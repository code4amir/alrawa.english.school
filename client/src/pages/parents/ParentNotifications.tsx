import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import ParentLayout from './ParentLayout';
import { Bell, ChevronRight, Megaphone, CalendarCheck, BarChart3, Wallet, Calendar } from 'lucide-react';

interface NoticeItem {
  id: string;
  title: string;
  body: string;
  eventType: string;
  sentAt: string;
  payload?: { url?: string; student_id?: string } | null;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fees', label: 'Fees', types: ['fee_received', 'fee_reversal', 'dues_reminder'] },
  { key: 'attendance', label: 'Attendance', types: ['attendance_marked'] },
  { key: 'results', label: 'Results', types: ['result_published'] },
  { key: 'school', label: 'School', types: ['announcement', 'routine_published', 'agent_digest'] },
] as const;

function iconFor(eventType: string) {
  switch (eventType) {
    case 'fee_received':
    case 'fee_reversal':
    case 'dues_reminder':
      return { Icon: Wallet, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' };
    case 'attendance_marked':
      return { Icon: CalendarCheck, cls: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' };
    case 'result_published':
      return { Icon: BarChart3, cls: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' };
    case 'routine_published':
      return { Icon: Calendar, cls: 'text-purple-600 bg-purple-50 dark:bg-purple-500/10' };
    default:
      return { Icon: Megaphone, cls: 'text-school-accent bg-school-paper dark:bg-white/10' };
  }
}

function labelFor(eventType: string) {
  switch (eventType) {
    case 'fee_received': return 'Fee Received';
    case 'fee_reversal': return 'Payment Reversed';
    case 'dues_reminder': return 'Dues Reminder';
    case 'attendance_marked': return 'Attendance';
    case 'result_published': return 'Result';
    case 'routine_published': return 'Routine';
    case 'agent_digest': return 'School Digest';
    default: return 'Notice';
  }
}

export default function ParentNotifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/notifications/')
      .then((res) => setItems(res.data))
      .catch(() => toast('Failed to load notifications', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
    const list = filter === 'all'
      ? items
      : items.filter((n) => (active as any).types?.includes(n.eventType));
    const byDay = new Map<string, NoticeItem[]>();
    for (const n of list) {
      const d = n.sentAt ? new Date(n.sentAt) : null;
      const key = d ? d.toLocaleDateString() : '';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(n);
    }
    return [...byDay.entries()];
  }, [items, filter]);

  const openNotice = (n: NoticeItem) => {
    const url = n.payload?.url as string | undefined;
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, '_blank', 'noopener'); return; }
    const hashIdx = url.indexOf('#');
    navigate(hashIdx >= 0 ? url.slice(hashIdx + 1) || '/' : url);
  };

  return (
    <ParentLayout>
      <Toast />
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-school-primary to-school-secondary rounded-2xl p-5 text-white">
          <div className="flex items-center gap-3">
            <Bell size={24} />
            <h2 className="font-serif text-xl">Notifications</h2>
          </div>
          <p className="text-sm text-white/70 mt-1">Your notices from the last 90 days</p>
        </div>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                filter === f.key
                  ? 'bg-school-primary text-white'
                  : 'bg-white text-school-muted border border-school-border hover:text-school-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-white rounded-xl p-4 border border-school-border">
                <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-school-border">
            <Bell size={40} className="mx-auto text-school-muted mb-3" />
            <p className="text-school-muted font-medium">No notifications yet</p>
          </div>
        ) : (
          grouped.map(([day, rows]) => (
            <div key={day} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-school-muted px-1">{day || 'Undated'}</p>
              {rows.map((n) => {
                const { Icon, cls } = iconFor(n.eventType);
                const url = n.payload?.url as string | undefined;
                return (
                  <div
                    key={n.id}
                    onClick={url ? () => openNotice(n) : undefined}
                    className={`bg-white rounded-xl border border-school-border p-4 flex items-start gap-3 ${
                      url ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                    }`}
                    role={url ? 'button' : undefined}
                    tabIndex={url ? 0 : undefined}
                    onKeyDown={url ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotice(n); } } : undefined}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cls}`}>
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-school-muted">{labelFor(n.eventType)}</span>
                        <span className="text-[10px] text-school-muted/70">
                          {n.sentAt ? new Date(n.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-school-primary mt-0.5 truncate">{n.title || 'Notice'}</h3>
                      {n.body && <p className="text-xs text-school-muted mt-0.5 line-clamp-2 whitespace-pre-line">{n.body}</p>}
                    </div>
                    {url && <ChevronRight size={18} className="text-school-muted flex-shrink-0 mt-1" />}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </ParentLayout>
  );
}
