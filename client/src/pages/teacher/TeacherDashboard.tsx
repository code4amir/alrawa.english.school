import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../store';
import {
  ClipboardList, CalendarCheck, BookOpen, BookText,
  Clock, ChevronRight, Loader2,
} from 'lucide-react';

interface DashboardData {
  today_schedule: { period: number; subject: string; class: string }[];
  pending_attendance: number;
  pending_lesson_plans: number;
  week_start: string;
  week_end: string;
}

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/teacher/dashboard/')
      .then((res) => setData(res.data))
      .catch(() => setError('Failed to load dashboard'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={28} className="animate-spin text-school-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 space-y-3">
        <p className="text-school-muted text-sm">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-school-accent text-white rounded-xl text-xs font-bold hover:opacity-90">Retry</button>
      </div>
    );
  }

  const actions = [
    { label: 'Attendance', icon: CalendarCheck, path: '/teacher/attendance', color: 'bg-blue-500' },
    { label: 'Routine', icon: ClipboardList, path: '/teacher/routine', color: 'bg-purple-500' },
    { label: 'Homework', icon: BookOpen, path: '/teacher/homework', color: 'bg-green-500' },
    { label: 'Diary', icon: BookText, path: '/teacher/diary', color: 'bg-amber-500' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 p-5 rounded-2xl text-white">
        <h2 className="font-bold text-xl">Good Morning</h2>
        <p className="text-sm text-white/70 mt-0.5">Here's your day ahead</p>
      </div>

      <div>
        <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-2 flex items-center gap-1.5">
          <Clock size={16} /> Today's Classes
        </h3>
        {data?.today_schedule && data.today_schedule.length > 0 ? (
          <div className="space-y-1.5">
            {data.today_schedule.map((c, i) => (
              <div key={i} className="flex items-center gap-3 bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] px-4 py-3 shadow-sm">
                <div className="w-8 h-8 rounded-full bg-school-accent/10 text-school-accent flex items-center justify-center font-bold text-xs">
                  {c.period}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8] truncate">{c.subject}</div>
                  <div className="text-[10px] text-school-muted">{c.class}</div>
                </div>
                <ChevronRight size={16} className="text-school-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-school-muted text-sm bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e]">
            No classes scheduled today
          </div>
        )}
      </div>

      <div>
        <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-2">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.path}
                onClick={() => navigate(a.path)}
                className="flex items-center gap-3 bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] px-4 py-4 text-left hover:border-school-accent/50 transition-colors shadow-sm"
              >
                <div className={`w-10 h-10 ${a.color} rounded-xl flex items-center justify-center`}>
                  <Icon size={20} className="text-white" />
                </div>
                <span className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8]">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
