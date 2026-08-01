from rest_framework.permissions import BasePermission, SAFE_METHODS

ROLE_PERMISSIONS = {
    'admin': [
        'students:read', 'students:write',
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
        'students:read', 'students:write',
        'teachers:read',
        'staff:read',
        'books:read',
        'classes:read',
        'subjects:read',
        'results:read', 'results:write',
        'academic-years:read',
        'academic:read', 'academic:write',
    ],
    # Monitor = academic supervisor: full read/write on all academic data
    # (attendance, results, homework, diary, routine...) but NO finance,
    # user management, or audit access.
    'monitor': [
        'students:read', 'students:write',
        'teachers:read',
        'staff:read',
        'books:read',
        'classes:read',
        'subjects:read', 'subjects:write', 'subjects:admin',
        'results:read', 'results:write', 'results:admin',
        'academic-years:read',
        'academic:read', 'academic:write', 'academic:admin',
    ],
    'accountant': [
        'students:read',
        'teachers:read',
        'staff:read',
        'books:read',
        'classes:read',
        'finance:read', 'finance:write',
        'academic-years:read',
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
    return permission in perms


class HasPermission(BasePermission):
    def __init__(self, permission):
        self.permission = permission
        super().__init__()

    def has_permission(self, request, view):
        return has_permission(request.user, self.permission)


def require_permission(permission):
    class CheckPermission(BasePermission):
        def has_permission(self, request, view):
            return has_permission(request.user, permission)
    return CheckPermission


def is_admin_or_superuser(user):
    return user.is_superuser or getattr(user, 'role', None) == 'admin'


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
