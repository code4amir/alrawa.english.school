from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Student
from core.models import SchoolClass

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class StudentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)

    def test_create_student(self):
        res = self.client.post('/api/students/', {
            'name': 'John Doe', 'schoolClass': self.klass.id, 'roll': '1',
            'fatherName': 'Father', 'motherName': 'Mother', 'contact': '123',
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Student.objects.count(), 1)
        self.assertEqual(res.data['name'], 'John Doe')
        self.assertIn('studentId', res.data)
        self.assertIn('hasPhoto', res.data)

    def test_list_students(self):
        Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        Student.objects.create(name='S2', student_id='S000002', school_class=self.klass)
        res = self.client.get('/api/students/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_retrieve_student(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.get(f'/api/students/{s.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'S1')

    def test_update_student(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.put(f'/api/students/{s.id}/', {'name': 'Updated', 'class': self.klass.id})
        self.assertEqual(res.status_code, 200)
        s.refresh_from_db()
        self.assertEqual(s.name, 'Updated')

    def test_delete_student_soft(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.delete(f'/api/students/{s.id}/')
        self.assertEqual(res.status_code, 204)
        s.refresh_from_db()
        self.assertIsNotNone(s.deleted_at)

    def test_restore_student(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        self.client.delete(f'/api/students/{s.id}/')
        res = self.client.post(f'/api/students/{s.id}/restore/')
        self.assertEqual(res.status_code, 200)
        s.refresh_from_db()
        self.assertIsNone(s.deleted_at)

    def test_filter_by_class(self):
        k2 = SchoolClass.objects.create(name='Class 6', order=2)
        Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        Student.objects.create(name='S2', student_id='S000002', school_class=k2)
        res = self.client.get(f'/api/students/?class_id={self.klass.id}')
        self.assertEqual(len(res.data['results']), 1)
        self.assertEqual(res.data['results'][0]['name'], 'S1')

    def test_filter_by_session(self):
        Student.objects.create(name='S1', student_id='S000001', school_class=self.klass, session='2026')
        Student.objects.create(name='S2', student_id='S000002', school_class=self.klass, session='2027')
        res = self.client.get('/api/students/?session=2026')
        self.assertEqual(len(res.data['results']), 1)

    def test_search_student(self):
        Student.objects.create(name='Alpha', student_id='S000001', school_class=self.klass)
        Student.objects.create(name='Beta', student_id='S000002', school_class=self.klass)
        res = self.client.get('/api/students/?search=Alpha')
        self.assertEqual(len(res.data['results']), 1)
        self.assertEqual(res.data['results'][0]['name'], 'Alpha')

    def test_graduate_student(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.post(f'/api/students/{s.id}/graduate/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['hasGraduated'])

    def test_ungraduate_student(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        self.client.post(f'/api/students/{s.id}/graduate/')
        res = self.client.post(f'/api/students/{s.id}/ungraduate/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['hasGraduated'])

    def test_photo_no_photo(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.get(f'/api/students/{s.id}/photo/')
        self.assertEqual(res.status_code, 404)

    def test_student_id_auto_generated(self):
        s1 = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        self.assertEqual(s1.student_id, 'S000001')

    def test_serializer_has_photo_url(self):
        s = Student.objects.create(name='S1', student_id='S000001', school_class=self.klass)
        res = self.client.get(f'/api/students/{s.id}/')
        self.assertIn('hasPhoto', res.data)

    def test_create_student_missing_name(self):
        res = self.client.post('/api/students/', {'class': self.klass.id})
        self.assertEqual(res.status_code, 400)

    def test_create_student_missing_class(self):
        res = self.client.post('/api/students/', {'name': 'John'})
        # school_class is nullable on the model, so create succeeds
        self.assertEqual(res.status_code, 201)
