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

    student = Student.objects.get(id=student_id)
    service_type = ServiceType.objects.get(id=service_type_id)

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
        fee_schedule = FeeSchedule.objects.create(
            academic_year=active_year,
            school_class=None,
            category=service_type.name,
            amount=service_type.default_amount,
            frequency=service_type.frequency,
            applicability='ASSIGNED_ONLY',
        )

    if fee_schedule:
        if active:
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
            elif not assignment.active:
                assignment.active = True
                if starts_at:
                    assignment.starts_at = starts_at
                if ends_at:
                    assignment.ends_at = ends_at
                assignment.save(update_fields=['active', 'starts_at', 'ends_at'])
                result['fee_assignment_created'] = True
        else:
            # Deactivate StudentFeeAssignment
            updated = StudentFeeAssignment.objects.filter(
                student=student,
                fee_schedule=fee_schedule,
                active=True,
            ).update(active=False)
            if updated:
                result['fee_assignment_removed'] = True

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
