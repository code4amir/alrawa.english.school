import { useState, useEffect } from 'react';
import { useSchoolStore, api } from '../../store';
import { toast } from '../../components/Toast';
import { Plus, Pencil, Trash2, AlertTriangle, Settings, Users, Power } from 'lucide-react';

export default function ServiceTypeManager() {
  const { serviceTypes, fetchServiceTypes } = useSchoolStore();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [defaultAmount, setDefaultAmount] = useState('');
  const [frequency, setFrequency] = useState('MONTHLY');
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<any[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [bulkServiceId, setBulkServiceId] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState<string | null>(null);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const res = await api.get('/students/service_summary/');
      setSummary(res.data || []);
    } catch { /* keep last */ }
    setSummaryLoading(false);
  };

  useEffect(() => {
    fetchServiceTypes(true).then(() => setLoading(false));
    loadSummary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bulkServiceId && serviceTypes.length > 0) {
      const first = serviceTypes.find((s: any) => s.active) || serviceTypes[0];
      if (first) setBulkServiceId(first.id);
    }
  }, [serviceTypes, bulkServiceId]);

  const handleBulk = async (cls: any, active: boolean) => {
    if (!bulkServiceId) { toast('Select a service first', 'error'); return; }
    const label = active ? 'Enable' : 'Disable';
    if (!confirm(`${label} "${serviceTypes.find((s: any) => s.id === bulkServiceId)?.name}" for ALL ${cls.total} students in ${cls.className}?`)) return;
    const key = `${cls.classId}_${active}`;
    setBulkSubmitting(key);
    try {
      const res = await api.post('/students/bulk_toggle_service/', {
        service_type_id: bulkServiceId,
        class_id: cls.classId,
        active,
      });
      const d = res.data || {};
      toast(`${label}d ${d.ok}/${d.total} students ✓`, d.errors ? 'info' : 'success');
      loadSummary();
      fetchServiceTypes(true);
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Bulk update failed', 'error');
    }
    setBulkSubmitting(null);
  };

  const resetForm = () => {
    setName('');
    setDefaultAmount('');
    setFrequency('MONTHLY');
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (st: any) => {
    setName(st.name);
    setDefaultAmount(String(st.defaultAmount));
    setFrequency(st.frequency);
    setEditId(st.id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast('Enter a service name', 'error'); return; }
    if (!defaultAmount || parseFloat(defaultAmount) < 0) { toast('Enter a valid amount', 'error'); return; }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        defaultAmount: parseFloat(defaultAmount),
        frequency,
      };
      if (editId) {
        await api.put(`/service-types/${editId}/`, payload);
        toast('Service updated ✓', 'success');
      } else {
        await api.post('/service-types/', payload);
        toast('Service created ✓', 'success');
      }
      resetForm();
      fetchServiceTypes(true);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.detail || 'Failed to save service';
      toast(msg, 'error');
    }
    setSubmitting(false);
  };

  const handleToggleActive = async (st: any) => {
    try {
      await api.patch(`/service-types/${st.id}/`, { active: !st.active });
      toast(st.active ? 'Service deactivated' : 'Service activated', 'success');
      fetchServiceTypes(true);
    } catch (e: any) {
      toast('Failed to update', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this service type? Fee schedules will remain in Finance.')) return;
    try {
      await api.delete(`/service-types/${id}/`);
      toast('Service deleted', 'success');
      fetchServiceTypes(true);
    } catch (e: any) {
      toast('Failed to delete', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-2">
          <Settings size={20} className="text-school-accent" />
          <h2 className="text-sm font-bold text-school-primary">Manage Services</h2>
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-12 bg-school-paper rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={20} className="text-school-accent" />
          <h2 className="text-sm font-bold text-school-primary dark:text-[#e0e0e8]">Manage Services</h2>
          <span className="text-[10px] bg-school-primary/10 text-school-primary px-2 py-0.5 rounded font-bold">
            {serviceTypes.length}
          </span>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-school-primary text-white rounded-xl text-xs font-bold hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> {showForm ? 'Cancel' : 'New Service'}
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-4 space-y-3">
          <h4 className="font-bold text-xs text-school-primary dark:text-[#e0e0e8]">
            {editId ? 'Edit Service' : 'Create New Service'}
          </h4>
          <p className="text-[11px] text-school-muted">
            This will auto-create a FeeSchedule in Finance for all active academic years.
          </p>
          <div>
            <label className="text-xs font-bold text-school-muted mb-1 block">Service Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Transport, Hifz"
              className="w-full border border-school-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-school-muted mb-1 block">Monthly Fee (৳)</label>
              <input type="number" value={defaultAmount} onChange={e => setDefaultAmount(e.target.value)}
                placeholder="500" min="0" step="0.01"
                className="w-full border border-school-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent" />
            </div>
            <div>
              <label className="text-xs font-bold text-school-muted mb-1 block">Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}
                className="w-full border border-school-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-[#1a1a2e] outline-none focus:ring-2 focus:ring-school-accent">
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONE_TIME">One Time</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={submitting || !name || !defaultAmount}
              className="flex items-center gap-1.5 px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity">
              {editId ? 'Update Service' : 'Create Service'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 border border-school-border rounded-xl text-sm hover:bg-school-paper">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Service List */}
      {serviceTypes.length === 0 ? (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-8 text-center">
          <Settings size={40} className="mx-auto mb-2 text-school-muted" />
          <p className="text-sm text-school-muted">No services defined yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-school-paper/50 text-[10px] uppercase tracking-widest text-school-muted font-bold">
                <tr>
                  <th className="px-4 py-3 text-left">Service</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Frequency</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-school-border/50">
                {serviceTypes.map((st: any) => (
                  <tr key={st.id} className="hover:bg-school-paper/30 transition-colors">
                    <td className="px-4 py-3 font-semibold text-xs">{st.name}</td>
                    <td className="px-4 py-3 text-xs">৳{st.defaultAmount}</td>
                    <td className="px-4 py-3 text-xs capitalize">{st.frequency?.toLowerCase()}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleActive(st)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                          st.active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>
                        {st.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleEdit(st)}
                          className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><Pencil size={12} /></button>
                        <button onClick={() => handleDelete(st.id)}
                          className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Class Enrollment — bulk activate per class */}
      {serviceTypes.length > 0 && (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-school-accent" />
              <h3 className="text-xs font-bold uppercase text-school-muted">Class Enrollment</h3>
              {summaryLoading && <div className="w-3.5 h-3.5 border-2 border-school-primary/20 border-t-school-primary rounded-full animate-spin" />}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-school-muted">Service</label>
              <select value={bulkServiceId} onChange={(e) => setBulkServiceId(e.target.value)}
                className="border border-school-border rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-[#1a1a2e] outline-none focus:ring-2 focus:ring-school-accent">
                {serviceTypes.map((st: any) => (
                  <option key={st.id} value={st.id}>{st.name}{st.active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </div>
          </div>
          {summary.length === 0 ? (
            <div className="px-4 pb-4 text-center text-xs text-school-muted py-4">
              {summaryLoading ? 'Loading enrollment…' : 'No classes with students yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-school-paper/50 text-[10px] uppercase tracking-widest text-school-muted font-bold">
                  <tr>
                    <th className="px-4 py-2 text-left">Class</th>
                    <th className="px-4 py-2 text-center">Students</th>
                    <th className="px-4 py-2 text-center">Enrolled</th>
                    <th className="px-4 py-2 text-right">Bulk Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-school-border/50">
                  {summary.map((row: any) => {
                    const enrolled = row.services?.[bulkServiceId] || 0;
                    const pct = row.total > 0 ? Math.round((enrolled / row.total) * 100) : 0;
                    return (
                      <tr key={row.classId} className="hover:bg-school-paper/30 transition-colors">
                        <td className="px-4 py-2.5 font-semibold text-xs">{row.className}</td>
                        <td className="px-4 py-2.5 text-center text-xs">{row.total}</td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="text-xs font-bold">{enrolled}/{row.total}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${pct === 100 ? 'bg-emerald-50 text-emerald-700' : pct > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleBulk(row, true)}
                              disabled={bulkSubmitting === `${row.classId}_true`}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                            >
                              <Power size={11} /> Enable all
                            </button>
                            <button
                              onClick={() => handleBulk(row, false)}
                              disabled={bulkSubmitting === `${row.classId}_false`}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 text-gray-500 border border-gray-200 rounded-lg text-[10px] font-bold hover:bg-gray-100 disabled:opacity-50 transition-colors"
                            >
                              Disable all
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-800">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          When a service is toggled ON for a student, a <strong>StudentFeeAssignment</strong> is auto-created in Finance.
          Student handlers can manage service enrollment from the student cards.
        </span>
      </div>
    </div>
  );
}
