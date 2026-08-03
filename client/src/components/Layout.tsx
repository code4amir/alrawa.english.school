import { useRef, useCallback, useEffect, useState } from 'react';
import type { ReactNode, TouchEvent } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore, useUIStore, useDarkMode, useSchoolStore } from '../store';
import { ChevronLeft, Lock, Users, Sun, Moon, ClipboardList, Sparkles, KeyRound, Link2, CalendarDays } from 'lucide-react';
import { useAIQueryStore } from '../store';
import { SCHOOL_LOGO } from '../lib/logo';
import BottomNav from './BottomNav';

const ROLE_DISPLAY: Record<string, string> = {
  admin: 'Admin',
  teacher: 'Teacher',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const { logout, user } = useAuthStore();
  const role = user?.role;
  const { activeMode, swipeBack, setMode } = useUIStore();
  const { dark, toggle: toggleDark } = useDarkMode();
  const { academicYears, fetchAcademicYears } = useSchoolStore();
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const activeYear = academicYears.find((y: any) => y.isActive);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  type ConnState = 'connected' | 'disconnected' | 'checking';
  const [connState, setConnState] = useState<ConnState>('checking');

  const checkHealth = useCallback(async () => {
    try {
      // Use direct fetch to the root backend health endpoint, not the /api base URL
      const res = await fetch('https://ares.alwaysdata.net/health/', { signal: AbortSignal.timeout(5000) });
      if (res.ok) setConnState('connected');
      else setConnState('disconnected');
    } catch { setConnState('disconnected'); }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    const onOnline = () => { setConnState('checking'); setTimeout(checkHealth, 500); };
    const onOffline = () => setConnState('disconnected');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { clearInterval(interval); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [checkHealth]);

  useEffect(() => { fetchAcademicYears(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connLabel = connState === 'connected' ? 'Connected' : connState === 'disconnected' ? 'Disconnected' : 'Checking…';
  const connDotClass = connState === 'connected' ? 'bg-green-500' : connState === 'disconnected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse';
  const lastFetched = useSchoolStore((s) => s.lastFetched);
  const lastFetchedLabel = lastFetched
    ? new Date(lastFetched).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleBack = useCallback(() => {
    swipeBack();
    // If swipeBack went to null mode, clear URL param
    const { activeMode: currentMode } = useUIStore.getState();
    if (!currentMode) {
      setSearchParams({}, { replace: true });
    }
  }, [swipeBack, setSearchParams]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 80 && activeMode) {
      handleBack();
    }
  }, [activeMode, handleBack]);

  return (
    <div className="min-h-screen bg-school-paper flex flex-col selection:bg-school-accent selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-school-primary text-school-paper shadow-lg px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="flex items-center gap-3 min-w-0">
                {activeMode && (
            <button
              onClick={handleBack}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
              aria-label="Go back"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <button onClick={() => { setMode(null); navigate('/'); }} className="flex items-center gap-3 text-left">
            <img src={SCHOOL_LOGO} alt="Logo" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/20 shadow-sm" id="school-logo" />
            <div className="min-w-0">
                          <h1 className="font-serif text-xl leading-tight whitespace-nowrap truncate">AL RAWA</h1>
                          <p className="text-[10px] uppercase tracking-widest opacity-70 truncate">English School</p>
                        </div>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0 flex-wrap justify-end">
                  {role === 'admin' && (
            <>
              <button
                onClick={() => navigate('/audit')}
                className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
                title="Audit Logs"
                aria-label="Audit Logs"
              >
                <ClipboardList size={20} className="group-hover:scale-110 transition-transform" />
              </button>
              <button
                onClick={() => navigate('/users')}
                className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
                title="User Management"
                aria-label="User Management"
              >
                <Users size={20} className="group-hover:scale-110 transition-transform" />
              </button>
              <button
                onClick={() => navigate('/connections')}
                className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
                title="Connections"
                aria-label="Connections"
              >
                <Link2 size={20} className="group-hover:scale-110 transition-transform" />
              </button>
              {/* Session Year Switcher */}
              <div className="relative">
                <button
                  onClick={() => setShowYearDropdown(!showYearDropdown)}
                  onBlur={() => setTimeout(() => setShowYearDropdown(false), 200)}
                  className="flex items-center gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs font-bold"
                  title={activeYear ? `Active: ${activeYear.name}` : 'No active year'}
                  aria-label="Switch academic year"
                >
                  <CalendarDays size={14} />
                  <span className="hidden sm:inline">{activeYear?.name || 'Year'}</span>
                </button>
                {showYearDropdown && academicYears.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-[#1a1a2e] rounded-xl shadow-xl border border-school-border dark:border-[#2a2a3e] py-1 min-w-[160px] z-[100]">
                    {[...academicYears]
                      .sort((a: any, b: any) => new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime())
                      .map((y: any) => (
                        <button
                          key={y.id}
                          onMouseDown={async () => {
                            if (!y.isActive) {
                              try {
                                const { api } = await import('../stores/api');
                                await api.patch(`/academic-years/${y.id}/`, { isActive: true });
                                fetchAcademicYears(true);
                              } catch { /* ignore */ }
                            }
                            setShowYearDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-school-paper/50 ${
                            y.isActive ? 'font-bold text-school-primary' : 'text-school-muted'
                          }`}
                        >
                          <span>{y.name}</span>
                          {y.isActive && <span className="text-[9px] bg-school-primary/10 text-school-primary px-1.5 py-0.5 rounded font-bold">Active</span>}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
          <button
            onClick={() => useAIQueryStore.getState().setOpen(true)}
            className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
            title="AI Query (Ctrl+K)"
            aria-label="AI Query"
          >
            <Sparkles size={20} className="group-hover:scale-110 transition-transform text-school-accent" />
          </button>
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-[10px] font-bold uppercase tracking-tighter opacity-50">Logged in as</span>
            <span className="text-xs font-semibold">{ROLE_DISPLAY[role || ''] || role}</span>
          </div>
          <button
            onClick={toggleDark}
            className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
            title={dark ? 'Light Mode' : 'Dark Mode'}
            aria-label={dark ? 'Light Mode' : 'Dark Mode'}
          >
            {dark ? <Sun size={20} className="group-hover:scale-110 transition-transform" /> : <Moon size={20} className="group-hover:scale-110 transition-transform" />}
          </button>
          <button
            onClick={() => navigate('/change-password')}
            className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
            title="Change Password"
            aria-label="Change Password"
          >
            <KeyRound size={20} className="group-hover:scale-110 transition-transform" />
          </button>
          <button
            onClick={logout}
            className="p-1.5 sm:p-2 hover:bg-white/10 rounded-full transition-colors group"
            title="Logout"
            aria-label="Logout"
          >
            <Lock size={20} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden relative" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeMode || location.pathname}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="p-4 md:p-6 max-w-7xl mx-auto w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-school-secondary text-white/50 text-[10px] py-2 px-4 flex justify-between items-center border-t border-white/5">
        <span>© 2026 AL RAWA English School</span>
        <div className="flex items-center gap-3">
          {lastFetchedLabel && <span className="hidden sm:inline text-[9px] opacity-60">Updated {lastFetchedLabel}</span>}
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${connDotClass}`}></div>
            <span className={`uppercase tracking-widest text-[9px] ${connState === 'disconnected' ? 'text-red-400' : ''}`}>{connLabel}</span>
          </div>
        </div>
      </footer>

      {/* Bottom Navigation (mobile only) */}
      <BottomNav />
    </div>
  );
};

export default Layout;
