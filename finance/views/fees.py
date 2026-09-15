from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction as db_transaction
from django.utils import timezone

from finance.models import FeeSchedule, FeeWaiver, StudentFeeAssignment
from students.models import Student
from finance.serializers import (
    FeeScheduleSerializer, FeeScheduleCopySerializer,
    FeeWaiverSerializer, StudentFeeAssignmentSerializer,
    StudentFeeAssignmentToggleSerializer, BulkAssignSerializer
)
from accounts.permissions import require_permission
from core.cache_headers import PrivateRefDataCacheMixin
from .base import PeriodClosedMixin, _param, _resolve_fiscal_year, _check_period_open
from core.audit import log_audit, AuditLogMixin


def _check_schedule_period_open(fee_schedule_id):
    """Block assignment edits when the schedule's fiscal year is closed.

    Custom actions (toggle/bulk) bypass PeriodClosedMixin, so they check here.
    """
    schedule = FeeSchedule.objects.select_related('academic_year').filter(
        id=fee_schedule_id
    ).first()
    if schedule is None:
        return
    fiscal_year = _resolve_fiscal_year({'fee_schedule': schedule})
    if fiscal_year:
        _check_period_open(fiscal_year)

class FeeScheduleViewSet(PrivateRefDataCacheMixin, PeriodClosedMixin, AuditLogMixin, viewsets.ModelViewSet):
    queryset = FeeSchedule.objects.select_related('academic_year', 'school_class').all()
    serializer_class = FeeScheduleSerializer
    filterset_fields = ['academic_year_id', 'school_class_id', 'category']

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    @action(detail=False, methods=['post'])
    def copy_from_year(self, request):
        serializer = FeeScheduleCopySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from core.models import AcademicYear
        from finance.views.base import _fiscal_year_from_date as _fy_from_date
        try:
            target_year = AcademicYear.objects.get(
                id=serializer.validated_data['to_academic_year_id'])
        except AcademicYear.DoesNotExist:
            from rest_framework.exceptions import ValidationError as _VE
            raise _VE({'targetAcademicYearId': 'Target academic year not found.'})
        _check_period_open(_fy_from_date(target_year.start_date))
        with db_transaction.atomic():
            from_year_id = serializer.validated_data['from_academic_year_id']
            to_year_id = serializer.validated_data['to_academic_year_id']
            schedules = FeeSchedule.objects.filter(
                academic_year_id=from_year_id
            ).select_related('school_class')
            count = 0
            for s in schedules:
                _, created = FeeSchedule.objects.get_or_create(
                    academic_year_id=to_year_id,
                    school_class=s.school_class,
                    category=s.category,
                    frequency=s.frequency,
                    defaults={
                        'amount': s.amount,
                        'applicability': s.applicability,
                    }
                )
                if created:
                    count += 1
        log_audit('copy_from_year', 'fee_schedule',
                  details={'from_year': from_year_id, 'to_year': to_year_id, 'copied': count},
                  request=request)
        return Response({'copied': count})


class FeeWaiverViewSet(PeriodClosedMixin, AuditLogMixin, viewsets.ModelViewSet):
    queryset = FeeWaiver.objects.select_related('student', 'fee_schedule').all()
    serializer_class = FeeWaiverSerializer

    def perform_create(self, serializer):
        # FeeWaiverViewSet overrides the mixin, so enforce the period lock here.
        fiscal_year = _resolve_fiscal_year(serializer.validated_data)
        if fiscal_year:
            _check_period_open(fiscal_year)
        # Only stamp approval when the waiver is actually created approved;
        # a pending waiver must not look approved.
        if serializer.validated_data.get('approval_status') == 'approved':
            serializer.save(
                approved_by=str(self.request.user.id),
                approved_at=timezone.now(),
            )
        else:
            serializer.save()

    def perform_update(self, serializer):
        # Period lock follows the existing waiver's schedule year.
        fiscal_year = _resolve_fiscal_year(serializer.instance)
        if fiscal_year:
            _check_period_open(fiscal_year)
        # Transitioning to approved stamps the approver; callers cannot
        # self-approve (approved_by/approved_at are read-only).
        if (serializer.validated_data.get('approval_status') == 'approved'
                and getattr(serializer.instance, 'approval_status', None) != 'approved'):
            serializer.save(
                approved_by=str(self.request.user.id),
                approved_at=timezone.now(),
            )
        else:
            serializer.save()

    def get_queryset(self):
        qs = super().get_queryset()
        student_id = _param(self.request, 'student_id', 'studentId')
        fee_schedule_id = _param(self.request, 'fee_schedule_id', 'feeScheduleId')
        active = _param(self.request, 'active')
        if student_id:
            qs = qs.filter(student_id=student_id)
        if fee_schedule_id:
            qs = qs.filter(fee_schedule_id=fee_schedule_id)
        if active is not None:
            qs = qs.filter(active=(active.lower() == 'true'))
        return qs

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        waiver = self.get_object()
        fiscal_year = _resolve_fiscal_year(waiver)
        if fiscal_year:
            _check_period_open(fiscal_year)
        waiver.approval_status = 'approved'
        waiver.approved_by = str(request.user.id)
        waiver.approved_at = timezone.now()
        waiver.save(update_fields=['approval_status', 'approved_by', 'approved_at'])
        log_audit('approve', 'fee_waiver', entity_id=waiver.pk, request=request)
        return Response(FeeWaiverSerializer(waiver).data)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        waiver = self.get_object()
        fiscal_year = _resolve_fiscal_year(waiver)
        if fiscal_year:
            _check_period_open(fiscal_year)
        waiver.active = False
        waiver.save(update_fields=['active'])
        log_audit('deactivate', 'fee_waiver', entity_id=waiver.pk, request=request)
        return Response(FeeWaiverSerializer(waiver).data)


class StudentFeeAssignmentViewSet(PeriodClosedMixin, AuditLogMixin, viewsets.ModelViewSet):
    queryset = StudentFeeAssignment.objects.select_related('student', 'fee_schedule').all()
    serializer_class = StudentFeeAssignmentSerializer

    def perform_create(self, serializer):
        # This overrides PeriodClosedMixin.perform_create, so enforce the
        # period lock here.
        fiscal_year = _resolve_fiscal_year(serializer.validated_data)
        if fiscal_year:
            _check_period_open(fiscal_year)
        # UniqueConstraint(student, fee_schedule) backs this; turn a race
        # duplicate into a 400 instead of a 500.
        from django.db import IntegrityError
        from rest_framework.exceptions import ValidationError
        try:
            serializer.save()
        except IntegrityError:
            raise ValidationError({'fee_schedule': 'This student is already assigned to this fee.'})

    def get_queryset(self):
        qs = super().get_queryset()
        student_id = _param(self.request, 'student_id', 'studentId')
        fee_schedule_id = _param(self.request, 'fee_schedule_id', 'feeScheduleId')
        active = _param(self.request, 'active')
        if student_id:
            qs = qs.filter(student_id=student_id)
        if fee_schedule_id:
            qs = qs.filter(fee_schedule_id=fee_schedule_id)
        if active is not None:
            qs = qs.filter(active=(active.lower() == 'true'))
        return qs

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    @action(detail=False, methods=['post'])
    def toggle(self, request):
        serializer = StudentFeeAssignmentToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        _check_schedule_period_open(data['fee_schedule_id'])

        assignment, created = StudentFeeAssignment.objects.select_related(
            'student', 'fee_schedule'
        ).get_or_create(
            student_id=data['student_id'],
            fee_schedule_id=data['fee_schedule_id'],
            defaults={
                'active': data['active'],
                'starts_at': data.get('startsAt'),
                'ends_at': data.get('endsAt'),
            },
        )

        if created:
            if assignment.active != data['active']:
                update_fields = ['active']
                assignment.active = data['active']
                if data.get('startsAt'):
                    assignment.starts_at = data['startsAt']
                    update_fields.append('starts_at')
                if data.get('endsAt'):
                    assignment.ends_at = data['endsAt']
                    update_fields.append('ends_at')
                assignment.save(update_fields=update_fields)
        else:
            update_fields = ['active']
            assignment.active = data['active']
            if data.get('startsAt'):
                assignment.starts_at = data['startsAt']
                update_fields.append('starts_at')
            if data.get('endsAt'):
                assignment.ends_at = data['endsAt']
                update_fields.append('ends_at')
            assignment.save(update_fields=update_fields)

        log_audit('toggle', 'student_fee_assignment',
                  entity_id=assignment.pk,
                  details={'active': data['active']}, request=request)
        return Response(StudentFeeAssignmentSerializer(assignment).data)

    @action(detail=False, methods=['post'])
    def bulk(self, request):
        serializer = BulkAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        students = Student.objects.filter(
            school_class_id=data['class_id'],
            deleted_at__isnull=True
        )

        _check_schedule_period_open(data['fee_schedule_id'])

        with db_transaction.atomic():
            existing = set(
                StudentFeeAssignment.objects.filter(
                    student__in=students,
                    fee_schedule_id=data['fee_schedule_id'],
                ).values_list('student_id', flat=True)
            )
            new_assignments = [
                StudentFeeAssignment(
                    student=s,
                    fee_schedule_id=data['fee_schedule_id'],
                    active=data.get('active', True),
                    starts_at=data.get('startsAt'),
                    ends_at=data.get('endsAt')
                )
                for s in students if s.id not in existing
            ]
            StudentFeeAssignment.objects.bulk_create(new_assignments)
            count = len(new_assignments)
        log_audit('bulk_assign', 'student_fee_assignment',
                  details={'class_id': str(data['class_id']), 'fee_schedule_id': str(data['fee_schedule_id']),
                           'assigned': count}, request=request)
        return Response({'assigned': count})
