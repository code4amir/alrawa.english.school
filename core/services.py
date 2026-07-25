import logging
from datetime import datetime, timezone
from django.db import transaction as db_transaction
from students.models import Student
from core.models import SchoolClass

logger = logging.getLogger(__name__)


def _new_roll_for_promotion(year, new_class_order, roll):
    """Generate {year}{classCode:02d}{rollNum} format, e.g. 20270201"""
    class_code = new_class_order + 1
    return f'{year}{class_code:02d}{roll}'


def promote_all(data, is_dry_run=False):
    """Execute end-of-year student promotion.

    Returns dict with keys: promoted, graduated, classesCreated, error.
    """
    now = datetime.now(timezone.utc)

    if 'from_class_id' in data and 'to_class_id' in data:
        return _simple_promote(data, is_dry_run)

    target_year_name = data.get('targetYearName')
    digits = target_year_name.lstrip('FY') if target_year_name else ''
    target_year = int(digits) if digits.isdigit() else None

    classes = list(SchoolClass.objects.order_by('order', 'name'))
    if not classes:
        return {'error': 'No classes found. Create classes before promoting.'}

    max_class_order = max(c.order for c in classes) if classes else 0

    promoted = []
    graduated = []
    classes_created = []

    class_by_order = {cls.order: cls for cls in classes}

    moves = []
    grads = []
    new_rolls = {}

    for cls in classes:
        students = list(Student.objects.filter(
            school_class=cls, deleted_at__isnull=True,
            graduated_at__isnull=True,
        ))
        if not students:
            continue

        next_order = cls.order + 1

        if next_order > max_class_order:
            grads.append((cls, students))
            continue

        next_class = class_by_order.get(next_order)
        if not next_class and not is_dry_run:
            next_class = SchoolClass.objects.create(name=f'Class {next_order + 1}', order=next_order)
            class_by_order[next_order] = next_class
            classes_created.append(next_class.name)
        elif not next_class:
            classes_created.append(f'Class {next_order + 1}')

        promoted.append({
            'from': cls.name,
            'to': next_class.name if next_class else f'Class {next_order + 1}',
            'count': len(students),
        })
        moves.append((cls, next_class, students))

        for s in students:
            old_roll = s.roll.lstrip('r')
            if target_year and next_class and old_roll.isdigit():
                new_roll = _new_roll_for_promotion(str(target_year), next_class.order, old_roll)
                new_rolls[s.id] = new_roll

    for cls, students in grads:
        for s in students:
            old_roll = s.roll.lstrip('r')
            if target_year and old_roll.isdigit():
                new_order = cls.order + 1
                new_roll = _new_roll_for_promotion(str(target_year), new_order, old_roll)
                new_rolls[s.id] = new_roll

    if not is_dry_run:
        # Update rolls first so the (roll, school_class) unique constraint is never
        # transiently violated while students are reassigned between classes.
        if new_rolls:
            students_to_update = Student.objects.filter(id__in=new_rolls.keys())
            for s in students_to_update:
                s.roll = new_rolls[s.id]
            Student.objects.bulk_update(students_to_update, ['roll'])

        for cls, next_class, students in moves:
            for s in students:
                s.school_class = next_class
            Student.objects.bulk_update(students, ['school_class'])

        for cls, students in grads:
            for s in students:
                s.graduated_at = now
                s.school_class = None
            Student.objects.bulk_update(students, ['graduated_at', 'school_class'])

        if target_year_name:
            session_value = target_year_name.lstrip('FY')
            Student.objects.filter(deleted_at__isnull=True).update(
                session=session_value,
            )

    return {
        'promoted': promoted,
        'graduated': [{'from': cls.name, 'count': len(students)} for cls, students in grads],
        'classesCreated': classes_created,
    }


def _simple_promote(data, is_dry_run):
    """Simple class-to-class promotion."""
    from_id = data['from_class_id']
    to_id = data['to_class_id']
    count = Student.objects.filter(
        school_class_id=from_id, deleted_at__isnull=True
    ).count()
    if not is_dry_run:
        Student.objects.filter(
            school_class_id=from_id, deleted_at__isnull=True
        ).update(school_class_id=to_id)
    from_name = SchoolClass.objects.filter(id=from_id).values_list('name', flat=True).first() or str(from_id)
    to_name = SchoolClass.objects.filter(id=to_id).values_list('name', flat=True).first() or str(to_id)
    return {
        'promoted': [{'from': from_name, 'to': to_name, 'count': count}],
        'graduated': [],
        'classesCreated': [],
    }


def auto_create_fee_schedules_for_service(service_type):
    """Create FeeSchedule entries for a ServiceType across all active AcademicYears."""
    from finance.models import FeeSchedule
    from core.models import AcademicYear

    active_years = AcademicYear.objects.filter(is_active=True)
    created = []
    for year in active_years:
        fs, was_created = FeeSchedule.objects.get_or_create(
            academic_year=year,
            school_class=None,
            category=service_type.name,
            frequency=service_type.frequency,
            defaults={
                'amount': service_type.default_amount,
                'applicability': 'ASSIGNED_ONLY',
            }
        )
        if was_created:
            created.append(fs)
    return created


def auto_create_service_fee_schedules_for_academic_year(academic_year):
    """Create FeeSchedule entries for all active ServiceTypes when a new AcademicYear is created."""
    from finance.models import FeeSchedule
    from core.models import ServiceType

    active_services = ServiceType.objects.filter(active=True)
    created = []
    for svc in active_services:
        fs, was_created = FeeSchedule.objects.get_or_create(
            academic_year=academic_year,
            school_class=None,
            category=svc.name,
            frequency=svc.frequency,
            defaults={
                'amount': svc.default_amount,
                'applicability': 'ASSIGNED_ONLY',
            }
        )
        if was_created:
            created.append(fs)
    return created
