export interface TeacherClassRef {
  id: string;
  name: string;
}

/** Full record CRUD on the ID-card section (students/teachers/staff). */
export function canManageIdCard(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'monitor';
}

/**
 * Dashboard / BottomNav module keys. Same key space as the dashboard `mode`
 * URL param, so a role check reads the same string in both places.
 */
export type ModuleKey =
  | 'idcard'
  | 'accessories'
  | 'attendance'
  | 'result'
  | 'finance'
  | 'routine'
  | 'exam-routine'
  | 'session-year'
  | 'announcements'
  | 'services'
  | 'scheduler';

/**
 * Single source of truth: which roles see which dashboard module.
 *
 * Mirrors the backend map in `accounts/permissions.py` (ROLE_PERMISSIONS) plus
 * the per-view `get_permissions` overrides:
 *   idcard       students:read  (+ photo access via require_photo_access)
 *   accessories  books:read
 *   attendance   students:read / students:write (CanMarkAttendance)
 *   result       results:read
 *   finance      finance:read
 *   routine      academic:read   (writes need academic:admin)
 *   exam-routine academic:read   (writes need academic:admin)
 *   session-year classes:read / academic-years:read (writes need classes:write)
 *   announcements IsAuthenticated on GET, announcements:write on POST
 *   services     classes:read on GET, finance:write on writes
 *   scheduler    finance:admin (admin only)
 *
 * Accountant is deliberately scoped to the money + student-roster surface:
 * accessories (read), finance, services, announcements, idcard — no academic
 * modules (attendance/result/routine/exam/session), no scheduler.
 *
 * Notes on the two roles that are not in the flow of a dashboard login:
 *   - `viewer` (pending account) has no backend permissions at all and sees
 *     no tiles — Dashboard also short-circuits the whole tile grid for it.
 *   - `parent` never renders Dashboard (App routes `/` to `/parent`), so its
 *     absence here cannot change live behaviour.
 *   - `super_viewer` keeps the read-only tiles it already had.
 */
export const MODULE_ROLES: Record<ModuleKey, readonly string[]> = {
  idcard: ['admin', 'monitor', 'teacher', 'accountant', 'super_viewer'],
  accessories: ['admin', 'monitor', 'teacher', 'accountant', 'super_viewer'],
  attendance: ['admin', 'monitor', 'teacher', 'super_viewer'],
  result: ['admin', 'monitor', 'teacher', 'super_viewer'],
  finance: ['admin', 'accountant', 'super_viewer'],
  routine: ['admin', 'monitor', 'super_viewer'],
  'exam-routine': ['admin', 'monitor', 'super_viewer'],
  'session-year': ['admin', 'monitor', 'super_viewer'],
  announcements: ['admin', 'monitor', 'accountant', 'super_viewer'],
  services: ['admin', 'monitor', 'accountant', 'super_viewer'],
  scheduler: ['admin'],
};

/** Whether `role` may open/see the given module. Unknown roles see nothing. */
export function canUseModule(
  role: string | undefined | null,
  module: ModuleKey,
): boolean {
  if (!role) return false;
  return (MODULE_ROLES[module] || []).includes(role);
}

/**
 * Roles allowed to register a new student (POST /api/students/), which the
 * backend gates on the create-only 'students:add' permission: admin, monitor
 * and accountant add students across every class. Teachers hold 'students:add'
 * too but stay scoped per class via canManageClassStudents() below.
 */
export function canAddStudents(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'monitor' || role === 'accountant';
}

/**
 * Whether `role` may add/edit/delete students of the class named `className`.
 * Admins and monitors cover every class; teachers only the classes they are
 * class teacher of (mirrors backend `can_manage_students`).
 */
export function canManageClassStudents(
  role: string | undefined | null,
  teacherClasses: TeacherClassRef[] | undefined | null,
  className: string,
): boolean {
  if (role === 'admin' || role === 'monitor') return true;
  if (role !== 'teacher') return false;
  return (teacherClasses || []).some((c) => c.name === className);
}
