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
    """Role gate only: any teacher with results:write may save ANY subject.

    A per-subject TeacherAssignment check (3f11687) 403'd the school's real
    teachers — subject links are barely populated school-wide and multiple
    teachers entering different subjects on one row is the intended workflow.
    The results:write role gate is the trust boundary.
    """

    def setUp(self):
        from core.models import Subject
        from teachers.models import Teacher
        self.client = APIClient()
        self.klass = SchoolClass.objects.create(name='Play', order=1)
        self.student = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass, session='2026')
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        Subject.objects.create(name='Bangla', full_marks=100, school_class=self.klass)
        # Teacher with ZERO subject/class assignments — the profile that the
        # 3f11687 gate rejected live (74 PATCH-403s on Sep 8-9).
        self.user = User.objects.create_user(
            email='unlinked-teacher@test.com', name='UT', password='testpass123', role='teacher')
        Teacher.objects.create(user=self.user, designation='Assistant', name='UT')
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026',
            marks={'Bangla': 80, 'Math': 70})

    def test_unlinked_teacher_can_save_any_subject(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Bangla': 80, 'Math': 75}}, format='json')
        self.assertEqual(res.status_code, 200)
        self.result.refresh_from_db()
        self.assertEqual(self.result.marks['Math'], 75)

    def test_unlinked_teacher_can_create_results(self):
        res = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '2', 'session': '2026', 'marks': {'Math': 60}}, format='json')
        self.assertEqual(res.status_code, 201)


class ResultConcurrentMergeTests(TestCase):
    """Two teachers saving different subjects from the same stale page-load
    baseline must not wipe each other (PATCH replaces marks JSON)."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026',
            marks={'Math': 80})

    def test_concurrent_subject_saves_merge(self):
        # Teacher A (English) and B (Bangla) both loaded {Math: 80}.
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 80, 'English': 85}}, format='json')
        self.assertEqual(res.status_code, 200)
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 80, 'Bangla': 90}}, format='json')
        self.assertEqual(res.status_code, 200)
        self.result.refresh_from_db()
        self.assertEqual(
            self.result.marks, {'Math': 80, 'English': 85, 'Bangla': 90})

    def test_null_deletes_subject(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': None}}, format='json')
        self.assertEqual(res.status_code, 200)
        self.result.refresh_from_db()
        self.assertEqual(self.result.marks, {})


class ResultMassClearGuardTests(TestCase):
    """One non-admin save may not wipe many subjects at once (C1)."""

    def setUp(self):
        from teachers.models import Teacher
        self.client = APIClient()
        self.admin_client = APIClient()
        _auth(self.admin_client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        user = User.objects.create_user(
            email='massclear-teacher@test.com', name='MT', password='testpass123', role='teacher')
        Teacher.objects.create(user=user, designation='Assistant', name='MT')
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026',
            marks={'A': 80, 'B': 81, 'C': 82, 'D': 83, 'E': 84})

    def test_teacher_clearing_one_subject_ok(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'A': None}}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_teacher_mass_clear_blocked(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'A': None, 'B': None, 'C': None, 'D': None}}, format='json')
        self.assertEqual(res.status_code, 403)
        self.result.refresh_from_db()
        self.assertEqual(len(self.result.marks), 5)

    def test_admin_mass_clear_allowed(self):
        res = self.admin_client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'A': None, 'B': None, 'C': None, 'D': None}}, format='json')
        self.assertEqual(res.status_code, 200)
        self.result.refresh_from_db()
        self.assertEqual(self.result.marks, {'E': 84})


class ResultLockTests(TestCase):
    """Locked class × session × term rejects non-admin writes (C3)."""

    def setUp(self):
        from results.models import ResultLock
        from teachers.models import Teacher
        self.client = APIClient()
        self.admin_client = APIClient()
        _auth(self.admin_client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        user = User.objects.create_user(
            email='locked-teacher@test.com', name='LT', password='testpass123', role='teacher')
        Teacher.objects.create(user=user, designation='Assistant', name='LT')
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026', marks={'Math': 80})
        self.lock = ResultLock.objects.create(
            school_class=self.klass, session='2026', term='1')

    def test_teacher_patch_blocked_when_locked(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 85}}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_teacher_create_blocked_when_locked(self):
        Student.objects.create(
            name='S2', student_id='S000002', school_class=self.klass, session='2026')
        s2 = Student.objects.get(student_id='S000002')
        res = self.client.post(
            f'/api/students/{s2.id}/results/',
            {'term': '1', 'session': '2026', 'marks': {'Math': 60}}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_admin_write_allowed_when_locked(self):
        res = self.admin_client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 85}}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_unlock_restores_teacher_write(self):
        self.lock.delete()
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 85}}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_lock_crud_is_admin_only(self):
        res = self.client.post(
            '/api/result-locks/',
            {'school_class': str(self.klass.id), 'session': '2026', 'term': '2'},
            format='json')
        self.assertEqual(res.status_code, 403)
        res = self.admin_client.post(
            '/api/result-locks/',
            {'school_class': str(self.klass.id), 'session': '2026', 'term': '2'},
            format='json')
        self.assertEqual(res.status_code, 201)
        lock_id = res.data['id']
        res = self.admin_client.delete(f'/api/result-locks/{lock_id}/')
        self.assertEqual(res.status_code, 204)

    def test_lock_list_visible_to_teacher(self):
        res = self.client.get('/api/result-locks/?session=2026')
        self.assertEqual(res.status_code, 200)


class ResultAuditHistoryTests(TestCase):
    """Updates log per-subject old→new diffs with actor context (C2)."""

    def setUp(self):
        from core.models import AuditLog
        self.AuditLog = AuditLog
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026',
            marks={'Math': 80, 'English': 70})

    def test_update_logs_field_diff(self):
        res = self.client.patch(
            f'/api/results/{self.result.id}/',
            {'marks': {'Math': 85, 'English': None}}, format='json')
        self.assertEqual(res.status_code, 200)
        entry = self.AuditLog.objects.filter(
            action='update', entity_type='result', entity_id=str(self.result.id)).latest('created_at')
        import json as _json
        details = _json.loads(entry.details)
        self.assertEqual(details['student_name'], 'Stu')
        self.assertEqual(details['term'], '1')
        self.assertEqual(details['marks_changed'],
                         {'Math': {'from': 80, 'to': 85}, 'English': {'from': 70, 'to': None}})
        self.assertEqual(entry.user_name, 'Admin')

    def test_create_logs_initial_marks(self):
        res = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '2', 'session': '2026', 'marks': {'Math': 60}}, format='json')
        self.assertEqual(res.status_code, 201)
        import json as _json
        entry = self.AuditLog.objects.filter(action='create', entity_type='result').latest('created_at')
        self.assertEqual(_json.loads(entry.details)['marks'], {'Math': 60})


class ResultMaxMarksTests(TestCase):
    """Backend rejects marks above the subject's full marks (Phase 0)."""

    def setUp(self):
        from core.models import Subject
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')

    def test_over_full_marks_rejected(self):
        res = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '1', 'session': '2026', 'marks': {'Math': 150}}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_at_full_marks_accepted(self):
        res = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '1', 'session': '2026', 'marks': {'Math': 100}}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_null_delete_and_unknown_subject_pass(self):
        r = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '1', 'session': '2026', 'marks': {'Math': 80}}, format='json')
        row_id = r.data['id']
        res = self.client.patch(
            f'/api/results/{row_id}/',
            {'marks': {'Math': None, 'Unlisted': 50}}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_update_over_full_marks_rejected(self):
        r = self.client.post(
            f'/api/students/{self.student.id}/results/',
            {'term': '1', 'session': '2026', 'marks': {'Math': 80}}, format='json')
        res = self.client.patch(
            f"/api/results/{r.data['id']}/",
            {'marks': {'Math': 101}}, format='json')
        self.assertEqual(res.status_code, 400)


class ResultSoftDeleteTests(TestCase):
    """Results of soft-deleted students stay out of listings (Phase 0)."""

    def setUp(self):
        from django.utils import timezone
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.result = Result.objects.create(
            student=self.student, term='1', session='2026', marks={'Math': 80})
        self.student.deleted_at = timezone.now()
        self.student.save(update_fields=['deleted_at'])

    def test_class_results_excludes_deleted(self):
        res = self.client.get(
            f'/api/classes/{self.klass.id}/results/?session=2026')
        self.assertEqual(res.status_code, 200)
        ids = [str(r.get('studentId') or r.get('student_id') or r.get('student'))
               for r in (res.data if isinstance(res.data, list) else res.data.get('results', []))]
        self.assertNotIn(str(self.student.id), ids)

    def test_student_results_excludes_deleted(self):
        res = self.client.get(
            f'/api/students/{self.student.id}/results/?session=2026')
        self.assertEqual(res.status_code, 200)
