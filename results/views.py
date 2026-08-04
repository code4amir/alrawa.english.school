import json
import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction as db_transaction
from .models import Result
from students.models import Student
from .serializers import ResultSerializer, SUBJECT_KEY_MAP
from accounts.permissions import require_permission, can_teach_subject, is_admin_or_superuser
from core.audit import log_audit
from core.models import SchoolSetting
from parents.services import notify_parents_of_student

logger = logging.getLogger(__name__)

TERM_LABELS = {'1': '1st Term', '2': '2nd Term', '3': '3rd Term'}


class ResultViewSet(viewsets.ModelViewSet):
    queryset = Result.objects.select_related('student').all()
    serializer_class = ResultSerializer
    filterset_fields = ['student_id', 'session', 'term']

    def create(self, request, *args, **kwargs):
        data = request.data.copy()
        student_id = self.kwargs.get('student_id')
        if student_id and 'student' not in data:
            data['student'] = student_id
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        if not is_admin_or_superuser(request.user):
            self._check_subject_permissions(serializer.validated_data, request.user)

        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        obj = serializer.save()
        log_audit('create', 'result', entity_id=obj.pk, request=self.request)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        if not is_admin_or_superuser(request.user):
            self._check_subject_permissions(serializer.validated_data, request.user)

        self.perform_update(serializer)
        log_audit('update', 'result', entity_id=str(instance.pk), request=request)
        return Response(serializer.data)

    def _check_subject_permissions(self, validated_data, user):
        from core.models import Subject
        from rest_framework.exceptions import PermissionDenied

        marks = validated_data.get('marks', {})
        if not marks:
            return

        student = validated_data.get('student')
        if not student:
            student_id = self.kwargs.get('student_id')
            if student_id:
                student = Student.objects.filter(id=student_id).first()

        if not student or not student.school_class_id:
            return

        class_id = student.school_class_id

        for subject_name in marks:
            canonical_name = SUBJECT_KEY_MAP.get(subject_name, subject_name)
            subject = Subject.objects.filter(
                name=canonical_name, school_class_id=class_id,
            ).first()
            if subject and not can_teach_subject(user, subject.id, class_id):
                raise PermissionDenied(
                    f'You are not assigned to teach "{canonical_name}" in this class.'
                )

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('results:read')()]
        if self.action in ['destroy', 'delete_class_results']:
            return [require_permission('results:admin')()]
        if self.action in ['publish_terms', 'published_terms']:
            return [require_permission('results:admin')()]
        return [require_permission('results:write')()]

    def get_queryset(self):
        qs = super().get_queryset()
        student_id = self.kwargs.get('student_id')
        if student_id:
            qs = qs.filter(student_id=student_id)
        class_id = self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(student__school_class_id=class_id)
        # Parent role: scope to linked students AND published terms only
        if self.request.user.is_authenticated and self.request.user.role == 'parent':
            student_ids = self.request.user.parent_links.values_list('student_id', flat=True)
            qs = qs.filter(student_id__in=student_ids)
            # Filter to published terms only
            from core.models import SchoolSetting
            setting = SchoolSetting.objects.filter(key='published_terms').first()
            if setting and setting.value:
                import json
                try:
                    published = json.loads(setting.value)
                    allowed_terms = set()
                    for session_terms in published.values():
                        allowed_terms.update(str(t) for t in session_terms)
                    if allowed_terms:
                        qs = qs.filter(term__in=allowed_terms)
                except (json.JSONDecodeError, TypeError):
                    qs = qs.none()  # no published terms = no results visible
            else:
                qs = qs.none()
        return qs

    @action(detail=False, methods=['get'])
    def class_results(self, request, class_id=None):
        if not class_id:
            class_id = request.query_params.get('class_id')
        session = request.query_params.get('session')
        term = request.query_params.get('term')

        if not all([class_id, session]):
            return Response({'error': 'class_id and session required'}, status=400)

        filters = {
            'student__school_class_id': class_id,
            'session': session,
        }
        if term:
            filters['term'] = term

        qs = self.get_queryset().filter(**filters).select_related('student')

        limit = int(request.query_params.get('limit', 200) if str(request.query_params.get('limit', '200')).isdigit() else 200)
        serializer = self.get_serializer(qs[:limit], many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def published_terms(self, request):
        setting = SchoolSetting.objects.filter(key='published_terms').first()
        if not setting or not setting.value:
            return Response({})
        try:
            return Response(json.loads(setting.value))
        except (json.JSONDecodeError, TypeError):
            return Response({})

    @action(detail=False, methods=['post'])
    def publish_terms(self, request):
        session = request.data.get('session', '')
        terms = request.data.get('terms', [])
        if not session or not isinstance(terms, list):
            return Response({'error': 'session and terms required'}, status=400)

        old = SchoolSetting.objects.filter(key='published_terms').first()
        old_val = {}
        if old and old.value:
            try:
                old_val = json.loads(old.value)
            except (json.JSONDecodeError, TypeError):
                old_val = {}
        old_set = set(old_val.get(session, []))

        new_terms = set(terms)
        added = new_terms - old_set

        setting, _ = SchoolSetting.objects.get_or_create(
            key='published_terms',
            defaults={'value': '{}'},
        )
        val = {}
        if setting.value:
            try:
                val = json.loads(setting.value)
            except (json.JSONDecodeError, TypeError):
                val = {}
        val[session] = terms
        setting.value = json.dumps(val)
        setting.save()

        if added and request.data.get('notify', True):
            for term in added:
                student_ids = Result.objects.filter(
                    session=session, term=str(term),
                ).values_list('student_id', flat=True).distinct()
                label = TERM_LABELS.get(str(term), f'Term {term}')
                for sid in student_ids:
                    try:
                        notify_parents_of_student(
                            sid, 'result_published',
                            f'{label} results published — {session}',
                            'Tap to view your child\'s results.',
                            url='/parent/results',
                        )
                    except Exception:
                        logger.exception('Failed to notify parent for student %s', sid)

        return Response(val)

    @action(detail=False, methods=['delete'])
    def delete_class_results(self, request, class_id=None):
        if not class_id:
            class_id = request.query_params.get('class_id')
        session = request.query_params.get('session')
        term = request.query_params.get('term')

        if not all([class_id, session, term]):
            return Response({'error': 'class_id, session, term required'}, status=400)

        with db_transaction.atomic():
            deleted, _ = Result.objects.filter(
                student__school_class_id=class_id,
                session=session,
                term=term,
            ).delete()
        log_audit('delete_class_results', 'result',
                  details={'class_id': class_id, 'session': session, 'term': term, 'deleted': deleted},
                  request=request)
        return Response({'deleted': deleted})
