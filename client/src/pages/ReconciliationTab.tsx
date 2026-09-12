import { useState, useEffect } from 'react';
import { Scale, Plus, X, Download } from 'lucide-react';
import { toast } from '../components/Toast';
import { useAuthStore, api } from '../store';
import { ACCOUNT_IDS } from '../lib/accounts';

export default function ReconciliationTab() {
  const role = useAuthStore(s => s.user?.role);
  const isAdmin = role === 'admin';
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [account, setAccount] = useState(ACCOUNT_IDS[0]);
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
  const [closingBalance, setClosingBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = (record: any) => {
    setExporting(record.id);
    try {
      // Retrieve returns the flat ReconciliationSerializer — export from
      // its fields directly (no nested envelope exists).
      const diff = Number(record.difference || 0);
      const rows = [
        ['Account', (record.account || '').replace(/_/g, ' ')],
        ['Statement Date', new Date(record.statementDate).toLocaleDateString()],
        ['Closing Balance (Statement)', Number(record.closingBalance).toLocaleString()],
        ['System Balance', Number(record.systemBalance || 0).toLocaleString()],
        ['Difference', Number(record.difference || 0).toLocaleString()],
        ['Status', Math.abs(diff) < 0.01 ? 'Reconciled' : 'Difference'],
        ['Notes', record.notes || ''],
      ];
      const csv = rows.map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${record.account}-${new Date(record.statementDate).toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Exported ✓', 'success');
    } catch { toast('Export failed', 'error'); }
    finally { setExporting(null); }
  };

  const fetchRecords = async () => {
    try {
      const res = await api.get('/finance/reconciliations');
      setRecords(res.data.results || res.data.data || res.data);
    } catch { /* empty */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchRecords(); }, []);

  const handleSubmit = async () => {
    if (!account || !statementDate || !closingBalance) return;
    setSubmitting(true);
    try {
      await api.post('/finance/reconciliations/', {
        account, statementDate, closingBalance: Number(closingBalance), notes: notes || undefined,
      });
      toast('Reconciliation recorded', 'success');
      setShowForm(false);
      setClosingBalance('');
      setNotes('');
      fetchRecords();
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to record reconciliation', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-school-border overflow-hidden">
      <div className="px-5 py-4 border-b border-school-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-school-muted" />
          <h4 className="font-serif text-sm text-school-primary">Bank Reconciliation</h4>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-school-primary text-white hover:bg-school-primary/90 transition-all">
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'Record'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="px-5 py-4 border-b border-school-border bg-blue-50/50 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Account</label>
            <select value={account} onChange={e => setAccount(e.target.value as typeof account)} className="border border-school-border rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-school-accent">
              {ACCOUNT_IDS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Statement Date</label>
            <input type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} className="border border-school-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-school-accent" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Closing Balance</label>
            <input type="number" step="0.01" value={closingBalance} onChange={e => setClosingBalance(e.target.value)} className="border border-school-border rounded-lg px-3 py-1.5 text-xs w-40 focus:outline-none focus:border-school-accent" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="border border-school-border rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:border-school-accent" />
          </div>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all">
            {submitting ? 'Saving...' : 'Record Reconciliation'}
          </button>
        </div>
      )}

      <div className="divide-y divide-school-border">
        {loading ? (
          <div className="px-5 py-8 text-center text-xs text-school-muted">Loading...</div>
        ) : records.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-school-muted">No reconciliations recorded</div>
        ) : records.map(r => {
          const diff = Number(r.difference || 0);
          const reconciled = Math.abs(diff) < 0.01;
          return (
          <div key={r.id} className="px-5 py-3 flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-school-primary">{r.account.replace(/_/g, ' ')}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${reconciled ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {reconciled ? 'Reconciled' : 'Difference'}
                </span>
              </div>
              <div className="flex gap-4 mt-1">
                <span className="text-xs text-school-muted">Statement: <strong>{Number(r.closingBalance).toLocaleString()} ৳</strong></span>
                <span className="text-xs text-school-muted">System: <strong>{Number(r.systemBalance || 0).toLocaleString()} ৳</strong></span>
                <span className={`text-xs font-bold ${reconciled ? 'text-emerald-600' : 'text-red-600'}`}>
                  Diff: {diff >= 0 ? '+' : ''}{diff.toLocaleString()} ৳
                </span>
              </div>
              {r.notes && <p className="text-xs text-school-muted mt-0.5">{r.notes}</p>}
              <p className="text-[10px] text-school-muted mt-0.5">{new Date(r.statementDate).toLocaleDateString()} &middot; Recorded: {new Date(r.createdAt).toLocaleDateString()}</p>
            </div>
            <button onClick={() => handleExport(r)} disabled={exporting === r.id}
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-school-paper text-school-muted hover:bg-school-accent/10 hover:text-school-accent border border-school-border transition-all disabled:opacity-50">
              <Download size={12} /> {exporting === r.id ? '...' : 'Export'}
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
