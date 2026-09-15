"""Regression tests for the attendance audit-fix batch.

- get_queryset rejects garbage class_id/date with 400 (not 500).
- Malformed UUIDs on .get() lookups return 404 (not 500).
- Report actions reject garbage dates with 400.
- Archived students are invisible to student_month.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from students.models import Student
from core.models import SchoolClass

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(
        email='admin@test.com', name='Admin', password='testpass123',
    )
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class AttendanceParamValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Alice', student_id='S000001',
            school_class=self.klass, session='2026',
        )

    def test_list_garbage_date_400(self):
        res = self.client.get(
            f'/api/attendance/?class_id={self.klass.id}&date=not-a-date')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_list_garbage_class_id_400(self):
        res = self.client.get(
            '/api/attendance/?class_id=garbage&date=2026-09-01')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_summary_malformed_student_404(self):
        res = self.client.get(
            '/api/attendance/summary/?student=garbage&term=1&session=2026')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_summary_unknown_student_404(self):
        import uuid
        res = self.client.get(
            f'/api/attendance/summary/?student={uuid.uuid4()}&term=1&session=2026')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_class_report_garbage_class_404(self):
        res = self.client.get(
            '/api/attendance/class-report/?class_id=garbage'
            '&from=2026-09-01&to=2026-09-30')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_class_report_garbage_from_400(self):
        res = self.client.get(
            f'/api/attendance/class-report/?class_id={self.klass.id}'
            '&from=garbage&to=2026-09-30')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_class_daily_garbage_date_400(self):
        res = self.client.get(
            f'/api/attendance/class-daily-report/?class_id={self.klass.id}'
            '&date=garbage')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_class_daily_garbage_class_404(self):
        res = self.client.get(
            '/api/attendance/class-daily-report/?class_id=garbage&date=2026-09-01')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_all_classes_daily_garbage_date_400(self):
        res = self.client.get('/api/attendance/all-classes-daily/?date=garbage')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_monthly_report_garbage_class_404(self):
        res = self.client.get(
            '/api/attendance/monthly-report/?class_id=garbage'
            '&year=2026&month=9')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_student_month_archived_student_404(self):
        self.student.deleted_at = timezone.now()
        self.student.save(update_fields=['deleted_at'])
        res = self.client.get(f'/api/attendance/student/{self.student.id}/')
        self.assertEqual(res.status_code, 404, res.content[:300])
