import { useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import { CreditCard, BookOpen, ClipboardList, Banknote, CalendarCheck } from 'lucide-react';

const financeRoles = ['admin', 'principal', 'accountant'];

const items = [
  { mode: 'idcard' as const, label: 'ID Card', icon: CreditCard },
  { mode: 'accessories' as const, label: 'Fees', icon: BookOpen },
  { mode: 'attendance' as const, label: 'Attendance', icon: CalendarCheck },
  { mode: 'result' as const, label: 'Result', icon: ClipboardList },
  { mode: 'finance' as const, label: 'Finance', icon: Banknote, roles: financeRoles },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { activeMode, setMode } = useUIStore();
  const user = useAuthStore((s) => s.user);

  const handleClick = (mode: typeof items[number]['mode']) => {
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
      {items.map((item) => {
        if (item.roles && user && !item.roles.includes(user.role)) return null;
        const active = activeMode === item.mode;
        return (
          <button
            key={item.mode}
            onClick={() => handleClick(item.mode)}
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
