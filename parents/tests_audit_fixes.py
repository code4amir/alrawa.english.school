"""Regression tests for the parents audit-fix batch.

- Malformed UUIDs on manual-link lookups return 404 (not 500).
- Archived students cannot be linked and are invisible to attendance.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass
from students.models import Student
from parents.models import ParentStudentLink

User = get_user_model()


def _auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class ParentAuditFixTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            email='padmin@test.com', name='Admin', password='testpass123',
        )
        self.parent = User.objects.create_user(
            email='pparent@test.com', name='Parent', password='testpass123',
            role='parent', email_verified=True,
        )
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Kid', student_id='P-1', school_class=self.klass,
            session='2026',
        )
        self.archived = Student.objects.create(
            name='Old Kid', student_id='P-2', school_class=self.klass,
            session='2026', deleted_at=timezone.now(),
        )

    def test_attendance_archived_student_404(self):
        ParentStudentLink.objects.create(parent=self.parent, student=self.archived)
        _auth(self.client, self.parent)
        res = self.client.get(f'/api/parents/attendance/{self.archived.id}/')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_manual_link_malformed_ids_404(self):
        _auth(self.client, self.admin)
        res = self.client.post('/api/parents/links/', {
            'parentId': 'not-a-uuid', 'studentId': 'also-bad',
        }, format='json')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_manual_link_malformed_student_404(self):
        _auth(self.client, self.admin)
        res = self.client.post('/api/parents/links/', {
            'parentId': str(self.parent.id), 'studentId': 'garbage',
        }, format='json')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_manual_link_archived_student_refused(self):
        _auth(self.client, self.admin)
        res = self.client.post('/api/parents/links/', {
            'parentId': str(self.parent.id), 'studentId': str(self.archived.id),
        }, format='json')
        self.assertEqual(res.status_code, 404, res.content[:300])
        self.assertFalse(
            ParentStudentLink.objects.filter(
                parent=self.parent, student=self.archived).exists()
        )

    def test_manual_link_active_student_still_works(self):
        _auth(self.client, self.admin)
        res = self.client.post('/api/parents/links/', {
            'parentId': str(self.parent.id), 'studentId': str(self.student.id),
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content[:300])
