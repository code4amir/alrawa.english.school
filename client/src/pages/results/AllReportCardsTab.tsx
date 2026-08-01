import { useState, useEffect } from 'react';
import { useSchoolStore } from '../../store';
import { toast } from '../../components/Toast';
import ClassSelect from '../../components/ClassSelect';
import { downloadReportCardPDF } from '../../lib/reportPdf';
import { FileSpreadsheet, PenLine, Award } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';

let _jsPDF: any = null;
async function loadJsPDF() {
  if (!_jsPDF) { _jsPDF = (await import('jspdf')).default; }
  return _jsPDF;
}

export default function AllReportCardsTab() {
  const { students, fetchStudents, subjects, fetchSubjects, academicYears, fetchAcademicYears, classResults, fetchClassResults } = useSchoolStore();
  const [cls, setCls] = useState<any>(null);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [sessionFilter, setSessionFilter] = useState('');

  const loadResults = async (clsId: string) => {
    const key = `${clsId}-${sessionFilter}`;
    if (classResults[key]) { setAllResults(classResults[key]); return; }
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

  const handleSelectClass = (c: any) => { setCls(c); fetchSubjects(c.id); fetchStudents({ className: c.name }, true); loadResults(c.id); };
  const clsStudents = cls ? students.filter((s: any) => s.class === cls.name).sort((a: any, b: any) => (+a.roll || 999) - (+b.roll || 999) || a.name.localeCompare(b.name)) : [];

  const downloadAll = async (term: string) => {
    if (!clsStudents.length) { toast('No students', 'error'); return; }
    toast(`Generating ${clsStudents.length} report cards…`, 'info');
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ format: 'a4', unit: 'mm' });
    for (const s of clsStudents) { await downloadReportCardPDF(s, cls.name, subjects, allResults, term, doc); }
    const isFinal = term === 'final';
    const label = isFinal ? 'Annual' : TERM_NAMES[term];
    doc.save(`${cls.name.replace(/\s+/g, '_')}_${label}_All_Reports.pdf`);
    toast('All report cards downloaded ✓', 'success');
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
      {!cls && <div className="text-center py-12 text-sm text-school-muted">Select a class to download report cards.</div>}
      {cls && (
        <div className="bg-white rounded-2xl border border-school-border p-6 space-y-4">
          <h4 className="font-serif text-lg text-school-primary flex items-center gap-1.5"><FileSpreadsheet size={16} /> Download All Report Cards</h4>
          <p className="text-sm text-school-muted">Generate report cards for all {clsStudents.length} students in {cls.name}:</p>
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => downloadAll('1')} className="px-4 py-2 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center gap-1.5"><PenLine size={14} /> 1st Term</button>
            <button onClick={() => downloadAll('2')} className="px-4 py-2 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center gap-1.5"><PenLine size={14} /> 2nd Term</button>
            <button onClick={() => downloadAll('3')} className="px-4 py-2 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center gap-1.5"><PenLine size={14} /> 3rd Term</button>
            <button onClick={() => downloadAll('final')} className="px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center gap-1.5"><Award size={14} /> Annual Result</button>
          </div>
        </div>
      )}
    </div>
  );
}
