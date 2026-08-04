from rest_framework.permissions import BasePermission
from accounts.permissions import has_permission, is_academic_admin


class CanMarkAttendance(BasePermission):
    def has_permission(self, request, view):
        return has_permission(request.user, 'students:write')


class CanManageHolidays(BasePermission):
    """Admin or Monitor only — holidays are school-level policy."""
    def has_permission(self, request, view):
        return is_academic_admin(request.user)
