import { useState, useEffect, useMemo } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { toast } from '../../components/Toast';
import ClassSelect from '../../components/ClassSelect';
import { gradeFromMarks, gradeChip } from '../../lib/grading';
import { Save } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

export default function EnterBySubject() {
  const { students, fetchStudents, subjects, fetchSubjects, saveStudentResult, academicYears, fetchAcademicYears, classResults, fetchClassResults } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const canSaveResults = role === 'admin' || role === 'teacher';
  const [cls, setCls] = useState<any>(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [bulkSubject, setBulkSubject] = useState('');
  const [termFilter, setTermFilter] = useState('1');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [bulkMarks, setBulkMarks] = useState<Record<string, string>>({});
  const [bulkAtt, setBulkAtt] = useState<Record<string, { days: string; present: string }>>({});
  const [bulkComment, setBulkComment] = useState<Record<string, string>>({});
  const bulkTerm = termFilter;

  const loadResults = async (clsId: string) => {
    const key = `${clsId}-${sessionFilter}`;
    if (classResults[key]) { setAllResults(classResults[key]); return; }
    await fetchClassResults(clsId, sessionFilter);
    setAllResults(useSchoolStore.getState().classResults[key] || []);
  };

  useEffect(() => {
    fetchAcademicYears().then(() => {
      const academicYears = useSchoolStore.getState().academicYears;
      const active = academicYears.find((y: any) => y.isActive);
      setSessionFilter(active ? active.name : (academicYears.length > 0 ? academicYears[0].name : ''));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cls) loadResults(cls.id); }, [sessionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const handleSelectClass = (c: any) => { setCls(c); setBulkSubject(''); fetchSubjects(c.id); if (sessionFilter) loadResults(c.id); fetchStudents({ className: c.name }, true); };

  const clsStudents = useMemo(() => cls ? students.filter((s: any) => s.class === cls.name).sort((a: any, b: any) => (+a.roll || 999) - (+b.roll || 999) || a.name.localeCompare(b.name)) : [], [students, cls]);
  const selectedSubj = subjects.find((s: any) => s.name === bulkSubject);
  const isAttendance = bulkSubject === '__attendance__';
  const isComment = bulkSubject === '__comment__';

  useEffect(() => {
    if (!bulkSubject || !cls || allResults.length === 0) return;
    
    const canonicalSubject = SUBJECT_KEY_MAP[bulkSubject] || bulkSubject;
    
    if (isAttendance) {
      const atts: Record<string, { days: string; present: string }> = {};
      clsStudents.forEach((s: any) => { 
        const r = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm));
        atts[s.id] = { days: String(r?.attendance?.days || ''), present: String(r?.attendance?.present || '') }; 
      });
      setBulkAtt(atts);
    } else if (isComment) {
      const cmts: Record<string, string> = {};
      clsStudents.forEach((s: any) => { 
        const r = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm)); 
        cmts[s.id] = r?.comment || ''; 
      });
      setBulkComment(cmts);
    } else {
      const m: Record<string, string> = {};
      clsStudents.forEach((s: any) => { 
        const r = allResults.find((x: any) => String(x.studentId) === String(s.id) && String(x.term) === String(bulkTerm)); 
        m[s.id] = r?.marks?.[canonicalSubject] !== undefined ? String(r.marks[canonicalSubject]) : ''; 
      });
      setBulkMarks(m);
    }
  }, [bulkSubject, bulkTerm, allResults, clsStudents]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBulkMarks = async () => {
    if (!selectedSubj) return;
    toast('Saving…');
    const canonicalSubject = SUBJECT_KEY_MAP[bulkSubject] || bulkSubject;
    for (const s of clsStudents) {
      const v = bulkMarks[s.id];
      const marksData: Record<string, number> = {};
      const existing = allResults.find((x: any) => x.studentId === s.id && x.term === bulkTerm);
      if (existing?.marks) Object.entries(existing.marks).forEach(([k, val]) => { marksData[k] = +(val as number); });
      if (v !== '' && v !== undefined && !isNaN(+v)) marksData[canonicalSubject] = Math.min(+v, selectedSubj.fullMarks);
      else delete marksData[canonicalSubject];
      await saveStudentResult(s.id, bulkTerm, marksData, existing?.attendance || undefined, undefined, sessionFilter);
    }
    setHasUnsavedChanges(false);
    toast(`Marks saved for ${clsStudents.length} students ✓`, 'success');
    loadResults(cls.id);
  };

  const saveBulkAttendance = async () => {
    toast('Saving…');
    for (const s of clsStudents) {
      const att = bulkAtt[s.id] || { days: '', present: '' };
      const existing = allResults.find((x: any) => x.studentId === s.id && x.term === bulkTerm);
      const days = parseInt(att.days) || 0;
      const present = parseInt(att.present) || 0;
      const attendanceData = days > 0 ? { days, present } : undefined;
      await saveStudentResult(s.id, bulkTerm, existing?.marks || {}, attendanceData, undefined, sessionFilter);
    }
    setHasUnsavedChanges(false);
    toast(`Attendance saved ✓`, 'success');
    loadResults(cls.id);
  };

  const saveBulkComments = async () => {
    toast('Saving…');
    for (const s of clsStudents) {
      const existing = allResults.find((x: any) => x.studentId === s.id && x.term === bulkTerm);
      await saveStudentResult(s.id, bulkTerm, existing?.marks || {}, existing?.attendance || undefined, bulkComment[s.id] || '', sessionFilter);
    }
    setHasUnsavedChanges(false);
    toast(`Comments saved ✓`, 'success');
    loadResults(cls.id);
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
                      <td className="px-3 py-2 text-center"><input type="number" min="0" value={att.days} onChange={(e) => { setHasUnsavedChanges(true); setBulkAtt({ ...bulkAtt, [s.id]: { ...att, days: e.target.value } }); }} className="w-16 px-2 py-1 border border-school-border rounded text-right text-xs focus:outline-none" /></td>
                      <td className="px-3 py-2 text-center"><input type="number" min="0" value={att.present} onChange={(e) => { setHasUnsavedChanges(true); setBulkAtt({ ...bulkAtt, [s.id]: { ...att, present: e.target.value } }); }} className="w-16 px-2 py-1 border border-school-border rounded text-right text-xs focus:outline-none" /></td>
                      <td className="px-3 py-2 text-center text-xs font-bold">{pct}</td>
                    </tr>;
                  }
                  const v = bulkMarks[s.id] ?? '';
                  const g = v !== '' && !isNaN(+v) ? gradeFromMarks(+v, selectedSubj!.fullMarks) : null;
                  return <tr key={s.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                    <td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2">{s.roll || '—'}</td>
                    <td className="px-3 py-2 text-center">{selectedSubj!.fullMarks}</td>
                    <td className="px-3 py-2 text-center"><input type="number" min="0" max={selectedSubj!.fullMarks} value={v} onChange={(e) => { setHasUnsavedChanges(true); setBulkMarks({ ...bulkMarks, [s.id]: e.target.value }); }} className={`w-16 px-2 py-1 border rounded text-right text-xs focus:outline-none ${v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) > selectedSubj!.fullMarks ? 'border-red-500' : 'border-school-border'}`} /></td>
                    <td className="px-3 py-2 text-center">{g ? gradeChip(g.grade) : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {canSaveResults && <button onClick={isComment ? saveBulkComments : isAttendance ? saveBulkAttendance : saveBulkMarks} className="w-full py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">
            <Save size={14} /> Save {isComment ? 'All Comments' : isAttendance ? `${TERM_NAMES[bulkTerm]} Attendance` : 'All Marks'}
          </button>}
        </div>
      )}
    </div>
  );
}
