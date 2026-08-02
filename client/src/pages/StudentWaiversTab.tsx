import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSchoolStore, api } from '../store';
import { X, Shield, Search } from 'lucide-react';
import { toast } from '../components/Toast';
import type { FeeWaiver, SchoolClass } from '../lib/types';

const StudentWaiversTab = () => {
  const { classes, students, feeSchedules: schedules, fetchClasses, fetchStudents, fetchFeeSchedules } = useSchoolStore();
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [waivers, setWaivers] = useState<FeeWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<FeeWaiver[]>([]);
  const [activeWaivers, setActiveWaivers] = useState<FeeWaiver[]>([]);
  const [activeLoading, setActiveLoading] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [waiverSearch, setWaiverSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editExpected, setEditExpected] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editApprovedBy, setEditApprovedBy] = useState('');

  useEffect(() => { fetchClasses(); fetchFeeSchedules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedClass) fetchStudents({ class_name: selectedClass }); }, [selectedClass]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadActiveWaivers = useCallback(async () => {
    setActiveLoading(true);
    try {
      const res = await api.get('/finance/fee-waivers/', { params: { active: 'true' } });
      setActiveWaivers(res.data.results || res.data.data || res.data);
    } catch { /* silent */ }
    finally { setActiveLoading(false); }
  }, []);

  useEffect(() => { loadActiveWaivers(); }, [loadActiveWaivers]);

  const loadData = useCallback(async () => {
    if (!selectedStudent) return;
    setSelectedScheduleId('');
    setExpectedAmount('');
    setReason('');
    setApprovedBy('');
    setLoading(true);
    const fetchWaiverData = async () => {
      const [waiverRes, historyRes] = await Promise.all([
        api.get('/finance/fee-waivers/', { params: { studentId: selectedStudent } }),
        api.get('/finance/fee-waivers/', { params: { studentId: selectedStudent, active: 'false' } }),
      ]);
      setWaivers(waiverRes.data.results || waiverRes.data.data || waiverRes.data);
      setHistory(historyRes.data.results || historyRes.data.data || historyRes.data);
    };
    try {
      await fetchWaiverData();
    } catch {
      // One automatic retry: the first attempt often times out when the
      // Alwaysdata backend is cold-starting after idle; the retry succeeds.
      try {
        await fetchWaiverData();
      } catch {
        toast('Failed to load data', 'error');
      }
    } finally { setLoading(false); }
  }, [selectedStudent]);

  useEffect(() => { loadData(); }, [loadData]); // eslint-disable-line react-hooks/exhaustive-deps

  const classStudents = students.filter((s: any) => !selectedClass || s.class === selectedClass);
  const filteredStudents = useMemo(() => {
    if (!studentSearch) return classStudents;
    const q = studentSearch.toLowerCase();
    return classStudents.filter((s: any) => (s.name || '').toLowerCase().includes(q) || (s.roll && String(s.roll).includes(q)));
  }, [classStudents, studentSearch]);
  const filteredActiveWaivers = useMemo(() => {
    if (!waiverSearch) return activeWaivers;
    const q = waiverSearch.toLowerCase();
    return activeWaivers.filter((w) => (w.studentName || '').toLowerCase().includes(q));
  }, [activeWaivers, waiverSearch]);
  const getWaiver = (feeScheduleId: string) => waivers.find(w => w.feeSchedule === feeScheduleId);

  const handleScheduleChange = (id: string) => {
    setSelectedScheduleId(id);
    const existing = getWaiver(id);
    setExpectedAmount(existing ? String(existing.value) : '');
    setReason(existing?.reason || '');
    setApprovedBy(existing?.approvedBy || '');
  };

  const saveWaiver = async () => {
    if (!selectedScheduleId || !expectedAmount) { toast('Select a fee category and enter expected amount', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/finance/fee-waivers/', {
        student: selectedStudent, feeSchedule: selectedScheduleId, value: Number(expectedAmount), reason, approvedBy,
      });
      toast('Waiver saved', 'success');
      await loadData();
      await loadActiveWaivers();
    } catch (e: any) { toast(e?.response?.data?.error || 'Failed to save waiver', 'error'); }
    finally { setSaving(false); }
  };

  const deactivateWaiver = async (waiverId: string) => {
    try {
      await api.post(`/finance/fee-waivers/${waiverId}/deactivate/`, {});
      toast('Waiver removed', 'success');
      await loadData();
      await loadActiveWaivers();
    } catch { toast('Failed to remove', 'error'); }
  };

  const editWaiver = (w: FeeWaiver) => {
    setEditingId(w.id);
    setEditExpected(String(w.value));
    setEditReason(w.reason || '');
    setEditApprovedBy(w.approvedBy || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditExpected('');
    setEditReason('');
    setEditApprovedBy('');
  };

  const saveInline = async (w: FeeWaiver) => {
    if (!editExpected) { toast('Enter expected amount', 'error'); return; }
    try {
      await api.post(`/finance/fee-waivers/${w.id}/deactivate/`, {});
      await api.post('/finance/fee-waivers/', {
        student: w.student, feeSchedule: w.feeSchedule, value: Number(editExpected), reason: editReason || w.reason, approvedBy: editApprovedBy || w.approvedBy,
      });
      toast('Waiver updated', 'success');
      setEditingId(null);
      setEditExpected('');
      setEditReason('');
      setEditApprovedBy('');
      loadActiveWaivers();
    } catch { toast('Failed to update', 'error'); }
  };

  const manageRef = useRef<HTMLDivElement>(null);

  const activeSchedules = schedules.filter((s: any) => {
    if (!selectedClass) return true;
    return !s.classId || s.classRel?.name === selectedClass;
  });

  const selectedSched = activeSchedules.find(s => s.id === selectedScheduleId);
  const existingWaiver = getWaiver(selectedScheduleId);
  const baseAmt = selectedSched ? Number(selectedSched.amount) : 0;
  const expectedVal = Number(expectedAmount) || 0;
  const waiverAmt = Math.max(0, baseAmt - expectedVal);

  return (
    <div className="space-y-6">
      {/* ── Active Waivers List ── */}
      <div className="bg-white rounded-xl border border-school-border overflow-hidden">
        <div className="px-5 py-4 border-b border-school-border flex items-center gap-2">
          <Shield size={16} className="text-emerald-600" />
          <h3 className="font-bold text-sm text-school-primary">Active Waivers</h3>
          <span className="text-[10px] text-school-muted">({filteredActiveWaivers.length} waivers)</span>
        </div>
        {activeLoading ? (
          <div className="px-5 py-8 text-center text-sm text-school-muted">Loading...</div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-school-border">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-school-muted pointer-events-none" />
                <input type="text" value={waiverSearch} onChange={e => setWaiverSearch(e.target.value)}
                  placeholder="Search by student name..."
                  className="w-full border border-school-border rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-school-accent" />
              </div>
            </div>
            {filteredActiveWaivers.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-school-muted italic">{waiverSearch ? 'No waivers match search.' : 'No active waivers.'}</div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm mobile-card-table">
                <thead className="bg-school-paper/50 text-[10px] uppercase tracking-widest text-school-muted font-bold">
                  <tr>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Fee</th>
                    <th className="px-4 py-3 text-right">Full Fee</th>
                    <th className="px-4 py-3 text-right">Student Pays</th>
                    <th className="px-4 py-3 text-right">Waived Amount</th>
                    <th className="px-4 py-3 text-left">Reason</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-school-border/50">
                  {filteredActiveWaivers.map((w) => {
                  const fullFee = Number(w.feeScheduleAmount || 0);
                  const expected = Number(w.value);
                  const waiverVal = Math.max(0, fullFee - expected);
                  const isEditing = editingId === w.id;
                  return (
                    <tr key={w.id} className={`hover:bg-school-paper/30 transition-colors ${isEditing ? 'bg-blue-50/50' : ''}`}>
                      <td data-label="Student" className="px-4 py-2.5 font-bold text-xs">{w.studentName}</td>
                      <td data-label="Fee" className="px-4 py-2.5 text-xs">{w.feeCategory}</td>
                      <td data-label="Full Fee" className="px-4 py-2.5 text-right font-mono text-xs">{fullFee.toLocaleString()}</td>
                      <td data-label="Student Pays" className="px-4 py-2.5 text-right font-mono text-xs font-bold text-emerald-600">
                        {isEditing ? (
                          <input type="number" min="0" value={editExpected} autoFocus
                            onChange={e => setEditExpected(e.target.value)}
                            className="w-24 text-right border border-blue-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
                            onKeyDown={e => { if (e.key === 'Enter') saveInline(w); if (e.key === 'Escape') cancelEdit(); }} />
                        ) : expected.toLocaleString()}
                      </td>
                      <td data-label="Waived Amount" className="px-4 py-2.5 text-right font-mono text-xs text-rose-500">{waiverVal.toLocaleString()}</td>
                      <td data-label="Reason" className="px-4 py-2.5 text-xs text-school-muted">
                        {isEditing ? (
                          <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)}
                            className="w-full border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" placeholder="Reason" />
                        ) : (w.reason || '—')}
                      </td>
                      <td data-label="Actions" className="px-4 py-2.5 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => saveInline(w)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                              Save
                            </button>
                            <button onClick={cancelEdit}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => editWaiver(w)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-700 hover:bg-blue-200">
                              Edit
                            </button>
                            <button onClick={() => deactivateWaiver(w.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">
                              <X size={12} /> Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                  })}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </div>

      {/* ── Per-Student Waiver Form ── */}
      <div ref={manageRef} className="bg-white rounded-xl border border-school-border overflow-hidden">
        <div className="px-5 py-4 border-b border-school-border">
          <h3 className="font-bold text-sm text-school-primary">Manage Student Waivers</h3>
        </div>
        <div className="px-5 py-3 border-b border-school-border flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Class</label>
            <select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSelectedStudent(''); setStudentSearch(''); }}
              className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
              <option value="">— All —</option>
              {[...classes].sort((a: SchoolClass, b: SchoolClass) => (a.order ?? 0) - (b.order ?? 0)).map((c: SchoolClass) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Student</label>
            <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
              className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white min-w-[180px]">
              <option value="">— Select Student —</option>
              {filteredStudents.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.roll ? ` (Roll ${s.roll})` : ''}</option>)}
            </select>
          </div>
          {selectedClass && (
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-school-muted pointer-events-none" />
                <input type="text" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                  placeholder="Type student name..."
                  className="border border-school-border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-school-accent min-w-[180px]" />
              </div>
            </div>
          )}
          {selectedStudent && (
            <div className="flex items-end pb-2">
              <span className="text-xs text-school-muted">
                {classStudents.find((s: any) => s.id === selectedStudent)?.name}
                {' — '}
                {classStudents.find((s: any) => s.id === selectedStudent)?.class}
                {classStudents.find((s: any) => s.id === selectedStudent)?.roll ? `, Roll ${classStudents.find((s: any) => s.id === selectedStudent)?.roll}` : ''}
              </span>
            </div>
          )}
        </div>

        {!selectedStudent ? (
          <div className="px-5 py-8 text-center text-sm text-school-muted italic">Select a student to manage their waivers.</div>
        ) : loading ? (
          <div className="px-5 py-8 text-center text-sm text-school-muted">Loading...</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Fee Category</label>
              <select value={selectedScheduleId} onChange={e => handleScheduleChange(e.target.value)}
                className="w-full border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">— Select Fee Category —</option>
                {activeSchedules.map((sched: any) => (
                  <option key={sched.id} value={sched.id}>{sched.category} — {Number(sched.amount).toLocaleString()} ({sched.frequency}){sched.classRel?.name ? ` — ${sched.classRel.name}` : ''}</option>
                ))}
              </select>
            </div>

            {selectedScheduleId && selectedSched && (
              <div className="bg-school-paper/30 rounded-xl border border-school-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-sm">{selectedSched.category}</span>
                    <span className="ml-2 text-xs text-school-muted">Full fee: {baseAmt.toLocaleString()}</span>
                  </div>
                  {existingWaiver?.active && (
                    <button onClick={() => deactivateWaiver(existingWaiver.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">
                      <X size={12} /> Remove Waiver
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Student Pays</label>
                    <input type="number" min="0" value={expectedAmount} onChange={e => setExpectedAmount(e.target.value)}
                      placeholder="e.g. 500" className="w-full border border-school-border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Reason</label>
                    <input type="text" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Reason for waiver" className="w-full border border-school-border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Approved By</label>
                    <input type="text" value={approvedBy} onChange={e => setApprovedBy(e.target.value)}
                      placeholder="Approver name" className="w-full border border-school-border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="flex items-end pb-2">
                    {expectedVal > 0 && (
                      <div className="text-sm space-y-0.5">
                        <p>Full fee: <span className="font-mono">{baseAmt.toLocaleString()}</span></p>
                        <p>Student Pays: <span className="font-mono text-emerald-600 font-bold">{expectedVal.toLocaleString()}</span></p>
                        <p>Waived Amount: <span className="font-mono text-rose-500">{waiverAmt.toLocaleString()}</span></p>
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={saveWaiver} disabled={saving || !expectedAmount}
                  className="w-full py-2 rounded-xl text-sm font-bold bg-school-primary text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving...' : existingWaiver?.active ? 'Update Waiver' : 'Apply Waiver'}
                </button>
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="px-5 py-4 border-t border-school-border">
            <h3 className="text-sm font-bold text-school-muted mb-2">Inactive Waiver History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-school-border text-left">
                    <th className="pb-2 font-bold text-[10px] uppercase text-school-muted">Category</th>
                    <th className="pb-2 font-bold text-[10px] uppercase text-school-muted">Student Pays</th>
                    <th className="pb-2 font-bold text-[10px] uppercase text-school-muted">Reason</th>
                    <th className="pb-2 font-bold text-[10px] uppercase text-school-muted">Approved By</th>
                    <th className="pb-2 font-bold text-[10px] uppercase text-school-muted">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((w) => (
                    <tr key={w.id} className="border-b border-school-border/50 text-school-muted">
                      <td className="py-2 pr-3">{w.feeCategory}</td>
                      <td className="py-2 pr-3 font-mono">{Number(w.value).toLocaleString()}</td>
                      <td className="py-2 pr-3">{w.reason || '—'}</td>
                      <td className="py-2 pr-3">{w.approvedBy || '—'}</td>
                      <td className="py-2 pr-3">{new Date(w.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentWaiversTab;
