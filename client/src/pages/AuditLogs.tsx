import { useEffect, useState } from 'react';
import { api } from '../store';
import Layout from '../components/Layout';
import { ClipboardList } from 'lucide-react';
import Skeleton from '../components/Skeleton';
import Modal from '../components/Modal';
import Toast, { toast } from '../components/Toast';

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  cancel: 'Cancel',
  deactivate: 'Deactivate',
  bulk_assign: 'Bulk Assign',
  restore: 'Restore',
  graduate: 'Graduate',
  ungraduate: 'Ungraduate',
  graduate_class: 'Graduate Class',
  promote_all: 'Promote All',
  reorder: 'Reorder',
  copy_from_year: 'Copy From Year',
  toggle: 'Toggle',
  revert: 'Revert',
  assign_class_teacher: 'Assign Class Teacher',
  remove_class_teacher: 'Remove Class Teacher',
  assign_subject: 'Assign Subject',
  remove_subject: 'Remove Subject',
  delete_class_results: 'Delete Class Results',
  lock: 'Lock Term',
  unlock: 'Unlock Term',
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  CANCEL: 'Cancel',
  DEACTIVATE: 'Deactivate',
  BULK_ASSIGN: 'Bulk Assign',
};

const ENTITY_COLORS: Record<string, string> = {
  student: 'text-blue-600 bg-blue-50',
  teacher: 'text-amber-600 bg-amber-50',
  staff: 'text-green-600 bg-green-50',
  transaction: 'text-emerald-600 bg-emerald-50',
  fee_schedule: 'text-purple-600 bg-purple-50',
  fee_waiver: 'text-amber-600 bg-amber-50',
  student_fee_assignment: 'text-rose-600 bg-rose-50',
  class: 'text-blue-600 bg-blue-50',
  subject: 'text-indigo-600 bg-indigo-50',
  academic_year: 'text-cyan-600 bg-cyan-50',
  category: 'text-gray-600 bg-gray-50',
  setting: 'text-gray-600 bg-gray-50',
  opening_balance: 'text-green-600 bg-green-50',
  period_close: 'text-red-600 bg-red-50',
  result: 'text-violet-600 bg-violet-50',
  book: 'text-orange-600 bg-orange-50',
  Student: 'text-blue-600 bg-blue-50',
  Teacher: 'text-amber-600 bg-amber-50',
  Staff: 'text-green-600 bg-green-50',
  Transaction: 'text-emerald-600 bg-emerald-50',
  FeeSchedule: 'text-purple-600 bg-purple-50',
  FeeWaiver: 'text-amber-600 bg-amber-50',
  StudentFeeAssignment: 'text-rose-600 bg-rose-50',
};

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  details: string;
  createdAt: string;
}

const fmtMark = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

// Parse the JSON details blob once; result rows (C2) carry
// {student_name, term, session, marks_changed: {subj: {from, to}}}.
const parseDetails = (details: string | null): any => {
  if (!details) return null;
  try { return JSON.parse(details); } catch { return details; }
};

// One-click revert (C4, admin page): re-apply the from-values on top of the
// current row. Later edits to the same subject get overwritten — the confirm
// states this, and the revert itself is audited like any other save.
const revertResultEntry = async (entityId: string, changes: Record<string, { from: unknown }>, onDone: () => void) => {
  const marks: Record<string, unknown> = {};
  for (const [subj, ch] of Object.entries(changes)) {
    marks[subj] = ch.from === undefined ? null : ch.from;
  }
  if (!window.confirm(`Re-apply these old values on top of the current marks? Later edits to the same subjects will be overwritten.\n\n${Object.entries(marks).map(([s, v]) => `${s} → ${fmtMark(v)}`).join('\n')}`)) return;
  try {
    await api.patch(`/results/${entityId}/`, { marks });
    toast('Reverted ✓', 'success');
    onDone();
  } catch {
    toast('Revert failed', 'error');
  }
};

const AuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [view, setView] = useState<'logs' | 'findings'>('logs');
  const [findings, setFindings] = useState<any[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);

  useEffect(() => { document.title = 'Audit Logs - AL RAWA English School'; }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: String(page), limit: String(limit) };
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entityType = entityFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (userIdFilter) params.userId = userIdFilter;
      const res = await api.get('/audit', { params });
      const data = res.data.data || res.data.results || res.data;
      setLogs(data);
      setTotal(res.data.total ?? res.data.count ?? data.length);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    api.get('/audit/actions')
      .then(res => {
        const data = res.data.results || res.data.data || res.data;
        setActions(data.map((r: { action: string }) => r.action));
      })
      .catch(() => {});
    api.get('/audit/entity-types')
      .then(res => {
        const data = res.data.results || res.data.data || res.data;
        setEntityTypes(data.map((r: { entityType: string }) => r.entityType));
      })
      .catch(() => {});
  }, []);


  useEffect(() => { fetchLogs(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 1 board: agents' findings live here next to the audit trail.
  const fetchFindings = async () => {
    setFindingsLoading(true);
    try {
      const res = await api.get('/agent-findings/', { params: { status: 'open', limit: 100 } });
      setFindings(res.data.results || res.data.data || res.data || []);
    } catch { /* ignore */ }
    setFindingsLoading(false);
  };
  useEffect(() => { if (view === 'findings') fetchFindings(); }, [view]);

  const transitionFinding = async (id: string, to: 'ack' | 'resolve') => {
    if (to === 'resolve' && !window.confirm('Mark this finding resolved? The agents will re-file it if the problem returns.')) return;
    try {
      await api.post(`/agent-findings/${id}/${to}/`, {});
      toast(to === 'ack' ? 'Acknowledged' : 'Resolved ✓', 'success');
      fetchFindings();
    } catch {
      toast('Action failed', 'error');
    }
  };

  const applyFilters = () => { setPage(1); fetchLogs(); };
  const clearFilters = () => {
    setActionFilter(''); setEntityFilter(''); setDateFrom(''); setDateTo('');
    setUserIdFilter(''); setPage(1);
  };

  const totalPages = Math.ceil(total / limit);

  const hasFilters = actionFilter || entityFilter || dateFrom || dateTo || userIdFilter;

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-500 text-white rounded-xl flex items-center justify-center">
            <ClipboardList size={20} />
          </div>
          <div>
            <h2 className="font-serif text-xl text-school-primary">Audit Logs</h2>
            <p className="text-xs text-school-muted">{total} total entries</p>
          </div>
        </div>

        <div className="flex gap-2">
          {(['logs', 'findings'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${view === v ? 'bg-school-primary text-white shadow-lg' : 'bg-white border border-school-border hover:border-school-accent'}`}>
              {v === 'logs' ? 'Log Trail' : `Agent Findings${findings.length > 0 && view !== 'findings' ? ` (${findings.length})` : ''}`}
            </button>
          ))}
        </div>

        {view === 'findings' ? (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden">
            {findingsLoading ? (
              <Skeleton type="table" rows={4} />
            ) : findings.length === 0 ? (
              <div className="text-center py-12 text-school-muted text-sm">✓ All clear — no open findings.</div>
            ) : (
              <div className="divide-y divide-school-border/50">
                {findings.map((f: any) => (
                  <div key={f.id} className="px-4 py-3 flex items-start gap-3">
                    <span className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${f.severity === 'critical' ? 'bg-red-50 text-red-600' : f.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                      {f.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-school-primary">{f.summary}</div>
                      <div className="text-[11px] text-school-muted mt-0.5">
                        {f.agent} · {f.createdAt ? new Date(f.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => transitionFinding(f.id, 'ack')} className="px-2.5 py-1 text-[11px] font-bold border border-school-border rounded-lg hover:border-school-accent">Ack</button>
                      <button onClick={() => transitionFinding(f.id, 'resolve')} className="px-2.5 py-1 text-[11px] font-bold bg-green-600 text-white rounded-lg hover:opacity-90">Resolve</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
        <>
        <div className="bg-white rounded-xl border border-school-border p-3 space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-[9px] font-bold uppercase text-school-muted mb-0.5 block">Action</label>
              <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
                className="text-xs bg-white border border-school-border rounded-lg px-3 py-1.5 outline-none">
                <option value="">All</option>
                {actions.map(a => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-school-muted mb-0.5 block">Entity</label>
              <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
                className="text-xs bg-white border border-school-border rounded-lg px-3 py-1.5 outline-none">
                <option value="">All</option>
                {entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-school-muted mb-0.5 block">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="text-xs bg-white border border-school-border rounded-lg px-3 py-1.5 outline-none w-[140px]" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-school-muted mb-0.5 block">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="text-xs bg-white border border-school-border rounded-lg px-3 py-1.5 outline-none w-[140px]" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase text-school-muted mb-0.5 block">User ID</label>
              <input type="text" value={userIdFilter} onChange={e => setUserIdFilter(e.target.value)}
                placeholder="Filter by user..."
                className="text-xs bg-white border border-school-border rounded-lg px-3 py-1.5 outline-none w-[150px]" />
            </div>
            <div className="flex gap-1">
              <button onClick={applyFilters}
                className="text-xs px-3 py-1.5 rounded-lg bg-school-primary text-white font-bold hover:opacity-90">
                Apply
              </button>
              {hasFilters && (
                <button onClick={clearFilters}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-school-muted font-bold hover:bg-gray-200">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <Skeleton type="table" rows={8} />
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-school-muted text-sm">No audit log entries found.</div>
        ) : (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs mobile-card-table">
                <thead>
                  <tr className="bg-school-paper border-b border-school-border text-left">
                    <th className="px-4 py-2.5 font-semibold text-school-muted uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 font-semibold text-school-muted uppercase tracking-wider">User</th>
                    <th className="px-4 py-2.5 font-semibold text-school-muted uppercase tracking-wider">Action</th>
                    <th className="px-4 py-2.5 font-semibold text-school-muted uppercase tracking-wider">Entity</th>
                    <th className="px-4 py-2.5 font-semibold text-school-muted uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: AuditLog) => {
                    const parsed: any = parseDetails(log.details);
                    const changes = parsed && typeof parsed === 'object' ? parsed.marks_changed : null;
                    const changeList = changes ? Object.entries(changes) : [];
                    const preview = changeList.length > 0 ? (
                      `${parsed.student_name || ''} · Term ${parsed.term || ''} · ` +
                      changeList.slice(0, 3).map(([s, c]: [string, any]) => `${s} ${fmtMark(c.from)}→${fmtMark(c.to)}`).join(', ') +
                      (changeList.length > 3 ? ` +${changeList.length - 3} more` : '')
                    ) : (typeof parsed === 'object' && parsed ? (
                      [parsed.destination_account ? `→ ${parsed.destination_account}` : '',
                       parsed.source_account ? `← ${parsed.source_account}` : '',
                       parsed.student ? parsed.student : '',
                       parsed.type ? parsed.type : ''].filter(Boolean).join(' · ') || JSON.stringify(parsed).slice(0, 80) + '…'
                    ) : (log.details || '—'));
                    return (
                      <tr key={log.id} className="border-b border-school-border/50 hover:bg-school-paper/50 cursor-pointer"
                        onClick={() => setDetailLog(log)}>
                        <td className="px-4 py-2.5 text-school-muted whitespace-nowrap" data-label="Date">
                          {new Date(log.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-school-muted font-mono" data-label="User">
                          {log.userName || (log.userId ? `#${log.userId.slice(0, 8)}` : '—')}
                        </td>
                        <td className="px-4 py-2.5" data-label="Action">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${log.action === 'delete' || log.action === 'DELETE' ? 'bg-red-50 text-red-600' : log.action === 'create' || log.action === 'CREATE' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" data-label="Entity">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ENTITY_COLORS[log.entityType] || 'text-gray-600 bg-gray-50'}`}>
                            {log.entityType}
                            {log.entityId && <span className="opacity-50 ml-1">#{log.entityId.slice(0, 8)}</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-school-muted max-w-[300px] truncate font-mono text-[10px]" data-label="Details">
                          {preview}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 bg-school-paper border-t border-school-border">
                <div className="text-xs text-school-muted">
                  Page {page} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1 bg-white border border-school-border rounded-lg text-xs disabled:opacity-50 font-bold">
                    Previous
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1 bg-white border border-school-border rounded-lg text-xs disabled:opacity-50 font-bold">
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>

      <Modal open={!!detailLog} onClose={() => setDetailLog(null)} title="Log Details" className="max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div><div className="text-[10px] uppercase font-bold text-school-muted">Action</div><div className="text-sm font-bold text-school-primary">{ACTION_LABELS[detailLog?.action ?? ''] || detailLog?.action}</div></div>
          <div><div className="text-[10px] uppercase font-bold text-school-muted">Entity</div><div className="text-sm">{detailLog?.entityType} #{detailLog?.entityId}</div></div>
          <div><div className="text-[10px] uppercase font-bold text-school-muted">User</div><div className="text-sm font-bold text-school-primary">{detailLog?.userName || detailLog?.userId}</div></div>
          <div><div className="text-[10px] uppercase font-bold text-school-muted">Timestamp</div><div className="text-sm">{detailLog ? new Date(detailLog.createdAt).toLocaleString() : ''}</div></div>
        </div>
        <div className="mt-4">
          <div className="text-[10px] uppercase font-bold text-school-muted mb-1">Changes / Details</div>
          {(() => {
            const d = detailLog ? parseDetails(detailLog.details) : null;
            const changes = d && typeof d === 'object' ? d.marks_changed : null;
            const changeList = changes ? Object.entries(changes) : [];
            if (changeList.length === 0) {
              if (!detailLog?.details) return 'No details recorded.';
              // parseDetails never throws: non-JSON details come back as-is.
              const raw = typeof d === 'object' ? JSON.stringify(d, null, 2) : String(d ?? detailLog.details);
              return (<pre className="bg-gray-50 p-4 rounded-xl text-xs font-mono whitespace-pre-wrap border border-gray-100 leading-relaxed overflow-x-auto">{raw}</pre>);
            }
            return (
              <div className="space-y-1.5">
                <div className="text-xs text-school-muted mb-1">
                  {d.student_name || ''} · {d.session || ''} · Term {d.term || ''}
                </div>
                {changeList.map(([s, c]: [string, any]) => (
                  <div key={s} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                    <span className="font-bold text-school-primary">{s}</span>
                    <span className="font-mono">{fmtMark(c.from)}</span>
                    <span className="text-school-muted">→</span>
                    <span className="font-mono font-bold">{fmtMark(c.to)}</span>
                  </div>
                ))}
                {detailLog && detailLog.action === 'update' && detailLog.entityType === 'result' && (
                  <button
                    onClick={() => revertResultEntry(detailLog.entityId, changes, () => { setDetailLog(null); fetchLogs(); })}
                    className="mt-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:opacity-90">
                    ↩ Revert these changes
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </Modal>
      <Toast />
    </Layout>
  );
};

export default AuditLogs;
