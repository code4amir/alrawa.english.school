from unittest.mock import patch
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .registry import REGISTRY
from .permission_filter import filter_functions_for_user
from .validator import validate_and_score
from .resolver import memory, ConversationMemory
from .models import AIQueryLog

User = get_user_model()


def _auth(client, user=None):
    if user is None:
        user = User.objects.create_superuser(
            email='admin@test.com', name='Admin', password='pass'
        )
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


# ─── Registry ────────────────────────────────────────────

class RegistryTests(TestCase):
    def test_all_15_functions_registered(self):
        # Registry has grown beyond the original 15; assert it is non-trivial
        # and at least the originally-documented minimum.
        self.assertGreaterEqual(len(REGISTRY), 15)

    def test_each_function_has_required_keys(self):
        for name, entry in REGISTRY.items():
            with self.subTest(name=name):
                self.assertIn('name', entry)
                self.assertIn('description', entry)
                self.assertIn('permissions', entry)
                self.assertIn('parameters', entry)
                self.assertIn('result_columns', entry)
                self.assertIn('handler', entry)
                self.assertEqual(entry['name'], name)
                self.assertTrue(callable(entry['handler']))

    def test_function_names_are_unique(self):
        names = [e['name'] for e in REGISTRY.values()]
        self.assertEqual(len(names), len(set(names)))


# ─── Permission Filter ───────────────────────────────────

class PermissionFilterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email='admin@test.com', name='Admin', password='pass'
        )
        self.teacher = User.objects.create_user(
            email='teacher@test.com', name='Teacher', password='pass', role='teacher'
        )
        self.accountant = User.objects.create_user(
            email='acc@test.com', name='Acc', password='pass', role='accountant'
        )
        self.viewer = User.objects.create_user(
            email='view@test.com', name='View', password='pass', role='viewer'
        )
        self.super_viewer = User.objects.create_user(
            email='sv@test.com', name='SV', password='pass', role='super_viewer'
        )

    def test_admin_sees_all(self):
        allowed = filter_functions_for_user(self.admin, REGISTRY)
        # Admin sees every registered function.
        self.assertEqual(len(allowed), len(REGISTRY))

    def test_teacher_sees_no_finance(self):
        allowed = filter_functions_for_user(self.teacher, REGISTRY)
        names = [e['name'] for e in allowed]
        self.assertIn('search_student', names)
        self.assertNotIn('fee_status', names)
        self.assertNotIn('defaulter_report', names)
        self.assertNotIn('ledger_query', names)
        self.assertNotIn('balances', names)

    def test_accountant_sees_no_results(self):
        allowed = filter_functions_for_user(self.accountant, REGISTRY)
        names = [e['name'] for e in allowed]
        self.assertNotIn('result_summary', names)
        self.assertNotIn('result_detail', names)
        self.assertIn('fee_status', names)

    def test_viewer_sees_nothing(self):
        allowed = filter_functions_for_user(self.viewer, REGISTRY)
        self.assertEqual(len(allowed), 0)

    def test_super_viewer_sees_all_finance_no_results_write(self):
        allowed = filter_functions_for_user(self.super_viewer, REGISTRY)
        names = [e['name'] for e in allowed]
        self.assertIn('fee_status', names)
        self.assertIn('result_summary', names)
        self.assertGreater(len(allowed), 10)

    def test_filter_requires_all_permissions(self):
        entry = {'permissions': ['students:read', 'finance:read']}
        fake_registry = {'multi': {'name': 'multi', 'permissions': ['students:read', 'finance:read'], 'handler': lambda: None}}
        admin_allowed = filter_functions_for_user(self.admin, fake_registry)
        teacher_allowed = filter_functions_for_user(self.teacher, fake_registry)
        self.assertEqual(len(admin_allowed), 1)
        self.assertEqual(len(teacher_allowed), 0)


# ─── Validator ───────────────────────────────────────────

class ValidatorTests(TestCase):
    def test_all_required_args_filled(self):
        entry = {
            'parameters': {
                'type': 'object',
                'properties': {'name': {'type': 'string'}, 'age': {'type': 'integer'}},
                'required': ['name', 'age'],
            }
        }
        validated, score = validate_and_score(entry, {'name': 'John', 'age': '10'})
        self.assertEqual(score, 1.0)
        self.assertEqual(validated['name'], 'John')
        self.assertEqual(validated['age'], 10)

    def test_partial_required_args(self):
        entry = {
            'parameters': {
                'type': 'object',
                'properties': {'a': {'type': 'string'}, 'b': {'type': 'string'}},
                'required': ['a', 'b'],
            }
        }
        validated, score = validate_and_score(entry, {'a': 'x'})
        self.assertLess(score, 1.0)
        self.assertGreater(score, 0.0)
        self.assertAlmostEqual(score, 0.5)

    def test_no_required_args_returns_full_score(self):
        entry = {'parameters': {'type': 'object', 'properties': {}, 'required': []}}
        validated, score = validate_and_score(entry, {})
        self.assertEqual(score, 1.0)

    def test_empty_args_no_required(self):
        entry = {'parameters': {'type': 'object', 'properties': {'opt': {'type': 'string'}}, 'required': []}}
        validated, score = validate_and_score(entry, {})
        self.assertEqual(score, 1.0)
        self.assertIsNone(validated['opt'])

    def test_string_conversion(self):
        entry = {'parameters': {'type': 'object', 'properties': {'val': {'type': 'string'}}, 'required': []}}
        validated, score = validate_and_score(entry, {'val': 123})
        self.assertEqual(validated['val'], '123')


# ─── Resolver / Conversation Memory ──────────────────────

class ResolverTests(TestCase):
    def test_memory_set_and_get(self):
        mem = ConversationMemory()
        mem.set('user:1', {'last_function': 'search_student', 'last_args': {'query': 'John'}})
        data = mem.get('user:1')
        self.assertEqual(data['last_function'], 'search_student')
        self.assertEqual(data['last_args']['query'], 'John')

    def test_memory_clear(self):
        mem = ConversationMemory()
        mem.set('user:1', {'x': 'y'})
        mem.clear('user:1')
        self.assertEqual(mem.get('user:1'), {})

    def test_memory_unknown_user(self):
        mem = ConversationMemory()
        self.assertEqual(mem.get('nonexistent'), {})

    def test_memory_ttl_expiry(self):
        mem = ConversationMemory()
        mem._ttl = -1
        mem.set('user:1', {'x': 'y'})
        self.assertEqual(mem.get('user:1'), {})


# ─── API End-to-End (mocked Gemini) ──────────────────────

class AIQueryAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _auth(self.client)
        from core.models import SchoolClass, Subject
        from students.models import Student
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        Student.objects.create(
            name='John Doe', student_id='STU001', school_class=self.klass, roll='1'
        )
        Student.objects.create(
            name='Jane Doe', student_id='STU002', school_class=self.klass, roll='2'
        )

    def _mock_ai(self, fn_name, args):
        return patch(
            'ai_query.views.call_ai_function',
            return_value={'type': 'function_call', 'name': fn_name, 'args': args},
        )

    def test_successful_student_search(self):
        with self._mock_ai('search_student', {'query': 'John'}):
            res = self.client.post('/api/ai/query/', {'query': 'find John'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['type'], 'table')
        self.assertGreater(len(data['data']), 0)
        self.assertIn('confidence', data)
        self.assertIn('explanation', data)

    def test_class_list(self):
        with self._mock_ai('class_list', {'class_name': 'Class 5'}):
            res = self.client.post('/api/ai/query/', {'query': 'list class 5'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['type'], 'table')
        self.assertEqual(len(data['data']), 2)

    def test_gemini_unavailable_returns_503(self):
        with patch('ai_query.views.call_ai_function', return_value=None):
            res = self.client.post('/api/ai/query/', {'query': 'anything'})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()['type'], 'error')

    def test_gemini_returns_text_clarification(self):
        with patch(
            'ai_query.views.call_ai_function',
            return_value={'type': 'text', 'text': 'Please clarify your question'},
        ):
            res = self.client.post('/api/ai/query/', {'query': 'huh'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['type'], 'clarification')

    def test_low_confidence_returns_clarification(self):
        entry = REGISTRY['search_student']
        entry_stub = {'parameters': entry['parameters']}
        from ai_query.views import CONFIDENCE_THRESHOLD
        low_args = {}
        with patch('ai_query.views.CONFIDENCE_THRESHOLD', 0.99):
            with self._mock_ai('search_student', low_args):
                res = self.client.post('/api/ai/query/', {'query': 'vague'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['type'], 'clarification')

    def test_unknown_function_returns_error(self):
        with self._mock_ai('nonexistent_fn', {}):
            res = self.client.post('/api/ai/query/', {'query': 'do something'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['type'], 'error')
        self.assertIn('Unknown', res.json()['explanation'])

    def test_viewer_gets_403(self):
        viewer = User.objects.create_user(
            email='view@test.com', name='View', password='pass', role='viewer'
        )
        _auth(self.client, viewer)
        res = self.client.post('/api/ai/query/', {'query': 'anything'})
        self.assertEqual(res.status_code, 403)

    def test_unauthenticated_gets_401(self):
        self.client.credentials()
        res = self.client.post('/api/ai/query/', {'query': 'anything'})
        self.assertEqual(res.status_code, 401)

    def test_empty_query_rejected(self):
        res = self.client.post('/api/ai/query/', {'query': ''})
        self.assertEqual(res.status_code, 400)

    def test_handler_error_returns_error_response(self):
        orig = REGISTRY['search_student']['handler']
        REGISTRY['search_student']['handler'] = lambda user, **kw: (_ for _ in ()).throw(ValueError('DB error'))
        try:
            with self._mock_ai('search_student', {'query': 'John'}):
                res = self.client.post('/api/ai/query/', {'query': 'find John'})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()['type'], 'error')
            # Internal details must NOT leak to clients (generic message only).
            self.assertNotIn('DB error', res.json()['explanation'])
            self.assertTrue(res.json()['explanation'])
        finally:
            REGISTRY['search_student']['handler'] = orig

    def test_dashboard_summary(self):
        with self._mock_ai('dashboard_summary', {}):
            res = self.client.post('/api/ai/query/', {'query': 'dashboard'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['type'], 'table')
        self.assertGreater(len(data['data']), 0)

    def test_audit_log_created_on_success(self):
        self.assertEqual(AIQueryLog.objects.count(), 0)
        with self._mock_ai('search_student', {'query': 'John'}):
            self.client.post('/api/ai/query/', {'query': 'find John'})
        self.assertGreater(AIQueryLog.objects.count(), 0)
        log = AIQueryLog.objects.first()
        self.assertEqual(log.function_called, 'search_student')
        self.assertTrue(log.success)

    def test_audit_log_created_on_failure(self):
        orig = REGISTRY['search_student']['handler']
        REGISTRY['search_student']['handler'] = lambda user, **kw: (_ for _ in ()).throw(ValueError('fail'))
        try:
            with self._mock_ai('search_student', {'query': 'John'}):
                self.client.post('/api/ai/query/', {'query': 'find John'})
            logs = AIQueryLog.objects.order_by('-created_at')
            self.assertFalse(logs[0].success)
            self.assertIn('fail', logs[0].error_message)
        finally:
            REGISTRY['search_student']['handler'] = orig

    def test_teacher_scope_restricted(self):
        teacher = User.objects.create_user(
            email='t@test.com', name='Teacher', password='pass', role='teacher'
        )
        _auth(self.client, teacher)
        with self._mock_ai('search_student', {'query': 'John'}):
            res = self.client.post('/api/ai/query/', {'query': 'John'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['type'], 'table')
        self.assertEqual(len(data['data']), 0)

    def test_response_has_meta_timing(self):
        with self._mock_ai('search_student', {'query': 'John'}):
            res = self.client.post('/api/ai/query/', {'query': 'find John'})
        data = res.json()
        self.assertIn('execution_time_ms', data['meta'])
        self.assertIn('result_count', data['meta'])


# ─── Handler Unit Tests ──────────────────────────────────

from ai_query.handlers.students import search_student_handler, student_profile_handler, class_list_handler
from ai_query.handlers.teachers import teacher_search_handler, teacher_subjects_handler, class_teachers_handler
from ai_query.handlers.attendance import attendance_summary_handler, attendance_detail_handler
from ai_query.handlers.finance import fee_status_handler, defaulter_report_handler, ledger_query_handler, balances_handler
from ai_query.handlers.results import result_summary_handler, result_detail_handler
from ai_query.handlers.dashboard import dashboard_summary_handler


class HandlerUnitTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email='admin@test.com', name='Admin', password='pass'
        )
        from core.models import SchoolClass, Subject, AcademicYear
        from students.models import Student
        from teachers.models import Teacher, ClassTeacher, TeacherSubject
        from attendance.models import AttendanceRecord
        from finance.models import BankAccount, AccountBalance

        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.subj = Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        self.year = AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.stu = Student.objects.create(name='John Doe', student_id='STU001', school_class=self.klass, roll='1')
        self.stu2 = Student.objects.create(name='Jane Doe', student_id='STU002', school_class=self.klass, roll='2')
        self.teacher = Teacher.objects.create(name='Ms. Smith', designation='Teacher')
        Teacher.objects.create(name='Mr. Jones', designation='Teacher')
        ClassTeacher.objects.create(teacher=self.teacher, school_class=self.klass)
        TeacherSubject.objects.create(teacher=self.teacher, subject=self.subj, school_class=self.klass)
        acct = BankAccount.objects.create(name='Cash', display_name='Cash Account', is_active=True)
        AccountBalance.objects.create(account=acct, fiscal_year='2026', month='01', opening_balance=0, total_debits=0, total_credits=0, closing_balance=1000)
        AttendanceRecord.objects.create(student=self.stu, school_class=self.klass, date='2026-06-01', status='present', term='Annual', session='2026')

    def test_search_student(self):
        r = search_student_handler(self.admin, query='John')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_search_student_no_results(self):
        r = search_student_handler(self.admin, query='Nonexistent')
        self.assertEqual(len(r['data']), 0)

    def test_student_profile(self):
        r = student_profile_handler(self.admin, student_id='STU001')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_student_profile_not_found(self):
        r = student_profile_handler(self.admin, student_id='XXX')
        self.assertEqual(r['type'], 'summary')

    def test_class_list(self):
        r = class_list_handler(self.admin, class_name='Class 5')
        self.assertEqual(r['type'], 'table')
        self.assertEqual(len(r['data']), 2)

    def test_class_list_not_found(self):
        r = class_list_handler(self.admin, class_name='Class 99')
        self.assertEqual(len(r['data']), 0)

    def test_teacher_search(self):
        r = teacher_search_handler(self.admin, query='Ms.')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_teacher_subjects(self):
        r = teacher_subjects_handler(self.admin, teacher_name='Ms. Smith')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_class_teachers(self):
        r = class_teachers_handler(self.admin, class_name='Class 5')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_attendance_summary(self):
        r = attendance_summary_handler(self.admin, class_name='Class 5', date_from='2026-06-01', date_to='2026-06-01')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_attendance_detail(self):
        r = attendance_detail_handler(self.admin, student_id='STU001')
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_dashboard_summary(self):
        r = dashboard_summary_handler(self.admin)
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)

    def test_teacher_scope_restricts_class_list(self):
        teacher = User.objects.create_user(
            email='t2@test.com', name='T2', password='pass', role='teacher'
        )
        r = class_list_handler(teacher, class_name='Class 5')
        self.assertEqual(r['type'], 'summary')
        self.assertIn("don't have access", r['explanation'])

    def test_result_handlers_return_empty_when_no_data(self):
        r = result_summary_handler(self.admin, class_name='Class 5', term='Mid Term')
        self.assertEqual(r['type'], 'table')
        self.assertEqual(len(r['data']), 0)

        r = result_detail_handler(self.admin, student_id='STU001', term='Mid Term')
        self.assertEqual(r['type'], 'summary')
        self.assertIn('No result', r['explanation'])

    def test_balances_handler(self):
        r = balances_handler(self.admin)
        self.assertEqual(r['type'], 'table')
        self.assertGreater(len(r['data']), 0)
