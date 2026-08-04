import calendar
import logging
from datetime import date, timedelta
from django.db import models
from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import NotFound

logger = logging.getLogger(__name__)

from .models import AttendanceRecord, Holiday
from .serializers import (
    AttendanceRecordSerializer, BatchAttendanceSerializer,
    AttendanceSummarySerializer, HolidaySerializer, BulkHolidaySerializer,
)
from .permissions import CanMarkAttendance, CanManageHolidays
from students.models import Student
from core.models import SchoolClass, SchoolSetting
from accounts.permissions import require_permission, is_admin_or_superuser
from core.audit import log_audit
from parents.services import notify_parents_of_student


WEEKEND_DAYS_DEFAULT = '4,5'


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


class AttendanceViewSet(viewsets.GenericViewSet):
    queryset = AttendanceRecord.objects.select_related('student', 'school_class').all()
    serializer_class = AttendanceRecordSerializer
    filterset_fields = ['school_class', 'date', 'term', 'session']

    def get_permissions(self):
        if self.action in ['list', 'student_month', 'summary', 'class_report']:
            return [require_permission('students:read')()]
        return [CanMarkAttendance()]

    def get_queryset(self):
        qs = super().get_queryset()
        class_id = self.request.query_params.get('class_id')
        date_param = self.request.query_params.get('date')
        if class_id:
            qs = qs.filter(school_class_id=class_id)
        if date_param:
            qs = qs.filter(date=date_param)
        return qs

    def list(self, request):
        class_id = request.query_params.get('class_id')
        date_param = request.query_params.get('date')
        if not class_id or not date_param:
            return Response(
                {'error': 'class_id and date query params are required'},
                status=400,
            )
        qs = self.get_queryset()
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def batch(self, request):
        serializer = BatchAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        class_id = data['school_class']
        att_date = data['date']
        term = data['term']
        session = data['session']
        records = data['records']

        try:
            school_class = SchoolClass.objects.get(id=class_id)
        except SchoolClass.DoesNotExist:
            return Response({'error': 'School class not found'}, status=404)

        student_ids = list(records.keys())
        existing = Student.objects.filter(id__in=student_ids, school_class_id=class_id)
        if existing.count() != len(student_ids):
            return Response(
                {'error': 'One or more students not found in this class'},
                status=400,
            )

        weekend_set = _get_weekend_set()
        if att_date.weekday() in weekend_set:
            return Response(
                {'error': 'Cannot mark attendance on a weekend day'},
                status=400,
            )

        holiday_set = _get_holiday_dates(year=att_date.year)
        if att_date in holiday_set:
            return Response(
                {'error': 'Cannot mark attendance on a holiday'},
                status=400,
            )

        now = timezone.now()
        with db_transaction.atomic():
            for student_id, status_val in records.items():
                AttendanceRecord.objects.update_or_create(
                    student_id=student_id,
                    date=att_date,
                    defaults={
                        'school_class': school_class,
                        'term': term,
                        'session': session,
                        'status': status_val,
                        'marked_by': request.user,
                    },
                )

        log_audit(
            'batch_attendance', 'attendance',
            details={
                'class_id': str(class_id), 'date': str(att_date),
                'term': term, 'session': session, 'count': len(records),
            },
            request=request,
        )

        absent_ids = [sid for sid, st in records.items() if st == 'absent']
        if absent_ids:
            name_map = {
                str(k): v for k, v in
                Student.objects.filter(id__in=absent_ids).values_list('id', 'name')
            }
            for sid in absent_ids:
                sname = name_map.get(str(sid))
                if sname:
                    notify_parents_of_student(
                        sid, 'attendance_marked',
                        f'{sname} was marked absent',
                        f'Date: {att_date}',
                        url='/#/parent/attendance/' + str(sid),
                    )

        return Response({'status': 'ok', 'count': len(records)})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        student_id = request.query_params.get('student')
        term = request.query_params.get('term')
        session = request.query_params.get('session')
        year = request.query_params.get('year')
        month = request.query_params.get('month')

        if not student_id or not term or not session:
            return Response(
                {'error': 'student, term, and session query params are required'},
                status=400,
            )

        # Parent role: verify student is linked to this parent
        if request.user.is_authenticated and request.user.role == 'parent':
            parent_student_ids = set(
                request.user.parent_links.values_list('student_id', flat=True)
            )
            if student_id not in parent_student_ids:
                return Response({'error': 'Student not found'}, status=404)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            raise NotFound('Student not found')

        base_qs = AttendanceRecord.objects.filter(
        student_id=student_id,
        term=term,
        session=session,
        )
        if year:
            base_qs = base_qs.filter(date__year=year)
        if month is not None:
            base_qs = base_qs.filter(date__month=month)

        status_counts = base_qs.values('status').annotate(
            count=models.Count('id'),
        )
        counts = {'present': 0, 'absent': 0, 'late': 0, 'excused': 0}
        for row in status_counts:
            counts[row['status']] = row['count']

        class_dates = AttendanceRecord.objects.filter(
            school_class=student.school_class,
            term=term,
            session=session,
        )
        if year:
            class_dates = class_dates.filter(date__year=year)
        if month is not None:
            class_dates = class_dates.filter(date__month=month)

        class_date_records = class_dates.values('date').annotate(
            total=models.Count('student', distinct=True),
            absent_count=models.Count('id', filter=models.Q(status='absent')),
        )

        weekend_set = _get_weekend_set()
        known_holidays = _get_holiday_dates(year=year or None, month=month)

        weekend_count = 0
        holiday_count = 0
        de_facto_holidays = 0
        total_days = 0

        for row in class_date_records:
            d = row['date']
            if d.weekday() in weekend_set:
                weekend_count += 1
                continue
            if d in known_holidays:
                holiday_count += 1
                continue
            if row['total'] == row['absent_count']:
                de_facto_holidays += 1
                continue
            total_days += 1

        total_attended = sum(counts.values())
        unmarked = total_days - total_attended

        result = {
            'present': counts['present'],
            'absent': counts['absent'],
            'late': counts['late'],
            'excused': counts['excused'],
            'total_school_days': total_days,
            'holidays': holiday_count + de_facto_holidays,
            'weekends': weekend_count,
            'unmarked': max(unmarked, 0),
        }
        return Response(AttendanceSummarySerializer(result).data)

    @action(detail=False, methods=['get'])
    def student_month(self, request, student_id=None):
        year = request.query_params.get('year')
        month = request.query_params.get('month')

        if not year or not month:
            today = timezone.now().date()
            year = str(today.year)
            month = str(today.month)

        try:
            year = int(year)
            month = int(month)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid year or month'}, status=400)

        # Parent role: verify student is linked to this parent
        if request.user.is_authenticated and request.user.role == 'parent':
            parent_student_ids = set(
                request.user.parent_links.values_list('student_id', flat=True)
            )
            if student_id not in parent_student_ids:
                return Response({'error': 'Student not found'}, status=404)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            raise NotFound('Student not found')

        records = AttendanceRecord.objects.filter(
            student_id=student_id,
            date__year=year,
            date__month=month,
        ).order_by('date')

        weekend_set = _get_weekend_set()
        known_holidays = _get_holiday_dates(year=year, month=month)

        class_date_records = AttendanceRecord.objects.filter(
            school_class=student.school_class,
            date__year=year,
            date__month=month,
        ).values('date').annotate(
            total=models.Count('student', distinct=True),
            absent_count=models.Count('id', filter=models.Q(status='absent')),
        )
        all_absent_dates = {
            row['date'] for row in class_date_records
            if row['total'] == row['absent_count']
        }

        records_by_date = {}
        for r in records:
            records_by_date[r.date] = r.status

        _, days_in_month = calendar.monthrange(year, month)
        calendar_data = []
        for day in range(1, days_in_month + 1):
            d = date(year, month, day)
            entry = {'date': d.isoformat(), 'weekday': d.weekday()}

            if d.weekday() in weekend_set:
                entry['type'] = 'weekend'
            elif d in known_holidays:
                entry['type'] = 'holiday'
                entry['holiday_name'] = Holiday.objects.filter(date=d).values_list('name', flat=True).first()
            elif d in all_absent_dates:
                entry['type'] = 'de_facto_holiday'
            elif d in records_by_date:
                entry['type'] = 'marked'
                entry['status'] = records_by_date[d]
            else:
                entry['type'] = 'unmarked'

            calendar_data.append(entry)

        return Response({
            'student': {'id': str(student.id), 'name': student.name, 'roll': student.roll},
            'year': year,
            'month': month,
            'days': calendar_data,
        })


    @action(detail=False, methods=['get'], url_path='class-report')
    def class_report(self, request):
        return self._class_report_logic(request)

    def _class_report_logic(self, request):
        class_id = request.query_params.get('class_id')
        from_date = request.query_params.get('from')
        to_date = request.query_params.get('to')
        term = request.query_params.get('term')
        session = request.query_params.get('session')

        if not class_id or not from_date or not to_date:
            return Response(
                {'error': 'class_id, from, and to query params are required'},
                status=400,
            )

        # Parent role: verify linked student is in this class
        if request.user.is_authenticated and request.user.role == 'parent':
            parent_student_ids = set(
                request.user.parent_links.values_list('student_id', flat=True)
            )
            has_linked_student = Student.objects.filter(
                id__in=parent_student_ids, school_class_id=class_id
            ).exists()
            if not has_linked_student:
                return Response({'error': 'Class not found'}, status=404)

        try:
            school_class = SchoolClass.objects.get(id=class_id)
        except SchoolClass.DoesNotExist:
            return Response({'error': 'Class not found'}, status=404)

        students = list(
            Student.objects.filter(
                school_class=school_class,
                deleted_at__isnull=True,
            )
            .order_by('roll', 'name')
            .values('id', 'name', 'roll')
        )

        qs = AttendanceRecord.objects.filter(
            school_class=school_class,
            date__gte=from_date,
            date__lte=to_date,
        )
        if term:
            qs = qs.filter(term=term)
        if session:
            qs = qs.filter(session=session)

        records = list(
            qs.values('student_id', 'date', 'status')
        )

        try:
            dates = sorted(
                {r['date'] for r in records},
                key=lambda d: str(d),
            )
        except TypeError:
            logger.warning('class_report: failed to sort dates', exc_info=True)
            dates = []

        student_ids = [str(s['id']) for s in students]

        grid: dict[str, dict[str, str]] = {}
        student_summary: dict[str, dict[str, int]] = {}
        date_summary: dict[str, dict[str, int]] = {}

        for rec in records:
            try:
                sid = str(rec['student_id'])
                d = rec['date'].isoformat()
                st = str(rec['status'])
            except (KeyError, TypeError, ValueError):
                logger.warning('class_report: skipping invalid record %r', rec, exc_info=True)
                continue

            grid.setdefault(sid, {})[d] = st

            ss = student_summary.setdefault(sid, {'present': 0, 'absent': 0, 'late': 0, 'excused': 0})
            if st in ss:
                ss[st] += 1

            ds = date_summary.setdefault(d, {'present': 0, 'absent': 0, 'late': 0, 'excused': 0})
            if st in ds:
                ds[st] += 1

        for sid in student_ids:
            grid.setdefault(sid, {})
            student_summary.setdefault(sid, {'present': 0, 'absent': 0, 'late': 0, 'excused': 0})

        full_summary: dict[str, dict[str, object]] = {}
        for sid in student_ids:
            ss = student_summary[sid]
            total = ss['present'] + ss['absent'] + ss['late'] + ss['excused']
            pct = round(ss['present'] / total * 100, 1) if total > 0 else 0.0
            full_summary[sid] = {**ss, 'total': total, 'pct': pct}

        return Response({
            'class': {'id': str(school_class.id), 'name': school_class.name},
            'students': [
                {'id': str(s['id']), 'name': s['name'], 'roll': s['roll']}
                for s in students
            ],
            'dates': [d.isoformat() for d in dates],
            'grid': grid,
            'summary': full_summary,
            'date_summary': date_summary,
        })

    @action(detail=False, methods=['get'], url_path='class-daily-report')
    def class_daily_report(self, request):
        return self._class_daily_report_logic(request)

    def _class_daily_report_logic(self, request):
        class_id = request.query_params.get('class_id')
        date_param = request.query_params.get('date')

        if not class_id or not date_param:
            return Response({'error': 'class_id and date query params are required'}, status=400)

        try:
            school_class = SchoolClass.objects.get(id=class_id)
        except SchoolClass.DoesNotExist:
            return Response({'error': 'Class not found'}, status=404)

        students = list(
            Student.objects.filter(
                school_class=school_class,
                deleted_at__isnull=True,
            )
            .order_by('roll', 'name')
            .values('id', 'name', 'roll')
        )

        records = list(
            AttendanceRecord.objects.filter(
                school_class=school_class,
                date=date_param,
            ).values('student_id', 'status')
        )

        records_map: dict[str, str] = {}
        for r in records:
            try:
                records_map[str(r['student_id'])] = str(r['status'])
            except (KeyError, TypeError, ValueError):
                logger.warning('class_daily_report: skipping invalid record %r', r, exc_info=True)
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
                'id': str(s['id']),
                'name': s['name'],
                'roll': s['roll'] or '',
                'status': st,
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

    @action(detail=False, methods=['get'], url_path='all-classes-daily')
    def all_classes_daily(self, request):
        return self._all_classes_daily_logic(request)

    def _all_classes_daily_logic(self, request):
        date_param = request.query_params.get('date')

        if not date_param:
            return Response({'error': 'date query param is required'}, status=400)

        summaries = []

        for klass in SchoolClass.objects.all().order_by('order', 'name'):
            total = Student.objects.filter(
                school_class=klass,
                deleted_at__isnull=True,
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

    @action(detail=False, methods=['get'], url_path='monthly-report')
    def monthly_report(self, request):
        return self._monthly_report_logic(request)

    def _monthly_report_logic(self, request):
        class_id = request.query_params.get('class_id')
        year = request.query_params.get('year')
        month = request.query_params.get('month')

        if not class_id or not year or not month:
            return Response(
                {'error': 'class_id, year, and month query params are required'},
                status=400,
            )

        try:
            year = int(year)
            month = int(month)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid year or month'}, status=400)

        try:
            school_class = SchoolClass.objects.get(id=class_id)
        except SchoolClass.DoesNotExist:
            return Response({'error': 'Class not found'}, status=404)

        import calendar as _cal
        from datetime import date as _date
        _, days_in_month = _cal.monthrange(year, month)
        weekend_set = _get_weekend_set()
        holiday_set = _get_holiday_dates(year=year, month=month)

        students = list(
            Student.objects.filter(
                school_class=school_class,
                deleted_at__isnull=True,
            )
            .order_by('roll', 'name')
            .values('id', 'name', 'roll')
        )

        records = AttendanceRecord.objects.filter(
            school_class=school_class,
            date__year=year,
            date__month=month,
        ).values('student_id', 'date', 'status')

        records_map: dict[str, dict[str, str]] = {}
        for r in records:
            try:
                records_map.setdefault(str(r['student_id']), {})[r['date'].isoformat()] = str(r['status'])
            except (KeyError, TypeError, ValueError):
                logger.warning('monthly_report: skipping invalid record %r', r, exc_info=True)
                continue

        days = []
        student_ids = [str(s['id']) for s in students]
        for day in range(1, days_in_month + 1):
            d = _date(year, month, day)
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

        return Response({
            'class': {'id': str(school_class.id), 'name': school_class.name},
            'year': year,
            'month': month,
            'students': [{'id': str(s['id']), 'name': s['name'], 'roll': s['roll'] or ''} for s in students],
            'days': days,
        })


class HolidayViewSet(viewsets.ModelViewSet):
    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
    filterset_fields = ['date', 'type']

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('students:read')()]
        return [CanManageHolidays()]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit('create', 'holiday', entity_id=str(instance.pk), request=self.request)

    def perform_destroy(self, instance):
        entity_id = str(instance.pk)
        super().perform_destroy(instance)
        log_audit('delete', 'holiday', entity_id=entity_id, request=self.request)

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk(self, request):
        """Create a range of consecutive holiday dates (long holiday) in one call."""
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
        skipped = []
        for i in range((end - start).days + 1):
            d = start + timedelta(days=i)
            if d in existing:
                skipped.append(d.isoformat())
                continue
            holiday = Holiday.objects.create(date=d, name=name, type=htype)
            created.append(holiday.id)

        log_audit(
            'create', 'holiday',
            details={
                'start': start.isoformat(), 'end': end.isoformat(),
                'name': name, 'type': htype,
                'created': len(created), 'skipped': len(skipped),
            },
            request=request,
        )

        return Response({
            'status': 'ok',
            'created': len(created),
            'skipped': skipped,
            'range': {'start': start.isoformat(), 'end': end.isoformat()},
        })
