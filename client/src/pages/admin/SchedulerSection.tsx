import { useState, useEffect, useCallback } from 'react';
import { api } from '../../store';
import { toast } from '../../components/Toast';
import {
  Clock, Play, Pause, Trash2, RefreshCw, AlertTriangle,
  CalendarDays, Terminal, ServerCog, Zap,
} from 'lucide-react';

interface SchedJob {
  id: number;
  crontabSyntax: string;
  argument: string;
  annotation: string;
  isDisabled: boolean;
  workingDirectory: string;
  href: string;
}

interface SchedList {
  configured: boolean;
  jobs: SchedJob[];
  error?: string;
}

interface RunOutput {
  run: string;
  ok?: boolean;
}

// Translate a 5-field cron into a friendly label (best-effort).
function describeSchedule(syntax: string): string {
  const parts = syntax.trim().split(/\s+/);
  if (parts.length !== 5) return syntax;
  const [min, hour, dom, mon, dow] = parts;
  const dows = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const h = hour.includes('/') ? hour : String(parseInt(hour, 10) || 0);
  const m = min.includes('/') ? min : String(parseInt(min, 10) || 0);
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && dow !== '*') {
    const names = dow.split(',').map((d) => dows[parseInt(d, 10) % 7]).join(', ');
    return `Every ${names} at ${time}`;
  }
  if (dom === '*' && mon === '*' && dow === '*') return `Every day at ${time}`;
  return syntax;
}

export default function SchedulerSection() {
  const [data, setData] = useState<SchedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [cron, setCron] = useState('0 11 * * 6');
  const [annotation, setAnnotation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [runOutput, setRunOutput] = useState<RunOutput | null>(null);
  const [running, setRunning] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/scheduler/');
      setData(res.data || { configured: false, jobs: [] });
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Failed to load scheduled tasks', 'error');
      setData({ configured: false, jobs: [] });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleJob = async (job: SchedJob) => {
    setActionId(job.id);
    try {
      await api.put(`/scheduler/${job.id}/`, { isDisabled: !job.isDisabled });
      toast(job.isDisabled ? 'Task enabled ✓' : 'Task paused', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Update failed', 'error');
    }
    setActionId(null);
  };

  const deleteJob = async (job: SchedJob) => {
    if (!confirm(`Delete scheduled task "${job.annotation || job.argument}"? This removes the Alwaysdata cron job.`)) return;
    setActionId(job.id);
    try {
      await api.delete(`/scheduler/${job.id}/`);
      toast('Task deleted', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Delete failed', 'error');
    }
    setActionId(null);
  };

  const runNow = async (job: SchedJob) => {
    setRunning(job.id);
    setRunOutput(null);
    try {
      const res = await api.post(`/scheduler/${job.id}/run/`, undefined, { timeout: 300000 });
      const d = res.data || {};
      const output = d.output || d.stdout || '';
      setRunOutput({ run: output, ok: d.ok });
      const first = output.trim().split('\n')[0];
      toast(d.ok === false ? 'Run failed (see output)' : (first || 'Run completed'), d.ok === false ? 'error' : 'success');
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Run failed', 'error');
    }
    setRunning(null);
  };

  const dryRun = async () => {
    setRunning('dry');
    setRunOutput(null);
    try {
      const res = await api.post('/scheduler/dry-run/', undefined, { timeout: 300000 });
      const d = res.data || {};
      const output = d.output || '';
      setRunOutput({ run: output, ok: d.ok });
      toast(`Dry-run ${d.ok ? 'completed' : 'finished with warnings'}: ${(output.trim().split('\n')[0] || '').slice(0, 80)}`, d.ok ? 'success' : 'info');
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Dry-run failed', 'error');
    }
    setRunning(null);
  };

  const handleCreate = async () => {
    if (!cron.trim()) { toast('Cron syntax is required', 'error'); return; }
    setSubmitting(true);
    try {
      await api.post('/scheduler/', {
        crontabSyntax: cron.trim(),
        annotation: annotation.trim() || 'Dues reminder',
        argument: '~/schoolenv/bin/python ~/school-management/manage.py send_due_reminders',
        sshUser: 516391,
        workingDirectory: 'school-management',
      });
      toast('Scheduled task created', 'success');
      setShowCreate(false);
      setAnnotation('');
      setCron('0 11 * * 6');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.error || 'Create failed', 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-700 text-white rounded-2xl flex items-center justify-center">
            <Clock size={20} />
          </div>
          <div>
            <h2 className="font-bold text-lg text-school-primary dark:text-[#e0e0e8]">Scheduled Tasks</h2>
            <p className="text-xs text-school-muted">Alwaysdata cron jobs (dues reminders, etc.)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={dryRun} disabled={!!running}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-lg disabled:opacity-50">
            <Zap size={14} /> {running === 'dry' ? 'Running…' : 'Dry-run (no send)'}
          </button>
          <button onClick={() => load()} disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-white dark:bg-[#1a1a2e] border border-school-border dark:border-[#2a2a3e] px-3 py-1.5 rounded-lg disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-school-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90">
            + New Task
          </button>
        </div>
      </div>

      {data && !data.configured && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Scheduling is not configured.</p>
              <p className="text-xs mt-1">{data.error}</p>
            </div>
          </div>
        </div>
      )}

      {data?.error && data.configured && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-200">
          {data.error}
        </div>
      )}

      {showCreate && (
        <div className="bg-white dark:bg-[#1a1a2e] border border-school-border dark:border-[#33334a] rounded-2xl p-5 space-y-3">
          <h3 className="font-semibold text-sm">Create scheduled task</h3>
          <div>
            <label className="text-xs text-school-muted block mb-1">Cron syntax (e.g. <code>0 11 * * 6</code> = Saturday 11:00)</label>
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 11 * * 6"
              className="w-full border border-school-border dark:border-[#33334a] bg-transparent rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-school-muted block mb-1">Label / annotation</label>
            <input value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="AL RAWA - weekly dues reminder"
              className="w-full border border-school-border dark:border-[#33334a] bg-transparent rounded-lg px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-school-muted">
            Creates a cron job running the <code>send_due_reminders</code> management command on Alwaysdata.
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs font-semibold rounded-lg border border-school-border dark:border-[#33334a]">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-school-primary text-white disabled:opacity-60">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-school-muted text-center py-10">Loading scheduled tasks…</div>
      )}

      {data && data.jobs.length === 0 && data.configured && (
        <div className="text-center text-sm text-school-muted py-10">
          No scheduled tasks yet. Create one to run the dues reminder on a regular schedule.
        </div>
      )}

      {data && data.jobs.length > 0 && (
        <div className="grid gap-3">
          {data.jobs.map((job) => (
            <div key={job.id} className="bg-white dark:bg-[#1a1a2e] border border-school-border dark:border-[#33334a] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${job.isDisabled ? 'bg-gray-400' : 'bg-emerald-500'}`} />
                  <span className="font-semibold text-sm truncate">{job.annotation || `Task #${job.id}`}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-school-muted">
                  <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {describeSchedule(job.crontabSyntax)}</span>
                  <span className="inline-flex items-center gap-1"><ServerCog size={12} /> #{job.id}</span>
                  <span className="hidden sm:inline font-mono text-[10px] truncate max-w-[320px]">{job.argument}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => runNow(job)} disabled={!!running || job.isDisabled}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border border-blue-500/30 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {running === job.id ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Run now
                </button>
                <button onClick={() => toggleJob(job)} disabled={actionId === job.id}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-500/10 hover:bg-gray-500/20 border border-gray-400/30 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {job.isDisabled ? <Play size={14} /> : <Pause size={14} />} {job.isDisabled ? 'Enable' : 'Disable'}
                </button>
                <button onClick={() => deleteJob(job)} disabled={actionId === job.id}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runOutput && runOutput.run && (
        <div className="bg-[#0b1120] border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-emerald-400">
            <Terminal size={14} /> Command output
          </div>
          <pre className="text-[11px] leading-relaxed font-mono text-gray-300 whitespace-pre-wrap max-h-64 overflow-auto">
            {runOutput.run}
          </pre>
        </div>
      )}
    </div>
  );
}