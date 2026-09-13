import time
import logging
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from .serializers import QuerySerializer
from .registry import REGISTRY
from .permission_filter import filter_functions_for_user
from .llm_service import call_ai_function, build_function_definitions
from .validator import validate_and_score
from .resolver import resolve_slots, memory
from .throttles import AIQueryRateThrottle
from .models import AIQueryLog
from accounts.permissions import is_admin_or_superuser

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = getattr(settings, 'AI_CONFIDENCE_THRESHOLD', 0.6)


class AIQueryView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AIQueryRateThrottle]

    def post(self, request):
        start = time.time()
        user = request.user
        ser = QuerySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        query = ser.validated_data['query']

        allowed = filter_functions_for_user(user, REGISTRY)
        if not allowed:
            return Response({
                'type': 'error',
                'explanation': 'You do not have permission to use any AI query features.',
                'data': [], 'columns': [], 'confidence': 0.0, 'meta': {},
            }, status=status.HTTP_403_FORBIDDEN)

        session = memory.get(str(user.id))
        system_prompt = _build_system_prompt(allowed, session)
        fn_defs = build_function_definitions(allowed)

        ai_result = call_ai_function(system_prompt, query, fn_defs)
        elapsed = int((time.time() - start) * 1000)

        if ai_result is None:
            _log_query(user, query, '', {}, 0.0, elapsed, 0, False, 'AI provider unavailable')
            return Response({
                'type': 'error',
                'explanation': 'The AI service is temporarily unavailable. Please try again.',
                'data': [], 'columns': [], 'confidence': 0.0, 'meta': {},
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if ai_result['type'] == 'text':
            return Response({
                'type': 'clarification',
                'explanation': ai_result.get('text', 'I could not understand your query. Please rephrase.'),
                'data': [], 'columns': [], 'confidence': 0.0, 'meta': {},
            })

        fn_name = ai_result['name']
        fn_args = ai_result['args']
        entry = REGISTRY.get(fn_name)

        if not entry:
            _log_query(user, query, fn_name, fn_args, 0.0, elapsed, 0, False, 'Unknown function')
            return Response({
                'type': 'error',
                'explanation': f'Unknown function: {fn_name}',
                'data': [], 'columns': [], 'confidence': 0.0, 'meta': {},
            })

        validated, confidence = validate_and_score(entry, fn_args)
        resolved = resolve_slots(fn_name, validated)

        if confidence < CONFIDENCE_THRESHOLD:
            _log_query(user, query, fn_name, resolved, confidence, elapsed, 0, True, 'Low confidence')
            return Response({
                'type': 'clarification',
                'explanation': f'I\'m not entirely sure what you mean. Could you clarify? (confidence: {confidence:.0%})',
                'data': [], 'columns': [], 'confidence': confidence, 'meta': {},
            })

        handler = entry['handler']
        try:
            result = handler(user, **resolved)
        except Exception as e:
            logger.exception(f"Handler {fn_name} failed")
            _log_query(user, query, fn_name, resolved, confidence, elapsed, 0, False, str(e))
            return Response({
                'type': 'error',
                'explanation': 'An error occurred while processing your query. Please try again.',
                'data': [], 'columns': [], 'confidence': confidence, 'meta': {},
            })

        memory.set(str(user.id), {
            'last_function': fn_name,
            'last_args': resolved,
        })

        result_count = len(result.get('data', []))
        _log_query(user, query, fn_name, resolved, confidence, elapsed, result_count, True, '')
        result['confidence'] = confidence
        result.setdefault('meta', {})
        result['meta']['execution_time_ms'] = elapsed
        result['meta']['result_count'] = result_count
        return Response(result)


def _build_system_prompt(allowed, session):
    names = ', '.join(e['name'] for e in allowed)
    prompt = (
        "You are an AI assistant for a school management system. "
        "Help users query school data by calling the appropriate function. "
        f"Available functions: {names}. "
    )
    if session:
        prompt += f"Current session context: last function was '{session.get('last_function', '')}' with args {session.get('last_args', {})}. "
    prompt += "If the query is unclear, respond with a text message asking for clarification."
    return prompt


def _log_query(user, query, fn_name, args, confidence, elapsed, count, success, error):
    try:
        AIQueryLog.objects.create(
            user=user if user.is_authenticated else None,
            query=query,
            function_called=fn_name,
            arguments=args,
            confidence=confidence,
            execution_time_ms=elapsed,
            result_count=count,
            success=success,
            error_message=error,
        )
    except Exception as e:
        logger.warning(f"AIQueryLog failed: {e}")
