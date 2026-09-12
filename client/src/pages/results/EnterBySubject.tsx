import { useState, useEffect, useMemo, useRef } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import ClassSelect from '../../components/ClassSelect';
import { gradeFromMarks, gradeChip } from '../../lib/grading';
import { mergeSavedAttendance, mergeSavedComments, mergeSavedMarks, rebuildBulkValues } from '../../lib/resultsMerge';
import { Save } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

// U3: reopen where the teacher left off — last class/subject/term/session.
const ENTER_PREFS_KEY = 'alrawa-enter-subject-v1';
const loadEnterPrefs = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(ENTER_PREFS_KEY) || '{}'); } catch { return {}; }
};

export default function EnterBySubject() {
  const { classes, fetchClasses, students, fetchStudents, subjects, fetchSubjects, saveBulkResults, academicYears, fetchAcademicYears, classResults, fetchClassResults, resultLocks, fetchResultLocks, lockResults, unlockResults } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const canSaveResults = role === 'admin' || role === 'teacher' || role === 'monitor';
  const isAdmin = role === 'admin';
  const prefsRef = useRef<Record<string, string> | null>(null);
  if (prefsRef.current === null) prefsRef.current = loadEnterPrefs();
  const [cls, setCls] = useState<any>(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [bulkSubject, setBulkSubject] = useState(() => prefsRef.current!.subject || '');
  const [termFilter, setTermFilter] = useState(() => prefsRef.current!.term || '1');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [bulkMarks, setBulkMarks] = useState<Record<string, string>>({});
  const [bulkAtt, setBulkAtt] = useState<Record<string, { days: string; present: string }>>({});
  const [bulkComment, setBulkComment] = useState<Record<string, string>>({});
  const bulkTerm = termFilter;
  const [saveStatus, setSaveStatus] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [saveError, setSaveError] = useState('');
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [coworkerNote, setCoworkerNote] = useState('');
  const statusTimer = useRef<any>(null);

  const loadResults = async (clsId: string) => {
    const key = `${clsId}-${sessionFilter}`;
    // Skip the cache only when it hasn't been invalidated: bulk saves
    // zero _fetchedAt for classResults keys after a save, so a plain truthy
    // check here used to serve STALE marks until a full page reload.
    const invalidated = useSchoolStore.getState()._fetchedAt[`classResults_${key}`] === 0;
    if (classResults[key] && !invalidated) { setAllResults(classResults[key]); return; }
    await fetchClassResults(clsId, sessionFilter);
    setAllResults(useSchoolStore.getState().classResults[key] || []);
  };

  const handleSelectClass = (c: any) => { setCls(c); setBulkSubject(''); fetchSubjects(c.id); if (sessionFilter) loadResults(c.id); fetchStudents({ className: c.name }, true); };

  useEffect(() => {
    fetchAcademicYears().then(() => {
      const academicYears = useSchoolStore.getState().academicYears;
      const prefs = prefsRef.current || {};
      const saved = prefs.session && academicYears.some((y: any) => y.name === prefs.session)
        ? prefs.session : null;
      const active = academicYears.find((y: any) => y.isActive);
      setSessionFilter(saved || (active ? active.name : (academicYears.length > 0 ? academicYears[0].name : '')));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // U3: restore last class once the class list arrives (also re-applies the
  // saved subject — selecting a class resets it).
  const restoredCls = useRef(false);
  useEffect(() => {
    if (restoredCls.current || cls) return;
    const classId = prefsRef.current?.classId;
    if (!classId) return;
    fetchClasses().then(() => {
      const list = useSchoolStore.getState().classes;
      const c = list.find((x: any) => String(x.id) === String(classId));
      if (c && !restoredCls.current) {
        restoredCls.current = true;
        handleSelectClass(c);
        if (prefsRef.current?.subject) setBulkSubject(prefsRef.current.subject);
      }
    });
  }, [classes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // U3: persist every switch so the next visit reopens here.
  useEffect(() => {
    try {
      localStorage.setItem(ENTER_PREFS_KEY, JSON.stringify({
        classId: cls?.id || '', subject: bulkSubject, term: termFilter, session: sessionFilter,
      }));
    } catch { /* private mode */ }
  }, [cls, bulkSubject, termFilter, sessionFilter]);

  useEffect(() => { if (cls) loadResults(cls.id); }, [sessionFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sessionFilter) fetchResultLocks(sessionFilter); }, [sessionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // U1 jump target: My Tasks fires alrawa-enter-task {classId, subject, term}.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d?.classId) return;
      const apply = (c: any) => {
        handleSelectClass(c);
        if (d.subject) setBulkSubject(d.subject);
        if (d.term) setTermFilter(d.term);
      };
      const found = useSchoolStore.getState().classes.find((x: any) => String(x.id) === String(d.classId));
      if (found) { apply(found); return; }
      fetchClasses().then(() => {
        const c = useSchoolStore.getState().classes.find((x: any) => String(x.id) === String(d.classId));
        if (c) apply(c);
      });
    };
    window.addEventListener('alrawa-enter-task', handler);
    return () => window.removeEventListener('alrawa-enter-task', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const clsStudents = useMemo(() => cls ? students.filter((s: any) => s.class === cls.name).sort((a: any, b: any) => (+a.roll || 999) - (+b.roll || 999) || a.name.localeCompare(b.name)) : [], [students, cls]);
  const selectedSubj = subjects.find((s: any) => s.name === bulkSubject);
  const isAttendance = bulkSubject === '__attendance__';
  const isComment = bulkSubject === '__comment__';
  const isMarksMode = !!bulkSubject && !isAttendance && !isComment;
  // U4 missing-marks: blank inputs glow amber + counter + jump-to-first-blank.
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const blankIds = isMarksMode && cls
    ? clsStudents.filter((s: any) => { const v = bulkMarks[s.id]; return v === '' || v === undefined; }).map((s: any) => String(s.id))
    : [];
  const jumpToFirstBlank = () => {
    const first = blankIds[0];
    if (!first) return;
    const el = inputRefs.current[first];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
  };
  // U6 phone-first: Enter jumps to the next student's input (thumb typing).
  const focusNextStudent = (sid: string) => {
    const idx = clsStudents.findIndex((x: any) => String(x.id) === String(sid));
    const next = idx >= 0 ? clsStudents[idx + 1] : null;
    if (!next) return;
    const el = inputRefs.current[String(next.id)];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
  };
  // C3 finalize switch: locked class × term blocks non-admin saves.
  const lock = cls && sessionFilter ? (resultLocks || []).find((l: any) =>
    String(l.school_class) === String(cls.id) &&
    String(l.session) === String(sessionFilter) &&
    String(l.term) === String(bulkTerm)) || null : null;
  const lockedForMe = !!lock && !isAdmin;

  // Basis for input rebuilds: full rebuild only on class/subject/term switch.
  // Late-arriving data on the same basis must NOT wipe unsaved typing (it did
  // before — typed numbers were replaced by blanks, and saving then wrote
  // those blanks to the server). Saves clear this to force one fresh rebuild.
  const buildBasis = useRef('');
  useEffect(() => {
    if (!bulkSubject || !cls) return;

    const basis = `${cls.id}|${bulkSubject}|${bulkTerm}`;
    const reset = basis !== buildBasis.current;
    buildBasis.current = basis;
    if (reset) setCoworkerNote('');
    const canonicalSubject = SUBJECT_KEY_MAP[bulkSubject] || bulkSubject;
    const ids = clsStudents.map((s: any) => String(s.id));
    const rowOf = (sid: string) => allResults.find((x: any) => String(x.studentId) === String(sid) && String(x.term) === String(bulkTerm));

    if (isAttendance) {
      setBulkAtt((prev) => rebuildBulkValues(prev, reset, ids, (sid) => {
        const r = rowOf(sid);
        return { days: String(r?.attendance?.days || ''), present: String(r?.attendance?.present || '') };
      }));
    } else if (isComment) {
      setBulkComment((prev) => rebuildBulkValues(prev, reset, ids, (sid) => rowOf(sid)?.comment || ''));
    } else {
      setBulkMarks((prev) => rebuildBulkValues(prev, reset, ids, (sid) => {
        const r = rowOf(sid);
        return r?.marks?.[canonicalSubject] !== undefined ? String(r.marks[canonicalSubject]) : '';
      }));
    }
  }, [bulkSubject, bulkTerm, allResults, clsStudents]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBulkMarks = async () => {
    if (!selectedSubj) return;
    if (lockedForMe) { setSaveStatus('error'); setSaveError('This term is locked — ask an admin to unlock it.'); return; }
    setSaveStatus('saving');
    setSaveError('');
    setSaveProgress({ done: 0, total: clsStudents.length });
    clearTimeout(statusTimer.current);
    const canonicalSubject = SUBJECT_KEY_MAP[bulkSubject] || bulkSubject;
    setCoworkerNote('');
    // U5 snapshot of OTHER subjects: after the save, any change here came
    // from a colleague saving concurrently — surface it instead of silently
    // swapping values under the teacher.
    const rowKey = (r: any) => `${r.studentId}|${r.term}`;
    const otherMarks = (marks: any) => {
      const m = { ...(marks || {}) };
      delete m[canonicalSubject];
      return m;
    };
    const beforeOthers = new Map(
      allResults
        .filter((x: any) => String(x.term) === String(bulkTerm))
        .map((x: any) => [rowKey(x), otherMarks(x.marks)])
    );
    // Delta items: only THIS subject per student (absent key = backend keeps
    // the stored subject untouched). Blank + nothing stored = no-op skip.
    const items: { student: string; marks: Record<string, number | null> }[] = [];
    for (const s of clsStudents) {
      const v = bulkMarks[s.id];
      const existing = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm));
      const hasValue = v !== '' && v !== undefined && !isNaN(+v);
      if (!hasValue && existing?.marks?.[canonicalSubject] === undefined) continue;
      const marksData: Record<string, number | null> = {};
      if (hasValue) marksData[canonicalSubject] = Math.min(+v, selectedSubj.fullMarks);
      else marksData[canonicalSubject] = null;
      items.push({ student: String(s.id), marks: marksData });
    }
    const failed: string[] = [];
    let succeeded: string[] = [];
    try {
      // ONE request for the whole grid (not N per-student round trips).
      const res = await saveBulkResults(bulkTerm, items, sessionFilter);
      succeeded = res.saved || [];
      setSaveProgress({ done: clsStudents.length, total: clsStudents.length });
      const failedIds = new Set((res.failed || []).map((f: any) => String(f.student)));
      for (const s of clsStudents) {
        if (failedIds.has(String(s.id))) {
          failed.push(s.name);
          const err = (res.failed || []).find((f: any) => String(f.student) === String(s.id));
          console.error('Result save failed for', s.name, err?.error);
        }
      }
    } catch (e: any) {
      // Whole-batch transport failure (offline, timeout): nothing saved.
      console.error('Bulk result save failed', e?.response?.data || e);
      for (const s of clsStudents) failed.push(s.name);
    }
    setHasUnsavedChanges(failed.length > 0);
    // Merge ONLY successes into local state: failed rows keep their typed
    // values visible (preserve-dirty) instead of being blanked by the
    // server rebuild below — and no forced reset, so typing survives.
    setAllResults((prev: any[]) => mergeSavedMarks(prev, succeeded, bulkTerm, canonicalSubject, bulkMarks, selectedSubj.fullMarks));
    if (failed.length === 0) buildBasis.current = ''; // force one fresh rebuild (e.g. clamped values)
    await loadResults(cls.id);
    setSaveProgress(null);
    // U5: diff sibling subjects against the pre-save snapshot — our own save
    // only touched canonicalSubject, so any other-subject delta is a
    // colleague's concurrent save. Name it instead of staying silent.
    {
      const fresh = useSchoolStore.getState().classResults[`${cls.id}-${sessionFilter}`] || [];
      const touched = new Set<string>();
      for (const r of fresh as any[]) {
        if (String((r as any).term) !== String(bulkTerm)) continue;
        const now = otherMarks((r as any).marks);
        const prev = beforeOthers.get(rowKey(r));
        if (prev === undefined) {
          Object.keys(now).forEach((k) => touched.add(k));
        } else {
          const keys = new Set([...Object.keys(prev), ...Object.keys(now)]);
          keys.forEach((k) => { if ((prev as any)[k] !== (now as any)[k]) touched.add(k); });
        }
      }
      if (touched.size > 0) {
        const names = [...touched].slice(0, 3).join(', ');
        setCoworkerNote(`A colleague updated ${names}${touched.size > 3 ? ` +${touched.size - 3} more` : ''} for this class while you were working — values refreshed.`);
      }
    }
    if (failed.length > 0) {
      setSaveStatus('error');
      setSaveError(`${failed.length} of ${clsStudents.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` +${failed.length - 3} more` : ''} — fix & retry`);
    } else {
      setSaveStatus('saved');
      statusTimer.current = setTimeout(() => setSaveStatus(''), 2500);
    }
  };

  const saveBulkAttendance = async () => {
    if (lockedForMe) { setSaveStatus('error'); setSaveError('This term is locked — ask an admin to unlock it.'); return; }
    setSaveStatus('saving');
    setSaveError('');
    setSaveProgress({ done: 0, total: clsStudents.length });
    clearTimeout(statusTimer.current);
    const failed: string[] = [];
    const items: { student: string; attendance: { days: number; present: number } | null }[] = [];
    for (const s of clsStudents) {
      const att = bulkAtt[s.id] || { days: '', present: '' };
      const existing = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm));
      const days = parseInt(att.days) || 0;
      // No-op skip: blank attendance + none stored = nothing to write.
      if (days <= 0 && !existing?.attendance) continue;
      const present = parseInt(att.present) || 0;
      items.push({ student: String(s.id), attendance: days > 0 ? { days, present } : null });
    }
    let succeeded: string[] = [];
    try {
      // ONE request for the whole grid (not N per-student round trips).
      const res = await saveBulkResults(bulkTerm, items, sessionFilter);
      succeeded = res.saved || [];
      setSaveProgress({ done: clsStudents.length, total: clsStudents.length });
      const failedIds = new Set((res.failed || []).map((f: any) => String(f.student)));
      for (const s of clsStudents) {
        if (failedIds.has(String(s.id))) {
          failed.push(s.name);
          const err = (res.failed || []).find((f: any) => String(f.student) === String(s.id));
          console.error('Attendance save failed for', s.name, err?.error);
        }
      }
    } catch (e: any) {
      console.error('Bulk attendance save failed', e?.response?.data || e);
      for (const s of clsStudents) failed.push(s.name);
    }
    setHasUnsavedChanges(failed.length > 0);
    setAllResults((prev: any[]) => mergeSavedAttendance(prev, succeeded, bulkTerm, bulkAtt));
    if (failed.length === 0) buildBasis.current = '';
    await loadResults(cls.id);
    setSaveProgress(null);
    if (failed.length > 0) {
      setSaveStatus('error');
      setSaveError(`${failed.length} of ${clsStudents.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` +${failed.length - 3} more` : ''} — fix & retry`);
    } else {
      setSaveStatus('saved');
      statusTimer.current = setTimeout(() => setSaveStatus(''), 2500);
    }
  };

  const saveBulkComments = async () => {
    if (lockedForMe) { setSaveStatus('error'); setSaveError('This term is locked — ask an admin to unlock it.'); return; }
    setSaveStatus('saving');
    setSaveError('');
    setSaveProgress({ done: 0, total: clsStudents.length });
    clearTimeout(statusTimer.current);
    const failed: string[] = [];
    const items: { student: string; comment: string }[] = [];
    for (const s of clsStudents) {
      const existing = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm));
      // No-op skip: blank comment + none stored = nothing to write.
      if (!(bulkComment[s.id] || '') && !(existing?.comment || '')) continue;
      items.push({ student: String(s.id), comment: bulkComment[s.id] || '' });
    }
    let succeeded: string[] = [];
    try {
      // ONE request for the whole grid (not N per-student round trips).
      const res = await saveBulkResults(bulkTerm, items, sessionFilter);
      succeeded = res.saved || [];
      setSaveProgress({ done: clsStudents.length, total: clsStudents.length });
      const failedIds = new Set((res.failed || []).map((f: any) => String(f.student)));
      for (const s of clsStudents) {
        if (failedIds.has(String(s.id))) {
          failed.push(s.name);
          const err = (res.failed || []).find((f: any) => String(f.student) === String(s.id));
          console.error('Comment save failed for', s.name, err?.error);
        }
      }
    } catch (e: any) {
      console.error('Bulk comment save failed', e?.response?.data || e);
      for (const s of clsStudents) failed.push(s.name);
    }
    setHasUnsavedChanges(failed.length > 0);
    setAllResults((prev: any[]) => mergeSavedComments(prev, succeeded, bulkTerm, bulkComment));
    if (failed.length === 0) buildBasis.current = '';
    await loadResults(cls.id);
    setSaveProgress(null);
    if (failed.length > 0) {
      setSaveStatus('error');
      setSaveError(`${failed.length} of ${clsStudents.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` +${failed.length - 3} more` : ''} — fix & retry`);
    } else {
      setSaveStatus('saved');
      statusTimer.current = setTimeout(() => setSaveStatus(''), 2500);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]"><label className="text-xs text-school-muted mb-1 block">Class</label><ClassSelect value={cls?.id || ''} onChange={handleSelectClass} /></div>
        {academicYears.length > 0 && (
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-school-muted mb-1 block">Academic Year</label>
            <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white">
              {academicYears.map((y: any) => (
                <option key={y.id} value={y.name}>{y.name} {y.isActive ? '✓' : ''}</option>
              ))}
            </select>
          </div>
        )}
        {cls && (
          <>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-school-muted mb-1 block">Subject</label>
              <select value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white">
                <option value="">— Select —</option>
                {subjects.map((s: any) => <option key={s.id} value={s.name}>{s.name} (/{s.fullMarks})</option>)}
                <option value="__attendance__">📅 Attendance</option>
                <option value="__comment__">💬 Teacher's Comment</option>
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-school-muted mb-1 block">Term</label>
              <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white" disabled={bulkSubject === '__comment__'}>
                {['1', '2', '3'].map(t => <option key={t} value={t}>{TERM_NAMES[t]}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {!cls && <div className="text-center py-12 text-sm text-school-muted">Select a class to begin.</div>}
      {cls && !bulkSubject && <div className="text-center py-8 text-sm text-school-muted">Select a subject above to begin.</div>}
      {cls && bulkSubject && (
        <div className="space-y-3 animate-in fade-in duration-200">
          {isMarksMode && blankIds.length > 0 && (
            <div className="px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 bg-amber-50 border border-amber-300 text-amber-800">
              <span>{blankIds.length} of {clsStudents.length} blank — not entered yet</span>
              <button onClick={jumpToFirstBlank} className="px-3 py-1 bg-white border border-amber-300 rounded-lg hover:bg-amber-100">↓ First blank</button>
            </div>
          )}
          {isMarksMode && blankIds.length === 0 && clsStudents.length > 0 && (
            <div className="px-4 py-2 rounded-xl text-xs font-bold bg-green-50 border border-green-200 text-green-700">
              ✓ All {clsStudents.length} entered — press Save to store
            </div>
          )}
          {coworkerNote && (
            <div className="px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 text-blue-800">
              <span>👥 {coworkerNote}</span>
              <button onClick={() => setCoworkerNote('')} className="px-2 py-0.5 bg-white border border-blue-200 rounded-lg hover:bg-blue-100">Dismiss</button>
            </div>
          )}
          {lock && (
            <div className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 ${isAdmin ? 'bg-amber-50 border border-amber-300 text-amber-800' : 'bg-school-paper border border-school-border text-school-muted'}`}>
              <span>🔒 {TERM_NAMES[bulkTerm] || `Term ${bulkTerm}`} marks locked{lock.lockedBy ? ` by ${lock.lockedBy}` : ''} — {isAdmin ? 'your saves still work (admin).' : 'ask an admin to unlock for edits.'}</span>
              {isAdmin && <button onClick={async () => { await unlockResults(lock.id); }} className="px-3 py-1 bg-white border border-amber-300 rounded-lg hover:bg-amber-100">Unlock</button>}
            </div>
          )}
          {isAdmin && !lock && (
            <div className="flex justify-end">
              <button onClick={async () => { await lockResults(cls.id, sessionFilter, bulkTerm); }} className="px-3 py-1 border border-school-border rounded-lg text-xs font-bold text-school-muted hover:border-school-accent">🔒 Lock {TERM_NAMES[bulkTerm] || `Term ${bulkTerm}`} marks</button>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-school-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-school-primary text-white text-xs uppercase">
                  <th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Roll</th>
                  {isComment ? <th className="px-3 py-2 text-left">Teacher's Comment</th> : isAttendance ? <>
                    <th className="px-3 py-2 text-center">Total Days</th><th className="px-3 py-2 text-center">Present</th><th className="px-3 py-2 text-center">%</th>
                  </> : <>
                    <th className="px-3 py-2 text-center">Full</th><th className="px-3 py-2 text-center">Marks</th><th className="px-3 py-2 text-center">Grade</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {clsStudents.map((s: any, i: number) => {
                  if (isComment) {
                    return <tr key={s.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                      <td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2">{s.roll || '—'}</td>
                      <td className="px-3 py-2"><textarea value={bulkComment[s.id] || ''} onChange={(e) => { setHasUnsavedChanges(true); setBulkComment({ ...bulkComment, [s.id]: e.target.value }); }} rows={2} className="w-full px-2 py-1 border border-school-border rounded text-xs focus:outline-none focus:border-school-accent resize-none" placeholder="Write about performance…" /></td>
                    </tr>;
                  }
                  if (isAttendance) {
                    const att = bulkAtt[s.id] || { days: '', present: '' };
                    const pct = att.days && parseInt(att.days) > 0 ? ((parseInt(att.present) || 0) / parseInt(att.days) * 100).toFixed(1) + '%' : '—';
                    return <tr key={s.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                      <td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2">{s.roll || '—'}</td>
                      <td className="px-3 py-2 text-center"><input type="number" inputMode="numeric" min="0" value={att.days} onChange={(e) => { setHasUnsavedChanges(true); setBulkAtt({ ...bulkAtt, [s.id]: { ...att, days: e.target.value } }); }} className="w-16 px-2 py-1 border border-school-border rounded text-right text-xs focus:outline-none" /></td>
                      <td className="px-3 py-2 text-center"><input type="number" inputMode="numeric" min="0" value={att.present} onChange={(e) => { setHasUnsavedChanges(true); setBulkAtt({ ...bulkAtt, [s.id]: { ...att, present: e.target.value } }); }} className="w-16 px-2 py-1 border border-school-border rounded text-right text-xs focus:outline-none" /></td>
                      <td className="px-3 py-2 text-center text-xs font-bold">{pct}</td>
                    </tr>;
                  }
                  const v = bulkMarks[s.id] ?? '';
                  const g = v !== '' && !isNaN(+v) ? gradeFromMarks(+v, selectedSubj!.fullMarks) : null;
                  const isBlank = v === '';
                  const zebra = i % 2 ? 'bg-school-paper/30' : 'bg-white';
                  return <tr key={s.id} className={`border-t border-school-border/50 ${zebra}`}>
                    <td className="px-3 py-2">{i + 1}</td><td className={`px-3 py-2 font-medium sticky left-0 ${zebra}`}>{s.name}</td><td className="px-3 py-2">{s.roll || '—'}</td>
                    <td className="px-3 py-2 text-center">{selectedSubj!.fullMarks}</td>
                    <td className="px-3 py-2 text-center"><input ref={(el) => { inputRefs.current[String(s.id)] = el; }} type="number" inputMode="numeric" min="0" max={selectedSubj!.fullMarks} value={v} onChange={(e) => { setHasUnsavedChanges(true); setBulkMarks({ ...bulkMarks, [s.id]: e.target.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextStudent(String(s.id)); } }} className={`w-16 px-2 py-1 border rounded text-right text-xs focus:outline-none ${v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) > selectedSubj!.fullMarks ? 'border-red-500' : isBlank ? 'border-amber-400 bg-amber-50' : 'border-school-border'}`} /></td>
                    <td className="px-3 py-2 text-center">{g ? gradeChip(g.grade) : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {canSaveResults && !lockedForMe && <button onClick={isComment ? saveBulkComments : isAttendance ? saveBulkAttendance : saveBulkMarks} className="w-full py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">
            <Save size={14} /> Save {isComment ? 'All Comments' : isAttendance ? `${TERM_NAMES[bulkTerm]} Attendance` : 'All Marks'}
          </button>}
          <div className="flex items-center justify-center gap-2 min-h-[1.25rem]">
            {saveStatus === 'saving' && <span className="text-[11px] text-school-muted animate-pulse">Saving…{saveProgress ? ` ${saveProgress.done}/${saveProgress.total}` : ''}</span>}
            {saveStatus === 'saved' && <span className="text-[11px] text-green-600 font-bold flex items-center gap-1"><Save size={12} /> Saved ✓</span>}
            {saveStatus === 'error' && <span className="text-[11px] text-red-500 font-bold flex items-center gap-1"><Save size={12} /> {saveError || 'Saved with errors — check connection & retry'}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
