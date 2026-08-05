from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass
from students.models import Student
from parents.models import ParentStudentLink, Announcement, NotificationLog

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
