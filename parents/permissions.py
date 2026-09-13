from rest_framework.permissions import BasePermission


class IsParentOfStudent(BasePermission):
    """Allow only authenticated users with the `parent` role.

    Manual-check contract (read this before touching parent-scoped views):

    - Every parent-scoped view MUST re-check the link table itself
      (`request.user.parent_links.values_list('student_id', ...)`) and return
      404 for unlinked students — this permission only proves "is a parent",
      NOT "is THIS student's parent". Relying on it alone is an IDOR.
    - The only exception is the staff-driven manual link flow
      (`ParentLinkView.post`, gated by `users:write`, audit action
      `manual_link`): it deliberately bypasses the ID-card-facts check that
      the self-service connect flow requires, because a verified staff member
      is performing the link on the parent's behalf. That bypass is audited
      and sends the parent a welcome notification — do not add other
      unaudited link-creation paths.
    """

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.role == 'parent':
            return True
        return False

    def has_object_permission(self, request, view, obj):
        parent_links = request.user.parent_links.values_list('student_id', flat=True)
        return obj.student_id in parent_links
