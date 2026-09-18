"""Regression tests for the academic audit-fix batch.

- Malformed class_id on routine publish returns 404 (not 500).
- Homework/diary updates and deletes are owner-only for teachers
  (admin/monitor exempt); ownership is never silently reassigned.
- Leave by_class groups classless students under 'Unassigned'.
"""
from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, Subject
from students.models import Student
from teachers.models import Teacher
from academic.models import Diary, Homework, LeaveReason

User = get_user_model()


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class AcademicAuditFixTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email='afadmin@test.com', name='Admin', password='pass123',
            role='admin', email_verified=True,
        )
        self.teacher_a_user = User.objects.create_user(
            email='afteachera@test.com', name='TeacherA', password='pass123',
            role='teacher', email_verified=True,
        )
        self.teacher_b_user = User.objects.create_user(
            email='afteacherb@test.com', name='TeacherB', password='pass123',
            role='teacher', email_verified=True,
        )
        self.teacher_a = Teacher.objects.create(
            user=self.teacher_a_user, designation='Assistant Teacher',
            name='TeacherA',
        )
        self.teacher_b = Teacher.objects.create(
            user=self.teacher_b_user, designation='Assistant Teacher',
            name='TeacherB',
        )
        self.klass = SchoolClass.objects.create(name='Class 5')
        self.subject = Subject.objects.create(
            name='Math', full_marks=100, school_class=self.klass,
        )

    def _hw_payload(self, **overrides):
        data = {
            'school_class': str(self.klass.id),
            'subject': str(self.subject.id),
            'date': '2026-09-01',
            'topic': 'Fractions',
            'description': 'Ex 1-5',
            'due_date': '2026-09-03',
        }
        data.update(overrides)
        return data

    def _diary_payload(self, **overrides):
        data = {
            'school_class': str(self.klass.id),
            'subject': str(self.subject.id),
            'date': '2026-09-01',
            'topic': 'Intro',
            'activities': 'Lecture',
        }
        data.update(overrides)
        return data

    # ── publish UUID hardening ──

    def test_publish_malformed_class_id_404(self):
        auth(self.client, self.admin)
        res = self.client.post(
            '/api/academic/routine-templates/publish/',
            {'class_id': 'garbage'}, format='json',
        )
        self.assertEqual(res.status_code, 404, res.content[:300])

    # ── homework ownership ──

    def test_teacher_cannot_patch_other_teachers_homework(self):
        hw = Homework.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Fractions',
            due_date='2026-09-03',
        )
        auth(self.client, self.teacher_b_user)
        res = self.client.patch(
            f'/api/teacher/homework/{hw.id}/', {'topic': 'Hijacked'},
            format='json',
        )
        self.assertIn(res.status_code, (403, 404), res.content[:300])
        hw.refresh_from_db()
        self.assertEqual(hw.topic, 'Fractions')

    def test_teacher_cannot_delete_other_teachers_homework(self):
        hw = Homework.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Fractions',
            due_date='2026-09-03',
        )
        auth(self.client, self.teacher_b_user)
        res = self.client.delete(f'/api/teacher/homework/{hw.id}/')
        self.assertIn(res.status_code, (403, 404), res.content[:300])
        self.assertTrue(Homework.objects.filter(id=hw.id).exists())

    def test_teacher_patch_cannot_reassign_owner(self):
        hw = Homework.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Fractions',
            due_date='2026-09-03',
        )
        auth(self.client, self.teacher_a_user)
        res = self.client.patch(
            f'/api/teacher/homework/{hw.id}/',
            {'topic': 'Decimals', 'teacher': str(self.teacher_b.id)},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content[:300])
        hw.refresh_from_db()
        self.assertEqual(hw.topic, 'Decimals')
        self.assertEqual(hw.teacher_id, self.teacher_a.id)

    def test_admin_can_edit_other_teachers_homework(self):
        hw = Homework.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Fractions',
            due_date='2026-09-03',
        )
        auth(self.client, self.admin)
        res = self.client.patch(
            f'/api/teacher/homework/{hw.id}/', {'topic': 'Admin edit'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content[:300])
        hw.refresh_from_db()
        self.assertEqual(hw.topic, 'Admin edit')

    # ── diary ownership ──

    def test_teacher_cannot_patch_other_teachers_diary(self):
        entry = Diary.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Intro',
        )
        auth(self.client, self.teacher_b_user)
        res = self.client.patch(
            f'/api/teacher/diary/{entry.id}/', {'topic': 'Hijacked'},
            format='json',
        )
        self.assertIn(res.status_code, (403, 404), res.content[:300])
        entry.refresh_from_db()
        self.assertEqual(entry.topic, 'Intro')

    def test_teacher_cannot_delete_other_teachers_diary(self):
        entry = Diary.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Intro',
        )
        auth(self.client, self.teacher_b_user)
        res = self.client.delete(f'/api/teacher/diary/{entry.id}/')
        self.assertIn(res.status_code, (403, 404), res.content[:300])
        self.assertTrue(Diary.objects.filter(id=entry.id).exists())

    def test_teacher_patch_cannot_reassign_diary_owner(self):
        entry = Diary.objects.create(
            school_class=self.klass, subject=self.subject,
            teacher=self.teacher_a, date='2026-09-01', topic='Intro',
        )
        auth(self.client, self.teacher_a_user)
        res = self.client.patch(
            f'/api/teacher/diary/{entry.id}/',
            {'topic': 'Updated', 'teacher': str(self.teacher_b.id)},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content[:300])
        entry.refresh_from_db()
        self.assertEqual(entry.topic, 'Updated')
        self.assertEqual(entry.teacher_id, self.teacher_a.id)

    # ── by_class classless guard ──

    def test_by_class_groups_classless_student(self):
        parent = User.objects.create_user(
            email='afparent@test.com', name='Parent', password='pass123',
            role='parent', email_verified=True,
        )
        classless = Student.objects.create(
            student_id='AF-9', name='No Class Kid', school_class=None,
        )
        LeaveReason.objects.create(
            parent=parent, student=classless, reason='Sick',
            start_date='2026-09-01', end_date='2026-09-02',
        )
        auth(self.client, self.admin)
        res = self.client.get('/api/teacher/leave-reasons/by_class/')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertIn('Unassigned', res.data)


class ParentPreviewParamsTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient
        from parents.models import ParentStudentLink
        from academic.models import RoutineTemplate
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='par@t.com', name='P', password='x', role='parent')
        self.client.force_authenticate(self.user)
        self.klass = SchoolClass.objects.create(name='Play', order=1)
        self.student = Student.objects.create(
            name='Kid', student_id='S1', school_class=self.klass)
        ParentStudentLink.objects.create(parent=self.user, student=self.student)
        self.subject = Subject.objects.create(
            name='Math', full_marks=100, order=1, school_class=self.klass)
        self.teacher = Teacher.objects.create(name='T', designation='D')

    def test_homework_limit(self):
        for i in range(5):
            Homework.objects.create(
                school_class=self.klass, subject=self.subject,
                teacher=self.teacher, topic=f'H{i}', description='d',
                date='2026-09-01', due_date='2026-09-05', published=True)
        res = self.client.get('/api/parents/homework/', {'limit': '3'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 3)
        res = self.client.get('/api/parents/homework/')
        self.assertEqual(len(res.data), 5)

    def test_routine_day_filter(self):
        from academic.models import RoutineTemplate
        RoutineTemplate.objects.create(
            school_class=self.klass, day='monday', period_number=1,
            subject=self.subject, teacher=self.teacher)
        RoutineTemplate.objects.create(
            school_class=self.klass, day='tuesday', period_number=1,
            subject=self.subject, teacher=self.teacher)
        res = self.client.get('/api/parents/routine/', {'day': 'monday'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        res = self.client.get('/api/parents/routine/', {'day': 'funday'})
        self.assertEqual(len(res.data), 2)
