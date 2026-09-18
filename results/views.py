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
from parents.services import notify_parents_of_students

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

        # No empty shells: a POST carrying no marks, no attendance and no
        # comment would create a blank row that haunts counts and the
        # integrity board forever (16 such rows landed 08-29 in one minute
        # from the pre-delta client). Attendance/comment-only saves pass —
        # they carry real data under an empty marks dict.
        marks = serializer.validated_data.get('marks') or {}
        has_data = (
            any(v is not None for v in marks.values())
            or serializer.validated_data.get('attendance') is not None
            or (serializer.validated_data.get('comment') or '') != ''
        )
        if not has_data:
            from rest_framework.exceptions import ValidationError
            raise ValidationError('Nothing to save: marks, attendance and comment are all empty.')

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
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        # Authorization is the results:write role gate only (see create()).
        _reject_if_locked(request.user, instance.student.school_class_id,
                          instance.session, instance.term)
        self._reject_mass_clear(request.user, serializer.validated_data.get('marks'))
        self._apply_validated_save(serializer, instance, request)
        return Response(serializer.data)

    def _reject_mass_clear(self, user, marks):
        # Mass-clear guard: one non-admin save may not wipe many subjects off
        # a row at once — legitimate entry only ever clears one subject per
        # save (delta protocol), so 4+ explicit deletions in a single PATCH
        # is sabotage or a broken client. Admins are exempt.
        from rest_framework.exceptions import PermissionDenied
        if is_admin_or_superuser(user):
            return
        cleared = [k for k, v in (marks or {}).items() if v is None]
        if len(cleared) >= 4:
            raise PermissionDenied(
                f'Clearing {len(cleared)} subjects at once needs an admin '
                f'({", ".join(sorted(cleared)[:4])}… ). Clear fewer subjects per save.'
            )

    def _apply_validated_save(self, serializer, instance, request):
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

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk(self, request):
        """Whole-grid save in ONE request (not N per-student round trips).

        Body: {session, term, items: [{student, marks?, attendance?, comment?}]}.
        The old per-student loop fired 60+ rapid requests per class save —
        the pattern that trips edge firewalls into IP bans. Per-item guards
        are identical to single saves (lock, mass-clear, max-marks); partial
        success by design:
        200 {saved: [studentIds], skipped: [studentIds], failed: [{student, error}]}.
        """
        from django.db import IntegrityError
        from rest_framework.exceptions import PermissionDenied, ValidationError

        session = request.data.get('session', '')
        term = request.data.get('term')
        items = request.data.get('items', [])
        if term is None or not isinstance(items, list):
            return Response({'error': 'term and items[] required'},
                            status=status.HTTP_400_BAD_REQUEST)
        term = str(term)
        saved, skipped, failed = [], [], []

        def _err(e):
            detail = getattr(e, 'detail', None) or str(e)
            if isinstance(detail, dict):
                first = next(iter(detail.values()), 'Invalid data.')
                detail = first[0] if isinstance(first, list) else first
            return str(detail)[:200]

        # Prefetch everything the loop needs (4 queries, flat in batch
        # size): students, existing result rows, subject limits, locks.
        # Per-item validation then touches zero tables: the serializer's
        # student-FK lookup is served from the prefetched dict and the
        # uniqueness check reads the prefetched row map.
        import uuid as _uuid
        sid_strs = []
        for item in items:
            sid = item.get('student') if isinstance(item, dict) else None
            if sid:
                try:
                    sid_strs.append(str(_uuid.UUID(str(sid))))
                except (ValueError, TypeError, AttributeError):
                    pass
        students_by_id = (
            {str(s.id): s for s in Student.objects.select_related(
                'school_class').filter(id__in=sid_strs)}
            if sid_strs else {}
        )
        results_by_sid = (
            {str(r.student_id): r for r in Result.objects.filter(
                student_id__in=list(students_by_id.keys()),
                term=term, session=session).select_related('student')}
            if students_by_id else {}
        )
        class_ids = {
            s.school_class_id for s in students_by_id.values()
            if s.school_class_id
        }
        limits_by_class = {}
        if class_ids:
            from core.models import Subject
            for sc_id, name, full in Subject.objects.filter(
                school_class_id__in=class_ids,
            ).values_list('school_class_id', 'name', 'full_marks'):
                limits_by_class.setdefault(sc_id, {})[name] = full
        is_admin = is_admin_or_superuser(request.user)
        locked_class_ids = set()
        if class_ids and not is_admin:
            locked_class_ids = set(ResultLock.objects.filter(
                school_class_id__in=class_ids,
                session=session, term=term,
            ).values_list('school_class_id', flat=True))

        def _serializer(instance, student, data, partial):
            ctx = self.get_serializer_context()
            ctx['subject_limits'] = limits_by_class.get(student.school_class_id, {})
            ser = self.get_serializer(instance, data=data, partial=partial, context=ctx)
            # Serve the student-FK lookup from the prefetched dict instead
            # of one SELECT per item (identical outcome: these ids were all
            # just fetched above; unknown ids fail the same way).
            fld = ser.fields.get('student')
            if fld is not None:
                def _cached_to_internal(value):
                    try:
                        key = str(_uuid.UUID(str(value)))
                    except (ValueError, TypeError, AttributeError):
                        key = str(value)
                    inst = students_by_id.get(key)
                    if inst is None:
                        from rest_framework import serializers as _serializers
                        raise _serializers.ValidationError('Student not found.')
                    return inst
                fld.to_internal_value = _cached_to_internal
            # Drop the (student, term, session) uniqueness SELECT: the
            # prefetched row map above already routes every item to
            # create-vs-update, the DB constraint still guards the write,
            # and the race fallback below merges on conflict.
            from rest_framework.validators import (
                UniqueTogetherValidator, UniqueValidator)
            ser.validators = [
                v for v in ser.validators
                if not isinstance(v, (UniqueValidator, UniqueTogetherValidator))
            ]
            return ser

        # Phase 1 (0 queries): validate every item, merge onto in-memory
        # rows. Phase 2 (3 queries): ONE transaction with bulk_create +
        # bulk_update + ONE audit row for the batch.
        pending = {}  # sid str -> Result (existing row or new in-memory row)
        to_create = []
        to_update = []
        updated_keys = set()

        def _pending_for(student):
            key = str(student.id)
            obj = pending.get(key)
            if obj is None:
                obj = results_by_sid.get(key)
                if obj is not None:
                    pending[key] = obj
            return obj

        for item in items:
            sid = item.get('student') if isinstance(item, dict) else None
            try:
                if not sid:
                    raise ValidationError('Missing student.')
                try:
                    sid_key = str(_uuid.UUID(str(sid)))
                except (ValueError, TypeError, AttributeError):
                    sid_key = str(sid)
                student = students_by_id.get(sid_key)
                if not student:
                    raise ValidationError('Student not found.')
                if student.school_class_id in locked_class_ids:
                    raise PermissionDenied(
                        'This term is locked — ask an admin to unlock it '
                        'before editing marks.'
                    )
                data = {'student': str(student.id), 'session': session, 'term': term}
                for key in ('marks', 'attendance', 'comment'):
                    if isinstance(item, dict) and key in item:
                        data[key] = item[key]
                marks = data.get('marks') or {}
                instance = _pending_for(student)
                serializer = _serializer(
                    instance, student, data=data, partial=bool(instance))
                serializer.is_valid(raise_exception=True)
                # Mass-clear guard BEFORE the empty-skip below: an all-null
                # wipe must 403, not slip through as "nothing to do".
                self._reject_mass_clear(request.user, serializer.validated_data.get('marks'))
                has_data = (
                    any(v is not None for v in marks.values())
                    or data.get('attendance') is not None
                    or (data.get('comment') or '') != ''
                )
                if not has_data:
                    skipped.append(str(student.id))
                    continue
                validated = serializer.validated_data
                if instance is None:
                    obj = Result(
                        student=student, session=session, term=term,
                        marks=dict(validated.get('marks') or {}),
                        attendance=validated.get('attendance'),
                        comment=validated.get('comment') or '',
                    )
                    pending[str(student.id)] = obj
                    to_create.append(obj)
                else:
                    if 'marks' in validated:
                        merged = dict(instance.marks or {})
                        for key, val in (validated['marks'] or {}).items():
                            if val is None:
                                merged.pop(key, None)
                            else:
                                merged[key] = val
                        instance.marks = merged
                    if 'attendance' in validated:
                        instance.attendance = validated['attendance']
                    if 'comment' in validated:
                        instance.comment = validated['comment']
                    if str(student.id) not in updated_keys:
                        updated_keys.add(str(student.id))
                        to_update.append(instance)
                saved.append(str(student.id))
            except (ValidationError, PermissionDenied) as e:
                failed.append({'student': str(sid), 'error': _err(e)})
            except Exception:
                logger.exception('Bulk result save failed for student %s', sid)
                failed.append({'student': str(sid), 'error': 'Unexpected error — retry.'})

        # Phase 2: one transaction, bulk writes, ONE audit row.
        # (New in-memory rows already carry a client-side UUID pk from the
        # field default — that never marks them as "existing"; only
        # to_update holds prefetched rows.)
        try:
            with db_transaction.atomic():
                if to_create:
                    Result.objects.bulk_create(to_create)
                if to_update:
                    Result.objects.bulk_update(
                        to_update, ['marks', 'attendance', 'comment'])
                log_audit('bulk_save', 'result', request=request,
                          details={'session': session, 'term': term,
                                   'saved': saved, 'skipped': skipped,
                                   'failed': failed})
        except IntegrityError:
            # Lost a create race with another teacher mid-batch: merge the
            # conflicting rows onto what just appeared, one by one. Only
            # this path costs extra queries, and only on a real race.
            # (The atomic block rolled back, but the in-memory objects
            # still hold their merged values — replay them.)
            logger.warning('Bulk result save hit a create race; merging.')
            for obj in to_create:
                instance = Result.objects.filter(
                    student=obj.student, term=term, session=session).first()
                if instance is None:
                    try:
                        obj.save()
                    except IntegrityError:
                        instance = Result.objects.filter(
                            student=obj.student, term=term,
                            session=session).first()
                        if instance is None:
                            raise
                    else:
                        continue
                merged = dict(instance.marks or {})
                for key, val in (obj.marks or {}).items():
                    if val is None:
                        merged.pop(key, None)
                    else:
                        merged[key] = val
                instance.marks = merged
                if obj.attendance is not None:
                    instance.attendance = obj.attendance
                if obj.comment:
                    instance.comment = obj.comment
                instance.save()
            for instance in to_update:
                fresh = Result.objects.filter(pk=instance.pk).first()
                if fresh is None:
                    instance.save()
                    continue
                fresh.marks = instance.marks
                fresh.attendance = instance.attendance
                fresh.comment = instance.comment
                fresh.save()
            log_audit('bulk_save', 'result', request=request,
                      details={'session': session, 'term': term,
                               'saved': saved, 'skipped': skipped,
                               'failed': failed})
        return Response({'saved': saved, 'skipped': skipped, 'failed': failed})

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
        # Phase 0: exclude soft-deleted/transferred students — their stale
        # rows used to haunt class results, tabulation and ranks (same bug
        # class as the attendance orphan counts).
        qs = qs.filter(student__deleted_at__isnull=True)
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
                student_ids = list(Result.objects.filter(
                    session=session, term=str(term),
                ).values_list('student_id', flat=True).distinct())
                if not student_ids:
                    continue
                label = TERM_LABELS.get(str(term), f'Term {term}')
                try:
                    notify_parents_of_students(
                        student_ids, 'result_published',
                        f'{label} results published — {session}',
                        'Tap to view your child\'s results.',
                        url='/#/parent/results',
                    )
                except Exception:
                    logger.exception(
                        'Failed to notify parents for %s term %s',
                        session, term)

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
