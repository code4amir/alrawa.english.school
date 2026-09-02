import logging
from datetime import timedelta

from django.contrib.auth.hashers import make_password, check_password
from django.db import transaction as db_transaction
from rest_framework.decorators import api_view, permission_classes, authentication_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from accounts.throttles import PinLoginRateThrottle
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import PinAuthentication

from .models import Teacher, ClassTeacher
from students.models import Student
from core.models import SchoolClass, SchoolSetting
from attendance.models import AttendanceRecord, Holiday
from attendance.serializers import HolidaySerializer, BulkHolidaySerializer
from core.audit import log_audit

logger = logging.getLogger(__name__)
WEEKEND_DAYS_DEFAULT = '4,5'


from datetime import timedelta, datetime

class PinAccessToken(AccessToken):
    lifetime = timedelta(hours=24)


def _parse_date(value):
    """Parse a YYYY-MM-DD string into a date, raising ValueError if malformed."""
    return datetime.strptime(value, '%Y-%m-%d').date()


def _make_pin_token(teacher):
    token = PinAccessToken()
    token['teacher_id'] = str(teacher.id)
    token['teacher_name'] = teacher.name
    token['pin_auth'] = True
    return str(token)


def _get_weekend_set():
    try:
        raw = SchoolSetting.objects.get(key='weekend_days').value
        return {int(x.strip()) for x in raw.split(',') if x.strip().isdigit()}
    except SchoolSetting.DoesNotExist:
        return {int(x) for x in WEEKEND_DAYS_DEFAULT.split(',')}


def _get_holiday_dates(year=None, month=None):
    qs = Holiday.objects.all()
    if year:
        qs = qs.filter(date__year=year)
    if month is not None:
        qs = qs.filter(date__month=month)
    return set(qs.values_list('date', flat=True))


def _admin_or_monitor(teacher):
    """True when the PIN-authenticated teacher's linked account is admin/monitor.

    Admin and monitor have full academic authority (browser app parity): they can
    submit attendance and view reports for ANY class without being assigned as a
    class teacher.
    """
    user = getattr(teacher, 'user', None)
    if user is None:
        return False
    return bool(getattr(user, 'is_superuser', False)) or user.role in ('admin', 'monitor')


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([PinLoginRateThrottle])
def pin_login(request):
    teacher_id = request.data.get('teacher_id')
    pin = request.data.get('pin')

    if not teacher_id or not pin:
        return Response({'error': 'teacher_id and pin are required'}, status=400)

    if not pin.isdigit() or len(pin) != 6:
        return Response({'error': 'PIN must be exactly 6 digits'}, status=400)

    try:
        teacher = Teacher.objects.get(id=teacher_id, deleted_at__isnull=True)
    except Teacher.DoesNotExist:
        return Response({'error': 'Teacher not found'}, status=404)

    if not teacher.pin:
        return Response({'error': 'No PIN set for this teacher'}, status=400)

    if not check_password(pin, teacher.pin):
        return Response({'error': 'Invalid PIN'}, status=403)

    token = _make_pin_token(teacher)

    if _admin_or_monitor(teacher):
        # Admin/monitor: full academic authority — no class-teacher assignment needed.
        classes = SchoolClass.objects.all().order_by('order', 'name')
    else:
        classes = ClassTeacher.objects.filter(
            teacher=teacher,
        ).select_related('school_class').values(
            'school_class__id', 'school_class__name', 'school_class__order',
        ).order_by('school_class__order', 'school_class__name')

    def _class_pair(c):
        """Extract (id, name) from either a values() dict or a SchoolClass model."""
        if isinstance(c, dict):
            return str(c.get('school_class__id') or c.get('id')), c.get('school_class__name') or c.get('name')
        return str(c.id), c.name

    return Response({
        'token': token,
        'teacher': {
            'id': str(teacher.id),
            'name': teacher.name,
            'designation': teacher.designation,
            'role': getattr(getattr(teacher, 'user', None), 'role', None),
        },
        'classes': [
            {'id': cid, 'name': cname}
            for c in classes
            for cid, cname in [_class_pair(c)]
        ],
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def set_pin(request):
    admin_user = getattr(request.user, 'is_superuser', False) or getattr(request.user, 'is_staff', False)
    if not request.user.is_authenticated or not admin_user:
        return Response({'error': 'Admin access required'}, status=403)

    teacher_id = request.data.get('teacher_id')
    pin = request.data.get('pin')

    if not teacher_id or not pin:
        return Response({'error': 'teacher_id and pin are required'}, status=400)

    if not pin.isdigit() or len(pin) != 6:
        return Response({'error': 'PIN must be exactly 6 digits'}, status=400)

    try:
        teacher = Teacher.objects.get(id=teacher_id)
    except Teacher.DoesNotExist:
        return Response({'error': 'Teacher not found'}, status=404)

    teacher.pin = make_password(pin)
    teacher.save(update_fields=['pin'])

    return Response({'status': 'ok'})


@api_view(['GET'])
@permission_classes([AllowAny])
def mobile_teachers(request):
    teachers = Teacher.objects.filter(
        deleted_at__isnull=True,
    ).exclude(pin='').values('id', 'name', 'designation').order_by('name')

    return Response({
        'teachers': [
            {'id': str(t['id']), 'name': t['name'], 'designation': t['designation']}
            for t in teachers
        ],
    })


@api_view(['GET'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_students(request):
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)
    teacher = request.user

    class_id = request.query_params.get('class_id')
    if not class_id:
        return Response({'error': 'class_id query param is required'}, status=400)

    if not _admin_or_monitor(teacher) and not ClassTeacher.objects.filter(teacher=teacher, school_class_id=class_id).exists():
        return Response({'error': 'You are not assigned to this class'}, status=403)

    try:
        school_class = SchoolClass.objects.get(id=class_id)
    except SchoolClass.DoesNotExist:
        return Response({'error': 'Class not found'}, status=404)

    students = Student.objects.filter(
        school_class=school_class,
        deleted_at__isnull=True,
    ).order_by('roll', 'name').values('id', 'name', 'roll', 'photo_path')

    return Response({
        'class': {'id': str(school_class.id), 'name': school_class.name},
        'students': list(students),
    })


@api_view(['GET'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_get_attendance(request):
    """Get existing attendance records for a class+date (PIN auth)."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)

    class_id = request.query_params.get('class_id')
    date_param = request.query_params.get('date')
    if not class_id or not date_param:
        return Response({'error': 'class_id and date are required'}, status=400)

    records = AttendanceRecord.objects.filter(
        school_class_id=class_id, date=date_param,
    ).values('student', 'status', 'term', 'session')

    return Response(list(records))


@api_view(['POST'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_batch_attendance(request):
    """Batch create/update attendance records (PIN auth)."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)
    teacher = request.user

    class_id = request.data.get('school_class')
    date_str = request.data.get('date')
    term = request.data.get('term')
    session_data = request.data.get('session')
    records = request.data.get('records')

    if not class_id or not date_str or not records:
        return Response({'error': 'school_class, date, and records are required'}, status=400)

    from datetime import datetime
    try:
        att_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return Response({'error': 'Invalid date format (YYYY-MM-DD)'}, status=400)

    if not isinstance(records, dict) or len(records) == 0:
        return Response({'error': 'records must be a non-empty object'}, status=400)

    try:
        school_class = SchoolClass.objects.get(id=class_id)
    except SchoolClass.DoesNotExist:
        return Response({'error': 'School class not found'}, status=404)

    if not _admin_or_monitor(teacher) and not ClassTeacher.objects.filter(teacher=teacher, school_class=school_class).exists():
        return Response({'error': 'You are not assigned to this class'}, status=403)

    # Validate students
    student_ids = list(records.keys())
    existing = Student.objects.filter(id__in=student_ids, school_class_id=class_id)
    if existing.count() != len(student_ids):
        return Response({'error': 'One or more students not found in this class'}, status=400)

    # Validate date is not weekend
    weekend_set = _get_weekend_set()
    if att_date.weekday() in weekend_set:
        return Response({'error': 'Cannot mark attendance on a weekend day'}, status=400)

    # Validate date is not holiday
    holiday_set = _get_holiday_dates(year=att_date.year)
    if att_date in holiday_set:
        return Response({'error': 'Cannot mark attendance on a holiday'}, status=400)

    with db_transaction.atomic():
        for student_id, status_val in records.items():
            AttendanceRecord.objects.update_or_create(
                student_id=student_id, date=att_date,
                defaults={
                    'school_class': school_class,
                    'term': term or '',
                    'session': session_data or '',
                    'status': status_val,
                    'marked_by': None,
                },
            )

    log_audit('batch_attendance', 'attendance',
              details={'class_id': str(class_id), 'date': str(att_date),
                       'term': term, 'session': session_data, 'count': len(records),
                       'via': 'pin_auth', 'teacher': teacher.name},
              request=request)

    return Response({'status': 'ok', 'count': len(records)})


@api_view(['GET'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_class_daily_report(request):
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)

    teacher = request.user

    class_id = request.query_params.get('class_id')
    date_param = request.query_params.get('date')
    from_param = request.query_params.get('from')
    to_param = request.query_params.get('to')

    if not class_id:
        return Response({'error': 'class_id is required'}, status=400)

    try:
        school_class = SchoolClass.objects.get(id=class_id)
    except SchoolClass.DoesNotExist:
        return Response({'error': 'Class not found'}, status=404)

    if not _admin_or_monitor(teacher) and not ClassTeacher.objects.filter(teacher=teacher, school_class=school_class).exists():
        return Response({'error': 'You are not assigned to this class'}, status=403)

    students = list(
        Student.objects.filter(school_class=school_class, deleted_at__isnull=True)
        .order_by('roll', 'name').values('id', 'name', 'roll')
    )

    # Range mode: when both `from` and `to` are supplied, return a per-student
    # grid across the date span (used for arbitrary-range attendance checks).
    if from_param and to_param:
        try:
            from_date = _parse_date(from_param)
            to_date = _parse_date(to_param)
        except ValueError:
            return Response({'error': 'Invalid from/to date (use YYYY-MM-DD)'}, status=400)
        if from_date > to_date:
            return Response({'error': 'from must be on or before to'}, status=400)

        records = AttendanceRecord.objects.filter(
            school_class=school_class, date__gte=from_date, date__lte=to_date,
        ).values('student_id', 'date', 'status')

        # student_id -> {iso_date: status}
        rec_map = {}
        for r in records:
            try:
                rec_map.setdefault(str(r['student_id']), {})[r['date'].isoformat()] = str(r['status'])
            except (KeyError, TypeError, ValueError):
                logger.warning('mobile_class_daily_report: skipping invalid record %r', r, exc_info=True)
                continue

        span_days = []
        cur = from_date
        while cur <= to_date:
            span_days.append(cur.isoformat())
            cur += timedelta(days=1)

        rows = []
        for s in students:
            per_day = rec_map.get(str(s['id']), {})
            present = sum(1 for st in per_day.values() if st == 'present')
            absent = sum(1 for st in per_day.values() if st == 'absent')
            rows.append({
                'id': str(s['id']), 'name': s['name'], 'roll': s['roll'] or '',
                'days': per_day,
                'present': present, 'absent': absent,
                'unmarked': len(span_days) - present - absent,
            })

        return Response({
            'class': {'id': str(school_class.id), 'name': school_class.name},
            'from': from_param, 'to': to_param,
            'total_students': len(students),
            'days': span_days,
            'students': rows,
        })

    # Single-date mode (original contract): require `date`.
    if not date_param:
        return Response({'error': 'date is required (or supply from and to for a range)'}, status=400)

    records = list(
        AttendanceRecord.objects.filter(school_class=school_class, date=date_param)
        .values('student_id', 'status')
    )

    records_map = {}
    for r in records:
        try:
            records_map[str(r['student_id'])] = str(r['status'])
        except (KeyError, TypeError, ValueError):
            logger.warning('mobile_class_daily_report: skipping invalid record %r', r, exc_info=True)
            continue

    present = 0
    absent = 0
    rows = []
    for s in students:
        st = records_map.get(str(s['id']), 'unmarked')
        if st == 'present':
            present += 1
        elif st == 'absent':
            absent += 1
        rows.append({
            'id': str(s['id']), 'name': s['name'], 'roll': s['roll'] or '', 'status': st,
        })

    return Response({
        'class': {'id': str(school_class.id), 'name': school_class.name},
        'date': date_param,
        'total_students': len(students),
        'present': present,
        'absent': absent,
        'unmarked': len(students) - present - absent,
        'students': rows,
    })

@api_view(['GET'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_monthly_report(request):
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)

    teacher = request.user

    class_id = request.query_params.get('class_id')
    year = request.query_params.get('year')
    month = request.query_params.get('month')
    from_date = request.query_params.get('from_date')
    to_date = request.query_params.get('to_date')

    # Range mode (from_date/to_date) or legacy month mode (year/month)
    if from_date and to_date:
        try:
            d_from = datetime.strptime(from_date, '%Y-%m-%d').date()
            d_to = datetime.strptime(to_date, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'Invalid from_date or to_date'}, status=400)
        if d_from > d_to:
            return Response({'error': 'from_date must be <= to_date'}, status=400)
    elif year and month:
        d_from = d_to = None
    else:
        return Response(
            {'error': 'class_id plus either (from_date & to_date) or (year & month) are required'},
            status=400,
        )

    if not class_id:
        return Response({'error': 'class_id is required'}, status=400)

    try:
        school_class = SchoolClass.objects.get(id=class_id)
    except SchoolClass.DoesNotExist:
        return Response({'error': 'Class not found'}, status=404)

    if not _admin_or_monitor(teacher) and not ClassTeacher.objects.filter(teacher=teacher, school_class=school_class).exists():
        return Response({'error': 'You are not assigned to this class'}, status=403)

    if d_from is not None:
        import calendar as _cal
        from datetime import date as _date
        day_list = []
        cur = d_from
        while cur <= d_to:
            day_list.append(cur)
            cur += timedelta(days=1)
        weekend_set = _get_weekend_set()
        holiday_set = {h for h in _get_holiday_dates(year=None, month=None) if d_from <= h <= d_to}
        resp_year, resp_month = d_from.year, d_from.month
        records = AttendanceRecord.objects.filter(
            school_class=school_class, date__gte=d_from, date__lte=d_to,
        ).values('student_id', 'date', 'status')
        days_in_range = day_list
    else:
        import calendar as _cal
        from datetime import date as _date
        year, month = int(year), int(month)
        _, days_in_month = _cal.monthrange(year, month)
        weekend_set = _get_weekend_set()
        holiday_set = _get_holiday_dates(year=year, month=month)
        resp_year, resp_month = year, month
        records = AttendanceRecord.objects.filter(
            school_class=school_class, date__year=year, date__month=month,
        ).values('student_id', 'date', 'status')
        days_in_range = [_date(year, month, day) for day in range(1, days_in_month + 1)]

    students = list(
        Student.objects.filter(school_class=school_class, deleted_at__isnull=True)
        .order_by('roll', 'name').values('id', 'name', 'roll')
    )

    records_map = {}
    for r in records:
        try:
            records_map.setdefault(str(r['student_id']), {})[r['date'].isoformat()] = str(r['status'])
        except (KeyError, TypeError, ValueError):
            logger.warning('mobile_monthly_report: skipping invalid record %r', r, exc_info=True)
            continue

    days = []
    student_ids = [str(s['id']) for s in students]
    for d in days_in_range:
        iso = d.isoformat()
        if d.weekday() in weekend_set:
            typ = 'weekend'
        elif d in holiday_set:
            typ = 'holiday'
        else:
            typ = 'unmarked'

        present = 0
        absent = 0
        for sid in student_ids:
            st = records_map.get(sid, {}).get(iso, typ)
            if st == 'present':
                present += 1
            elif st == 'absent':
                absent += 1

        days.append({
            'date': iso,
            'weekday': d.weekday(),
            'type': typ,
            'present': present,
            'absent': absent,
            'unmarked': len(student_ids) - present - absent,
        })

    resp = {
        'class': {'id': str(school_class.id), 'name': school_class.name},
        'year': resp_year,
        'month': resp_month,
        'students': [{'id': str(s['id']), 'name': s['name'], 'roll': s['roll'] or ''} for s in students],
        'days': days,
    }
    if d_from is not None:
        resp['from_date'] = d_from.isoformat()
        resp['to_date'] = d_to.isoformat()
    return Response(resp)


@api_view(['GET'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_all_classes_daily(request):
    """All-classes daily summary for a date (browser-app parity for PIN UI)."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)

    date_param = request.query_params.get('date')
    if not date_param:
        return Response({'error': 'date query param is required'}, status=400)

    summaries = []
    for klass in SchoolClass.objects.all().order_by('order', 'name'):
        total = Student.objects.filter(
            school_class=klass, deleted_at__isnull=True,
        ).count()
        qs = AttendanceRecord.objects.filter(school_class=klass, date=date_param)
        present = qs.filter(status='present').count()
        absent = qs.filter(status='absent').count()
        summaries.append({
            'class': {'id': str(klass.id), 'name': klass.name},
            'total_students': total,
            'present': present,
            'absent': absent,
            'unmarked': max(total - present - absent, 0),
        })

    return Response({'date': date_param, 'classes': summaries})


@api_view(['GET', 'POST'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_holidays(request):
    """List holidays (any PIN teacher) / create one (admin or monitor only)."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)
    teacher = request.user

    if request.method == 'GET':
        holidays = Holiday.objects.all().order_by('-date')
        return Response({
            'holidays': [
                {'id': str(h.id), 'date': h.date.isoformat(), 'name': h.name, 'type': h.type}
                for h in holidays
            ],
        })

    if not _admin_or_monitor(teacher):
        return Response({'error': 'Admin or monitor access required'}, status=403)

    serializer = HolidaySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    instance = serializer.save()
    log_audit('create', 'holiday', entity_id=str(instance.pk), request=request,
              details={'via': 'pin_auth', 'teacher': teacher.name})
    return Response({
        'id': str(instance.id), 'date': instance.date.isoformat(),
        'name': instance.name, 'type': instance.type,
    }, status=201)


@api_view(['POST'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_holidays_bulk(request):
    """Create a range of consecutive holiday dates (long holiday) — admin/monitor only."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)
    teacher = request.user

    if not _admin_or_monitor(teacher):
        return Response({'error': 'Admin or monitor access required'}, status=403)

    serializer = BulkHolidaySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    start = data['start_date']
    end = data['end_date']
    name = data['name']
    htype = data['type']

    existing = set(
        Holiday.objects.filter(date__gte=start, date__lte=end)
        .values_list('date', flat=True)
    )

    created = []
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        if d in existing:
            continue
        Holiday.objects.create(date=d, name=name, type=htype)
        created.append(d.isoformat())

    log_audit('bulk_create', 'holiday', details={
        'start': start.isoformat(), 'end': end.isoformat(),
        'count': len(created), 'via': 'pin_auth', 'teacher': teacher.name,
    }, request=request)

    return Response({'created': created, 'skipped': len(existing)})


@api_view(['DELETE'])
@authentication_classes([PinAuthentication])
@permission_classes([AllowAny])
def mobile_holiday_delete(request, holiday_id):
    """Delete a holiday — admin or monitor only."""
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=401)
    teacher = request.user

    if not _admin_or_monitor(teacher):
        return Response({'error': 'Admin or monitor access required'}, status=403)

    deleted, _ = Holiday.objects.filter(id=holiday_id).delete()
    if not deleted:
        return Response({'error': 'Holiday not found'}, status=404)
    log_audit('delete', 'holiday', entity_id=str(holiday_id), request=request,
              details={'via': 'pin_auth', 'teacher': teacher.name})
    return Response({'status': 'ok'})
