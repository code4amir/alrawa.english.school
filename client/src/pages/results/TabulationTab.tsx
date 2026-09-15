import { useState, useEffect } from 'react';
import { useSchoolStore } from '../../store';
import ClassSelect from '../../components/ClassSelect';
import { ClipboardList, Download } from 'lucide-react';
import { TERM_NAMES } from '../../lib/config';


export default function TabulationTab() {

  const { fetchStudents, fetchSubjects, academicYears, fetchAcademicYears, classResults, fetchClassResults } = useSchoolStore();
  const [cls, setCls] = useState<any>(null);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [sessionFilter, setSessionFilter] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadResults = async (clsId: string) => {
    const key = `${clsId}-${sessionFilter}`;
    const invalidated = useSchoolStore.getState()._fetchedAt[`classResults_${key}`] === 0;
    if (classResults[key] && !invalidated) { 
        setAllResults(classResults[key]); 
        return; 
    }
    await fetchClassResults(clsId, sessionFilter);
    const data = useSchoolStore.getState().classResults[key];
    setAllResults(data || []);
  };

  useEffect(() => {
    fetchAcademicYears().then(() => {
      const active = useSchoolStore.getState().academicYears.find((y: any) => y.isActive);
      setSessionFilter(active ? active.name : String(new Date().getFullYear()));
    }).catch(() => setSessionFilter(String(new Date().getFullYear())));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cls) loadResults(cls.id); }, [sessionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClass = (c: any) => { if (!c) { setCls(null); setAllResults([]); return; } setCls(c); fetchSubjects(c.id); fetchStudents({ className: c.name }, true); loadResults(c.id); };

  // The download buttons used to build the PDF from whatever happened to be
  // in state — clicking right after selecting a class produced a sheet with
  // missing students/subjects/marks while the three fetches were still in
  // flight. Now the click awaits all three (dedupedFetch joins an in-flight
  // load instead of refetching) and builds from the fresh store snapshot.
  const handleDownload = async (term: string) => {
    if (!cls || downloading) return;
    setDownloading(term);
    try {
      let session = sessionFilter;
      if (!session) {
        await fetchAcademicYears();
        const ys = useSchoolStore.getState().academicYears;
        session = ys.find((y: any) => y.isActive)?.name || ys[0]?.name || '';
        if (session) setSessionFilter(session);
      }
      await Promise.all([
        fetchSubjects(cls.id),
        fetchStudents({ className: cls.name }, true),
        ...(session ? [fetchClassResults(cls.id, session)] : []),
      ]);
      const st = useSchoolStore.getState();
      const results = (session && st.classResults[`${cls.id}-${session}`]) || allResults;
      setAllResults(results);
      const list = st.students.filter((s: any) => s.class === cls.name).sort((a: any, b: any) => (+a.roll || 999) - (+b.roll || 999) || a.name.localeCompare(b.name));
      const { tabulationPDF } = await import('../../lib/tabulationPdf');
      tabulationPDF({ clsName: cls.name, subjects: st.subjects, clsStudents: list, allResults: results, term });
    } finally {
      setDownloading(null);
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
      </div>
      {!cls && <div className="text-center py-12 text-sm text-school-muted">Select a class to download tabulation sheets.</div>}
      {cls && (
        <div className="bg-white rounded-2xl border border-school-border p-6 space-y-4">
          <h4 className="font-serif text-lg text-school-primary flex items-center gap-1.5"><ClipboardList size={16} /> Tabulation Sheet</h4>
          <p className="text-sm text-school-muted">Download a marks grid for {cls.name}. "Final Combined" only available after Term 3 is entered.</p>
          <div className="flex gap-3 flex-wrap">
            {['1', '2', '3'].map(t => (
              <button key={t} disabled={downloading !== null} onClick={() => handleDownload(t)} className="px-4 py-2 border border-school-border rounded-xl text-sm font-bold hover:border-school-accent transition-all flex items-center gap-1.5 disabled:opacity-50"><Download size={14} /> {downloading === t ? 'Preparing…' : TERM_NAMES[t]}</button>
            ))}
            <button disabled={downloading !== null} onClick={() => handleDownload('final')} className="px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"><Download size={14} /> {downloading === 'final' ? 'Preparing…' : 'Final Combined'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
