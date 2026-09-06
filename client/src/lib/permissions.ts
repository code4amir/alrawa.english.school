export interface TeacherClassRef {
  id: string;
  name: string;
}

/** Full record CRUD on the ID-card section (students/teachers/staff). */
export function canManageIdCard(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'monitor';
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
