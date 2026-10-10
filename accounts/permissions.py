from rest_framework.permissions import BasePermission, SAFE_METHODS

# Permission namespaces
# -------------------
# 'students:add'   create-only student writes (ID-card / reception desk).
#                   Separate from 'students:write' so a role can admit students
#                   without gaining edit/delete/graduate over existing rows.
# 'announcements:write' publish parent announcements. Owned by the role, not by
#                   borrowing 'students:write', so accountant/administration can
#                   publish without holding student-edit rights.
# Granting the legacy string satisfies the dedicated one too. Needed because
# these permissions were previously enforced under the 'students:write'
# umbrella: teacher/monitor/admin could already create students and publish
# announcements, and must keep doing so after the split.
WRITE_PERM_ALIASES = {
    'students:add': ['students:write'],
    'announcements:write': ['students:write'],
}

ROLE_PERMISSIONS = {
    'admin': [
        'students:read', 'students:write', 'students:add',
        'announcements:write',
        'teachers:read', 'teachers:write',
        'staff:read', 'staff:write',
        'books:read', 'books:write',
        'classes:read', 'classes:write',
        'subjects:read', 'subjects:write', 'subjects:admin',
        'results:read', 'results:write', 'results:admin',
        'finance:read', 'finance:write', 'finance:admin',
        'users:read', 'users:write',
        'audit:read',
        'academic-years:read', 'academic-years:write',
        'academic:read', 'academic:write', 'academic:admin',
    ],
    'teacher': [
        'students:read', 'students:write', 'students:add',
        'teachers:read',
        'staff:read',
        'books:read', 'books:write',
        'classes:read',
        'subjects:read',
        'results:read', 'results:write',
        'academic-years:read',
        'academic:read', 'academic:write',
        'announcements:write',
    ],
    # Monitor = academic supervisor: full read/write on all academic data
    # (attendance, results, homework, diary, routine...) but NO finance,
    # user management, or audit access.
    'monitor': [
        'students:read', 'students:write', 'students:add',
        'teachers:read', 'teachers:write',
        'staff:read', 'staff:write',
        'books:read', 'books:write',
        'classes:read',
        'subjects:read', 'subjects:write', 'subjects:admin',
        'results:read', 'results:write', 'results:admin',
        'academic-years:read',
        'academic:read', 'academic:write', 'academic:admin',
        'announcements:write',
    ],
    # Accountant = fees/books + services + announcements + finance, and can
    # admit students for ID cards ('students:add') but must never edit, delete,
    # restore, or graduate existing student records.
    'accountant': [
        'students:read', 'students:add',
        'teachers:read',
        'staff:read',
        'books:read',
        'classes:read',
        'finance:read', 'finance:write',
        'academic-years:read',
        'announcements:write',
    ],
    'super_viewer': [
        'students:read',
        'teachers:read',
        'staff:read',
        'books:read',
        'classes:read',
        'subjects:read',
        'results:read',
        'finance:read',
        'academic-years:read',
    ],
    'viewer': [],
    'parent': [
        'students:read',
        'results:read',
        'academic:read',
    ],
}


def has_permission(user, permission):
    if not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    perms = ROLE_PERMISSIONS.get(user.role, [])
    if permission in perms:
        return True
    # Dedicated write strings accept the legacy umbrella string, so splitting
    # 'students:write' into 'students:add' / 'announcements:write' cannot
    # silently lock out roles that were previously allowed to write.
    return any(p in perms for p in WRITE_PERM_ALIASES.get(permission, ()))


def require_permission(permission):
    class CheckPermission(BasePermission):
        def has_permission(self, request, view):
            return has_permission(request.user, permission)
    return CheckPermission


def is_admin_or_superuser(user):
    return user.is_superuser or getattr(user, 'role', None) == 'admin'


class IsAdminOrSuperuser(BasePermission):
    """Admin role or superuser only — for authority control (PINs, assignments).

    Distinct from 'teachers:write', which monitors also hold: a monitor can
    manage teacher/staff records but must not set attendance PINs or change
    class/subject assignments.
    """

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and is_admin_or_superuser(u))


def is_academic_admin(user):
    """Admin or Monitor — full academic authority (class teacher checks, subject coverage)."""
    return user.is_superuser or getattr(user, 'role', None) in ('admin', 'monitor')


def is_class_teacher_of(user, school_class_id):
    if is_academic_admin(user):
        return True
    teacher_profile = getattr(user, 'teacher_profile', None)
    if not teacher_profile:
        return False
    from teachers.models import ClassTeacher
    return ClassTeacher.objects.filter(
        teacher=teacher_profile, school_class_id=school_class_id,
    ).exists()


def can_teach_subject(user, subject_id, school_class_id):
    if is_academic_admin(user):
        return True
    teacher_profile = getattr(user, 'teacher_profile', None)
    if not teacher_profile:
        return False
    if is_class_teacher_of(user, school_class_id):
        return True
    from teachers.models import TeacherSubject
    return TeacherSubject.objects.filter(
        teacher=teacher_profile, subject_id=subject_id, school_class_id=school_class_id,
    ).exists()


def can_manage_students(user, school_class_id):
    return is_academic_admin(user) or is_class_teacher_of(user, school_class_id)


def require_photo_access(permission):
    class PhotoAccessPermission(BasePermission):
        def has_permission(self, request, view):
            if not request.user.is_authenticated:
                return True
            return has_permission(request.user, permission)
    return PhotoAccessPermission
