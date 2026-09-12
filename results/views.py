import json
import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction as db_transaction
from .models import Result, ResultLock
from students.models import Student
from .serializers import ResultSerializer, ResultLockSerializer, SUBJECT_KEY_MAP
from accounts.permissions import require_permission, is_admin_or_superuser
from core.audit import log_audit
from core.models import SchoolSetting
from parents.services import notify_parents_of_student

logger = logging.getLogger(__name__)

TERM_LABELS = {'1': '1st Term', '2': '2nd Term', '3': '3rd Term'}


def _reject_if_locked(user, school_class_id, session, term):
    """C3: locked class × session × term rejects non-admin writes."""
    from rest_framework.exceptions import PermissionDenied
    if is_admin_or_superuser(user):
        return
    if not school_class_id or not session or term is None:
        return
    if ResultLock.objects.filter(
        school_class_id=school_class_id, session=session, term=str(term),
    ).exists():
        raise PermissionDenied(
            'This term is locked — ask an admin to unlock it before editing marks.'
        )


class ResultLockViewSet(viewsets.ModelViewSet):
    """Finalize switch (C3): list readable with results:read; create/delete
    need results:admin. POST {school_class, session, term} locks; DELETE the
    row unlocks."""

    queryset = ResultLock.objects.select_related('school_class', 'locked_by').all()
    serializer_class = ResultLockSerializer
    filterset_fields = ['school_class', 'session', 'term']

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('results:read')()]
        return [require_permission('results:admin')()]

    def perform_create(self, serializer):
        obj = serializer.save(locked_by=self.request.user)
        log_audit('lock', 'result_lock', entity_id=str(obj.pk), request=self.request,
                  details={'class': str(obj.school_class_id),
                           'term': obj.term, 'session': obj.session})

    def perform_destroy(self, instance):
        log_audit('unlock', 'result_lock', entity_id=str(instance.pk), request=self.request,
                  details={'class': str(instance.school_class_id),
                           'term': instance.term, 'session': instance.session})
        instance.delete()


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

        # Authorization is the results:write role gate ONLY. A finer
        # per-subject teaching-assignment check (tried in 3f11687) 403'd the
        # school's real teachers: TeacherSubject links are barely populated
        # (12 school-wide), and multiple teachers entering different subjects
        # on the same student row is the intended workflow. Server-side
        # atomic merge in update() keeps concurrent saves safe.
        student = serializer.validated_data.get('student')
        if student is not None:
            _reject_if_locked(request.user, student.school_class_id,
                              serializer.validated_data.get('session', ''),
                              serializer.validated_data.get('term'))
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        obj = serializer.save()
        log_audit('create', 'result', entity_id=obj.pk, request=self.request,
                  details={'student': str(obj.student_id),
                           'student_name': getattr(obj.student, 'name', ''),
                           'term': obj.term, 'session': obj.session,
                           'marks': dict(obj.marks or {})})

    def update(self, request, *args, **kwargs):
        from rest_framework.exceptions import PermissionDenied

        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        # Authorization is the results:write role gate only (see create()).
        _reject_if_locked(request.user, instance.student.school_class_id,
                          instance.session, instance.term)
        # Mass-clear guard: one non-admin save may not wipe many subjects off
        # a row at once — legitimate entry only ever clears one subject per
        # save (delta protocol), so 4+ explicit deletions in a single PATCH
        # is sabotage or a broken client. Admins are exempt.
        if not is_admin_or_superuser(request.user):
            incoming = serializer.validated_data.get('marks') or {}
            cleared = [k for k, v in incoming.items() if v is None]
            if len(cleared) >= 4:
                raise PermissionDenied(
                    f'Clearing {len(cleared)} subjects at once needs an admin '
                    f'({", ".join(sorted(cleared)[:4])}… ). Clear fewer subjects per save.'
                )
        # Atomic merge: one Result row holds EVERY subject's marks, and each
        # teacher's payload is built from their own page-load snapshot. A
        # plain replace here means the last teacher to save wipes subjects
        # saved by teachers who loaded earlier ("Saved ✓" on both screens,
        # blanks on next load). So merge incoming marks onto the locked
        # current row: missing key = keep, explicit null = delete subject.
        old_marks = dict(instance.marks or {})
        if 'marks' in serializer.validated_data:
            with db_transaction.atomic():
                current = Result.objects.select_for_update().get(pk=instance.pk)
                merged = dict(current.marks or {})
                for key, val in (serializer.validated_data['marks'] or {}).items():
                    if val is None:
                        merged.pop(key, None)
                    else:
                        merged[key] = val
                serializer.validated_data['marks'] = merged
                self.perform_update(serializer)
            new_marks = merged
        else:
            self.perform_update(serializer)
            new_marks = old_marks
        # Field-level history (C2): per-subject old→new so any incident reads
        # like a receipt — who changed what, from what to what — and the
        # recent-changes feed can render and revert it.
        changes = {}
        for key in old_marks.keys() | new_marks.keys():
            old, new = old_marks.get(key), new_marks.get(key)
            if old != new:
                changes[key] = {'from': old, 'to': new}
        log_audit('update', 'result', entity_id=str(instance.pk), request=request,
                  details={'student': str(instance.student_id),
                           'student_name': getattr(instance.student, 'name', ''),
                           'term': instance.term, 'session': instance.session,
                           'marks_changed': changes})
        return Response(serializer.data)

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
