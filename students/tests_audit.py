from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass, AcademicYear, ServiceType, AuditLog

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(
        email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class StudentServiceAuditTests(TestCase):
    """Regression tests: YYYY-MM validation + period locks + audit rows
    on the student-service enrollment path."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.svc = ServiceType.objects.create(
            name='Transport', default_amount=500, frequency='MONTHLY')

    def _toggle(self, **kw):
        data = {
            'studentId': str(self.student.id),
            'serviceTypeId': str(self.svc.id),
            'active': True,
        }
        data.update(kw)
        return self.client.post(
            f'/api/students/{self.student.id}/toggle_service/', data, format='json')

    def test_toggle_garbage_month_400(self):
        res = self._toggle(starts_at='junk', ends_at='2026-12')
        self.assertEqual(res.status_code, 400)

    def test_toggle_bad_month_number_400(self):
        res = self._toggle(starts_at='2026-13', ends_at='2026-12')
        self.assertEqual(res.status_code, 400)

    def test_toggle_ends_before_starts_400(self):
        res = self._toggle(starts_at='2026-12', ends_at='2026-01')
        self.assertEqual(res.status_code, 400)

    def test_bulk_toggle_garbage_month_400(self):
        res = self.client.post('/api/students/bulk_toggle_service/', {
            'service_type_id': str(self.svc.id),
            'student_ids': [str(self.student.id)],
            'active': True,
            'starts_at': 'junk', 'ends_at': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_enrollment_blocked_when_period_closed(self):
        from finance.models import PeriodClose
        from finance.views.base import _fiscal_year_from_date
        PeriodClose.objects.create(
            fiscal_year=_fiscal_year_from_date(self.year.start_date), closed_by='test')
        res = self._toggle(starts_at='2026-01', ends_at='2026-12')
        self.assertEqual(res.status_code, 403)

    def test_enrollment_writes_audit_rows(self):
        res = self._toggle(starts_at='2026-01', ends_at='2026-12')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(
            entity_type='fee_schedule').exists())
        self.assertTrue(AuditLog.objects.filter(
            entity_type='student_fee_assignment').exists())
