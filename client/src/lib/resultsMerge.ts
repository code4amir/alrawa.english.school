export interface ResultRow {
  studentId: string;
  term: string | number;
  session?: string;
  marks?: Record<string, number>;
  attendance?: { days: number; present: number };
  comment?: string;
  [key: string]: unknown;
}

const sameCell = (r: ResultRow, studentId: string, term: string | number) =>
  String(r.studentId) === String(studentId) && String(r.term) === String(term);

/**
 * Merge just-saved subject marks into cached rows so inputs reflect the save
 * instantly. The post-save server refetch can resolve with a stale (pre-save)
 * snapshot — deduped onto an in-flight request or falling back to old cache
 * on error — which used to blank the inputs until a full refresh.
 */
export function mergeSavedMarks(
  rows: ResultRow[],
  studentIds: string[],
  term: string | number,
  subject: string,
  values: Record<string, string>,
  fullMarks: number,
): ResultRow[] {
  const next = rows.map((r) => ({ ...r, marks: { ...(r.marks || {}) } }));
  for (const sid of studentIds) {
    const v = values[sid];
    const saved = v !== '' && v !== undefined && !isNaN(+v) ? Math.min(+v, fullMarks) : undefined;
    const idx = next.findIndex((r) => sameCell(r, sid, term));
    if (idx >= 0) {
      if (saved === undefined) delete next[idx].marks![subject];
      else next[idx].marks![subject] = saved;
    } else if (saved !== undefined) {
      next.push({ studentId: sid, term, marks: { [subject]: saved } });
    }
  }
  return next;
}

/** Same instant-merge for the attendance bulk save. */
export function mergeSavedAttendance(
  rows: ResultRow[],
  studentIds: string[],
  term: string | number,
  values: Record<string, { days: string; present: string }>,
): ResultRow[] {
  const next = rows.map((r) => ({ ...r }));
  for (const sid of studentIds) {
    const att = values[sid] || { days: '', present: '' };
    const days = parseInt(att.days) || 0;
    const present = parseInt(att.present) || 0;
    const idx = next.findIndex((r) => sameCell(r, sid, term));
    const attendance = days > 0 ? { days, present } : undefined;
    if (idx >= 0) {
      if (attendance) next[idx] = { ...next[idx], attendance };
      else { const rest = { ...next[idx] }; delete rest.attendance; next[idx] = rest; }
    } else if (attendance) {
      next.push({ studentId: sid, term, attendance });
    }
  }
  return next;
}

/** Same instant-merge for the comments bulk save. */
export function mergeSavedComments(
  rows: ResultRow[],
  studentIds: string[],
  term: string | number,
  values: Record<string, string>,
): ResultRow[] {
  const next = rows.map((r) => ({ ...r }));
  for (const sid of studentIds) {
    const idx = next.findIndex((r) => sameCell(r, sid, term));
    if (idx >= 0) next[idx] = { ...next[idx], comment: values[sid] || '' };
    else next.push({ studentId: sid, term, comment: values[sid] || '' });
  }
  return next;
}
