from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, Subject
from students.models import Student
from teachers.models import Teacher
from parents.models import ParentStudentLink
from academic.models import RoutineTemplate, ExamRoutine, LeaveReason

User = get_user_model()


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


def _results(res):
    data = res.data
    if isinstance(data, dict) and 'results' in data:
        return data['results']
    return data


class AcademicHardeningTests(TestCase):
    """Regression tests for academic backend hardening.

    - Routine-template / exam-routine admin lists are scoped to a parent's
      linked children classes; academic admins still see the full list.
    - Parent leave-reason create/update for an unlinked student returns 404.
    - Malformed week / week_start dates return 400 instead of 500.
    - Teacher homework/diary querysets eager-load school_class/subject/teacher.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email='acadadmin@test.com', name='Admin', password='pass123',
            role='admin', email_verified=True,
        )
        self.parent = User.objects.create_user(
            email='acadparent@test.com', name='Parent', password='pass123',
            role='parent', email_verified=True,
        )
        self.teacher_user = User.objects.create_user(
            email='acadteacher@test.com', name='Teacher', password='pass123',
            role='teacher', email_verified=True,
        )
        self.teacher = Teacher.objects.create(
            user=self.teacher_user, designation='Assistant Teacher',
            name='Teacher',
        )
        self.class_a = SchoolClass.objects.create(name='Class 5')
        self.class_b = SchoolClass.objects.create(name='Class 9')
        self.subject_a = Subject.objects.create(
            name='Math', full_marks=100, school_class=self.class_a,
        )
        self.subject_b = Subject.objects.create(
            name='Science', full_marks=100, school_class=self.class_b,
        )
        self.student_a = Student.objects.create(
            student_id='AH-1', name='Linked Kid', school_class=self.class_a,
        )
        self.student_b = Student.objects.create(
            student_id='AH-2', name='Other Kid', school_class=self.class_b,
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.student_a)
        self.routine_a = RoutineTemplate.objects.create(
            school_class=self.class_a, day='monday', period_number=1,
            subject=self.subject_a, teacher=self.teacher,
        )
        self.routine_b = RoutineTemplate.objects.create(
            school_class=self.class_b, day='monday', period_number=1,
            subject=self.subject_b, teacher=self.teacher,
        )
        self.exam_a = ExamRoutine.objects.create(
            exam_name='Final', school_class=self.class_a,
            subject=self.subject_a, date='2026-10-01',
            start_time='09:00:00', end_time='12:00:00',
        )
        self.exam_b = ExamRoutine.objects.create(
            exam_name='Final', school_class=self.class_b,
            subject=self.subject_b, date='2026-10-01',
            start_time='09:00:00', end_time='12:00:00',
        )

    # ── (1) parent scoping on admin list endpoints ──

    def test_parent_routine_template_list_scoped_to_linked_class(self):
        auth(self.client, self.parent)
        res = self.client.get('/api/academic/routine-templates/')
        self.assertEqual(res.status_code, 200, res.content[:300])
        ids = {str(item['id']) for item in _results(res)}
        self.assertIn(str(self.routine_a.id), ids)
        self.assertNotIn(str(self.routine_b.id), ids)

    def test_parent_exam_routine_list_scoped_to_linked_class(self):
        auth(self.client, self.parent)
        res = self.client.get('/api/academic/exam-routines/')
        self.assertEqual(res.status_code, 200, res.content[:300])
        ids = {str(item['id']) for item in _results(res)}
        self.assertIn(str(self.exam_a.id), ids)
        self.assertNotIn(str(self.exam_b.id), ids)

    def test_parent_cannot_retrieve_unlinked_routine(self):
        auth(self.client, self.parent)
        res = self.client.get(f'/api/academic/routine-templates/{self.routine_b.id}/')
        self.assertEqual(res.status_code, 404, res.content[:300])

    def test_admin_sees_full_routine_and_exam_lists(self):
        auth(self.client, self.admin)
        res = self.client.get('/api/academic/routine-templates/')
        self.assertEqual(res.status_code, 200, res.content[:300])
        ids = {str(item['id']) for item in _results(res)}
        self.assertIn(str(self.routine_a.id), ids)
        self.assertIn(str(self.routine_b.id), ids)
        res = self.client.get('/api/academic/exam-routines/')
        self.assertEqual(res.status_code, 200, res.content[:300])
        ids = {str(item['id']) for item in _results(res)}
        self.assertIn(str(self.exam_a.id), ids)
        self.assertIn(str(self.exam_b.id), ids)

    # ── (2) parent leave-reason link validation ──

    def _leave_payload(self, student):
        return {
            'student': str(student.id),
            'reason': 'Sick',
            'start_date': '2026-08-01',
            'end_date': '2026-08-03',
        }

    def test_parent_leave_create_unlinked_student_404(self):
        auth(self.client, self.parent)
        res = self.client.post(
            '/api/parents/leave-reasons/', self._leave_payload(self.student_b),
            format='json',
        )
        self.assertEqual(res.status_code, 404, res.content[:300])
        self.assertFalse(
            LeaveReason.objects.filter(
                parent=self.parent, student=self.student_b,
            ).exists()
        )

    def test_parent_leave_create_linked_student_201(self):
        auth(self.client, self.parent)
        res = self.client.post(
            '/api/parents/leave-reasons/', self._leave_payload(self.student_a),
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content[:300])
        self.assertTrue(
            LeaveReason.objects.filter(
                parent=self.parent, student=self.student_a,
            ).exists()
        )

    def test_parent_leave_update_to_unlinked_student_404(self):
        leave = LeaveReason.objects.create(
            parent=self.parent, student=self.student_a, reason='Sick',
            start_date='2026-08-01', end_date='2026-08-03',
        )
        auth(self.client, self.parent)
        res = self.client.patch(
            f'/api/parents/leave-reasons/{leave.id}/',
            {'student': str(self.student_b.id)}, format='json',
        )
        self.assertEqual(res.status_code, 404, res.content[:300])
        leave.refresh_from_db()
        self.assertEqual(leave.student_id, self.student_a.id)

    # ── (3) malformed date params return 400 ──

    def test_teacher_routine_week_bad_date_400(self):
        auth(self.client, self.teacher_user)
        res = self.client.get('/api/teacher/routine/week/?week=not-a-date')
        self.assertEqual(res.status_code, 400, res.content[:300])

    def test_teacher_lesson_plan_bad_week_start_400(self):
        auth(self.client, self.teacher_user)
        res = self.client.post('/api/teacher/routine/lesson_plan/', {
            'routine_template': str(self.routine_a.id),
            'week_start': 'not-a-date',
            'topic': 'Fractions',
        }, format='json')
        self.assertEqual(res.status_code, 400, res.content[:300])

    # ── (4) teacher homework/diary querysets eager-load relations ──

    def test_teacher_homework_queryset_select_related(self):
        from academic.views import TeacherHomeworkViewSet
        from rest_framework.test import APIRequestFactory
        from rest_framework.request import Request
        wsgi = APIRequestFactory().get('/api/teacher/homework/')
        request = Request(wsgi)
        request.user = self.teacher_user
        view = TeacherHomeworkViewSet()
        view.request = request
        view.format_kwarg = None
        qs = view.get_queryset()
        self.assertIn('school_class', qs.query.select_related)
        self.assertIn('subject', qs.query.select_related)
        self.assertIn('teacher', qs.query.select_related)

    def test_teacher_diary_queryset_select_related(self):
        from academic.views import TeacherDiaryViewSet
        from rest_framework.test import APIRequestFactory
        from rest_framework.request import Request
        wsgi = APIRequestFactory().get('/api/teacher/diary/')
        request = Request(wsgi)
        request.user = self.teacher_user
        view = TeacherDiaryViewSet()
        view.request = request
        view.format_kwarg = None
        qs = view.get_queryset()
        self.assertIn('school_class', qs.query.select_related)
        self.assertIn('subject', qs.query.select_related)
        self.assertIn('teacher', qs.query.select_related)
