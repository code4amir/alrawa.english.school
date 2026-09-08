from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass
from .models import Result

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class ResultTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(name='Stu', student_id='S000001', school_class=self.klass, session='2026')

    def test_save_result(self):
        res = self.client.post(f'/api/students/{self.student.id}/results/', {
            'term': 'First Term', 'session': '2026',
            'marks': {'Math': 85, 'English': 90}
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Result.objects.count(), 1)

    def test_get_results(self):
        Result.objects.create(
            student=self.student, term='First Term', session='2026',
            marks={'Math': 85, 'English': 90}
        )
        res = self.client.get(f'/api/students/{self.student.id}/results/?session=2026')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)

    def test_get_results_no_session(self):
        res = self.client.get(f'/api/students/{self.student.id}/results/')
        # Session is not required by the view, returns all results for the student
        self.assertEqual(res.status_code, 200)

    def test_class_results(self):
        Result.objects.create(
            student=self.student, term='First Term', session='2026',
            marks={'Math': 85, 'English': 90}
        )
        res = self.client.get(f'/api/classes/{self.klass.id}/results/?session=2026&term=First Term')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_result_with_attendance(self):
        res = self.client.post(f'/api/students/{self.student.id}/results/', {
            'term': 'First Term', 'session': '2026',
            'marks': {'Math': 85},
            'attendance': {'days': 100, 'present': 95}
        }, format='json')
        self.assertEqual(res.status_code, 201)
        r = Result.objects.first()
        self.assertEqual(r.attendance['present'], 95)

    def test_result_with_comment(self):
        res = self.client.post(f'/api/students/{self.student.id}/results/', {
            'term': 'First Term', 'session': '2026',
            'marks': {'Math': 85}, 'comment': 'Good progress'
        }, format='json')
        self.assertEqual(res.status_code, 201)
        r = Result.objects.first()
        self.assertEqual(r.comment, 'Good progress')


class ResultSubjectPermissionTests(TestCase):
    """Non-admin saves check only CHANGED subjects (payload carries merged marks)."""

    def setUp(self):
        from core.models import Subject
        from teachers.models import Teacher, TeacherSubject
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='Play', order=1)
        self.student = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass, session='2026')
        self.math = Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        Subject.objects.create(name='Bangla', full_marks=100, school_class=self.klass)
        self.user = User.objects.create_user(
            email='subject-teacher@test.com', name='ST', password='testpass123', role='teacher')
        teacher = Teacher.objects.create(user=self.user, designation='Assistant', name='ST')
        TeacherSubject.objects.create(teacher=teacher, subject=self.math, school_class=self.klass)
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026',
            marks={'Bangla': 80, 'Math': 70})

    def test_teacher_can_update_assigned_subject(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Bangla': 80, 'Math': 75}}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_teacher_cannot_change_unassigned_subject(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Bangla': 85, 'Math': 70}}, format='json')
        self.assertEqual(res.status_code, 403)
