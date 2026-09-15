from datetime import date, timedelta
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from students.models import Student
from core.models import SchoolClass
from parents.models import ParentStudentLink
from teachers.models import Teacher, ClassTeacher
from .models import AttendanceRecord, Holiday

User = get_user_model()


def _auth(client, role='admin'):
    user = User.objects.create_superuser(
        email='admin@test.com', name='Admin', password='testpass123',
    )
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class AttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.s1 = Student.objects.create(
            name='Alice', student_id='S000001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Bob', student_id='S000002',
            school_class=self.klass, session='2026',
        )

    def _today(self):
        t = timezone.now().date()
        # Make sure it's not a weekend
        while t.weekday() in (4, 5):
            t = t.replace(day=t.day - 1)
        return t

    def test_batch_mark_all_present(self):
        today = self._today()
        res = self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {
                str(self.s1.id): 'present',
                str(self.s2.id): 'present',
            },
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['count'], 2)
        self.assertEqual(AttendanceRecord.objects.count(), 2)

    def test_monthly_report_date_range(self):
        """Range mode: from_date/to_date spanning multiple months."""
        d1 = self._today()                      # a weekday
        d2 = d1 + timedelta(days=1)
        while d2.weekday() in (4, 5):
            d2 = d2 + timedelta(days=1)
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': d1.isoformat(),
            'term': '1', 'session': '2026',
            'records': {str(self.s1.id): 'present', str(self.s2.id): 'absent'},
        }, format='json')
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': d2.isoformat(),
            'term': '1', 'session': '2026',
            'records': {str(self.s1.id): 'present', str(self.s2.id): 'present'},
        }, format='json')

        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'from_date': d1.isoformat(),
            'to_date': d2.isoformat(),
        })
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        data = res.data
        self.assertEqual(data['from_date'], d1.isoformat())
        self.assertEqual(data['to_date'], d2.isoformat())
        # days list covers the exact range (weekends included as type=weekend)
        self.assertEqual(data['days'][0]['date'], d1.isoformat())
        self.assertEqual(data['days'][-1]['date'], d2.isoformat())
        self.assertEqual(
            (data['days'][-1]['date'] >= data['days'][0]['date']),
            True,
        )
        by_date = {d['date']: d for d in data['days']}
        self.assertEqual(by_date[d1.isoformat()]['present'], 1)
        self.assertEqual(by_date[d1.isoformat()]['absent'], 1)
        self.assertEqual(by_date[d2.isoformat()]['present'], 2)
        # register matrix: per-student day statuses
        sd = data['student_days']
        self.assertIn(str(self.s1.id), sd)
        self.assertIn(str(self.s2.id), sd)
        self.assertEqual(sd[str(self.s1.id)][d1.isoformat()], 'present')
        self.assertEqual(sd[str(self.s2.id)][d1.isoformat()], 'absent')
        self.assertEqual(sd[str(self.s1.id)][d2.isoformat()], 'present')
        self.assertEqual(sd[str(self.s2.id)][d2.isoformat()], 'present')
        # weekend day cell is None
        weekend = [d for d in data['days'] if d['type'] == 'weekend']
        if weekend:
            self.assertIsNone(sd[str(self.s1.id)][weekend[0]['date']])

    def test_monthly_report_range_validation(self):
        # missing class_id -> 400
        res = self.client.get('/api/attendance/monthly-report/', {
            'from_date': '2026-01-01', 'to_date': '2026-01-31',
        })
        self.assertEqual(res.status_code, 400)
        # from > to -> 400
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'from_date': '2026-02-01', 'to_date': '2026-01-01',
        })
        self.assertEqual(res.status_code, 400)
        # bad format -> 400
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'from_date': '01-2026-01', 'to_date': '2026-01-31',
        })
        self.assertEqual(res.status_code, 400)
        # neither range nor month -> 400
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
        })
        self.assertEqual(res.status_code, 400)

    def test_all_classes_daily_ignores_moved_students(self):
        # Regression: rows stamped with a class must not count once the
        # student has moved to another class (roster-scoped counts).
        day = self._today()
        AttendanceRecord.objects.create(
            student=self.s1, school_class=self.klass, date=day,
            term='1', session='2026', status='present',
        )
        AttendanceRecord.objects.create(
            student=self.s2, school_class=self.klass, date=day,
            term='1', session='2026', status='absent',
        )
        other = SchoolClass.objects.create(name='Other Class', order=99)
        self.s2.school_class = other
        self.s2.save(update_fields=['school_class'])

        res = self.client.get('/api/attendance/all-classes-daily/', {'date': day.isoformat()})
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        row = next(c for c in res.data['classes'] if c['class']['id'] == str(self.klass.id))
        self.assertEqual(row['total_students'], 1)
        self.assertEqual(row['present'], 1)
        self.assertEqual(row['absent'], 0)
        self.assertEqual(row['unmarked'], 0)

    def test_batch_mixed_statuses(self):
        today = self._today()
        res = self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {
                str(self.s1.id): 'present',
                str(self.s2.id): 'absent',
            },
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            AttendanceRecord.objects.get(student=self.s1).status, 'present',
        )
        self.assertEqual(
            AttendanceRecord.objects.get(student=self.s2).status, 'absent',
        )

    def test_batch_upsert_updates_existing(self):
        today = self._today()
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {str(self.s1.id): 'present'},
        }, format='json')
        res = self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {str(self.s1.id): 'absent'},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            AttendanceRecord.objects.get(student=self.s1).status, 'absent',
        )
        self.assertEqual(AttendanceRecord.objects.count(), 1)

    def test_batch_rejects_weekend(self):
        # Find a Saturday (weekday=5)
        sat = date(2026, 6, 13)  # Saturday
        res = self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': sat.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {str(self.s1.id): 'present'},
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('weekend', res.data['error'].lower())

    def test_batch_rejects_holiday(self):
        Holiday.objects.create(date=date(2026, 6, 16), name='Eid')
        res = self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': '2026-06-16',
            'term': '1',
            'session': '2026',
            'records': {str(self.s1.id): 'present'},
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('holiday', res.data['error'].lower())

    def test_list_by_class_and_date(self):
        today = self._today()
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {
                str(self.s1.id): 'present',
                str(self.s2.id): 'absent',
            },
        }, format='json')
        res = self.client.get(
            f'/api/attendance/?class_id={self.klass.id}&date={today.isoformat()}',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)

    def test_summary_counts(self):
        today = self._today()
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {
                str(self.s1.id): 'present',
                str(self.s2.id): 'absent',
            },
        }, format='json')
        res = self.client.get(
            f'/api/attendance/summary/'
            f'?student={self.s1.id}&term=1&session=2026',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['present'], 1)
        self.assertEqual(res.data['absent'], 0)
        self.assertEqual(res.data['total_school_days'], 1)

    def test_student_month_endpoint(self):
        today = self._today()
        self.client.post('/api/attendance/batch/', {
            'school_class': str(self.klass.id),
            'date': today.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {str(self.s1.id): 'present'},
        }, format='json')
        res = self.client.get(
            f'/api/attendance/student/{self.s1.id}/'
            f'?year={today.year}&month={today.month}',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['student']['name'], 'Alice')
        marked = [d for d in res.data['days'] if d['type'] == 'marked']
        self.assertTrue(any(d['status'] == 'present' for d in marked))

    def test_holiday_crud(self):
        res = self.client.post('/api/holidays/', {
            'date': '2026-12-25',
            'name': 'Christmas',
            'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Holiday.objects.count(), 1)

        res = self.client.get('/api/holidays/?limit=50')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)

        hid = res.data['results'][0]['id']
        res = self.client.delete(f'/api/holidays/{hid}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(Holiday.objects.count(), 0)


class HolidayBulkAndPermissionTests(TestCase):
    """Range creation (long holidays) + admin/monitor-only write enforcement."""

    def setUp(self):
        self.client = self._auth(
            User.objects.create_superuser(
                email='admin@test.com', name='Admin', password='testpass123',
            )
        )

    def _user(self, role):
        return User.objects.create_user(
            email=f'{role}@test.com', password='testpass123', name=role, role=role,
        )

    def _auth(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')
        return client

    def test_bulk_creates_full_range(self):
        res = self.client.post('/api/holidays/bulk/', {
            'start_date': '2026-12-20', 'end_date': '2026-12-23',
            'name': 'Winter Break', 'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 200, msg=res.content[:300])
        self.assertEqual(res.data['created'], 4)
        self.assertEqual(res.data['skipped'], [])
        self.assertEqual(Holiday.objects.count(), 4)
        dates = set(Holiday.objects.values_list('date', flat=True))
        self.assertEqual(dates, {date(2026, 12, d) for d in (20, 21, 22, 23)})

    def test_bulk_skips_existing_dates(self):
        Holiday.objects.create(date=date(2026, 6, 21), name='Existing', type='public')
        res = self.client.post('/api/holidays/bulk/', {
            'start_date': '2026-06-20', 'end_date': '2026-06-22',
            'name': 'Eid', 'type': 'public',
        }, format='json')
        self.assertEqual(res.data['created'], 2)
        self.assertEqual(res.data['skipped'], ['2026-06-21'])
        self.assertEqual(Holiday.objects.count(), 3)

    def test_bulk_rejects_inverted_range(self):
        res = self.client.post('/api/holidays/bulk/', {
            'start_date': '2026-12-23', 'end_date': '2026-12-20',
            'name': 'Bad', 'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Holiday.objects.count(), 0)

    def test_teacher_cannot_write_holidays(self):
        teacher_client = self._auth(self._user('teacher'))
        res = teacher_client.post('/api/holidays/', {
            'date': '2026-12-25', 'name': 'Xmas', 'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 403)
        res = teacher_client.post('/api/holidays/bulk/', {
            'start_date': '2026-12-20', 'end_date': '2026-12-21',
            'name': 'Break', 'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(Holiday.objects.count(), 0)

    def test_monitor_can_create_holiday(self):
        client = self._auth(self._user('monitor'))
        res = client.post('/api/holidays/', {
            'date': '2026-12-25', 'name': 'Xmas', 'type': 'public',
        }, format='json')
        self.assertEqual(res.status_code, 201)

    def test_teacher_can_still_read_holidays(self):
        teacher = self._auth(self._user('teacher'))
        res = teacher.get('/api/holidays/?limit=50')
        self.assertEqual(res.status_code, 200)


class MobileDailyReportTests(TestCase):
    """Tests for /api/m/attendance/class-daily-report/ against the REAL contract.

    Two modes (source of truth = the view):
      * single-date: ?class_id=&date=  -> {students:[{status}], present, absent, unmarked}
      * range:       ?class_id=&from=&to= -> {days:[...], students:[{days:{date:status}, present, absent}]}
    """

    def setUp(self):
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='RR Class', order=2)
        self.teacher = Teacher.objects.create(name='PIN Teacher', designation='T')
        ClassTeacher.objects.create(teacher=self.teacher, school_class=self.klass)
        self.s1 = Student.objects.create(
            name='Alice', student_id='RR0001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Bob', student_id='RR0002',
            school_class=self.klass, session='2026',
        )
        today = timezone.now().date()
        while today.weekday() in (4, 5):
            today = today.replace(day=today.day - 1)
        self.at_day = today
        self.other_day = today - timedelta(days=1)
        while self.other_day.weekday() in (4, 5):
            self.other_day = self.other_day.replace(day=self.other_day.day - 1)

    def _pin_token(self):
        tok = AccessToken()
        tok['teacher_id'] = str(self.teacher.id)
        tok['pin_auth'] = True
        tok.set_exp('exp', lifetime=timedelta(hours=1))
        return str(tok)

    def _batch(self, token, day, recs):
        return self.client.post(
            '/api/m/attendance/batch/',
            {
                'school_class': str(self.klass.id),
                'date': day.isoformat(),
                'term': '1',
                'session': '2026',
                'records': recs,
            },
            format='json',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )

    # ── single-date mode ──────────────────────────────────────────────
    def test_single_date_empty(self):
        token = self._pin_token()
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}&date={self.at_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(res.data['date'], self.at_day.isoformat())
        self.assertEqual(res.data['total_students'], 2)
        self.assertEqual(res.data['present'], 0)
        self.assertEqual(res.data['absent'], 0)
        self.assertEqual(res.data['unmarked'], 2)
        names = {s['name'] for s in res.data['students']}
        self.assertEqual(names, {'Alice', 'Bob'})
        for s in res.data['students']:
            self.assertEqual(s['status'], 'unmarked')

    def test_single_date_with_records(self):
        token = self._pin_token()
        self._batch(token, self.at_day, {str(self.s1.id): 'present', str(self.s2.id): 'absent'})
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}&date={self.at_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(res.data['present'], 1)
        self.assertEqual(res.data['absent'], 1)
        by_id = {s['id']: s for s in res.data['students']}
        self.assertEqual(by_id[str(self.s1.id)]['status'], 'present')
        self.assertEqual(by_id[str(self.s2.id)]['status'], 'absent')

    def test_single_date_requires_class_id(self):
        token = self._pin_token()
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?date={self.at_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 400)

    # ── range mode ────────────────────────────────────────────────────
    def test_range_empty(self):
        token = self._pin_token()
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}'
            f'&from={self.other_day.isoformat()}&to={self.at_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(res.data['from'], self.other_day.isoformat())
        self.assertEqual(res.data['to'], self.at_day.isoformat())
        # Range mode walks every calendar day inclusive (weekends render as
        # `·` in the matrix) — not just the endpoints.
        expected_days = []
        cur = self.other_day
        while cur <= self.at_day:
            expected_days.append(cur.isoformat())
            cur += timedelta(days=1)
        self.assertEqual(res.data['days'], expected_days)
        self.assertEqual(res.data['total_students'], 2)
        for s in res.data['students']:
            self.assertEqual(s['days'], {})
            self.assertEqual(s['present'], 0)
            self.assertEqual(s['absent'], 0)

    def test_range_with_records(self):
        token = self._pin_token()
        self._batch(token, self.at_day, {str(self.s1.id): 'present', str(self.s2.id): 'absent'})
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}'
            f'&from={self.other_day.isoformat()}&to={self.at_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        by_id = {s['id']: s for s in res.data['students']}
        s1 = by_id[str(self.s1.id)]
        self.assertEqual(s1['days'].get(self.at_day.isoformat()), 'present')
        self.assertEqual(s1['present'], 1)
        self.assertEqual(s1['absent'], 0)
        s2 = by_id[str(self.s2.id)]
        self.assertEqual(s2['days'].get(self.at_day.isoformat()), 'absent')
        self.assertEqual(s2['absent'], 1)

    def test_range_invalid_date_format(self):
        token = self._pin_token()
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}&from=13-01-2026&to=2026-01-20',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 400)

    def test_range_from_after_to(self):
        token = self._pin_token()
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass.id}'
            f'&from={self.at_day.isoformat()}&to={self.other_day.isoformat()}',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(res.status_code, 400)


class PinAdminMonitorFeatureTests(TestCase):
    """Admin/monitor parity for the PIN attendance app.

    Browser-app parity: admin & monitor are NOT required to be assigned as a
    class teacher — they can submit attendance and view reports for ANY class,
    and they manage holidays. Regular PIN teachers keep the ClassTeacher gate.
    """

    def setUp(self):
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='RR Class', order=2)
        self.klass2 = SchoolClass.objects.create(name='SS Class', order=3)
        self.s1 = Student.objects.create(
            name='Alice', student_id='RR0001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Bob', student_id='SS0001',
            school_class=self.klass2, session='2026',
        )
        # Admin teacher — linked account role=admin, NO ClassTeacher assignment
        self.admin_user = User.objects.create_user(
            email='adminpin@test.com', name='Admin PIN', password='x',
            role='admin', is_staff=True,
        )
        self.admin_teacher = Teacher.objects.create(
            name='Admin PIN', designation='Admin',
            user=self.admin_user,
        )
        # Monitor teacher — role=monitor, NO ClassTeacher assignment
        self.monitor_user = User.objects.create_user(
            email='monitorpin@test.com', name='Monitor PIN', password='x',
            role='monitor',
        )
        self.monitor_teacher = Teacher.objects.create(
            name='Monitor PIN', designation='Monitor',
            user=self.monitor_user,
        )
        # Regular teacher — role=teacher, DOES have ClassTeacher on klass
        self.plain_user = User.objects.create_user(
            email='teacherpin@test.com', name='Teacher PIN', password='x',
            role='teacher',
        )
        self.plain_teacher = Teacher.objects.create(
            name='Teacher PIN', designation='Teacher',
            user=self.plain_user,
        )
        ClassTeacher.objects.create(teacher=self.plain_teacher, school_class=self.klass)
        today = timezone.now().date()
        while today.weekday() in (4, 5):
            today = today.replace(day=today.day - 1)
        self.at_day = today

    # ── token helpers ──────────────────────────────────────────────
    def _token_for(self, teacher):
        tok = AccessToken()
        tok['teacher_id'] = str(teacher.id)
        tok['pin_auth'] = True
        tok.set_exp('exp', lifetime=timedelta(hours=1))
        return str(tok)

    def _auth(self, teacher):
        return {'HTTP_AUTHORIZATION': f'Bearer {self._token_for(teacher)}'}

    # ── 1. batch attendance bypass ─────────────────────────────────
    def test_admin_can_batch_for_class_not_assigned(self):
        res = self.client.post(
            '/api/m/attendance/batch/',
            {
                'school_class': str(self.klass2.id),
                'date': self.at_day.isoformat(),
                'term': '1',
                'session': '2026',
                'records': {str(self.s2.id): 'present'},
            },
            format='json',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_monitor_can_batch_for_class_not_assigned(self):
        res = self.client.post(
            '/api/m/attendance/batch/',
            {
                'school_class': str(self.klass2.id),
                'date': self.at_day.isoformat(),
                'term': '1',
                'session': '2026',
                'records': {str(self.s2.id): 'present'},
            },
            format='json',
            **self._auth(self.monitor_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_plain_teacher_cannot_batch_unassigned_class(self):
        res = self.client.post(
            '/api/m/attendance/batch/',
            {
                'school_class': str(self.klass2.id),
                'date': self.at_day.isoformat(),
                'term': '1',
                'session': '2026',
                'records': {str(self.s2.id): 'present'},
            },
            format='json',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_students_list_unassigned_class(self):
        res = self.client.get(
            f'/api/m/students/?class_id={self.klass2.id}',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_plain_teacher_students_list_unassigned_class_403(self):
        res = self.client.get(
            f'/api/m/students/?class_id={self.klass2.id}',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 403)

    # ── 2. reports bypass ──────────────────────────────────────────
    def test_admin_daily_report_unassigned_class(self):
        res = self.client.get(
            f'/api/m/attendance/class-daily-report/?class_id={self.klass2.id}&date={self.at_day.isoformat()}',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_admin_monthly_report_unassigned_class(self):
        res = self.client.get(
            f'/api/m/attendance/monthly-report/?class_id={self.klass2.id}'
            f'&year={self.at_day.year}&month={self.at_day.month}',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    # ── 3. all-classes daily report ────────────────────────────────
    def test_all_classes_daily(self):
        res = self.client.get(
            f'/api/m/attendance/all-classes-daily/?date={self.at_day.isoformat()}',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(res.data['date'], self.at_day.isoformat())
        names = {c['class']['name'] for c in res.data['classes']}
        self.assertEqual(names, {'RR Class', 'SS Class'})

    def test_all_classes_daily_requires_date(self):
        res = self.client.get('/api/m/attendance/all-classes-daily/', **self._auth(self.admin_teacher))
        self.assertEqual(res.status_code, 400)

    def test_all_classes_daily_open_to_plain_teacher(self):
        res = self.client.get(
            f'/api/m/attendance/all-classes-daily/?date={self.at_day.isoformat()}',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(len(res.data['classes']), 2)

    # ── 4. holidays CRUD ───────────────────────────────────────────
    def test_holidays_list_any_pin_teacher(self):
        res = self.client.get('/api/m/holidays/', **self._auth(self.plain_teacher))
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(res.data['holidays'], [])

    def test_holiday_create_admin(self):
        res = self.client.post(
            '/api/m/holidays/',
            {'date': self.at_day.isoformat(), 'name': 'Test Holiday', 'type': 'school'},
            format='json',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 201, msg=res.content[:500])
        self.assertTrue(Holiday.objects.filter(date=self.at_day).exists())

    def test_holiday_create_monitor(self):
        res = self.client.post(
            '/api/m/holidays/',
            {'date': self.at_day.isoformat(), 'name': 'Monitor Holiday'},
            format='json',
            **self._auth(self.monitor_teacher),
        )
        self.assertEqual(res.status_code, 201, msg=res.content[:500])

    def test_holiday_create_plain_teacher_403(self):
        res = self.client.post(
            '/api/m/holidays/',
            {'date': self.at_day.isoformat(), 'name': 'Nope'},
            format='json',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 403)

    def test_holidays_bulk_skips_existing(self):
        Holiday.objects.create(date=self.at_day, name='Already', type='public')
        start = self.at_day - timedelta(days=1)
        res = self.client.post(
            '/api/m/holidays/bulk/',
            {
                'start_date': start.isoformat(),
                'end_date': self.at_day.isoformat(),
                'name': 'Long Holiday',
                'type': 'school',
            },
            format='json',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertEqual(len(res.data['created']), 1)
        self.assertEqual(res.data['skipped'], 1)
        self.assertEqual(Holiday.objects.filter(name='Long Holiday').count(), 1)

    def test_holiday_bulk_plain_teacher_403(self):
        res = self.client.post(
            '/api/m/holidays/bulk/',
            {
                'start_date': self.at_day.isoformat(),
                'end_date': self.at_day.isoformat(),
                'name': 'Nope',
            },
            format='json',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 403)

    def test_holiday_delete_admin(self):
        h = Holiday.objects.create(date=self.at_day, name='ToDelete', type='public')
        res = self.client.delete(
            f'/api/m/holidays/{h.id}/',
            **self._auth(self.admin_teacher),
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        self.assertFalse(Holiday.objects.filter(id=h.id).exists())

    def test_holiday_delete_plain_teacher_403(self):
        h = Holiday.objects.create(date=self.at_day, name='Locked', type='public')
        res = self.client.delete(
            f'/api/m/holidays/{h.id}/',
            **self._auth(self.plain_teacher),
        )
        self.assertEqual(res.status_code, 403)
        self.assertTrue(Holiday.objects.filter(id=h.id).exists())

    # ── 5. pin_login classes list ──────────────────────────────────
    def test_pin_login_admin_gets_all_classes(self):
        self.admin_teacher.pin = make_password('593008')
        self.admin_teacher.save(update_fields=['pin'])
        res = self.client.post(
            '/api/m/auth/pin/',
            {'teacher_id': str(self.admin_teacher.id), 'pin': '593008'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        names = {c['name'] for c in res.data['classes']}
        self.assertEqual(names, {'RR Class', 'SS Class'})
        self.assertEqual(res.data['teacher']['role'], 'admin')

    def test_pin_login_plain_teacher_only_assigned_classes(self):
        self.plain_teacher.pin = make_password('111111')
        self.plain_teacher.save(update_fields=['pin'])
        res = self.client.post(
            '/api/m/auth/pin/',
            {'teacher_id': str(self.plain_teacher.id), 'pin': '111111'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        names = {c['name'] for c in res.data['classes']}
        self.assertEqual(names, {'RR Class'})
        self.assertEqual(res.data['teacher']['role'], 'teacher')


class ParentAttendanceScopeTests(TestCase):
    """Parent role is restricted to classes containing linked students (else 404)."""

    def setUp(self):
        self.klass = SchoolClass.objects.create(name='Linked Class', order=1)
        self.other_klass = SchoolClass.objects.create(name='Other Class', order=2)
        self.s1 = Student.objects.create(
            name='Alice', student_id='PS0001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Bob', student_id='PS0002',
            school_class=self.other_klass, session='2026',
        )
        self.parent = User.objects.create_user(
            email='parent@test.com', password='testpass123',
            name='Parent', role='parent',
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.s1)
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(self.parent).access_token}'
        )
        today = timezone.now().date()
        while today.weekday() in (4, 5):
            today = today - timedelta(days=1)
        self.today = today

    def test_list_linked_class_ok(self):
        res = self.client.get('/api/attendance/', {
            'class_id': str(self.klass.id), 'date': self.today.isoformat(),
        })
        self.assertEqual(res.status_code, 200, msg=res.content[:300])

    def test_list_unlinked_class_404(self):
        res = self.client.get('/api/attendance/', {
            'class_id': str(self.other_klass.id), 'date': self.today.isoformat(),
        })
        self.assertEqual(res.status_code, 404)

    def test_class_daily_report_linked_ok(self):
        res = self.client.get('/api/attendance/class-daily-report/', {
            'class_id': str(self.klass.id), 'date': self.today.isoformat(),
        })
        self.assertEqual(res.status_code, 200, msg=res.content[:300])

    def test_class_daily_report_unlinked_404(self):
        res = self.client.get('/api/attendance/class-daily-report/', {
            'class_id': str(self.other_klass.id), 'date': self.today.isoformat(),
        })
        self.assertEqual(res.status_code, 404)

    def test_monthly_report_linked_ok(self):
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'year': str(self.today.year), 'month': str(self.today.month),
        })
        self.assertEqual(res.status_code, 200, msg=res.content[:300])

    def test_monthly_report_unlinked_404(self):
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.other_klass.id),
            'year': str(self.today.year), 'month': str(self.today.month),
        })
        self.assertEqual(res.status_code, 404)

    def test_all_classes_daily_only_linked(self):
        res = self.client.get('/api/attendance/all-classes-daily/', {
            'date': self.today.isoformat(),
        })
        self.assertEqual(res.status_code, 200, msg=res.content[:300])
        class_ids = {c['class']['id'] for c in res.data['classes']}
        self.assertIn(str(self.klass.id), class_ids)
        self.assertNotIn(str(self.other_klass.id), class_ids)


class BatchClassTeacherGateTests(TestCase):
    """Browser batch() enforces class-teacher scope like the PIN path
    (teachers/views_mobile.py) and students/views.py: monitors/admins may
    mark any class, other teachers only their assigned classes."""

    def setUp(self):
        self.klass = SchoolClass.objects.create(name='Gate Class A', order=1)
        self.other = SchoolClass.objects.create(name='Gate Class B', order=2)
        self.s1 = Student.objects.create(
            name='Ann', student_id='G000001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Ben', student_id='G000002',
            school_class=self.other, session='2026',
        )
        self.teacher_user = User.objects.create_user(
            email='gate-teacher@test.com', password='testpass123',
            name='Gate Teacher', role='teacher',
        )
        self.teacher = Teacher.objects.create(
            name='Gate Teacher', designation='T', user=self.teacher_user,
        )
        ClassTeacher.objects.create(
            teacher=self.teacher, school_class=self.klass,
        )
        self.monitor = User.objects.create_user(
            email='gate-monitor@test.com', password='testpass123',
            name='Gate Monitor', role='monitor',
        )
        day = timezone.now().date()
        while day.weekday() in (4, 5):
            day = day - timedelta(days=1)
        self.day = day

    def _client_for(self, user):
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}'
        )
        return client

    def _batch(self, client, klass, student):
        return client.post('/api/attendance/batch/', {
            'school_class': str(klass.id),
            'date': self.day.isoformat(),
            'term': '1',
            'session': '2026',
            'records': {str(student.id): 'present'},
        }, format='json')

    def test_teacher_can_batch_assigned_class(self):
        res = self._batch(
            self._client_for(self.teacher_user), self.klass, self.s1,
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_teacher_cannot_batch_unassigned_class(self):
        res = self._batch(
            self._client_for(self.teacher_user), self.other, self.s2,
        )
        self.assertEqual(res.status_code, 403)
        self.assertFalse(
            AttendanceRecord.objects.filter(student=self.s2).exists()
        )

    def test_monitor_can_batch_any_class(self):
        res = self._batch(
            self._client_for(self.monitor), self.other, self.s2,
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])

    def test_admin_can_batch_any_class(self):
        admin = User.objects.create_superuser(
            email='gate-admin@test.com', name='Gate Admin',
            password='testpass123',
        )
        res = self._batch(self._client_for(admin), self.other, self.s2)
        self.assertEqual(res.status_code, 200, msg=res.content[:500])


class MonthlyReportYearMonthValidationTests(TestCase):
    """Legacy year/month mode must return 400 (not 500) on bad input."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='YM Class', order=1)

    def test_non_numeric_year_month_400(self):
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'year': 'abcd', 'month': 'xx',
        })
        self.assertEqual(res.status_code, 400)

    def test_out_of_range_month_400(self):
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'year': '2026', 'month': '13',
        })
        self.assertEqual(res.status_code, 400)


class AllClassesDailyAggregateTests(TestCase):
    """Grouped aggregates return correct per-class counts (incl. empty class)."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Agg Class A', order=1)
        self.other = SchoolClass.objects.create(name='Agg Class B', order=2)
        self.empty = SchoolClass.objects.create(name='Agg Empty', order=3)
        self.s1 = Student.objects.create(
            name='Ann', student_id='A000001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Ben', student_id='A000002',
            school_class=self.klass, session='2026',
        )
        self.s3 = Student.objects.create(
            name='Cat', student_id='A000003',
            school_class=self.other, session='2026',
        )
        day = timezone.now().date()
        while day.weekday() in (4, 5):
            day = day - timedelta(days=1)
        self.day = day

    def test_multi_class_counts(self):
        AttendanceRecord.objects.create(
            student=self.s1, school_class=self.klass, date=self.day,
            term='1', session='2026', status='present',
        )
        AttendanceRecord.objects.create(
            student=self.s2, school_class=self.klass, date=self.day,
            term='1', session='2026', status='absent',
        )
        AttendanceRecord.objects.create(
            student=self.s3, school_class=self.other, date=self.day,
            term='1', session='2026', status='present',
        )
        res = self.client.get(
            '/api/attendance/all-classes-daily/',
            {'date': self.day.isoformat()},
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        by_id = {c['class']['id']: c for c in res.data['classes']}
        row = by_id[str(self.klass.id)]
        self.assertEqual(
            (row['total_students'], row['present'], row['absent'], row['unmarked']),
            (2, 1, 1, 0),
        )
        row = by_id[str(self.other.id)]
        self.assertEqual(
            (row['total_students'], row['present'], row['absent'], row['unmarked']),
            (1, 1, 0, 0),
        )
        row = by_id[str(self.empty.id)]
        self.assertEqual(
            (row['total_students'], row['present'], row['absent'], row['unmarked']),
            (0, 0, 0, 0),
        )

    def test_moved_student_excluded_from_old_class(self):
        # Record stamped for klass, then the student moves away: the old
        # class must not count it (roster-scoped aggregate).
        AttendanceRecord.objects.create(
            student=self.s1, school_class=self.klass, date=self.day,
            term='1', session='2026', status='present',
        )
        self.s1.school_class = self.other
        self.s1.save(update_fields=['school_class'])
        res = self.client.get(
            '/api/attendance/all-classes-daily/',
            {'date': self.day.isoformat()},
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        by_id = {c['class']['id']: c for c in res.data['classes']}
        row = by_id[str(self.klass.id)]
        self.assertEqual(row['present'], 0)
        self.assertEqual(row['total_students'], 1)  # only s2 remains


class StudentMonthHolidayNameTests(TestCase):
    """student_month resolves holiday names from one month fetch."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='HM Class', order=1)
        self.s1 = Student.objects.create(
            name='Ann', student_id='H000001',
            school_class=self.klass, session='2026',
        )

    def test_holiday_name_present(self):
        import calendar as _cal
        today = timezone.now().date()
        year, month = today.year, today.month
        days_in_month = _cal.monthrange(year, month)[1]
        hol_day = next(
            d for d in range(1, days_in_month + 1)
            if date(year, month, d).weekday() not in (4, 5)
        )
        Holiday.objects.create(
            date=date(year, month, hol_day), name='Founders Day',
        )
        res = self.client.get(
            f'/api/attendance/student/{self.s1.id}/',
            {'year': str(year), 'month': str(month)},
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:500])
        by_date = {d['date']: d for d in res.data['days']}
        entry = by_date[date(year, month, hol_day).isoformat()]
        self.assertEqual(entry['type'], 'holiday')
        self.assertEqual(entry.get('holiday_name'), 'Founders Day')


class ParentStudentMonthTests(TestCase):
    """Parent access to student_month is scoped to linked students."""

    def setUp(self):
        self.klass = SchoolClass.objects.create(name='PM Linked', order=1)
        self.other_klass = SchoolClass.objects.create(name='PM Other', order=2)
        self.s1 = Student.objects.create(
            name='Ann', student_id='PM0001',
            school_class=self.klass, session='2026',
        )
        self.s2 = Student.objects.create(
            name='Ben', student_id='PM0002',
            school_class=self.other_klass, session='2026',
        )
        self.parent = User.objects.create_user(
            email='pm-parent@test.com', password='testpass123',
            name='Parent', role='parent',
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.s1)
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(self.parent).access_token}'
        )
        today = timezone.now().date()
        while today.weekday() in (4, 5):
            today = today - timedelta(days=1)
        self.today = today

    def test_linked_student_ok(self):
        res = self.client.get(
            f'/api/attendance/student/{self.s1.id}/',
            {'year': str(self.today.year), 'month': str(self.today.month)},
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:300])

    def test_unlinked_student_404(self):
        res = self.client.get(
            f'/api/attendance/student/{self.s2.id}/',
            {'year': str(self.today.year), 'month': str(self.today.month)},
        )
        self.assertEqual(res.status_code, 404)


class MobileTeachersAuthTests(TestCase):
    """PIN teacher directory (/api/m/teachers/) requires authentication."""

    def setUp(self):
        self.klass = SchoolClass.objects.create(name='MT Class', order=1)
        self.teacher = Teacher.objects.create(
            name='MT Teacher', designation='T',
        )

    def _pin_token(self):
        tok = AccessToken()
        tok['teacher_id'] = str(self.teacher.id)
        tok['pin_auth'] = True
        tok.set_exp('exp', lifetime=timedelta(hours=1))
        return str(tok)

    def test_anonymous_denied(self):
        res = APIClient().get('/api/m/teachers/')
        self.assertEqual(res.status_code, 403)

    def test_jwt_user_ok(self):
        client = APIClient()
        _auth(client)
        res = client.get('/api/m/teachers/')
        self.assertEqual(res.status_code, 200, msg=res.content[:300])
        self.assertIn('teachers', res.data)

    def test_pin_teacher_ok(self):
        client = APIClient()
        res = client.get(
            '/api/m/teachers/',
            HTTP_AUTHORIZATION=f'Bearer {self._pin_token()}',
        )
        self.assertEqual(res.status_code, 200, msg=res.content[:300])
        self.assertIn('teachers', res.data)



class AttendanceRangeCapTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)

    def test_class_report_rejects_overlong_range(self):
        res = self.client.get('/api/attendance/class-report/', {
            'class_id': str(self.klass.id),
            'from': '2026-01-01', 'to': '2026-04-01',
        })
        self.assertEqual(res.status_code, 400)

    def test_monthly_report_rejects_overlong_range(self):
        res = self.client.get('/api/attendance/monthly-report/', {
            'class_id': str(self.klass.id),
            'from_date': '2026-01-01', 'to_date': '2026-04-01',
        })
        self.assertEqual(res.status_code, 400)

    def test_range_within_cap_ok(self):
        # 2026-01-01 .. 2026-03-03 inclusive = 62 days: allowed.
        res = self.client.get('/api/attendance/class-report/', {
            'class_id': str(self.klass.id),
            'from': '2026-01-01', 'to': '2026-03-03',
        })
        self.assertEqual(res.status_code, 200)
