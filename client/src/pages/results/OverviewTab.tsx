import { useEffect, useState } from 'react';
import { useSchoolStore } from '../../store';
import { LayoutDashboard } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

const TERMS = ['1', '2', '3'];

interface Cell { done: number; total: number }
interface ClassRow {
  classId: string;
  className: string;
  subjects: { name: string; terms: Record<string, Cell> }[];
}

// U8: coordinator's completion matrix — every class × subject × term at a
// glance (green full / amber partial / red empty), with the C3 lock toggles
// per class × term so finalizing happens right where gaps are spotted.
export default function OverviewTab() {
  const { fetchAcademicYears, fetchClasses, fetchSubjects, fetchStudents, fetchClassResults,
    resultLocks, fetchResultLocks, lockResults, unlockResults } = useSchoolStore();
  const [rows, setRows] = useState<ClassRow[] | null>(null);
  const [session, setSession] = useState('');
  const [busyLock, setBusyLock] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAcademicYears();
      const ys = useSchoolStore.getState().academicYears;
      const sess = ys.find((y: any) => y.isActive)?.name || ys[0]?.name || '';
      if (!sess) { if (!cancelled) { setRows([]); } return; }
      if (!cancelled) setSession(sess);
      await fetchResultLocks(sess);
      await fetchClasses();
      const classes = [...useSchoolStore.getState().classes];
      const out: ClassRow[] = [];
      for (const c of classes) {
        await fetchSubjects(c.id);
        const subs = [...useSchoolStore.getState().subjects];
        await fetchStudents({ className: c.name }, true);
        const roster = useSchoolStore.getState().students.filter((s: any) => s.class === c.name);
        await fetchClassResults(c.id, sess);
        const res = useSchoolStore.getState().classResults[`${c.id}-${sess}`] || [];
        out.push({
          classId: c.id, className: c.name,
          subjects: subs.map((sub: any) => {
            const canonical = SUBJECT_KEY_MAP[sub.name] || sub.name;
            const terms: Record<string, Cell> = {};
            for (const t of TERMS) {
              const done = res.filter((r: any) =>
                String(r.term) === t && r.marks && r.marks[canonical] !== undefined && r.marks[canonical] !== null
              ).length;
              terms[t] = { done, total: roster.length };
            }
            return { name: sub.name, terms };
          }),
        });
        if (cancelled) return;
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLock = async (row: ClassRow, term: string) => {
    const key = `${row.classId}|${term}`;
    setBusyLock(key);
    try {
      const existing = (resultLocks || []).find((l: any) =>
        String(l.school_class) === String(row.classId) &&
        String(l.session) === String(session) && String(l.term) === String(term));
      if (existing) await unlockResults(existing.id);
      else await lockResults(row.classId, session, term);
      await fetchResultLocks(session);
    } finally {
      setBusyLock(null);
    }
  };

  const pill = (cell: Cell) => {
    if (cell.total === 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-400">—</span>;
    if (cell.done >= cell.total) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700">✓ {cell.done}/{cell.total}</span>;
    if (cell.done > 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">{cell.done}/{cell.total}</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">0/{cell.total}</span>;
  };

  if (rows === null) {
    return <div className="text-center py-12 text-sm text-school-muted animate-pulse">Loading completion overview…</div>;
  }
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.classId} className="bg-white rounded-2xl border border-school-border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-serif text-base text-school-primary flex items-center gap-1.5">
              <LayoutDashboard size={16} /> {row.className}
            </h4>
            <div className="flex gap-1.5">
              {TERMS.map((t) => {
                const locked = (resultLocks || []).some((l: any) =>
                  String(l.school_class) === String(row.classId) &&
                  String(l.session) === String(session) && String(l.term) === String(t));
                const busy = busyLock === `${row.classId}|${t}`;
                return (
                  <button key={t} disabled={busy} onClick={() => toggleLock(row, t)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border disabled:opacity-50 ${locked ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-school-border text-school-muted hover:border-school-accent'}`}>
                    {busy ? '…' : locked ? `🔒 ${TERM_NAMES[t] || `T${t}`}` : `Lock ${TERM_NAMES[t] || `T${t}`}`}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-school-muted uppercase border-b border-school-border">
                  <th className="text-left py-1 pr-2">Subject</th>
                  {TERMS.map((t) => <th key={t} className="text-center py-1 px-2">{TERM_NAMES[t] || `T${t}`}</th>)}
                </tr>
              </thead>
              <tbody>
                {row.subjects.map((s) => (
                  <tr key={s.name} className="border-b border-school-border/50">
                    <td className="py-1.5 pr-2 font-medium">{s.name}</td>
                    {TERMS.map((t) => <td key={t} className="text-center py-1.5 px-2">{pill(s.terms[t])}</td>)}
                  </tr>
                ))}
                {row.subjects.length === 0 && (
                  <tr><td className="py-2 text-school-muted">No subjects set up.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
