import { useState, useEffect, useRef, useMemo } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { toast } from '../../components/Toast';
import ClassSelect from '../../components/ClassSelect';
import { gradeFromMarks, gradeChip, gpaToGrade, calcTermSummary, calcTermRanks } from '../../lib/grading';
import OnlineReportCard from './OnlineReportCard';
import { FileText, Save, CalendarDays, MessageSquare, PenLine, Award, User } from 'lucide-react';
import { API_URL, TERM_NAMES } from '../../lib/config';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

export default function EnterByStudent() {
  const { students, fetchStudents, subjects, fetchSubjects, saveStudentResult, academicYears, fetchAcademicYears, classResults, fetchClassResults } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const canSaveResults = role === 'admin' || role === 'teacher' || role === 'monitor';
  const [cls, setCls] = useState<any>(null);
  const [activeStudent, setActiveStudent] = useState<any>(null);
  const [activeTerm, setActiveTerm] = useState('1');
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [attendance, setAttendance] = useState({ days: '', present: '' });
  const [comment, setComment] = useState('');
  const [allResults, setAllResults] = useState<any[]>([]);
  const [reportTerm, setReportTerm] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | ''>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [sessionFilter, setSessionFilter] = useState('');
  const saveTimer = useRef<any>(null);
  const statusTimer = useRef<any>(null);
  const marksRef = useRef(marks);
  const attendanceRef = useRef(attendance);
  const commentRef = useRef(comment);
  const sessionRef = useRef(sessionFilter);

  useEffect(() => { marksRef.current = marks; }, [marks]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);
  useEffect(() => { commentRef.current = comment; }, [comment]);
  useEffect(() => { sessionRef.current = sessionFilter; }, [sessionFilter]);
  useEffect(() => { return () => { clearTimeout(saveTimer.current); }; }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const loadResults = async (clsId: string) => {
    const key = `${clsId}-${sessionFilter}`;
    // Skip the cache only when it hasn't been invalidated: saveStudentResult
    // zeroes _fetchedAt for classResults keys after a save, so a plain truthy
    // check here used to serve STALE marks until a full page reload.
    const invalidated = useSchoolStore.getState()._fetchedAt[`classResults_${key}`] === 0;
    if (classResults[key] && !invalidated) { setAllResults(classResults[key]); return; }
    await fetchClassResults(clsId, sessionFilter);
    setAllResults(useSchoolStore.getState().classResults[key] || []);
  };

  useEffect(() => {
    fetchAcademicYears().then(() => {
      const active = useSchoolStore.getState().academicYears.find((y: any) => y.isActive);
      setSessionFilter(active ? active.name : String(new Date().getFullYear()));
    }).catch(() => setSessionFilter(String(new Date().getFullYear())));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cls) loadResults(cls.id); }, [sessionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClass = (c: any) => { setCls(c); setActiveStudent(null); setActiveTerm('1'); fetchSubjects(c.id); fetchStudents({ className: c.name }, true); if (sessionFilter) loadResults(c.id); };

  const clsStudents = useMemo(() => cls ? students.filter((s: any) => s.class === cls.name).sort((a: any, b: any) => (+a.roll || 999) - (+b.roll || 999) || a.name.localeCompare(b.name)) : [], [students, cls]);

  const result = activeStudent ? allResults.find((r: any) => r.studentId === activeStudent.id && r.term === activeTerm) : null;

  useEffect(() => {
    if (!activeStudent) return;
    if (result?.marks) { const m: Record<string, string> = {}; Object.entries(result.marks).forEach(([k, v]) => { m[k] = String(v); }); setMarks(m); } else { setMarks({}); }
    if (result?.attendance) { setAttendance({ days: String(result.attendance.days || ''), present: String(result.attendance.present || '') }); } else { setAttendance({ days: '', present: '' }); }
    setComment(result?.comment || '');
  }, [activeStudent, activeTerm, allResults.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranks = useMemo(() => activeStudent ? calcTermRanks(clsStudents, activeTerm, subjects, allResults) : {}, [activeStudent, clsStudents, activeTerm, subjects, allResults]);
  const myRank = activeStudent ? (ranks[activeStudent.id] || '—') : '—';

  const { totalObt, totalFull, termGPA, termGrade, attendPct, gpas } = useMemo(() => {
    let tObt = 0, tFull = 0, hasF = false; const gpaArr: number[] = [];
    subjects.forEach((sub: any) => { 
      const canonical = SUBJECT_KEY_MAP[sub.name] || sub.name;
      const v = marks[sub.name] !== undefined ? marks[sub.name] : marks[canonical];
      if (v !== '' && v !== undefined && !isNaN(+v)) { const g = gradeFromMarks(+v, sub.fullMarks); gpaArr.push(g.gpa); if (g.grade === 'F') hasF = true; tObt += +v; tFull += sub.fullMarks; } 
    });
    const tGPA = gpaArr.length ? gpaArr.reduce((a, b) => a + b, 0) / gpaArr.length : null;
    const tGrade = hasF ? 'F' : tGPA !== null ? gpaToGrade(tGPA) : '—';
    const attPct = attendance.days && parseInt(attendance.days) > 0 ? ((parseInt(attendance.present) / parseInt(attendance.days)) * 100).toFixed(1) + '%' : '—';
    return { totalObt: tObt, totalFull: tFull, termGPA: tGPA, termGrade: tGrade, attendPct: attPct, gpas: gpaArr };
  }, [marks, subjects, attendance]);

  const save = async () => {
    setSaveStatus('saving'); clearTimeout(statusTimer.current);
    const m = marksRef.current;
    const marksData: Record<string, number> = {};
    subjects.forEach((sub: any) => { const v = m[sub.name]; if (v !== '' && v !== undefined && !isNaN(+v)) marksData[sub.name] = Math.min(+v, sub.fullMarks); });
    const days = parseInt(attendanceRef.current.days) || 0;
    const present = parseInt(attendanceRef.current.present) || 0;
    const attendanceData = days > 0 ? { days, present } : undefined;
    await saveStudentResult(activeStudent.id, activeTerm, marksData, attendanceData, commentRef.current, sessionRef.current);
    setHasUnsavedChanges(false);
    setSaveStatus('saved'); statusTimer.current = setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleMarksChange = (subjName: string, value: string, fullMarks: number) => {
    setHasUnsavedChanges(true);
    if (!isNaN(parseFloat(value)) && parseFloat(value) > fullMarks) toast(`Max marks is ${fullMarks}`, 'error');
    const next = { ...marks, [subjName]: value };
    setMarks(next);
    marksRef.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { save().catch((e) => { console.error('Auto-save failed', e?.response?.data || e); toast('Auto-save failed — press Save to retry', 'error'); setSaveStatus(''); }); }, 500);
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
      </div>

      {!cls && <div className="text-center py-12 text-sm text-school-muted">Select a class to begin.</div>}
      {cls && !activeStudent && (
        <div className="space-y-3">
          <p className="text-sm text-school-muted">Select a student:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clsStudents.map((s: any) => {
              const tc = calcTermSummary(s.id, activeTerm, subjects, allResults);
              return (
                <button key={s.id} onClick={() => { setActiveStudent(s); }} className="bg-white p-4 rounded-2xl border border-school-border hover:shadow-md transition-shadow text-left">
                  <div className="flex items-center gap-3">
                    {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-school-border" /> : s.hasPhoto ? <img src={`${API_URL}/students/${s.id}/photo/`} alt="" className="w-10 h-10 rounded-full object-cover border border-school-border" /> : <div className="w-10 h-10 rounded-full bg-school-primary text-white flex items-center justify-center text-sm"><User size={24} className="text-white" /></div>}
                    <div>
                      <div className="font-bold text-sm text-school-primary">{s.name}</div>
                      <div className="text-[11px] text-school-muted">{s.roll ? `Roll: ${s.roll}` : cls.name}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2">{tc ? gradeChip(tc.grade) : <span className="text-[10px] text-school-muted">No marks</span>}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {cls && activeStudent && !reportTerm && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveStudent(null)} className="text-sm text-school-accent hover:underline">← Students</button>
            {activeStudent.photoUrl ? <img src={activeStudent.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-school-border" /> : activeStudent.hasPhoto ? <img src={`${API_URL}/students/${activeStudent.id}/photo/`} alt="" className="w-10 h-10 rounded-full object-cover border border-school-border" /> : <div className="w-10 h-10 rounded-full bg-school-primary text-white flex items-center justify-center text-sm"><User size={24} className="text-white" /></div>}
            <div className="flex-1">
              <div className="font-bold text-sm text-school-primary">{activeStudent.name}</div>
              <div className="text-[11px] text-school-muted">{cls.name}{activeStudent.roll ? ` · Roll: ${activeStudent.roll}` : ''}</div>
            </div>
            <button onClick={() => setReportTerm('pick')} className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:opacity-90 flex items-center gap-1.5"><FileText size={14} /> Report Card</button>
          </div>
          <div className="flex gap-2 items-center">
            {['1', '2', '3'].map(t => <button key={t} onClick={() => setActiveTerm(t)} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTerm === t ? 'bg-school-primary text-white shadow-lg' : 'bg-white border border-school-border hover:border-school-accent'}`}>{TERM_NAMES[t]}</button>)}
            {saveStatus === 'saving' && <span className="text-[10px] text-school-muted animate-pulse">Saving...</span>}
            {saveStatus === 'saved' && <span className="text-[10px] text-green-600 font-bold">✓ Saved</span>}
          </div>
          <div className="bg-white rounded-2xl border border-school-border p-4">
            <h4 className="font-serif text-sm text-school-primary mb-3">{TERM_NAMES[activeTerm]}</h4>
            {subjects.length === 0 ? <div className="text-center py-8 text-school-muted"><p className="text-sm">No subjects set up.</p></div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-school-muted text-xs uppercase border-b border-school-border">
                    <th className="text-left pb-2">Subject</th><th className="text-right pb-2">Full</th><th className="text-right pb-2">Marks</th><th className="text-center pb-2">Grade</th><th className="text-right pb-2">GPA</th>
                  </tr></thead>
                  <tbody>
                    {subjects.map((sub: any) => {
                      const canonical = SUBJECT_KEY_MAP[sub.name] || sub.name;
                      const v = marks[sub.name] !== undefined ? marks[sub.name] : marks[canonical];
                      const g = v !== '' && v !== undefined && !isNaN(+v) ? gradeFromMarks(+v, sub.fullMarks) : null;
                      return <tr key={sub.id} className="border-b border-school-border/50">
                        <td className="py-2 font-medium">{sub.name}</td><td className="py-2 text-right">{sub.fullMarks}</td>
                        <td className="py-2 text-right"><input type="number" min="0" max={sub.fullMarks} value={v || ''} onChange={(e) => handleMarksChange(sub.name, e.target.value, sub.fullMarks)} placeholder="—" className={`w-16 px-2 py-1 border rounded text-right text-sm focus:outline-none focus:border-school-accent ${v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) > sub.fullMarks ? 'border-red-500' : 'border-school-border'}`} /></td>
                        <td className="py-2 text-center">{g ? gradeChip(g.grade) : '—'}</td>
                        <td className="py-2 text-right">{g ? g.gpa.toFixed(2) : '—'}</td>
                      </tr>;
                    })}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-school-primary font-bold">
                    <td className="py-2 text-xs uppercase">Total</td><td className="py-2 text-right">{totalFull || '—'}</td><td className="py-2 text-right">{gpas.length ? totalObt : '—'}</td>
                    <td className="py-2 text-center">{gradeChip(termGrade)}</td><td className="py-2 text-right">{termGPA !== null ? termGPA.toFixed(2) : '—'}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
            {subjects.length > 0 && <div className="flex gap-3 mt-4 flex-wrap">
              <div className="bg-school-paper px-3 py-2 rounded-xl text-center"><div className="text-[10px] text-school-muted uppercase">Total</div><div className="font-bold text-sm">{gpas.length ? `${totalObt}/${totalFull}` : '—'}</div></div>
              <div className="bg-school-paper px-3 py-2 rounded-xl text-center"><div className="text-[10px] text-school-muted uppercase">GPA</div><div className="font-bold text-sm">{termGPA !== null ? termGPA.toFixed(2) : '—'}</div></div>
              <div className="bg-school-paper px-3 py-2 rounded-xl text-center"><div className="text-[10px] text-school-muted uppercase">Grade</div><div className="font-bold text-sm">{termGrade}</div></div>
              <div className="bg-school-paper px-3 py-2 rounded-xl text-center"><div className="text-[10px] text-school-muted uppercase">Rank</div><div className="font-bold text-sm">{myRank}</div></div>
            </div>}
            {canSaveResults && <button onClick={async () => { try { await save(); loadResults(cls.id); toast('Saved ✓', 'success'); } catch { toast('Save failed', 'error'); } }} className="w-full mt-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5"><Save size={14} /> Save Marks</button>}
          </div>
          <div className="bg-white rounded-2xl border border-school-border p-4">
            <h4 className="font-bold text-sm mb-3 flex items-center gap-1.5"><CalendarDays size={16} /> Attendance</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-school-muted mb-1 block">Total Days</label><input type="number" min="0" value={attendance.days} onChange={(e) => { setAttendance({ ...attendance, days: e.target.value }); setHasUnsavedChanges(true); }} placeholder="200" className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent" /></div>
              <div><label className="text-xs text-school-muted mb-1 block">Days Present</label><input type="number" min="0" value={attendance.present} onChange={(e) => { setAttendance({ ...attendance, present: e.target.value }); setHasUnsavedChanges(true); }} placeholder="185" className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent" /></div>
              <div><label className="text-xs text-school-muted mb-1 block">Attendance</label><div className="px-3 py-2 bg-school-paper rounded-xl text-sm font-bold text-center">{attendPct}</div></div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-school-border p-4">
            <h4 className="font-bold text-sm mb-3 flex items-center gap-1.5"><MessageSquare size={16} /> Teacher's Comment</h4>
            <textarea value={comment} onChange={(e) => { setHasUnsavedChanges(true); setComment(e.target.value); commentRef.current = e.target.value; clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { save().catch((err) => { console.error('Auto-save failed', err?.response?.data || err); toast('Auto-save failed — press Save to retry', 'error'); setSaveStatus(''); }); }, 500); }} rows={3} placeholder="Write about the student's performance…" className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent resize-none" />
          </div>
        </div>
      )}
      {cls && activeStudent && reportTerm === 'pick' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setReportTerm(null)} className="text-sm text-school-accent hover:underline">← Back</button>
          </div>
          <div className="bg-white rounded-2xl border border-school-border p-6 text-center space-y-4">
            <div className="font-serif text-lg text-school-primary">{activeStudent.name}</div>
            <p className="text-sm text-school-muted">Which term report card?</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={() => setReportTerm('1')} className="min-w-[130px] px-6 py-3 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center justify-center gap-1.5"><PenLine size={14} /> 1st Term</button>
              <button onClick={() => setReportTerm('2')} className="min-w-[130px] px-6 py-3 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center justify-center gap-1.5"><PenLine size={14} /> 2nd Term</button>
              <button onClick={() => setReportTerm('3')} className="min-w-[130px] px-6 py-3 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center justify-center gap-1.5"><PenLine size={14} /> 3rd Term</button>
              <button onClick={() => setReportTerm('final')} className="min-w-[130px] px-6 py-3 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all flex items-center justify-center gap-1.5"><Award size={14} /> Annual Result</button>
            </div>
          </div>
        </div>
      )}
      {cls && activeStudent && reportTerm && reportTerm !== 'pick' && (
        <OnlineReportCard student={activeStudent} cls={cls} subjects={subjects} allResults={allResults} term={reportTerm} onBack={() => setReportTerm('pick')} />
      )}
    </div>
  );
}
