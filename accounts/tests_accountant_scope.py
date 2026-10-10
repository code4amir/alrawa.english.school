"""Accountant role scope: what the role may and may not do.

Decided scope (Fees & Books read, Services full, Announcements full, Finance
full, ID-card student add WITHOUT edit/delete), locked in here so a later
permission edit cannot silently widen or narrow it.

    accountant  create student      201
    accountant  update/delete/restore/graduate student  403
    accountant  publish announcement 201
    accountant  create/update service type  200/201
"""

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, ServiceType
from parents.models import Announcement
from students.models import Student
from accounts.permissions import has_permission, ROLE_PERMISSIONS

User = get_user_model()


class AccountantRoleMixin:
    def setUp(self):
        self.client = APIClient()
        self.accountant = self._make_user('acct@test.com', role='accountant')
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self._auth(self.accountant)

    def _make_user(self, email, role, **kw):
        kw.setdefault('name', email.split('@')[0])
        kw.setdefault('password', 'testpass123')
        kw.setdefault('email_verified', True)
        return User.objects.create_user(email=email, role=role, **kw)

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def _student(self, name='S1', sid='S000001'):
        return Student.objects.create(
            name=name, student_id=sid, school_class=self.klass)


class AccountantPermissionMapTests(TestCase):
    """The role table itself — cheap guard on the grant list."""

    def test_accountant_holds_add_but_not_full_student_write(self):
        perms = ROLE_PERMISSIONS['accountant']
        self.assertIn('students:add', perms)
        self.assertIn('students:read', perms)
        # The whole point of 'students:add': no blanket write on student records.
        self.assertNotIn('students:write', perms)

    def test_accountant_holds_finance_services_and_announcements(self):
        # services -> 'finance:write' + 'classes:read'; announcements -> its own string.
        for perm in ('finance:read', 'finance:write', 'classes:read',
                     'books:read', 'announcements:write'):
            self.assertIn(perm, ROLE_PERMISSIONS['accountant'])

    def test_accountant_keeps_no_academic_or_user_authority(self):
        for perm in ('results:write', 'academic:write', 'users:write',
                     'academic-years:write', 'audit:read'):
            self.assertNotIn(perm, ROLE_PERMISSIONS['accountant'])

    def test_has_permission_alias_keeps_legacy_write_roles_working(self):
        # A role that holds ONLY the legacy 'students:write' (the shape every
        # write-capable role had before the split) must still pass the dedicated
        # create/publish checks through WRITE_PERM_ALIASES. Uses a patched
        # ROLE_PERMISSIONS so the real admin grant cannot mask a broken alias.
        from unittest.mock import patch
        legacy = {'legacy_writer': ['students:read', 'students:write']}
        user = User.objects.create_user(
            email='a@test.com', name='A', password='p', email_verified=True,
            role='admin')
        user.role = 'legacy_writer'
        with patch.dict(ROLE_PERMISSIONS, legacy, clear=False):
            self.assertTrue(has_permission(user, 'students:add'))
            self.assertTrue(has_permission(user, 'announcements:write'))

    def test_alias_only_applies_to_dedicated_write_strings(self):
        from unittest.mock import patch
        legacy = {'legacy_writer': ['students:read', 'students:write']}
        user = User.objects.create_user(
            email='a2@test.com', name='A2', password='p', email_verified=True,
            role='admin')
        user.role = 'legacy_writer'
        with patch.dict(ROLE_PERMISSIONS, legacy, clear=False):
            # Reads must not leak in through the alias table.
            self.assertFalse(has_permission(user, 'finance:write'))
            self.assertFalse(has_permission(user, 'users:write'))

    def test_has_permission_does_not_grant_write_from_add(self):
        accountant = User.objects.create_user(
            email='b@test.com', name='B', password='p', email_verified=True,
            role='accountant')
        # One-way: holding 'students:add' must NOT unlock 'students:write'.
        self.assertTrue(has_permission(accountant, 'students:add'))
        self.assertFalse(has_permission(accountant, 'students:write'))


class AccountantStudentScopeTests(AccountantRoleMixin, TestCase):
    def assertPermissionLayerDenied(self, res):
        """403 must come from the permission layer, not a later scoping check.

        perform_update/perform_destroy raise PermissionDenied for the class
        teacher rule, which would hide an over-granted role: the request would
        still 403 while the viewset handed out the action. DRF's generic
        'You do not have permission to perform this action.' only appears when
        get_permissions() itself refused.
        """
        self.assertEqual(res.status_code, 403)
        detail = str(res.data.get('detail', ''))
        self.assertIn('do not have permission', detail.lower())

    def test_can_create_student(self):
        res = self.client.post('/api/students/', {
            'name': 'John Doe', 'schoolClass': str(self.klass.id), 'roll': '1',
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Student.objects.count(), 1)
        self.assertEqual(res.data['name'], 'John Doe')

    def test_cannot_create_student_in_class_without_teacher_scope_block(self):
        # perform_create applies class-teacher scoping to non-admin writers; an
        # add-only caller must bypass it, or every POST 403s.
        res = self.client.post('/api/students/', {
            'name': 'Jane Roe', 'schoolClass': str(self.klass.id), 'roll': '2',
        })
        self.assertEqual(res.status_code, 201)

    def test_cannot_update_student(self):
        s = self._student()
        res = self.client.put(f'/api/students/{s.id}/', {'name': 'Hacked'})
        self.assertPermissionLayerDenied(res)
        s.refresh_from_db()
        self.assertEqual(s.name, 'S1')

    def test_cannot_patch_student(self):
        s = self._student()
        res = self.client.patch(f'/api/students/{s.id}/', {'name': 'Hacked'})
        self.assertPermissionLayerDenied(res)

    def test_cannot_delete_student(self):
        s = self._student()
        res = self.client.delete(f'/api/students/{s.id}/')
        self.assertPermissionLayerDenied(res)
        s.refresh_from_db()
        self.assertIsNone(s.deleted_at)

    def test_cannot_restore_student(self):
        s = self._student()
        # Soft-delete as an admin so the row is actually archived first.
        s.deleted_at = timezone_now()
        s.save(update_fields=['deleted_at'])
        res = self.client.post(f'/api/students/{s.id}/restore/')
        self.assertPermissionLayerDenied(res)
        s.refresh_from_db()
        self.assertIsNotNone(s.deleted_at)

    def test_cannot_graduate_or_ungraduate_student(self):
        s = self._student()
        for action in ('graduate', 'ungraduate'):
            res = self.client.post(f'/api/students/{s.id}/{action}/')
            self.assertPermissionLayerDenied(res)

    def test_cannot_bulk_import_students(self):
        res = self.client.post('/api/students/import/', {
            'students': [{'name': 'Bulk', 'roll': '9'}],
        })
        self.assertPermissionLayerDenied(res)
        self.assertEqual(Student.objects.count(), 0)

    def test_can_read_students(self):
        self._student()
        res = self.client.get('/api/students/')
        self.assertEqual(res.status_code, 200)


class AccountantAnnouncementTests(AccountantRoleMixin, TestCase):
    def test_can_publish_announcement(self):
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Fees due', 'body': 'Pay by Friday',
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Announcement.objects.filter(title='Fees due').exists())

    def test_can_publish_class_scoped_announcement(self):
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Class 5 notice', 'body': 'hi',
            'school_class_id': str(self.klass.id),
        })
        self.assertEqual(res.status_code, 201)

    def test_get_stays_open_to_authenticated_accountant(self):
        res = self.client.get('/api/parents/announcements/')
        self.assertEqual(res.status_code, 200)

    def test_parent_still_cannot_publish(self):
        parent = self._make_user('p@test.com', role='parent')
        self._auth(parent)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Nope', 'body': 'x',
        })
        self.assertEqual(res.status_code, 403)

    def test_viewer_cannot_publish(self):
        viewer = self._make_user('v@test.com', role='viewer')
        self._auth(viewer)
        res = self.client.post('/api/parents/announcements/', {
            'title': 'Nope', 'body': 'x',
        })
        self.assertEqual(res.status_code, 403)


class AccountantServiceTypeTests(AccountantRoleMixin, TestCase):
    def test_can_create_service_type(self):
        res = self.client.post('/api/service-types/', {
            'name': 'Transport', 'default_amount': '250.00', 'frequency': 'MONTHLY',
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(ServiceType.objects.filter(name='Transport').exists())

    def test_can_update_service_type(self):
        st = ServiceType.objects.create(name='Library', default_amount=100)
        res = self.client.patch(
            f'/api/service-types/{st.id}/', {'default_amount': '150.00'})
        self.assertEqual(res.status_code, 200)
        st.refresh_from_db()
        self.assertEqual(float(st.default_amount), 150.00)

    def test_can_read_service_types(self):
        res = self.client.get('/api/service-types/')
        self.assertEqual(res.status_code, 200)


def timezone_now():
    from django.utils import timezone
    return timezone.now()

class AccountantServiceEnrollmentTests(TestCase):
    """Service enrollment writes finance rows, so it rides finance:write.

    Without this the accountant's Services screen 403s on summary/toggle even
    though service-types itself works (that one needs classes:read +
    finance:write).
    """

    def setUp(self):
        from core.models import SchoolClass, ServiceType
        from students.models import Student
        from parents.models import ParentStudentLink  # noqa: F401  (import parity)
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='acc-svc@test.com', name='Acc', password='pass123',
            role='accountant', email_verified=True)
        self.client.force_authenticate(self.user)
        self.klass = SchoolClass.objects.create(name='Play', order=1)
        self.student = Student.objects.create(
            name='Kid', student_id='S000123', school_class=self.klass)
        self.svc = ServiceType.objects.create(name='Transport', default_amount=500)

    def test_service_summary_allowed(self):
        res = self.client.get('/api/students/service_summary/')
        self.assertEqual(res.status_code, 200)

    def test_bulk_toggle_service_allowed(self):
        res = self.client.post('/api/students/bulk_toggle_service/', {
            'service_type_id': str(self.svc.id),
            'class_id': str(self.klass.id),
            'active': True,
        }, format='json')
        self.assertNotIn(res.status_code, (401, 403), msg=res.content[:300])

    def test_student_edit_still_denied(self):
        res = self.client.patch(
            f'/api/students/{self.student.id}/', {'name': 'Renamed'})
        self.assertEqual(res.status_code, 403)
