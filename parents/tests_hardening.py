"""Regression tests for the engagement + parents hardening batch.

Covers: days-param 400s, announcement broadcast validation + ordering,
push-subscription uniqueness, manual-link audit + welcome notify,
VAPID-from-settings, generic connect-create error, fees/dues parity.
"""

import uuid
from decimal import Decimal

from django.db import IntegrityError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import AcademicYear, SchoolClass
from students.models import Student
from parents.models import (
    Announcement, NotificationLog, ParentStudentLink, PushSubscription,
)

User = get_user_model()


class HardeningAuthMixin:
    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}'
        )

    def _make_user(self, email, role='parent', **kw):
        kw.setdefault('name', email.split('@')[0])
        kw.setdefault('password', 'testpass123')
        kw.setdefault('email_verified', True)
        return User.objects.create_user(
            email=email, role=role, **kw,
        )


class EngagementDaysValidationTests(HardeningAuthMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = self._make_user('t-days@test.com', role='teacher')
        self.admin = self._make_user('a-days@test.com', role='admin')

    def test_leaderboard_rejects_garbage_days(self):
        self._auth(self.teacher)
        res = self.client.get('/api/engagement/quiz/leaderboard/?days=abc')
        self.assertEqual(res.status_code, 400)

    def test_leaderboard_rejects_out_of_range_days(self):
        self._auth(self.teacher)
        for bad in ('0', '-3'):
            res = self.client.get(
                f'/api/engagement/quiz/leaderboard/?days={bad}'
            )
            self.assertEqual(res.status_code, 400, f'days={bad}')

    def test_leaderboard_accepts_valid_days(self):
        self._auth(self.teacher)
        res = self.client.get('/api/engagement/quiz/leaderboard/?days=7')
        self.assertEqual(res.status_code, 200)

    def test_mood_history_rejects_garbage_days(self):
        self._auth(self.teacher)
        res = self.client.get('/api/engagement/mood/history/?days=NaN')
        self.assertEqual(res.status_code, 400)

    def test_mood_aggregate_admin_rejects_garbage_days(self):
        self._auth(self.admin)
        res = self.client.get('/api/engagement/mood/aggregate/?days=oops')
        self.assertEqual(res.status_code, 400)

    def test_mood_aggregate_non_admin_still_forbidden(self):
        self._auth(self.teacher)
        res = self.client.get('/api/engagement/mood/aggregate/?days=oops')
        self.assertEqual(res.status_code, 403)


class AnnouncementBroadcastTests(HardeningAuthMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = self._make_user('a-bc@test.com', role='admin')
        self.parent = self._make_user('p-bc@test.com', role='parent')
        self.klass = SchoolClass.objects.create(name='BC Class')
        self.student = Student.objects.create(
            name='BC Child', student_id='E009001',
            school_class=self.klass,
        )
        ParentStudentLink.objects.create(
            parent=self.parent, student=self.student,
        )

    def test_broadcast_rejects_unknown_class(self):
        self._auth(self.admin)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Bad class', 'body': 'x',
            'school_class_id': str(uuid.uuid4()),
        })
        self.assertEqual(res.status_code, 404)

    def test_broadcast_rejects_malformed_class_id(self):
        self._auth(self.admin)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Bad class', 'body': 'x',
            'school_class_id': 'not-a-uuid',
        })
        self.assertEqual(res.status_code, 404)

    def test_list_is_newest_first_with_author(self):
        self._auth(self.parent)
        Announcement.objects.create(
            author=self.admin, title='Older', body='a',
        )
        Announcement.objects.create(
            author=self.admin, title='Newer', body='b',
        )
        res = self.client.get('/api/parents/announcements/')
        self.assertEqual(res.status_code, 200)
        titles = [a['title'] for a in res.data]
        self.assertEqual(titles, ['Newer', 'Older'])
        self.assertEqual(res.data[0]['author'], self.admin.name)


class PushSubscriptionConstraintTests(HardeningAuthMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('p-push@test.com', role='parent')

    def test_subscribe_is_idempotent_per_endpoint(self):
        self._auth(self.parent)
        payload = {'endpoint': 'https://push.example/sub-1',
                   'keys': {'p256dh': 'k1', 'auth': 'a1'}}
        r1 = self.client.post('/api/parents/push/subscribe/', payload,
                              format='json')
        r2 = self.client.post('/api/parents/push/subscribe/', payload,
                              format='json')
        self.assertIn(r1.status_code, (200, 201))
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(
            PushSubscription.objects.filter(
                user=self.parent, endpoint=payload['endpoint'],
            ).count(), 1,
        )

    def test_duplicate_user_endpoint_violates_constraint(self):
        PushSubscription.objects.create(
            user=self.parent, endpoint='https://push.example/dup',
            p256dh_key='k', auth_key='a',
        )
        with self.assertRaises(IntegrityError):
            PushSubscription.objects.create(
                user=self.parent, endpoint='https://push.example/dup',
                p256dh_key='k', auth_key='a',
            )


class ParentLinkManualTests(HardeningAuthMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = self._make_user('a-link@test.com', role='admin')
        self.parent = self._make_user('p-link@test.com', role='parent')
        self.student = Student.objects.create(
            name='Link Child', student_id='E009002',
        )

    def test_manual_link_audits_and_welcomes(self):
        from core.models import AuditLog
        self._auth(self.admin)
        res = self.client.post('/api/parents/links/', {
            'parentId': str(self.parent.id),
            'studentId': str(self.student.id),
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(
            AuditLog.objects.filter(
                action='manual_link',
                entity_id=str(self.student.id),
            ).exists()
        )
        welcome = NotificationLog.objects.filter(
            user=self.parent, event_type='announcement',
        ).latest('sent_at')
        self.assertIn(self.student.name, welcome.body)
        self.assertEqual(
            welcome.payload.get('student_id'), str(self.student.id),
        )


class VapidKeySettingsTests(TestCase):
    def test_key_comes_from_django_settings(self):
        res = APIClient().get('/api/parents/push/vapid-key/')
        self.assertEqual(res.status_code, 200)

    @override_settings(VAPID_PUBLIC_KEY='test-key-123')
    def test_settings_override_is_reflected(self):
        res = APIClient().get('/api/parents/push/vapid-key/')
        self.assertEqual(res.data['publicKey'], 'test-key-123')


class ConnectCreateGenericErrorTests(HardeningAuthMixin, TestCase):
    def setUp(self):
        from django.utils import timezone
        from datetime import timedelta
        from parents.models import StudentConnectLink
        self.client = APIClient()
        self.existing = self._make_user(
            'taken@test.com', role='parent', name='Taken',
        )
        self.student = Student.objects.create(
            name='CC Child', student_id='E009003',
            contact='01700000000',
            father_name='Karim', mother_name='Fatema',
        )
        self.link = StudentConnectLink.objects.create(
            student=self.student, token='generic-err-token-1',
            expires_at=timezone.now() + timedelta(days=30),
        )

    def test_existing_email_returns_generic_409_without_code(self):
        res = self.client.post(
            f'/api/parents/connect/{self.link.token}/',
            {'mode': 'create', 'name': 'Someone',
             'email': 'taken@test.com', 'password': 'password123',
             'fatherName': 'Karim', 'motherName': '',
             'contact': '01700000000'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertNotIn('code', res.data)


class StudentFeesDuesParityTests(HardeningAuthMixin, TestCase):
    """Portal /fees totals must equal the dues-push computation."""

    def setUp(self):
        from datetime import date as dt_date
        self.client = APIClient()
        self.parent = self._make_user('p-fees@test.com', role='parent')
        self.klass = SchoolClass.objects.create(name='Fees Class')
        self.student = Student.objects.create(
            name='Fees Child', student_id='E009004',
            school_class=self.klass,
        )
        ParentStudentLink.objects.create(
            parent=self.parent, student=self.student,
        )
        self.year = AcademicYear.objects.create(
            name='2099', start_date=dt_date(2098, 9, 1),
            end_date=dt_date(2099, 8, 31), is_active=True,
        )
        from finance.models import FeeSchedule
        FeeSchedule.objects.create(
            academic_year=self.year, school_class=None,
            category='Tuition Fee', amount='5000.00',
            frequency='YEARLY', applicability='AUTO',
        )

    def test_portal_balance_matches_defaulter_service(self):
        from django.utils import timezone
        from finance.services.defaulter_service import DefaulterService
        now = timezone.now()
        month_to = f'{now.year}-{now.month:02d}'
        prev_year = now.year - 1 if now.month == 1 else now.year
        prev_month = 12 if now.month == 1 else now.month - 1
        month_from = f'{prev_year}-{prev_month:02d}'
        svc = DefaulterService(
            student_id=self.student.id,
            month_from=month_from, month_to=month_to,
        )
        svc.resolve_year()
        expected = svc.compute([self.student], [self.student.id])[0]

        self._auth(self.parent)
        res = self.client.get(f'/api/parents/fees/{self.student.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            Decimal(res.data['totalDue']),
            Decimal(str(expected['totalDue'])),
        )
        self.assertEqual(
            Decimal(res.data['balance']),
            Decimal(str(expected['balance'])),
        )
        portal_cats = {s['category'] for s in res.data['schedules']}
        service_names = {f['name'] for f in expected['fees']}
        self.assertEqual(portal_cats, service_names)


class BackendHardeningBatchTests(HardeningAuthMixin, TestCase):
    """Regression tests for the uncommitted backend hardening batch.

    Covers: attendance year/month 400 guard, push shared-device delete,
    connect-link is_active multi-guardian count, NotificationLog new
    event-type choices.
    """

    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('hard-a@test.com')
        self.parent2 = self._make_user('hard-b@test.com')
        self.klass = SchoolClass.objects.create(name='Hardening Class')
        self.student = Student.objects.create(
            student_id='S-HARD-1', name='Hard One', contact='01710000001',
            school_class=self.klass,
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.student)

    def test_attendance_rejects_bad_year_month(self):
        self._auth(self.parent)
        base = f'/api/parents/attendance/{self.student.id}/'
        for qs in ('?month=13', '?month=0', '?month=abc', '?year=abc',
                   '?year=0', '?year=10000'):
            res = self.client.get(base + qs)
            self.assertEqual(res.status_code, 400, qs)

    def test_attendance_accepts_valid_year_month(self):
        self._auth(self.parent)
        res = self.client.get(f'/api/parents/attendance/{self.student.id}/?year=2024&month=1')
        self.assertEqual(res.status_code, 200)

    def test_push_subscribe_drops_other_users_same_endpoint(self):
        from parents.models import PushSubscription
        ep = 'https://push.example.com/sub/shared-device'
        PushSubscription.objects.create(
            user=self.parent2, endpoint=ep,
            p256dh_key='k1', auth_key='a1',
        )
        self._auth(self.parent)
        res = self.client.post('/api/parents/push/subscribe/', {
            'endpoint': ep, 'keys': {'p256dh': 'k2', 'auth': 'a2'},
        }, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        self.assertFalse(
            PushSubscription.objects.filter(user=self.parent2, endpoint=ep).exists()
        )
        self.assertTrue(
            PushSubscription.objects.filter(user=self.parent, endpoint=ep).exists()
        )

    def test_connect_link_is_active_multi_guardian(self):
        import datetime
        from django.utils import timezone
        from parents.models import ConnectClaim, StudentConnectLink
        link = StudentConnectLink.objects.create(
            student=self.student, token='tok-hardening-1',
            expires_at=timezone.now() + datetime.timedelta(days=30),
        )
        self.assertTrue(link.is_active())
        # legacy claimed_by alone counts as one claim — still active
        link.claimed_by = self.parent
        link.claimed_at = timezone.now()
        link.save(update_fields=['claimed_by', 'claimed_at'])
        link.refresh_from_db()
        self.assertTrue(link.is_active())
        # +2 ConnectClaim rows (one duplicating legacy user) -> 3 distinct -> inactive
        ConnectClaim.objects.create(link=link, user=self.parent)
        u3 = self._make_user('hard-c@test.com')
        u4 = self._make_user('hard-d@test.com')
        ConnectClaim.objects.create(link=link, user=u3)
        link.refresh_from_db()
        self.assertTrue(link.is_active())
        ConnectClaim.objects.create(link=link, user=u4)
        link.refresh_from_db()
        self.assertFalse(link.is_active())

    def test_notification_log_new_event_types(self):
        log = NotificationLog.objects.create(
            user=self.parent, event_type='homework_published',
            title='HW', body='Do page 5',
        )
        log.full_clean()  # must not raise — choice must exist
        log2 = NotificationLog.objects.create(
            user=self.parent, event_type='diary_created',
            title='Diary', body='Today we...',
        )
        log2.full_clean()
