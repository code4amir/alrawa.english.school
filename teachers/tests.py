from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
from datetime import timedelta
from core.models import SchoolClass
from .models import Teacher, ClassTeacher

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class TeacherTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_create_teacher(self):
        res = self.client.post('/api/teachers/', {'name': 'Mr. Smith', 'designation': 'Math Teacher', 'contact': '123', 'email': 'smith@test.com'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Teacher.objects.count(), 1)
        self.assertIn('hasPhoto', res.data)

    def test_list_teachers(self):
        Teacher.objects.create(name='T1', designation='Math')
        Teacher.objects.create(name='T2', designation='Science')
        res = self.client.get('/api/teachers/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_retrieve_teacher(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        res = self.client.get(f'/api/teachers/{t.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'T1')

    def test_update_teacher(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        res = self.client.put(f'/api/teachers/{t.id}/', {'name': 'Updated', 'designation': 'Science'})
        self.assertEqual(res.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.name, 'Updated')

    def test_delete_teacher_soft(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        res = self.client.delete(f'/api/teachers/{t.id}/')
        self.assertEqual(res.status_code, 204)
        t.refresh_from_db()
        self.assertIsNotNone(t.deleted_at)

    def test_restore_teacher(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        self.client.delete(f'/api/teachers/{t.id}/')
        res = self.client.post(f'/api/teachers/{t.id}/restore/')
        self.assertEqual(res.status_code, 200)
        t.refresh_from_db()
        self.assertIsNone(t.deleted_at)

    def test_photo_no_photo(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        res = self.client.get(f'/api/teachers/{t.id}/photo/')
        self.assertEqual(res.status_code, 404)

    def test_serializer_has_photo(self):
        t = Teacher.objects.create(name='T1', designation='Math')
        res = self.client.get(f'/api/teachers/{t.id}/')
        self.assertIn('hasPhoto', res.data)

    def test_create_teacher_missing_name(self):
        res = self.client.post('/api/teachers/', {'designation': 'Math'})
        self.assertEqual(res.status_code, 400)


class MonitorTeacherAccessTests(TestCase):
    """Monitors manage teacher records but cannot touch PINs or assignments."""

    def setUp(self):
        self.client = APIClient()
        self.monitor = User.objects.create_user(
            email='monitor@test.com', name='Monitor', password='testpass123', role='monitor')
        refresh = RefreshToken.for_user(self.monitor)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.teacher = Teacher.objects.create(name='T1', designation='Assistant')

    def test_monitor_can_create_teacher(self):
        res = self.client.post('/api/teachers/', {'name': 'New T', 'designation': 'Assistant'})
        self.assertEqual(res.status_code, 201)

    def test_monitor_can_update_teacher(self):
        res = self.client.put(f'/api/teachers/{self.teacher.id}/', {'name': 'T1x', 'designation': 'Assistant'})
        self.assertEqual(res.status_code, 200)

    def test_monitor_can_delete_teacher(self):
        res = self.client.delete(f'/api/teachers/{self.teacher.id}/')
        self.assertEqual(res.status_code, 204)

    def test_monitor_cannot_set_pin(self):
        res = self.client.post(f'/api/teachers/{self.teacher.id}/set_pin/', {'pin': '123456'})
        self.assertEqual(res.status_code, 403)

    def test_monitor_cannot_assign_class_teacher(self):
        from core.models import SchoolClass
        klass = SchoolClass.objects.create(name='Play', order=1)
        res = self.client.post(
            f'/api/teachers/{self.teacher.id}/class_teacher/', {'classId': str(klass.id)})
        self.assertEqual(res.status_code, 403)


class MobileMonthlyReportGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.teacher = Teacher.objects.create(name='PIN Teacher', designation='T')
        ClassTeacher.objects.create(teacher=self.teacher, school_class=self.klass)

    def _pin_token(self):
        tok = AccessToken()
        tok['teacher_id'] = str(self.teacher.id)
        tok['pin_auth'] = True
        tok.set_exp('exp', lifetime=timedelta(hours=1))
        return str(tok)

    def _get(self, params):
        return self.client.get(
            '/api/m/attendance/monthly-report/', params,
            HTTP_AUTHORIZATION=f'Bearer {self._pin_token()}')

    def test_bad_year_month_400(self):
        res = self._get({
            'class_id': str(self.klass.id), 'year': 'abc', 'month': 'xyz'})
        self.assertEqual(res.status_code, 400)

    def test_month_out_of_range_400(self):
        res = self._get({
            'class_id': str(self.klass.id), 'year': '2026', 'month': '13'})
        self.assertEqual(res.status_code, 400)

    def test_valid_month_200(self):
        res = self._get({
            'class_id': str(self.klass.id), 'year': '2026', 'month': '9'})
        self.assertEqual(res.status_code, 200)
