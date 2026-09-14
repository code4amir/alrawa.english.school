"""Regression tests for the portal follow-up batch.

Covers: notification retention (TTL window + 100-row cap), the family
siblings endpoint (one-tap claim discovery), and the prune command.
"""

from datetime import timedelta

from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass
from students.models import Student
from parents.models import NotificationLog, ParentStudentLink
from parents.views import NOTIFICATION_TTL_DAYS, NOTIFICATION_RETENTION_CAP

User = get_user_model()


class NotificationBase(TestCase):
    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def _make_user(self, email, role='parent', **kw):
        kw.setdefault('name', email.split('@')[0])
        kw.setdefault('password', 'testpass123')
        kw.setdefault('email_verified', True)
        return User.objects.create_user(email=email, role=role, **kw)

    def _log(self, user, title='Notice', days_ago=None):
        n = NotificationLog.objects.create(
            user=user, event_type='announcement', title=title, body='',
            payload={}, sent_at=timezone.now() - timedelta(days=days_ago or 0),
        )
        # auto_now_add overrode sent_at — set it explicitly
        NotificationLog.objects.filter(id=n.id).update(
            sent_at=timezone.now() - timedelta(days=days_ago or 0)
        )
        n.refresh_from_db()
        return n


class NotificationRetentionTests(NotificationBase):
    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('p-retain@test.com')
        self.other = self._make_user('p-other@test.com')

    def test_old_rows_are_hidden(self):
        self._log(self.parent, 'old', days_ago=NOTIFICATION_TTL_DAYS + 5)
        self._log(self.parent, 'new', days_ago=1)
        self._auth(self.parent)
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 200)
        titles = [r['title'] for r in res.data]
        self.assertIn('new', titles)
        self.assertNotIn('old', titles)

    def test_cap_100_rows(self):
        for i in range(NOTIFICATION_RETENTION_CAP + 20):
            self._log(self.parent, f'n{i}')
        self._auth(self.parent)
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), NOTIFICATION_RETENTION_CAP)
        # newest first — the first 20 oldest of the 120 are dropped
        self.assertEqual(res.data[0]['title'], f'n{NOTIFICATION_RETENTION_CAP + 19}')
        self.assertNotIn('n0', [r['title'] for r in res.data])

    def test_scoped_to_own_rows(self):
        self._log(self.other, 'secret')
        self._auth(self.parent)
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('secret', [r['title'] for r in res.data])

    def test_boundary_row_exactly_at_ttl_visible(self):
        self._log(self.parent, 'edge', days_ago=NOTIFICATION_TTL_DAYS - 1)
        self._auth(self.parent)
        res = self.client.get('/api/parents/notifications/')
        self.assertIn('edge', [r['title'] for r in res.data])

    def test_non_parent_forbidden(self):
        staff = self._make_user('s-x@test.com', role='teacher')
        self._auth(staff)
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 403)


class PruneNotificationsTests(NotificationBase):
    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('p-prune@test.com')

    def test_prune_deletes_only_old_rows(self):
        old = self._log(self.parent, 'old', days_ago=NOTIFICATION_TTL_DAYS + 10)
        fresh = self._log(self.parent, 'fresh')
        out = StringIO()
        call_command('prune_notifications', stdout=out)
        self.assertIn('Pruned 1', out.getvalue())
        self.assertFalse(NotificationLog.objects.filter(id=old.id).exists())
        self.assertTrue(NotificationLog.objects.filter(id=fresh.id).exists())

    def test_dry_run_deletes_nothing(self):
        old = self._log(self.parent, 'old', days_ago=NOTIFICATION_TTL_DAYS + 10)
        out = StringIO()
        call_command('prune_notifications', '--dry-run', stdout=out)
        self.assertIn('would delete 1', out.getvalue())
        self.assertTrue(NotificationLog.objects.filter(id=old.id).exists())


class FamilySiblingsTests(NotificationBase):
    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('p-sib@test.com')
        self.nobody = self._make_user('p-nolink@test.com')
        # family A: two siblings sharing a contact, tolerant formats
        self.cls = SchoolClass.objects.create(name='One')
        self.kid_a = Student.objects.create(
            name='Kid A', student_id='SA', roll='1', contact='01712345678',
            school_class=self.cls,
        )
        self.kid_b = Student.objects.create(
            name='Kid B', student_id='SB', roll='2', contact='+880 1712-345678',
            school_class=self.cls,
        )
        # unrelated student
        self.kid_c = Student.objects.create(
            name='Kid C', student_id='SC', roll='3', contact='01811111111',
            school_class=self.cls,
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.kid_a)

    def test_sibling_shown_unlinked(self):
        self._auth(self.parent)
        res = self.client.get('/api/parents/family-siblings/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['name'], 'Kid B')
        self.assertEqual(res.data[0]['className'], 'One')

    def test_sibling_hidden_once_linked(self):
        ParentStudentLink.objects.create(parent=self.parent, student=self.kid_b)
        self._auth(self.parent)
        res = self.client.get('/api/parents/family-siblings/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_unrelated_student_never_listed(self):
        self._auth(self.parent)
        res = self.client.get('/api/parents/family-siblings/')
        names = [r['name'] for r in res.data]
        self.assertNotIn('Kid C', names)

    def test_no_links_no_crash(self):
        self._auth(self.nobody)
        res = self.client.get('/api/parents/family-siblings/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_non_parent_forbidden(self):
        staff = self._make_user('t-sib@test.com', role='teacher')
        self._auth(staff)
        res = self.client.get('/api/parents/family-siblings/')
        self.assertEqual(res.status_code, 403)

    def test_soft_deleted_sibling_excluded(self):
        Student.objects.filter(id=self.kid_b.id).update(deleted_at=timezone.now())
        self._auth(self.parent)
        res = self.client.get('/api/parents/family-siblings/')
        self.assertEqual(res.data, [])


class FamilyClaimTests(NotificationBase):
    def setUp(self):
        self.client = APIClient()
        self.parent = self._make_user('p-claim@test.com')
        self.outsider = self._make_user('p-out@test.com')
        self.cls = SchoolClass.objects.create(name='One')
        self.kid_a = Student.objects.create(
            name='Kid A', student_id='SA', roll='1', contact='01712345678',
            school_class=self.cls,
        )
        self.kid_b = Student.objects.create(
            name='Kid B', student_id='SB', roll='2', contact='+880 1712-345678',
            school_class=self.cls,
        )
        self.kid_c = Student.objects.create(
            name='Kid C', student_id='SC', roll='3', contact='01811111111',
            school_class=self.cls,
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.kid_a)

    def test_claim_sibling_links(self):
        self._auth(self.parent)
        res = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'linked')
        self.assertTrue(ParentStudentLink.objects.filter(
            parent=self.parent, student=self.kid_b,
        ).exists())

    def test_claim_requires_family_overlap(self):
        self._auth(self.outsider)  # outsider links no child at all
        res = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res.status_code, 403)
        self.assertFalse(ParentStudentLink.objects.filter(
            parent=self.outsider, student=self.kid_b,
        ).exists())

    def test_claim_outsider_with_other_family_blocked(self):
        # outsider links an unrelated child, then tries to claim kid_b — no overlap
        ParentStudentLink.objects.create(parent=self.outsider, student=self.kid_c)
        self._auth(self.outsider)
        res = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res.status_code, 403)
        self.assertFalse(ParentStudentLink.objects.filter(
            parent=self.outsider, student=self.kid_b,
        ).exists())

    def test_claim_idempotent(self):
        self._auth(self.parent)
        res = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res.status_code, 201)
        res2 = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data['status'], 'already_linked')
        self.assertEqual(ParentStudentLink.objects.filter(
            parent=self.parent, student=self.kid_b,
        ).count(), 1)

    def test_claim_unknown_student_404(self):
        self._auth(self.parent)
        res = self.client.post('/api/parents/family-claim/', {'studentId': 'not-a-uuid'})
        self.assertEqual(res.status_code, 404)

    def test_claim_missing_param_400(self):
        self._auth(self.parent)
        res = self.client.post('/api/parents/family-claim/', {})
        self.assertEqual(res.status_code, 400)

    def test_claim_non_parent_403(self):
        staff = self._make_user('t-claim@test.com', role='teacher')
        self._auth(staff)
        res = self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertEqual(res.status_code, 403)

    def test_claim_writes_audit_log(self):
        from core.audit import AuditLog
        self._auth(self.parent)
        self.client.post('/api/parents/family-claim/', {'studentId': str(self.kid_b.id)})
        self.assertTrue(AuditLog.objects.filter(action='family_claim').exists())
