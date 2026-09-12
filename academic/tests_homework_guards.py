from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, Subject
from teachers.models import Teacher
from academic.models import Homework

User = get_user_model()


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class TeacherHomeworkGuardTests(TestCase):
    """Regression tests for the teacher-write permission on homework.

    Parent users must get 403 on POST, and a teacher must not be able to
    forge ownership by submitting another teacher's id — writes are always
    forced to the logged-in teacher's own profile.
    """

    def setUp(self):
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='Class 5')
        self.subject = Subject.objects.create(
            name='Math', full_marks=100, school_class=self.klass,
        )
        self.parent = User.objects.create_user(
            email='hwparent@test.com', name='Parent', password='pass123',
            role='parent', email_verified=True,
        )
        self.teacher_user = User.objects.create_user(
            email='hwteacher@test.com', name='Teacher', password='pass123',
            role='teacher', email_verified=True,
        )
        self.teacher = Teacher.objects.create(
            user=self.teacher_user, designation='Assistant Teacher',
            name='Teacher',
        )
        self.other_teacher = Teacher.objects.create(
            designation='Senior Teacher', name='Other',
        )

    def _payload(self, **overrides):
        data = {
            'school_class': str(self.klass.id),
            'subject': str(self.subject.id),
            'date': '2026-09-01',
            'topic': 'Fractions',
            'description': 'Exercises 1-5',
            'due_date': '2026-09-03',
        }
        data.update(overrides)
        return data

    def test_parent_post_homework_403(self):
        auth(self.client, self.parent)
        res = self.client.post(
            '/api/teacher/homework/', self._payload(), format='json',
        )
        self.assertEqual(res.status_code, 403, res.content[:300])
        self.assertFalse(Homework.objects.exists())

    def test_teacher_forged_teacher_forced_to_self(self):
        auth(self.client, self.teacher_user)
        res = self.client.post(
            '/api/teacher/homework/',
            self._payload(teacher=str(self.other_teacher.id)),
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content[:300])
        obj = Homework.objects.get()
        self.assertEqual(obj.teacher_id, self.teacher.id)
        self.assertEqual(str(res.data['teacher']), str(self.teacher.id))
