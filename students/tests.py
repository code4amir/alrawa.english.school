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

    def test_create_student_with_class_name_keeps_class(self):
        # The UI/import send the class under the ``class`` key as its NAME.
        # Regression: this previously created a classless student because DRF
        # silently dropped the undeclared key.
        res = self.client.post('/api/students/', {
            'name': 'Jane Doe', 'class': self.klass.name, 'roll': '2',
            'fatherName': 'Father Jane', 'motherName': 'Mother Jane',
        })
        self.assertEqual(res.status_code, 201)
        s = Student.objects.get(name='Jane Doe')
        self.assertEqual(s.school_class_id, self.klass.id)
        self.assertEqual(s.father_name, 'Father Jane')
        self.assertEqual(s.mother_name, 'Mother Jane')

    def test_create_student_class_name_case_insensitive(self):
        res = self.client.post('/api/students/', {
            'name': 'Casey', 'class': self.klass.name.lower(), 'roll': '3',
        })
        self.assertEqual(res.status_code, 201)
        s = Student.objects.get(name='Casey')
        self.assertEqual(s.school_class_id, self.klass.id)

    def test_duplicate_roll_active_400(self):
        self.client.post('/api/students/', {
            'name': 'First', 'class': self.klass.name, 'roll': '2026420'})
        res = self.client.post('/api/students/', {
            'name': 'Second', 'class': self.klass.name, 'roll': '2026420'})
        self.assertEqual(res.status_code, 400)

    def test_deleted_roll_reusable_201(self):
        res = self.client.post('/api/students/', {
            'name': 'Gone', 'class': self.klass.name, 'roll': '2026420'})
        self.assertEqual(res.status_code, 201)
        gone = Student.objects.get(name='Gone')
        del_res = self.client.delete(f'/api/students/{gone.id}/')
        self.assertEqual(del_res.status_code, 204)
        res2 = self.client.post('/api/students/', {
            'name': 'Replacement', 'class': self.klass.name, 'roll': '2026420'})
        self.assertEqual(res2.status_code, 201)

    def test_create_student_null_names_flattened(self):
        # NOT NULL columns with default '' — API must not 500 on nulls.
        res = self.client.post('/api/students/', {
            'name': 'Null Sis', 'class': self.klass.name,
            'fatherName': None, 'motherName': None, 'contact': None,
        }, format='json')  # axios sends JSON where null is legal
        self.assertEqual(res.status_code, 201)
        s = Student.objects.get(name='Null Sis')
        self.assertEqual(s.father_name, '')
        self.assertEqual(s.mother_name, '')
        self.assertEqual(s.contact, '')

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

    def test_photo_url_is_redirect_not_proxy(self):
        from unittest.mock import patch
        s = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass,
            photo_path='students/s1.jpg')
        with patch('core.mixins.get_signed_url', return_value='https://cdn.test/signed.jpg'):
            res = self.client.get(f'/api/students/{s.id}/')
            self.assertEqual(res.status_code, 200)
            self.assertIn('/photo/?token=', res.data['photoUrl'])
            self.assertNotIn('proxy=1', res.data['photoUrl'])

    def test_photo_endpoint_redirects_to_storage(self):
        from unittest.mock import patch
        s = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass,
            photo_path='students/s1.jpg')
        with patch('core.mixins.get_signed_url', return_value='https://cdn.test/signed.jpg'):
            detail = self.client.get(f'/api/students/{s.id}/').data
            token_url = detail['photoUrl']
            res = self.client.get(token_url)
            self.assertEqual(res.status_code, 302)
            self.assertEqual(res['Location'], 'https://cdn.test/signed.jpg')

    def test_create_student_missing_name(self):
        res = self.client.post('/api/students/', {'class': self.klass.id})
        self.assertEqual(res.status_code, 400)

    def test_create_student_missing_class(self):
        res = self.client.post('/api/students/', {'name': 'John'})
        # school_class is nullable on the model, so create succeeds
        self.assertEqual(res.status_code, 201)


class StudentClassTeacherScopeTests(TestCase):
    """Class teachers manage students of their own class only (add/remove/edit)."""

    def setUp(self):
        from teachers.models import Teacher, ClassTeacher
        self.client = APIClient()
        self.play = SchoolClass.objects.create(name='Play', order=1)
        self.kg = SchoolClass.objects.create(name='KG', order=2)
        self.teacher_user = User.objects.create_user(
            email='classteacher@test.com', name='Class Teacher', password='testpass123', role='teacher')
        teacher = Teacher.objects.create(
            user=self.teacher_user, designation='Assistant Teacher', name='Class Teacher')
        ClassTeacher.objects.create(teacher=teacher, school_class=self.play, is_primary=True)
        refresh = RefreshToken.for_user(self.teacher_user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.play_student = Student.objects.create(name='P1', student_id='S000101', school_class=self.play)
        self.kg_student = Student.objects.create(name='K1', student_id='S000102', school_class=self.kg)

    def test_class_teacher_can_update_own_class_student(self):
        res = self.client.put(
            f'/api/students/{self.play_student.id}/',
            {'name': 'P1 Updated', 'class': str(self.play.id)})
        self.assertEqual(res.status_code, 200)

    def test_class_teacher_cannot_update_other_class_student(self):
        res = self.client.put(f'/api/students/{self.kg_student.id}/', {'name': 'Hacked'})
        self.assertEqual(res.status_code, 403)

    def test_class_teacher_cannot_move_student_to_other_class(self):
        res = self.client.put(
            f'/api/students/{self.play_student.id}/',
            {'name': 'P1', 'class': str(self.kg.id)})
        self.assertEqual(res.status_code, 403)

    def test_class_teacher_can_delete_own_class_student(self):
        res = self.client.delete(f'/api/students/{self.play_student.id}/')
        self.assertEqual(res.status_code, 204)

    def test_class_teacher_cannot_delete_other_class_student(self):
        res = self.client.delete(f'/api/students/{self.kg_student.id}/')
        self.assertEqual(res.status_code, 403)

    def test_import_skips_other_class_rows(self):
        res = self.client.post('/api/students/import/', {'students': [
            {'name': 'New Play Kid', 'class': 'Play'},
            {'name': 'Sneaky KG Kid', 'class': 'KG'},
        ]}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['created'], 1)
        self.assertEqual(len(res.data['errors']), 1)


class ServiceWindowDefaultTests(TestCase):
    """Dateless activation must fall back to the academic-year window,
    otherwise the auto-created fee assignment can never match a fee month."""

    def test_dateless_activation_gets_year_window(self):
        from core.models import AcademicYear, ServiceType
        from students.services import toggle_student_service
        from finance.models import StudentFeeAssignment
        year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        klass = SchoolClass.objects.create(name='Nursery', order=1)
        svc = ServiceType.objects.create(name='Transport', default_amount=500)
        s = Student.objects.create(name='Rider', school_class=klass)
        r = toggle_student_service(s.id, svc.id, True)
        self.assertTrue(r['student_service']['active'])
        self.assertEqual(r['student_service']['starts_at'], '2026-01')
        self.assertEqual(r['student_service']['ends_at'], '2026-12')
        a = StudentFeeAssignment.objects.get(student=s)
        self.assertTrue(a.active)
        self.assertEqual(a.starts_at, '2026-01')
        self.assertEqual(a.ends_at, '2026-12')

    def test_explicit_window_kept(self):
        from core.models import AcademicYear, ServiceType
        from students.services import toggle_student_service
        AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        klass = SchoolClass.objects.create(name='Nursery', order=1)
        svc = ServiceType.objects.create(name='Hifz', default_amount=300)
        s = Student.objects.create(name='Keeper', school_class=klass)
        r = toggle_student_service(s.id, svc.id, True, starts_at='2026-03', ends_at='2026-06')
        self.assertEqual(r['student_service']['starts_at'], '2026-03')
        self.assertEqual(r['student_service']['ends_at'], '2026-06')
