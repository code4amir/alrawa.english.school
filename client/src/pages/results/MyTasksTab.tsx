import { useEffect, useState } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { ClipboardCheck } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

const TERMS = ['1', '2', '3'];

interface SubjectTask {
  name: string;
  terms: Record<string, { done: number; total: number }>;
  nextTerm: string;
}
interface ClassTask {
  classId: string;
  className: string;
  subjects: SubjectTask[];
}

// U1: each teacher lands on their own entry tasks — their classes (from the
// session's teacherClasses) with per-subject × term progress. One tap jumps
// straight into Enter-by-Subject via the alrawa-enter-task event (U3 prefs
// make the return trip seamless too).
export default function MyTasksTab() {
  const teacherClasses = useAuthStore((s) => s.user?.teacherClasses) || [];
  const { fetchAcademicYears, fetchSubjects, fetchStudents, fetchClassResults } = useSchoolStore();
  const [tasks, setTasks] = useState<ClassTask[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAcademicYears();
      const ys = useSchoolStore.getState().academicYears;
      const session = ys.find((y: any) => y.isActive)?.name || ys[0]?.name || '';
      if (!session) { if (!cancelled) setTasks([]); return; }
      const out: ClassTask[] = [];
      for (const c of teacherClasses) {
        await fetchSubjects(c.id);
        const subs = [...useSchoolStore.getState().subjects];
        await fetchStudents({ className: c.name }, true);
        const roster = useSchoolStore.getState().students.filter((s: any) => s.class === c.name);
        await fetchClassResults(c.id, session);
        const rows = useSchoolStore.getState().classResults[`${c.id}-${session}`] || [];
        const subjects: SubjectTask[] = subs.map((sub: any) => {
          const canonical = SUBJECT_KEY_MAP[sub.name] || sub.name;
          const terms: Record<string, { done: number; total: number }> = {};
          for (const t of TERMS) {
            const done = rows.filter((r: any) =>
              String(r.term) === t && r.marks && r.marks[canonical] !== undefined && r.marks[canonical] !== null
            ).length;
            terms[t] = { done, total: roster.length };
          }
          const nextTerm = TERMS.find((t) => terms[t].done < terms[t].total) || '1';
          return { name: sub.name, terms, nextTerm };
        });
        out.push({ classId: c.id, className: c.name, subjects });
        if (cancelled) return;
      }
      if (!cancelled) setTasks(out);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (t: ClassTask, s: SubjectTask) => {
    window.dispatchEvent(new CustomEvent('alrawa-enter-task', {
      detail: { classId: t.classId, subject: s.name, term: s.nextTerm },
    }));
    window.dispatchEvent(new CustomEvent('alrawa-results-tab', { detail: 'subject' }));
  };

  if (tasks === null) {
    return <div className="text-center py-12 text-sm text-school-muted animate-pulse">Loading your entry tasks…</div>;
  }
  if (tasks.length === 0) {
    return <div className="text-center py-12 text-sm text-school-muted">No classes assigned to you yet — ask an admin to make you class-teacher.</div>;
  }
  return (
    <div className="space-y-4">
      {tasks.map((t) => (
        <div key={t.classId} className="bg-white rounded-2xl border border-school-border p-4 space-y-3">
          <h4 className="font-serif text-base text-school-primary flex items-center gap-1.5">
            <ClipboardCheck size={16} /> {t.className}
          </h4>
          {t.subjects.length === 0 && <div className="text-xs text-school-muted">No subjects set up for this class.</div>}
          {t.subjects.map((s) => {
            const totals = TERMS.map((term) => s.terms[term]);
            const allDone = totals.every((x) => x.total > 0 && x.done >= x.total);
            return (
              <button key={s.name} onClick={() => jump(t, s)} className="w-full text-left border border-school-border rounded-xl p-3 hover:border-school-accent transition-all space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-school-primary">{s.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${allDone ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {allDone ? '✓ Complete' : 'Continue →'}
                  </span>
                </div>
                {TERMS.map((term) => {
                  const { done, total } = s.terms[term];
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <div key={term} className="flex items-center gap-2">
                      <span className="text-[10px] text-school-muted w-14 shrink-0">{TERM_NAMES[term] || `T${term}`}</span>
                      <div className="flex-1 h-2 bg-school-paper rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-school-muted w-10 text-right shrink-0">{done}/{total}</span>
                    </div>
                  );
                })}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
