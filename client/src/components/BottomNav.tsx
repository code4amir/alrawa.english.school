import { useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import { CreditCard, BookOpen, ClipboardList, Banknote, CalendarCheck } from 'lucide-react';
import { canUseModule } from '../lib/permissions';
import type { ModuleKey } from '../lib/permissions';

// Same MODULE_ROLES map as the dashboard tiles — an entry that isn't rendered
// as a tile must not be reachable from the mobile nav either.
const items = [
  { module: 'idcard' as ModuleKey, label: 'ID Card', icon: CreditCard },
  { module: 'accessories' as ModuleKey, label: 'Fees', icon: BookOpen },
  { module: 'attendance' as ModuleKey, label: 'Attendance', icon: CalendarCheck },
  { module: 'result' as ModuleKey, label: 'Result', icon: ClipboardList },
  { module: 'finance' as ModuleKey, label: 'Finance', icon: Banknote },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { activeMode, setMode } = useUIStore();
  const user = useAuthStore((s) => s.user);

  const handleClick = (mode: ModuleKey) => {
    if (activeMode === mode) {
      setMode(null);
      navigate('/', { replace: true });
    } else {
      setMode(mode);
      navigate('/');
    }
  };

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-school-primary border-t border-school-border flex items-center justify-around py-1 safe-area-bottom"
      aria-label="Main navigation"
    >
      {items.filter((item) => canUseModule(user?.role, item.module)).map((item) => {
        const active = activeMode === item.module;
        return (
          <button
            key={item.module}
            onClick={() => handleClick(item.module)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[64px] ${
              active
                ? 'text-school-accent'
                : 'text-school-muted hover:text-school-primary dark:hover:text-white'
            }`}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon size={20} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
