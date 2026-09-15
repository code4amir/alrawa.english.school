"""Speed bundle: /api/bootstrap/ contract + private ref-data caching."""
from django.test import TestCase
from django.core.cache import cache
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, AcademicYear, SchoolSetting, Category
from students.models import Student
from teachers.models import Teacher
from staff.models import Staff
from books.models import Book
from parents.models import ParentStudentLink

User = get_user_model()


def _token(user):
    return str(RefreshToken.for_user(user).access_token)


def _auth(client, user):
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {_token(user)}')


def _make_admin(email='admin@speed.test'):
    return User.objects.create_superuser(email=email, name='Admin', password='x')


def _list_data(res):
    """Paginated-or-plain list payload -> (count, rows)."""
    if isinstance(res.data, dict) and 'results' in res.data:
        return res.data['count'], list(res.data['results'])
    if isinstance(res.data, list):
        return len(res.data), list(res.data)
    return len(res.data), list(res.data)


class BootstrapTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = _make_admin()
        _auth(self.client, self.admin)
        self.klass_a = SchoolClass.objects.create(name='Class A', order=0)
        self.klass_b = SchoolClass.objects.create(name='Class B', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.year2 = AcademicYear.objects.create(
            name='2025', start_date='2025-01-01', end_date='2025-12-31', is_active=False)
        self.s1 = Student.objects.create(
            name='Stu One', student_id='SPD001', school_class=self.klass_a, session='2026')
        self.s2 = Student.objects.create(
            name='Stu Two', student_id='SPD002', school_class=self.klass_b, session='2026')
        Teacher.objects.create(name='T One', designation='Teacher')
        Teacher.objects.create(name='T Two', designation='Teacher')
        Staff.objects.create(name='S One', role='Guard')
        Book.objects.create(name='Math Book', school_class=self.klass_a)
        SchoolSetting.objects.create(key='school_name', value='Speed School')
        SchoolSetting.objects.create(key='phone', value='123')
        Category.objects.create(name='Stationery', type='EXPENSE')
        Category.objects.create(name='Snacks', type='EXPENSE')
        Category.objects.create(name='Tuition', type='INCOME')

    def test_auth_required(self):
        anon = APIClient()
        res = anon.get('/api/bootstrap/')
        self.assertIn(res.status_code, (401, 403))

    def test_exact_top_level_shape(self):
        res = self.client.get('/api/bootstrap/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            set(res.data.keys()),
            {'counts', 'classes', 'academicYears', 'settings', 'expenseCategories'})
        self.assertEqual(
            set(res.data['counts'].keys()),
            {'students', 'teachers', 'staff', 'books'})

    def test_counts_match_list_endpoints(self):
        boot = self.client.get('/api/bootstrap/').data
        for url, key in (('/api/students/', 'students'),
                         ('/api/teachers/', 'teachers'),
                         ('/api/staff/', 'staff'),
                         ('/api/books/', 'books')):
            count, _ = _list_data(self.client.get(url))
            self.assertEqual(boot['counts'][key], count, url)

    def test_classes_match_list_endpoint(self):
        boot = self.client.get('/api/bootstrap/').data
        _, rows = _list_data(self.client.get('/api/classes/'))
        expected = sorted(
            ({'id': c['id'], 'name': c['name'], 'order': c['order'],
              'studentCount': c.get('studentCount') or 0} for c in rows),
            key=lambda c: c['id'])
        got = sorted(boot['classes'], key=lambda c: c['id'])
        self.assertEqual(got, expected)
        # studentCount is real, not a stub
        by_name = {c['name']: c['studentCount'] for c in got}
        self.assertEqual(by_name['Class A'], 1)
        self.assertEqual(by_name['Class B'], 1)
        for c in got:
            self.assertEqual(set(c.keys()), {'id', 'name', 'order', 'studentCount'})

    def test_academic_years_match_list_endpoint(self):
        boot = self.client.get('/api/bootstrap/').data
        _, rows = _list_data(self.client.get('/api/academic-years/'))
        expected = sorted(
            ({'id': y['id'], 'name': y['name'], 'isActive': y.get('isActive', False),
              'startDate': y.get('startDate'), 'endDate': y.get('endDate')}
             for y in rows),
            key=lambda y: y['id'])
        got = sorted(boot['academicYears'], key=lambda y: y['id'])
        self.assertEqual(got, expected)
        for y in got:
            self.assertEqual(set(y.keys()), {'id', 'name', 'isActive', 'startDate', 'endDate'})

    def test_settings_match_summary_endpoint(self):
        boot = self.client.get('/api/bootstrap/').data
        summary = self.client.get('/api/settings/').data
        self.assertEqual(dict(boot['settings']), dict(summary))
        self.assertEqual(boot['settings']['school_name'], 'Speed School')

    def test_expense_categories_match_filtered_list(self):
        boot = self.client.get('/api/bootstrap/').data
        _, rows = _list_data(self.client.get('/api/categories/?type=EXPENSE'))
        self.assertEqual(list(boot['expenseCategories']), rows)
        self.assertTrue(all(c['type'] == 'EXPENSE' for c in boot['expenseCategories']))
        self.assertEqual(len(boot['expenseCategories']), 2)

    def test_parent_sees_scoped_rows(self):
        parent = User.objects.create_user(
            email='par@speed.test', name='Par', password='x',
            email_verified=True, role='parent')
        ParentStudentLink.objects.create(parent=parent, student=self.s1)
        _auth(self.client, parent)

        boot = self.client.get('/api/bootstrap/')
        self.assertEqual(boot.status_code, 200)
        # scoped: only the linked student, matching the parent's list view
        parent_list_count, _ = _list_data(self.client.get('/api/students/'))
        self.assertEqual(parent_list_count, 1)
        self.assertEqual(boot.data['counts']['students'], 1)
        # no read permission elsewhere -> empty, never leaked
        self.assertEqual(boot.data['counts']['teachers'], 0)
        self.assertEqual(boot.data['counts']['staff'], 0)
        self.assertEqual(boot.data['counts']['books'], 0)
        self.assertEqual(boot.data['classes'], [])
        self.assertEqual(boot.data['academicYears'], [])
        self.assertEqual(boot.data['expenseCategories'], [])

        # admin still sees everything (no bypass in the other direction)
        _auth(self.client, self.admin)
        admin_boot = self.client.get('/api/bootstrap/').data
        self.assertEqual(admin_boot['counts']['students'], 2)
        self.assertEqual(len(admin_boot['classes']), 2)


class RefDataCacheHeaderTests(TestCase):
    """private, max-age=60 (+ETag) on ref-data lists; never public/shared."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        _auth(self.client, _make_admin(email='cache-admin@speed.test'))
        SchoolClass.objects.create(name='Class C', order=0)
        AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)

    def _assert_private(self, res):
        cc = res.get('Cache-Control', '')
        self.assertIn('private', cc)
        self.assertIn('max-age=60', cc)
        self.assertNotIn('public', cc)
        self.assertNotIn('s-maxage', cc)
        self.assertTrue(res.get('ETag'), 'ETag missing')

    def test_core_ref_data_lists_are_private_cached(self):
        for url in ('/api/classes/', '/api/academic-years/',
                    '/api/settings/', '/api/categories/?type=EXPENSE'):
            res = self.client.get(url)
            self.assertEqual(res.status_code, 200, url)
            self._assert_private(res)

    def test_per_user_students_list_is_never_shared(self):
        res = self.client.get('/api/students/')
        self.assertEqual(res.status_code, 200)
        cc = res.get('Cache-Control', '')
        self.assertNotIn('public', cc)
        self.assertNotIn('s-maxage', cc)
