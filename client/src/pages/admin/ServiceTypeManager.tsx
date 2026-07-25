import { useState, useEffect } from 'react';
import { useSchoolStore, api } from '../../store';
import { toast } from '../../components/Toast';
import { Plus, Pencil, Trash2, AlertTriangle, Settings } from 'lucide-react';

export default function ServiceTypeManager() {
  const { serviceTypes, fetchServiceTypes } = useSchoolStore();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [defaultAmount, setDefaultAmount] = useState('');
  const [frequency, setFrequency] = useState('MONTHLY');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchServiceTypes(true).then(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
