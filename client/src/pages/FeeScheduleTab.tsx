import { useState, useEffect } from 'react';
import { useSchoolStore, api } from '../store';
import { Plus, Save, Trash2, BookOpen, ChevronDown, ChevronRight, Pencil, Copy } from 'lucide-react';
import { toast } from '../components/Toast';
const FREQUENCIES = ['MONTHLY', 'YEARLY', 'ONE_TIME'];
const APPLICABILITIES = ['AUTO', 'ASSIGNED_ONLY'];

const FeeScheduleTab = () => {
  const { classes, feeSchedules: schedules, academicYears: years, fetchClasses, fetchFeeSchedules } = useSchoolStore();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ classId: '', category: '', amount: '', frequency: 'MONTHLY', applicability: 'AUTO' });

  const activeYear = years.find((y: any) => y.isActive);
  const previousYear = years
    .filter((y: any) => !y.isActive)
    .sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

  const activeSchedules = schedules.filter((s: any) => s.academicYearId === activeYear?.id);
  const previousYearSchedules = previousYear
    ? schedules.filter((s: any) => s.academicYearId === previousYear.id)
    : [];

  useEffect(() => { Promise.all([fetchClasses(), fetchFeeSchedules()]).then(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEdit = (s: any) => {
    setEditingId(s.id);
    setForm({
      classId: s.classId || '',
      category: s.category,
      amount: String(s.amount),
      frequency: s.frequency,
      applicability: s.applicability,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.category || !form.amount) { toast('Category and amount required', 'error'); return; }
    if (!activeYear) { toast('No active academic year. Create one in Session Year first.', 'error'); return; }
    try {
      const payload = {
        classId: form.classId || null,
        category: form.category,
        amount: Number(form.amount),
        frequency: form.frequency,
        applicability: form.applicability,
      };

      const store = useSchoolStore.getState();

      if (editingId) {
        const res = await api.patch(`/finance/fee-schedules/${editingId}/`, payload);
        toast('Fee schedule updated', 'success');
        useSchoolStore.setState({ feeSchedules: store.feeSchedules.map(s => s.id === editingId ? res.data : s) });
      } else {
        const res = await api.post('/finance/fee-schedules/', { ...payload, academicYearId: activeYear.id });
        toast('Fee schedule created', 'success');
        useSchoolStore.setState({ feeSchedules: [...store.feeSchedules, res.data] });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ classId: '', category: '', amount: '', frequency: 'MONTHLY', applicability: 'AUTO' });
    } catch (e: any) {
      if (import.meta.env.DEV) console.error('[FeeScheduleTab] Save error:', e.response?.data || e);
      const msg = e?.response?.data ? Object.values(e.response.data).flat().join(', ') : (editingId ? 'Failed to update' : 'Failed to create');
      toast(msg, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/finance/fee-schedules/${id}/`);
      toast('Fee schedule deleted', 'success');
      useSchoolStore.setState({ feeSchedules: useSchoolStore.getState().feeSchedules.filter(s => s.id !== id) });
    } catch { toast('Failed to delete', 'error'); }
  };

  const handleCopyFromPreviousYear = async () => {
    if (!activeYear || !previousYear) return;
    try {
      const res = await api.post('/finance/fee-schedules/copy-from-year/', {
        sourceAcademicYearId: previousYear.id,
        targetAcademicYearId: activeYear.id,
      });
      toast(`${res.data.copied} schedules copied from ${previousYear.name} to ${activeYear.name}${res.data.skipped ? ` (${res.data.skipped} skipped)` : ''}`, 'success');
      fetchFeeSchedules();
    } catch { toast('Failed to copy schedules', 'error'); }
  };

  const grouped = schedules.reduce((acc: Record<string, any[]>, s: any) => {
    const key = s.classRel?.name || 'All Classes';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {} as Record<string, any[]>);

  const groupOrder = Object.keys(grouped).sort((a, b) => a === 'All Classes' ? -1 : b === 'All Classes' ? 1 : a.localeCompare(b));

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (groupOrder.length) {
      setOpenGroups(prev => {
        const next = { ...prev };
        groupOrder.forEach(k => { if (!(k in next)) next[k] = false; });
        return next;
      });
    }
  }, [groupOrder.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-sm text-school-primary flex items-center gap-2"><BookOpen size={16} /> Fee Schedules</h3>
          {activeYear && (
            <span className="text-[10px] bg-school-primary/10 text-school-primary px-2 py-0.5 rounded font-bold">
              {activeYear.name}
            </span>
          )}
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ classId: '', category: '', amount: '', frequency: 'MONTHLY', applicability: 'AUTO' }); }} className="flex items-center gap-1.5 px-3 py-2 bg-school-primary text-white rounded-xl text-xs font-bold">
          <Plus size={14} /> {showForm ? 'Cancel' : 'Add Schedule'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-school-border p-4 space-y-3">
          {!activeYear && (
            <p className="text-xs text-rose-600 font-bold">Create an academic year first in Dashboard → Session Year</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted block mb-1">Category</label>
              <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Tuition Fee" className="w-full border border-school-border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted block mb-1">Class (optional)</label>
              <select value={form.classId} onChange={e => setForm({ ...form, classId: e.target.value })} className="w-full border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">All Classes</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted block mb-1">Amount (৳)</label>
              <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border border-school-border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted block mb-1">Frequency</label>
              <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="w-full border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted block mb-1">Applicability</label>
              <select value={form.applicability} onChange={e => setForm({ ...form, applicability: e.target.value })} className="w-full border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                {APPLICABILITIES.map(a => <option key={a} value={a}>{a === 'AUTO' ? 'Auto (all students)' : 'Assigned Only (per student)'}</option>)}
              </select>
            </div>
          </div>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold">
            <Save size={14} /> {editingId ? 'Update Schedule' : 'Create Schedule'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-school-muted">Loading...</div>
      ) : activeYear && activeSchedules.length === 0 && previousYear && previousYearSchedules.length > 0 ? (
        <div className="bg-white rounded-xl border border-amber-200 p-6 text-center space-y-3">
          <p className="text-sm text-school-muted">
            No schedules for <span className="font-bold text-school-primary">{activeYear.name}</span> yet.
            <br />
            <span className="text-[11px]">{previousYear.name} has {previousYearSchedules.length} schedule{previousYearSchedules.length > 1 ? 's' : ''}.</span>
          </p>
          <button onClick={handleCopyFromPreviousYear} className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors">
            <Copy size={14} /> Copy from {previousYear.name}
          </button>
          <p className="text-[10px] text-school-muted">You can edit amounts after copying</p>
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white rounded-xl border border-school-border p-8 text-center text-school-muted text-sm">
          No fee schedules defined. Add one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {groupOrder.map(key => {
            const items = grouped[key];
            const isOpen = openGroups[key] ?? false;
            return (
              <div key={key} className="bg-white rounded-xl border border-school-border overflow-hidden">
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-school-paper hover:bg-gray-100 transition-colors text-left"
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${key}`}
                >
                  {isOpen ? <ChevronDown size={16} className="text-school-muted" /> : <ChevronRight size={16} className="text-school-muted" />}
                  <span className="font-bold text-sm text-school-primary">{key}</span>
                  <span className="text-[10px] text-school-muted ml-auto">{items.length} schedule{items.length > 1 ? 's' : ''}</span>
                </button>
                {isOpen && (
                  <table className="w-full text-sm mobile-card-table">
                    <thead><tr className="bg-school-primary text-white text-[10px] uppercase">
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Frequency</th>
                      <th className="px-3 py-2 text-left">Applicability</th>
                      <th className="px-3 py-2 text-left">Year</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {items.map((s: any) => (
                        <tr key={s.id} className="border-t border-school-border/50">
                          <td className="px-3 py-2 font-medium">{s.category}</td>
                          <td className="px-3 py-2 text-right font-bold">{Number(s.amount).toLocaleString()} /-</td>
                          <td className="px-3 py-2 text-[10px] uppercase">{s.frequency}</td>
                          <td className="px-3 py-2 text-[10px]">
                            <span className={`px-2 py-0.5 rounded font-bold ${s.applicability === 'AUTO' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                              {s.applicability === 'AUTO' ? 'Auto' : 'Assigned'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">{s.academicYear?.name || '-'}</td>
                          <td className="px-3 py-2 text-right flex gap-1 justify-end">
                            <button onClick={() => handleEdit(s)} className="text-blue-600 hover:text-blue-800 p-1" title="Edit" aria-label="Edit schedule">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDelete(s.id)} className="text-rose-600 hover:text-rose-800 p-1" title="Delete" aria-label="Delete schedule">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FeeScheduleTab;
