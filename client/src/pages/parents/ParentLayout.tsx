import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { SCHOOL_LOGO } from '../../lib/logo';
import { usePushSubscription } from '../../lib/usePushSubscription';
import {
  Home, CalendarCheck, Wallet, BarChart3, Megaphone,
  BookOpen, BookText, ClipboardList, Calendar, LogOut, ArrowLeft, Bell,
} from 'lucide-react';

const tabs = [
  { path: '/parent', label: 'Home', icon: Home },
  { path: '/parent/notifications', label: 'Alerts', icon: Bell },
  { path: '/parent/homework', label: 'Homework', icon: BookOpen },
  { path: '/parent/diary', label: 'Diary', icon: BookText },
  { path: '/parent/routine', label: 'Routine', icon: ClipboardList },
  { path: '/parent/exam-routine', label: 'Exams', icon: Calendar },
  { path: '/parent/attendance', label: 'Attendance', icon: CalendarCheck },
  { path: '/parent/fees', label: 'Fees', icon: Wallet },
  { path: '/parent/results', label: 'Results', icon: BarChart3 },
  { path: '/parent/announcements', label: 'Updates', icon: Megaphone },
];

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  // Subscribe to router location (not window.location.hash) so the active
  // tab highlight re-renders on every in-app navigation under HashRouter.
  const currentPath = location.pathname;
  usePushSubscription();

  const isActive = (path: string) =>
    path === '/parent' ? currentPath === '/parent' : currentPath.startsWith(path);

  return (
    <div className="min-h-screen bg-school-paper flex flex-col">
      <header className="sticky top-0 z-50 bg-school-primary text-school-paper shadow-lg px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={SCHOOL_LOGO} alt="Logo" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/20 shadow-sm" />
          <div>
            <h1 className="font-serif text-lg leading-tight">AL RAWA</h1>
            <p className="text-[9px] uppercase tracking-widest opacity-70">Parent Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium opacity-80 hidden sm:inline">{user?.name}</span>
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/')} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Back to Dashboard">
              <ArrowLeft size={18} />
            </button>
          )}
          <button onClick={logout} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full">{children}</main>

      <nav className="sticky bottom-0 z-50 bg-white dark:bg-school-primary border-t border-school-border overflow-x-auto scrollbar-hide safe-area-bottom">
        <div className="flex items-center px-1 py-1 min-w-max">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.path);
            return (
              <button
                key={t.path}
                onClick={() => navigate(t.path)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[56px] ${
                  active ? 'text-school-accent' : 'text-school-muted hover:text-school-primary dark:hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
