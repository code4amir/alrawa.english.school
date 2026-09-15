import { useState, useEffect } from 'react';
import { Lock, Unlock, Plus, X } from 'lucide-react';
import { toast } from '../components/Toast';
import { useAuthStore, api } from '../store';

const CURRENT_YEAR = new Date().getFullYear();

export default function PeriodCloseTab() {
  const role = useAuthStore(s => s.user?.role);
  const isAdmin = role === 'admin';
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [fiscalYear, setFiscalYear] = useState(CURRENT_YEAR);
  const [notes, setNotes] = useState('');

  const fetchPeriods = async () => {
    try {
      const res = await api.get('/finance/period-closes');
      setPeriods(res.data.results || res.data.data || res.data);
    } catch { toast('Failed to load closed periods', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPeriods(); }, []);

  const handleClose = async () => {
    if (!fiscalYear) return;
    setClosing(true);
    try {
      await api.post('/finance/period-closes/', { fiscalYear, notes });
      toast(`Fiscal year ${fiscalYear} closed`, 'success');
      setShowForm(false);
      setNotes('');
      fetchPeriods();
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to close period', 'error');
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async (year: number) => {
    try {
      await api.delete(`/finance/period-closes/${year}/`);
      toast(`Fiscal year ${year} reopened`, 'success');
      fetchPeriods();
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to reopen', 'error');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-school-border overflow-hidden">
      <div className="px-5 py-4 border-b border-school-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-school-muted" />
          <h4 className="font-serif text-sm text-school-primary">Period Close</h4>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-school-primary text-white hover:bg-school-primary/90 transition-all">
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'Close Period'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="px-5 py-4 border-b border-school-border bg-school-paper/50 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Fiscal Year</label>
            <input type="number" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))} className="border border-school-border rounded-lg px-3 py-1.5 text-xs w-32 bg-white dark:bg-gray-800 focus:outline-none focus:border-school-accent" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="border border-school-border rounded-lg px-3 py-1.5 text-xs w-full bg-white dark:bg-gray-800 focus:outline-none focus:border-school-accent" />
          </div>
          <button onClick={handleClose} disabled={closing} className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-all">
            {closing ? 'Closing...' : `Close FY ${fiscalYear}`}
          </button>
        </div>
      )}

      <div className="divide-y divide-school-border">
        {loading ? (
          <div className="px-5 py-6 space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-100 rounded w-24 animate-pulse" />
                  <div className="h-3 bg-gray-50 rounded w-40 animate-pulse" />
                </div>
                <div className="h-8 bg-gray-100 rounded w-20 animate-pulse" />
              </div>
            ))}
          </div>
        ) : periods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
              <Lock size={20} className="text-gray-300" />
            </div>
            <p className="text-sm text-school-muted">No closed periods</p>
            <p className="text-[10px] text-school-muted mt-1">Closed fiscal years will appear here</p>
          </div>
        ) : periods.map(p => (
          <div key={p.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-school-primary">FY {p.fiscalYear}</span>
              {p.notes && <p className="text-xs text-school-muted mt-0.5">{p.notes}</p>}
              <p className="text-[10px] text-school-muted mt-0.5">Closed: {new Date(p.closedAt).toLocaleString()}</p>
            </div>
            {isAdmin && (
              <button onClick={() => handleReopen(p.fiscalYear)} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold border border-school-border text-school-muted hover:text-emerald-600 hover:border-emerald-300 transition-all">
                <Unlock size={12} /> Reopen
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
