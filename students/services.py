import logging
from django.db import transaction as db_transaction
from students.models import Student, StudentService
from core.models import ServiceType, AcademicYear

logger = logging.getLogger(__name__)


@db_transaction.atomic
def toggle_student_service(student_id, service_type_id, active, starts_at=None, ends_at=None):
    """Toggle a StudentService on/off. Auto-creates/removes StudentFeeAssignment.

    Returns dict with keys: student_service, fee_assignment_created, fee_assignment_removed.
    """
    from finance.models import FeeSchedule, StudentFeeAssignment
    from finance.views.base import _check_period_open, _fiscal_year_from_date
    from core.audit import log_audit

    student = Student.objects.get(id=student_id)
    service_type = ServiceType.objects.get(id=service_type_id)

    # Activating with no window creates a dateless assignment, which the
    # fee engine can never match (NULL never satisfies starts_at__lte /
    # ends_at__gte) — the student looks enrolled but is never billed.
    # Default missing ends of the window to the active academic year.
    if active and (not starts_at or not ends_at):
        active_year_for_window = AcademicYear.objects.filter(is_active=True).first()
        if active_year_for_window:
            starts_at = starts_at or active_year_for_window.start_date.strftime('%Y-%m')
            ends_at = ends_at or active_year_for_window.end_date.strftime('%Y-%m')

    # Find or create the StudentService record
    student_service, created = StudentService.objects.select_for_update().get_or_create(
        student=student,
        service_type=service_type,
        defaults={
            'active': active,
            'starts_at': starts_at,
            'ends_at': ends_at,
            'auto_assigned': True,
        }
    )

    if not created:
        # Update existing
        student_service.active = active
        if starts_at is not None:
            student_service.starts_at = starts_at
        if ends_at is not None:
            student_service.ends_at = ends_at
        student_service.save(update_fields=['active', 'starts_at', 'ends_at'])

    result = {
        'student_service': {
            'id': str(student_service.id),
            'active': student_service.active,
            'starts_at': student_service.starts_at,
            'ends_at': student_service.ends_at,
        },
        'fee_assignment_created': False,
        'fee_assignment_removed': False,
    }

    # Find the matching FeeSchedule (category = service_type.name, active academic year)
    active_year = AcademicYear.objects.filter(is_active=True).first()
    if not active_year:
        logger.warning('No active academic year found for fee auto-assignment')
        return result

    fee_schedule = FeeSchedule.objects.filter(
        academic_year=active_year,
        category=service_type.name,
        school_class__isnull=True,
    ).first()

    if not fee_schedule and active:
        # Auto-create FeeSchedule from ServiceType defaults
        _check_period_open(_fiscal_year_from_date(active_year.start_date))
        fee_schedule = FeeSchedule.objects.create(
            academic_year=active_year,
            school_class=None,
            category=service_type.name,
            amount=service_type.default_amount,
            frequency=service_type.frequency,
            applicability='ASSIGNED_ONLY',
        )
        log_audit('create', 'fee_schedule', entity_id=fee_schedule.pk,
                  details={'category': fee_schedule.category,
                           'academic_year': active_year.name,
                           'via': 'toggle_student_service'})

    if fee_schedule:
        if active:
            _check_period_open(_fiscal_year_from_date(
                fee_schedule.academic_year.start_date
                if getattr(fee_schedule, 'academic_year', None) and getattr(fee_schedule.academic_year, 'start_date', None)
                else active_year.start_date))
            # Create or reactivate StudentFeeAssignment
            assignment, was_created = StudentFeeAssignment.objects.get_or_create(
                student=student,
                fee_schedule=fee_schedule,
                defaults={
                    'active': True,
                    'starts_at': starts_at or student_service.starts_at,
                    'ends_at': ends_at or student_service.ends_at,
                }
            )
            if was_created:
                result['fee_assignment_created'] = True
                log_audit('create', 'student_fee_assignment', entity_id=assignment.pk,
                          details={'student_id': str(student.id),
                                   'fee_schedule_id': str(fee_schedule.id),
                                   'via': 'toggle_student_service'})
            elif not assignment.active:
                assignment.active = True
                if starts_at:
                    assignment.starts_at = starts_at
                if ends_at:
                    assignment.ends_at = ends_at
                assignment.save(update_fields=['active', 'starts_at', 'ends_at'])
                result['fee_assignment_created'] = True
                log_audit('update', 'student_fee_assignment', entity_id=assignment.pk,
                          details={'active': True, 'via': 'toggle_student_service'})
        else:
            # Deactivate StudentFeeAssignment
            active_rows = StudentFeeAssignment.objects.filter(
                student=student,
                fee_schedule=fee_schedule,
                active=True,
            )
            if active_rows.exists():
                _check_period_open(_fiscal_year_from_date(
                    fee_schedule.academic_year.start_date
                    if getattr(fee_schedule, 'academic_year', None) and getattr(fee_schedule.academic_year, 'start_date', None)
                    else active_year.start_date))
            updated = active_rows.update(active=False)
            if updated:
                result['fee_assignment_removed'] = True
                rows = StudentFeeAssignment.objects.filter(
                    student=student, fee_schedule=fee_schedule)
                for row in rows:
                    log_audit('update', 'student_fee_assignment', entity_id=row.pk,
                              details={'active': False, 'via': 'toggle_student_service'})

    return result


@db_transaction.atomic
def bulk_set_student_service(service_type_id, student_ids, active, starts_at=None, ends_at=None):
    """Toggle a service for multiple students at once."""
    results = []
    for sid in student_ids:
        try:
            r = toggle_student_service(sid, service_type_id, active, starts_at, ends_at)
            results.append({'student_id': sid, 'status': 'ok', **r})
        except Exception as e:
            results.append({'student_id': sid, 'status': 'error', 'error': str(e)})
    return results
