from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from datetime import date

from core.models import SchoolClass
from students.models import Student
from parents.models import ParentStudentLink, Announcement, NotificationLog
from finance.models import BankAccount, Transaction

User = get_user_model()


class AnnouncementScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email='admin@test.com', name='Admin', password='testpass123',
            email_verified=True, role='admin',
        )
        self.parent_a = User.objects.create_user(
            email='parenta@test.com', name='Parent A', password='testpass123',
            email_verified=True, role='parent',
        )
        self.parent_b = User.objects.create_user(
            email='parentb@test.com', name='Parent B', password='testpass123',
            email_verified=True, role='parent',
        )
        self.klass_kg = SchoolClass.objects.create(name='KG')
        self.klass_one = SchoolClass.objects.create(name='Class One')
        self.student_a = Student.objects.create(
            name='Child A', student_id='E000001', school_class=self.klass_kg,
        )
        self.student_b = Student.objects.create(
            name='Child B', student_id='E000002', school_class=self.klass_one,
        )
        ParentStudentLink.objects.create(parent=self.parent_a, student=self.student_a)
        ParentStudentLink.objects.create(parent=self.parent_b, student=self.student_b)
        self.all_school = Announcement.objects.create(
            author=self.admin, title='All-school notice', body='hi'
        )
        self.kg_only = Announcement.objects.create(
            author=self.admin, title='KG notice', body='hi', school_class=self.klass_kg
        )
        self.one_only = Announcement.objects.create(
            author=self.admin, title='Class One notice', body='hi', school_class=self.klass_one
        )

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_parent_sees_all_school_and_own_class_only(self):
        self._auth(self.parent_a)
        res = self.client.get('/api/parents/announcements/')
        self.assertEqual(res.status_code, 200)
        titles = [a['title'] for a in res.data]
        self.assertIn('All-school notice', titles)
        self.assertIn('KG notice', titles)
        self.assertNotIn('Class One notice', titles)

    def test_other_parent_sees_own_class_only(self):
        self._auth(self.parent_b)
        res = self.client.get('/api/parents/announcements/')
        titles = [a['title'] for a in res.data]
        self.assertIn('All-school notice', titles)
        self.assertIn('Class One notice', titles)
        self.assertNotIn('KG notice', titles)

    def test_admin_sees_all(self):
        self._auth(self.admin)
        res = self.client.get('/api/parents/announcements/')
        titles = [a['title'] for a in res.data]
        self.assertEqual(len(res.data), 3)

    def test_unlinked_parent_sees_all_school_only(self):
        lonely = User.objects.create_user(
            email='lonely@test.com', name='Lonely', password='testpass123',
            email_verified=True, role='parent',
        )
        self._auth(lonely)
        res = self.client.get('/api/parents/announcements/')
        titles = [a['title'] for a in res.data]
        self.assertEqual(titles, ['All-school notice'])

    def test_class_announcement_creation_with_class(self):
        self._auth(self.admin)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'New KG notice',
            'body': 'hello',
            'school_class_id': str(self.klass_kg.id),
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['school_class']['id'], self.klass_kg.id)

    def test_parent_cannot_create(self):
        self._auth(self.parent_a)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Should fail', 'body': 'x',
        })
        self.assertEqual(res.status_code, 403)


class ParentNotificationsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent_a = User.objects.create_user(
            email='parenta@test.com', name='Parent A', password='testpass123',
            email_verified=True, role='parent',
        )
        self.parent_b = User.objects.create_user(
            email='parentb@test.com', name='Parent B', password='testpass123',
            email_verified=True, role='parent',
        )
        self.student_a = Student.objects.create(
            name='Child A', student_id='E000001',
        )
        self.student_b = Student.objects.create(
            name='Child B', student_id='E000002',
        )
        ParentStudentLink.objects.create(parent=self.parent_a, student=self.student_a)
        ParentStudentLink.objects.create(parent=self.parent_b, student=self.student_b)
        self.log_a = NotificationLog.objects.create(
            user=self.parent_a, event_type='dues_reminder',
            title='Fee Dues Reminder', body='You have dues:\nTuition: Mar 2026 — 1500.00/mo',
            payload={'student_id': str(self.student_a.id), 'url': '/#/parent/fees'},
        )
        self.log_b = NotificationLog.objects.create(
            user=self.parent_b, event_type='announcement',
            title='School notice', body='hi',
        )

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_parent_sees_only_own_notifications_newest_first(self):
        self._auth(self.parent_a)
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['eventType'], 'dues_reminder')
        self.assertEqual(res.data[0]['payload']['student_id'], str(self.student_a.id))

    def test_parent_does_not_see_other_parents_notifications(self):
        self._auth(self.parent_a)
        res = self.client.get('/api/parents/notifications/')
        for row in res.data:
            self.assertNotEqual(row['title'], 'School notice')

    def test_unauthenticated_gets_401(self):
        res = self.client.get('/api/parents/notifications/')
        self.assertEqual(res.status_code, 401)


class ParentPaymentsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.parent = User.objects.create_user(
            name='Mom', email='mom@test.com', password='pass123',
            email_verified=True, role='parent',
        )
        self.klass = SchoolClass.objects.create(name='Test Class')
        self.student = Student.objects.create(
            name='Child', student_id='E000100', school_class=self.klass,
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.student)
        self.cash = BankAccount.objects.get_or_create(
            name='CASH_IN_HAND', defaults={'display_name': 'Cash in Hand'},
        )[0]
        Transaction.objects.create(
            student=self.student, transaction_type='INCOME',
            amount='3500.00', category='Tuition Fee',
            source_account=self.cash, reference_id='RCPT-TEST-1',
            transaction_date=date(2026, 7, 5),
        )

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_parent_gets_own_student_payments(self):
        self._auth(self.parent)
        res = self.client.get(f'/api/parents/payments/{self.student.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['reference'], 'RCPT-TEST-1')
        self.assertEqual(res.data[0]['amount'], '3500.00')
        self.assertEqual(res.data[0]['category'], 'Tuition Fee')
        self.assertEqual(res.data[0]['date'], '2026-07-05')
        self.assertFalse(res.data[0]['isCancelled'])

    def test_unlinked_parent_gets_404(self):
        stray = User.objects.create_user(
            name='Stray', email='stray2@test.com', password='pass123',
            email_verified=True, role='parent',
        )
        self._auth(stray)
        res = self.client.get(f'/api/parents/payments/{self.student.id}/')
        self.assertEqual(res.status_code, 404)

    def test_unauthenticated_gets_401(self):
        res = self.client.get(f'/api/parents/payments/{self.student.id}/')
        self.assertEqual(res.status_code, 401)


class MultiGuardianConnectTests(TestCase):
    """Regression: one connect link serves up to 3 distinct guardians."""

    def setUp(self):
        from django.utils import timezone
        from datetime import timedelta
        from parents.models import StudentConnectLink
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='KG Multi')
        self.student = Student.objects.create(
            name='Child M', student_id='E000501', school_class=self.klass,
            contact='01712345678',
            father_name='Md. Karim Uddin', mother_name='Fatema Begum',
        )
        # Phone-format variant of the same family number.
        self.sibling = Student.objects.create(
            name='Sibling M', student_id='E000502', school_class=self.klass,
            contact='+8801712345678',
            father_name='MD Karim Uddin', mother_name='Fatema Begum',
        )
        self.guardians = []
        for i in range(1, 5):
            self.guardians.append(User.objects.create_user(
                email=f'g{i}@test.com', name=f'G{i}', password='testpass123',
                email_verified=True, role='parent',
            ))
        self.link = StudentConnectLink.objects.create(
            student=self.student, token='multi-guardian-test-token-1',
            expires_at=timezone.now() + timedelta(days=30),
        )
        self.facts = {
            'fatherName': 'Karim Uddin',
            'motherName': '',
            'contact': '01712 345678',
        }

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def _claim(self, user, facts=None):
        self._auth(user)
        return self.client.post(
            f'/api/parents/connect/{self.link.token}/', facts or self.facts,
        )

    def test_sibling_phone_variants_resolve(self):
        from parents.connect import sibling_students, normalize_phone
        self.assertEqual(normalize_phone('+8801712345678'), normalize_phone('01712 345678'))
        sibs = sibling_students(self.student)
        self.assertIsNotNone(sibs)
        self.assertIn(self.sibling.id, set(sibs.values_list('id', flat=True)))

    def test_second_guardian_claim_ok_and_reclaim_idempotent(self):
        from parents.models import ConnectClaim, ParentStudentLink
        r1 = self._claim(self.guardians[0])
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r1.data['status'], 'linked')
        # Partially-claimed link still reports shareable.
        self._auth(self.guardians[1])
        g = self.client.get(f'/api/parents/connect/{self.link.token}/')
        self.assertEqual(g.data['status'], 'unclaimed')
        r2 = self._claim(self.guardians[1])
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(ConnectClaim.objects.filter(link=self.link).count(), 2)
        self.assertEqual(
            ParentStudentLink.objects.filter(student=self.student).count(), 2,
        )
        # Same-user reclaim is idempotent, not a 409.
        r_again = self._claim(self.guardians[0])
        self.assertEqual(r_again.status_code, 200)
        self.assertEqual(r_again.data['status'], 'already_linked')
        self.assertEqual(ConnectClaim.objects.filter(link=self.link).count(), 2)

    def test_fourth_guardian_blocked(self):
        from parents.models import ConnectClaim
        for g in self.guardians[:3]:
            res = self._claim(g)
            self.assertEqual(res.status_code, 201)
        self.assertEqual(ConnectClaim.objects.filter(link=self.link).count(), 3)
        blocked = self._claim(self.guardians[3])
        self.assertEqual(blocked.status_code, 409)
        self._auth(self.guardians[3])
        g = self.client.get(f'/api/parents/connect/{self.link.token}/')
        self.assertEqual(g.data['status'], 'claimed')
        self.assertFalse(g.data['claimedByMe'])

    def test_expired_link_rejected(self):
        from django.utils import timezone
        from datetime import timedelta
        from parents.models import StudentConnectLink
        expired = StudentConnectLink.objects.create(
            student=self.student, token='expired-link-token-xyz',
            expires_at=timezone.now() - timedelta(days=1),
        )
        self._auth(self.guardians[0])
        res = self.client.post(
            f'/api/parents/connect/{expired.token}/', self.facts,
        )
        self.assertEqual(res.status_code, 410)
        get = self.client.get(f'/api/parents/connect/{expired.token}/')
        self.assertFalse(get.data['valid'])
        self.assertEqual(get.data['status'], 'expired')

    def test_no_subscription_error_logged(self):
        from parents.services import notify_parents_of_student
        from parents.models import ParentStudentLink
        ParentStudentLink.objects.create(parent=self.guardians[0], student=self.student)
        n = notify_parents_of_student(
            self.student.id, 'dues_reminder', 'Fee Dues Reminder', 'You have dues',
        )
        self.assertEqual(n, 1)
        log = NotificationLog.objects.filter(
            user=self.guardians[0], event_type='dues_reminder',
        ).latest('sent_at')
        self.assertEqual(log.error, 'no_subscription')
