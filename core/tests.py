from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from django.core.cache import cache
from unittest.mock import patch
import os
from .models import SchoolClass, Subject, AcademicYear, Category
from students.models import Student

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class ClassTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_create_class(self):
        res = self.client.post('/api/classes/', {'name': 'Class 5'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(SchoolClass.objects.count(), 1)

    def test_list_classes(self):
        SchoolClass.objects.create(name='Class 5', order=1)
        SchoolClass.objects.create(name='Class 6', order=2)
        res = self.client.get('/api/classes/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_delete_class(self):
        c = SchoolClass.objects.create(name='Class 5', order=1)
        res = self.client.delete(f'/api/classes/{c.id}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(SchoolClass.objects.count(), 0)

    def test_reorder_classes(self):
        c1 = SchoolClass.objects.create(name='Class 5', order=2)
        c2 = SchoolClass.objects.create(name='Class 6', order=1)
        res = self.client.post('/api/classes/reorder/', {'order': [str(c1.id), str(c2.id)]})
        self.assertEqual(res.status_code, 200)

    def test_class_serializer_fields(self):
        c = SchoolClass.objects.create(name='Class 5', order=1)
        res = self.client.get(f'/api/classes/{c.id}/')
        self.assertIn('studentCount', res.data)
        self.assertIn('order', res.data)


class SubjectTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)

    def test_create_subject(self):
        res = self.client.post(f'/api/classes/{self.klass.id}/subjects/', {'name': 'Math', 'fullMarks': 100})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Subject.objects.count(), 1)

    def test_list_subjects(self):
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        Subject.objects.create(name='English', full_marks=100, school_class=self.klass)
        res = self.client.get(f'/api/classes/{self.klass.id}/subjects/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_update_subject(self):
        s = Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        res = self.client.put(f'/api/subjects/{s.id}/', {'name': 'Advanced Math', 'fullMarks': 150})
        self.assertEqual(res.status_code, 200)
        s.refresh_from_db()
        self.assertEqual(s.name, 'Advanced Math')

    def test_delete_subject(self):
        s = Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        res = self.client.delete(f'/api/subjects/{s.id}/')
        self.assertEqual(res.status_code, 204)

    def test_subject_serializer_fields(self):
        s = Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        res = self.client.get(f'/api/subjects/{s.id}/')
        self.assertIn('fullMarks', res.data)
        self.assertIn('classId', res.data)


class AcademicYearTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_create_academic_year(self):
        res = self.client.post('/api/academic-years/', {
            'name': '2027', 'isActive': True,
            'startDate': '2027-01-01', 'endDate': '2027-12-31'
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(AcademicYear.objects.count(), 1)
        self.assertTrue(res.data['isActive'])

    def test_list_academic_years(self):
        AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31')
        res = self.client.get('/api/academic-years/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)

    def test_serializer_camelcase(self):
        y = AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        res = self.client.get(f'/api/academic-years/{y.id}/')
        self.assertIn('isActive', res.data)
        self.assertIn('startDate', res.data)
        self.assertIn('endDate', res.data)
        self.assertIn('createdAt', res.data)

    def test_set_active_year(self):
        y1 = AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        y2 = AcademicYear.objects.create(name='2027', start_date='2027-01-01', end_date='2027-12-31')
        res = self.client.patch(f'/api/academic-years/{y2.id}/', {'isActive': True})
        self.assertEqual(res.status_code, 200)
        y1.refresh_from_db()
        y2.refresh_from_db()
        self.assertFalse(y1.is_active)
        self.assertTrue(y2.is_active)


class CategoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_create_category(self):
        res = self.client.post('/api/categories/', {'type': 'INCOME', 'name': 'Tuition Fee'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Category.objects.count(), 1)

    def test_list_categories(self):
        Category.objects.create(type='INCOME', name='Tuition')
        Category.objects.create(type='EXPENSE', name='Salary')
        res = self.client.get('/api/categories/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_filter_categories(self):
        Category.objects.create(type='INCOME', name='Tuition')
        Category.objects.create(type='EXPENSE', name='Salary')
        res = self.client.get('/api/categories/?type=INCOME')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)


class SettingsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_get_settings(self):
        from .models import SchoolSetting
        SchoolSetting.objects.create(key='school_name', value='Test School')
        SchoolSetting.objects.create(key='address', value='123 Main St')
        res = self.client.get('/api/settings/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['school_name'], 'Test School')
        self.assertEqual(res.data['address'], '123 Main St')

    def test_get_settings_default(self):
        res = self.client.get('/api/settings/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('school_name', res.data)

    def test_get_settings_by_key(self):
        from .models import SchoolSetting
        SchoolSetting.objects.create(key='school_name', value='Test School')
        res = self.client.get('/api/settings/?key=school_name')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['key'], 'school_name')
        self.assertEqual(res.data['value'], 'Test School')

    def test_update_settings(self):
        from .models import SchoolSetting
        SchoolSetting.objects.create(key='school_name', value='Old Name')
        res = self.client.put(
            '/api/settings/',
            {'school_name': 'New Name', 'address': '456 Oak Ave'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['school_name'], 'New Name')
        self.assertEqual(res.data['address'], '456 Oak Ave')
        self.assertEqual(SchoolSetting.objects.get(key='school_name').value, 'New Name')
        self.assertEqual(SchoolSetting.objects.get(key='address').value, '456 Oak Ave')


class PromoteAllTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.c1 = SchoolClass.objects.create(name='Test Class 1', order=8)
        self.c2 = SchoolClass.objects.create(name='Test Class 2', order=9)
        self.c3 = SchoolClass.objects.create(name='Test Class 3', order=10)
        self.s1 = Student.objects.create(name='Alice', student_id='r9998001', roll='01', school_class=self.c1, session='old')
        self.s2 = Student.objects.create(name='Bob', student_id='r9998101', roll='01', school_class=self.c2, session='old')
        self.s3 = Student.objects.create(name='Charlie', student_id='r9998201', roll='01', school_class=self.c3, session='old')

    def tearDown(self):
        Student.objects.filter(id__in=[self.s1.id, self.s2.id, self.s3.id]).delete()
        SchoolClass.objects.filter(order__in=[8, 9, 10, 11, 12]).delete()

    def test_dry_run_does_not_modify(self):
        self.client.post('/api/classes/promote-all/?dryRun=true', {'targetYearName': '2027'}, format='json')
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.school_class, self.c1)
        self.assertEqual(self.s1.student_id, 'r9998001')
        self.assertEqual(self.s1.roll, '01')

    def test_promote_moves_students(self):
        self.client.post('/api/classes/promote-all/', {'targetYearName': '2027'}, format='json')
        self.s1.refresh_from_db()
        self.s2.refresh_from_db()
        self.s3.refresh_from_db()
        self.assertEqual(self.s1.school_class, self.c2)
        self.assertEqual(self.s2.school_class, self.c3)
        # s3 at max_class_order=10 graduates
        self.assertIsNone(self.s3.school_class)
        self.assertIsNotNone(self.s3.graduated_at)

    def test_session_updated(self):
        self.client.post('/api/classes/promote-all/', {'targetYearName': '2027'}, format='json')
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.session, '2027')

    def test_roll_numbers_updated(self):
        self.client.post('/api/classes/promote-all/', {'targetYearName': '2027'}, format='json')
        self.s1.refresh_from_db()
        self.s2.refresh_from_db()
        # roll = {year}{classCode:02d}{roll}; classCode = next_class.order + 1
        # s1: c1(order=8)→c2(order=9) → 2027 + 10 + 01
        # s2: c2(order=9)→c3(order=10) → 2027 + 11 + 01
        self.assertEqual(self.s1.roll, '20271001')
        self.assertEqual(self.s2.roll, '20271101')
        # student_id is permanent and never rewritten by promotion
        self.assertEqual(self.s1.student_id, 'r9998001')

    def test_empty_body_rejected(self):
        res = self.client.post('/api/classes/promote-all/', {}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_hyphen_url_works(self):
        res = self.client.post('/api/classes/promote-all/?dryRun=true', {'targetYearName': '2027'}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_auto_create_class(self):
        # Leave a gap at order 8 so the move c7(order7)→order8 triggers auto-create.
        SchoolClass.objects.filter(order__gte=7).delete()
        c7 = SchoolClass.objects.create(name='Class Seven', order=7)
        SchoolClass.objects.create(name='Class Nine', order=9)
        s = Student.objects.create(name='AutoTest', student_id='r9998301', roll='01', school_class=c7, session='old')
        res = self.client.post('/api/classes/promote-all/?dryRun=true', {'targetYearName': '2027'}, format='json')
        self.assertEqual(res.status_code, 200)
        created = res.data.get('classesCreated', [])
        self.assertTrue(any('Class' in c for c in created))
        s.delete()

    def test_graduation_at_max_class(self):
        SchoolClass.objects.filter(order__gte=8).delete()
        c = SchoolClass.objects.create(name='Test Twelve', order=12)
        s = Student.objects.create(name='GradTest', student_id='r9998401', school_class=c, session='old')
        res = self.client.post('/api/classes/promote-all/', {'targetYearName': '2027'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['graduated']), 1)
        s.refresh_from_db()
        self.assertIsNone(s.school_class)
        self.assertIsNotNone(s.graduated_at)

    def test_new_roll_for_promotion(self):
        from core.services import _new_roll_for_promotion
        # classCode = order + 1; roll is the bare 2-digit roll number
        self.assertEqual(_new_roll_for_promotion('2027', 9, '01'), '20271001')
        self.assertEqual(_new_roll_for_promotion('2026', 0, '01'), '20260101')


class DashboardCacheTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)

    def test_dashboard_cache_invalidated_on_student_create(self):
        cache.set('dashboard_summary', {'stale': True}, 60)
        Student.objects.create(name='Test', student_id='S999001', school_class=self.klass, session='2026')
        self.assertIsNone(cache.get('dashboard_summary'))

    def test_dashboard_cache_invalidated_on_student_delete(self):
        s = Student.objects.create(name='Test', student_id='S999002', school_class=self.klass, session='2026')
        cache.set('dashboard_summary', {'stale': True}, 60)
        s.delete()
        self.assertIsNone(cache.get('dashboard_summary'))


class SchedulerTests(TestCase):
    """In-app scheduled-task management (proxies Alwaysdata `/v1/job/`)."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_superuser(email='sched@test.com', name='Sched Admin', password='testpass123')
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        os.environ['ALWAYSDATA_SCHED_TOKEN'] = 'test-token'

    def tearDown(self):
        os.environ.pop('ALWAYSDATA_SCHED_TOKEN', None)

    @staticmethod
    def _job(**over):
        from core.scheduler import Job
        base = dict(
            id=30737, type='TYPE_COMMAND', date_type='CRONTAB',
            crontab_syntax='0 11 * * 6',
            argument='~/schoolenv/bin/python ~/school-management/manage.py send_due_reminders',
            annotation='AL RAWA - weekly dues reminder', is_disabled=False,
            working_directory='', href='/v1/job/30737/',
        )
        base.update(over)
        return Job.from_dict(base)

    def test_admin_can_list_jobs(self):
        with patch('core.scheduler.list_jobs', return_value=[self._job()]):
            res = self.client.get('/api/scheduler/')
        self.assertEqual(res.status_code, 200)
        body = res.data
        self.assertTrue(body['configured'])
        self.assertEqual(len(body['jobs']), 1)
        self.assertEqual(body['jobs'][0]['id'], 30737)
        self.assertEqual(body['jobs'][0]['crontabSyntax'], '0 11 * * 6')

    def test_non_admin_forbidden(self):
        self.client.credentials()  # drop auth
        res = self.client.get('/api/scheduler/')
        self.assertEqual(res.status_code, 401)

    def test_create_job(self):
        with patch('core.scheduler.create_job', return_value=self._job(id=99999)) as mock:
            res = self.client.post('/api/scheduler/', {
                'crontabSyntax': '0 9 * * 1',
                'annotation': 'Weekly reminder',
                'argument': '~/schoolenv/bin/python ~/school-management/manage.py send_due_reminders',
                'sshUser': 516391,
                'workingDirectory': 'school-management',
            })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['id'], 99999)
        mock.assert_called_once()
        kwargs = mock.call_args.kwargs
        self.assertEqual(kwargs['crontab_syntax'], '0 9 * * 1')
        self.assertEqual(kwargs['ssh_user'], 516391)

    def test_update_toggle_disabled(self):
        with patch('core.scheduler.update_job', return_value=self._job(is_disabled=True)) as mock:
            res = self.client.put('/api/scheduler/30737/', {'isDisabled': True})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['isDisabled'])
        self.assertTrue(mock.call_args.kwargs['is_disabled'])

    def test_delete_job(self):
        with patch('core.scheduler.delete_job', return_value=None) as mock:
            res = self.client.delete('/api/scheduler/30737/')
        self.assertEqual(res.status_code, 204)
        mock.assert_called_once_with(30737)

    def test_run_now_extracts_command_from_argument(self):
        with patch('core.scheduler.get_job', return_value=self._job()), \
             patch('core.scheduler.run_command_now', return_value={'ok': True, 'output': '[DRY-RUN] Students: 97', 'exitCode': 0}) as run:
            res = self.client.post('/api/scheduler/30737/run/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['ok'])
        self.assertEqual(run.call_args.args[0], 'send_due_reminders')

    def test_dry_run_endpoint(self):
        with patch('core.scheduler.run_command_now', return_value={'ok': True, 'output': '[DRY-RUN] Students: 97', 'exitCode': 0}) as run:
            res = self.client.post('/api/scheduler/dry-run/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['ok'])
        self.assertEqual(run.call_args.args, ('send_due_reminders', '--dry-run'))

    def test_missing_token_returns_configured_false(self):
            os.environ.pop('ALWAYSDATA_SCHED_TOKEN', None)
            from core.scheduler import SchedulerConfigError
            with patch('core.scheduler.list_jobs', side_effect=SchedulerConfigError('ALWAYSDATA_SCHED_TOKEN')):
                res = self.client.get('/api/scheduler/')
            self.assertEqual(res.status_code, 200)
            self.assertFalse(res.data['configured'])
            self.assertIn('ALWAYSDATA_SCHED_TOKEN', res.data['error'])


class AgentFindingTests(TestCase):
    """Board: idempotent filing, self-healing resolve, admin triage (Phase 1)."""

    def setUp(self):
        from .models import AgentFinding
        self.AgentFinding = AgentFinding
        self.client = APIClient()
        _auth(self.client)

    def test_report_dedupes_open_findings(self):
        from .findings import report
        report('watchdog', 'warning', 'result', 'row-1', 'Blanks remain')
        report('watchdog', 'warning', 'result', 'row-1', 'Blanks remain (12 now)')
        qs = self.AgentFinding.objects.filter(agent='watchdog', status='open')
        self.assertEqual(qs.count(), 1)
        self.assertIn('12 now', qs.first().summary)

    def test_resolve_stale_heals_fixed(self):
        from .findings import report, resolve_stale
        report('watchdog', 'warning', 'result', 'row-1', 'Blanks remain')
        report('watchdog', 'warning', 'result', 'row-2', 'Blanks remain')
        n = resolve_stale('watchdog', [('result', 'row-2')])
        self.assertEqual(n, 1)
        self.assertEqual(
            self.AgentFinding.objects.get(agent='watchdog', entity_id='row-1').status,
            'resolved')

    def test_board_api_lists_and_transitions(self):
        from .findings import report
        f = report('integrity', 'critical', 'result', 'row-9', 'Out of range')
        res = self.client.get('/api/agent-findings/?status=open')
        self.assertEqual(res.status_code, 200)
        res = self.client.post(f'/api/agent-findings/{f.id}/ack/', {'resolution': 'looking'}, format='json')
        self.assertEqual(res.status_code, 200)
        res = self.client.post(f'/api/agent-findings/{f.id}/resolve/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        f.refresh_from_db()
        self.assertEqual(f.status, 'resolved')

    def test_board_rejects_forged_writes(self):
        for method, url, body in [
            ('post', '/api/agent-findings/', {'summary': 'fake'}),
            ('put', '/api/agent-findings/00000000-0000-0000-0000-000000000000/', {'summary': 'x'}),
            ('delete', '/api/agent-findings/00000000-0000-0000-0000-000000000000/', None),
        ]:
            res = getattr(self.client, method)(url, body, format='json')
            self.assertIn(res.status_code, (404, 405), method)
        self.assertEqual(self.AgentFinding.objects.count(), 0)


class WatchdogTests(TestCase):
    """watch_entry files gaps, heals silently, dry-runs clean (Phase 1)."""

    def setUp(self):
        import json
        from core.models import AcademicYear, SchoolSetting
        from students.models import Student
        from results.models import Result
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        self.s1 = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass, session='2026')
        self.s2 = Student.objects.create(
            name='S2', student_id='S000002', school_class=self.klass, session='2026')
        Result.objects.create(
            student=self.s1, term='1', session='2026', marks={'Math': 80})
        SchoolSetting.objects.create(
            key='published_terms', value=json.dumps({'2026': ['1']}))

    def _run(self, *args):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('watch_entry', *args, stdout=out)
        return out.getvalue()

    def test_files_published_gap(self):
        from .models import AgentFinding
        out = self._run()
        self.assertIn('filed=1', out)
        f = AgentFinding.objects.get(agent='watchdog', status='open')
        self.assertIn('Math 1/2', f.summary)

    def test_heals_when_completed(self):
        from .models import AgentFinding
        from results.models import Result
        self._run()
        Result.objects.create(
            student=self.s2, term='1', session='2026', marks={'Math': 70})
        out = self._run()
        self.assertIn('auto-resolved=1', out)
        self.assertEqual(
            AgentFinding.objects.filter(agent='watchdog', status='open').count(), 0)

    def test_dry_run_writes_nothing(self):
        from .models import AgentFinding
        out = self._run('--dry-run')
        self.assertIn('DRY-RUN', out)
        self.assertEqual(AgentFinding.objects.count(), 0)


class IntegrityTests(TestCase):
    """check_integrity reports bad data, repairs nothing (Phase 1)."""

    def setUp(self):
        from django.utils import timezone
        from core.models import AcademicYear
        from students.models import Student
        from results.models import Result
        AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        Subject.objects.create(name='Math', full_marks=100, school_class=self.klass)
        self.gone = Student.objects.create(
            name='Gone', student_id='S000009', school_class=self.klass,
            session='2026', deleted_at=timezone.now())
        Result.objects.create(
            student=self.gone, term='1', session='2026', marks={'Math': 60})
        self.s1 = Student.objects.create(
            name='S1', student_id='S000001', school_class=self.klass, session='2026')
        Result.objects.create(
            student=self.s1, term='1', session='2026', marks={'Math': 999})

    def _run(self, *args):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('check_integrity', *args, stdout=out)
        return out.getvalue()

    def test_files_over_range_and_orphan(self):
        from .models import AgentFinding
        out = self._run()
        self.assertIn('filed=2', out)
        kinds = set(AgentFinding.objects.filter(
            agent='integrity', status='open').values_list('details__kind', flat=True))
        self.assertEqual(kinds, {'over-range', 'orphan-rows'})

    def test_repairs_nothing(self):
        from results.models import Result
        self._run()
        # The 999 stands — agents report, humans fix (board revert).
        self.assertEqual(
            Result.objects.get(student=self.s1).marks, {'Math': 999})


class DigestTests(TestCase):
    """send_agent_digest notifies admins once, stays quiet when clear."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_quiet_when_nothing_open(self):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('send_agent_digest', stdout=out)
        self.assertIn('nothing open', out.getvalue())

    def test_dry_run_lists_without_sending(self):
        from io import StringIO
        from django.core.management import call_command
        from .findings import report
        from parents.models import NotificationLog
        report('watchdog', 'warning', 'result', 'c1:1', 'Class 5 Term 1 gaps')
        out = StringIO()
        call_command('send_agent_digest', '--dry-run', stdout=out)
        self.assertIn('would notify 1 admin', out.getvalue())
        self.assertEqual(NotificationLog.objects.count(), 0)

    def test_send_logs_notification(self):
        from io import StringIO
        from django.core.management import call_command
        from .findings import report
        from parents.models import NotificationLog
        report('integrity', 'critical', 'result', 'c1:x', 'Bad data')
        out = StringIO()
        call_command('send_agent_digest', stdout=out)
        self.assertIn('admins_notified=1', out.getvalue())
        self.assertEqual(
            NotificationLog.objects.filter(event_type='agent_digest').count(), 1)


class AuditLogOrderingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)

    def test_default_ordering_newest_first(self):
        from .models import AuditLog
        AuditLog.objects.create(action='older_action', entity_type='t')
        AuditLog.objects.create(action='newer_action', entity_type='t')
        res = self.client.get('/api/audit/')
        self.assertEqual(res.status_code, 200)
        actions = [r['action'] for r in res.data['results']]
        self.assertEqual(actions[0], 'newer_action')
