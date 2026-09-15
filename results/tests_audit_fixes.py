"""Regression tests for the results bulk-prefetch rewrite.

Bulk saves must still behave identically (saved/skipped/failed) while
serving all students, existing rows and subject limits from prefetched
maps — malformed UUIDs fail per-item instead of raising 500.
"""
import uuid
from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from students.models import Student
from core.models import SchoolClass, Subject
from .models import Result

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(
        email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class BulkPrefetchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        Subject.objects.create(
            name='Math', full_marks=100, school_class=self.klass)
        self.s1 = Student.objects.create(
            name='S1', student_id='R-1', school_class=self.klass,
            session='2026')
        self.s2 = Student.objects.create(
            name='S2', student_id='R-2', school_class=self.klass,
            session='2026')

    def _post(self, items):
        return self.client.post('/api/results/bulk/', {
            'session': '2026', 'term': '1', 'items': items,
        }, format='json')

    def test_bulk_saves_multiple_students(self):
        res = self._post([
            {'student': str(self.s1.id), 'marks': {'Math': 80}},
            {'student': str(self.s2.id), 'marks': {'Math': 90}},
        ])
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(
            set(res.data['saved']), {str(self.s1.id), str(self.s2.id)})
        self.assertEqual(res.data['failed'], [])
        self.assertEqual(Result.objects.count(), 2)

    def test_bulk_malformed_uuid_fails_per_item(self):
        res = self._post([
            {'student': str(self.s1.id), 'marks': {'Math': 80}},
            {'student': 'garbage', 'marks': {'Math': 10}},
        ])
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.data['saved'], [str(self.s1.id)])
        self.assertEqual(len(res.data['failed']), 1)
        self.assertEqual(res.data['failed'][0]['student'], 'garbage')

    def test_bulk_unknown_uuid_fails_per_item(self):
        res = self._post([
            {'student': str(uuid.uuid4()), 'marks': {'Math': 10}},
        ])
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.data['saved'], [])
        self.assertEqual(len(res.data['failed']), 1)

    def test_bulk_updates_existing_row(self):
        Result.objects.create(
            student=self.s1, term='1', session='2026',
            marks={'Math': 50})
        res = self._post([
            {'student': str(self.s1.id), 'marks': {'Math': 75}},
        ])
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.data['saved'], [str(self.s1.id)])
        self.assertEqual(Result.objects.count(), 1)
        self.assertEqual(
            Result.objects.get(student=self.s1).marks['Math'], 75)

    def test_bulk_max_marks_still_enforced(self):
        res = self._post([
            {'student': str(self.s1.id), 'marks': {'Math': 999}},
        ])
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(res.data['saved'], [])
        self.assertEqual(len(res.data['failed']), 1)
