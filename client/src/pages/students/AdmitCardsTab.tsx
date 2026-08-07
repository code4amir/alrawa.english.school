import { useState, useEffect } from 'react';
import { useSchoolStore, api } from '../../store';
import { toast } from '../../components/Toast';
import ClassSelect from '../../components/ClassSelect';
import { downloadAdmitCardsPDF } from '../../lib/admitCardPdf';
import { CreditCard, Download, RefreshCw } from 'lucide-react';

export default function AdmitCardsTab() {
  const { fetchClasses, fetchStudents, academicYears, fetchAcademicYears, settings, fetchSettings } = useSchoolStore();
  const [cls, setCls] = useState<any>(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [termFilter, setTermFilter] = useState('1');
  const [admitData, setAdmitData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchClasses();
    fetchAcademicYears().then(() => {
      const active = useSchoolStore.getState().academicYears.find((y: any) => y.isActive);
      setSessionFilter(active ? active.name : String(new Date().getFullYear()));
    });
    fetchSettings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClass = (c: any) => {
    setCls(c);
    fetchStudents({ className: c.name }, true);
  };

  const loadAdmitCards = async () => {
    if (!cls) return;
    setLoading(true);
    try {
      const res = await api.get(`/classes/${cls.id}/admit-cards/`, {
        params: { term: termFilter, session: sessionFilter },
      });
      setAdmitData(res.data);
      toast(`Loaded ${res.data.students?.length || 0} students`, 'success');
    } catch (e: any) {
      toast(e.response?.data?.detail || e.message || 'Failed to load admit card data', 'error');
      setAdmitData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cls && sessionFilter) {
      loadAdmitCards();
    }
  }, [cls, sessionFilter, termFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadAll = async () => {
    if (!admitData || !admitData.students?.length) {
      toast('No students to generate admit cards for', 'error');
      return;
    }
    toast('Generating admit cards PDF…', 'info');
    await downloadAdmitCardsPDF({
      className: admitData.className,
      session: admitData.session,
      term: admitData.term,
      termLabel: admitData.termLabel,
      examType: admitData.examType,
      subjects: admitData.subjects,
      students: admitData.students,
      settings,
      coordinatorSignatureNote: admitData.coordinatorSignatureNote,
    });
    toast('Admit cards downloaded ✓', 'success');
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-school-muted mb-1 block">Class</label>
          <ClassSelect value={cls?.id || ''} onChange={handleSelectClass} />
        </div>
        {academicYears.length > 0 && (
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-school-muted mb-1 block">Academic Year</label>
            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white"
            >
              {academicYears.map((y: any) => (
                <option key={y.id} value={y.name}>
                  {y.name} {y.isActive ? '✓' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[140px]">
          <label className="text-xs text-school-muted mb-1 block">Term</label>
          <select
            value={termFilter}
            onChange={(e) => setTermFilter(e.target.value)}
            className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white"
          >
            <option value="1">1st Term</option>
            <option value="2">2nd Term</option>
            <option value="3">3rd Term</option>
          </select>
        </div>
      </div>

      {!cls && (
        <div className="text-center py-12 text-sm text-school-muted">
          Select a class to begin generating admit cards.
        </div>
      )}

      {cls && (
        <div className="bg-white rounded-2xl border border-school-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-serif text-lg text-school-primary flex items-center gap-1.5">
              <CreditCard size={16} /> Admit Cards — {cls.name}
            </h4>
            <button
              onClick={loadAdmitCards}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-school-muted">Loading admit card data…</div>
          ) : admitData && (
            <>
              <p className="text-sm text-school-muted">
                {admitData.students.length} student{admitData.students.length !== 1 ? 's' : ''} found in {cls.name} for {admitData.termLabel}.
              </p>
              {admitData.subjects && admitData.subjects.length > 0 && (
                <div className="text-xs text-school-muted">
                  Subjects: {admitData.subjects.map((s: any) => `${s.name} (${s.fullMarks})`).join(', ')}
                </div>
              )}
              <button
                onClick={handleDownloadAll}
                disabled={!admitData.students.length}
                className="w-full sm:w-auto px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5"
              >
                <Download size={14} /> Download All Admit Cards (PDF)
              </button>
              <p className="text-[10px] text-school-muted">4 admit cards per A4 page. Co-ordinator signature line included on each card.</p>
            </>
          )}

          {!admitData && cls && (
            <div className="text-center py-6 text-sm text-school-muted">
              Select a year and term, then click Download.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
