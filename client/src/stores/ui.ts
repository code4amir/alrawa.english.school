import { create } from 'zustand';

function getInitialDark(): boolean {
  const stored = localStorage.getItem('dark-mode');
  if (stored !== null) return stored === 'true';
  return false; // light mode is the default theme
}

export const useDarkMode = create<{ dark: boolean; toggle: () => void }>((set, get) => ({
  dark: getInitialDark(),
  toggle: () => {
    const next = !get().dark;
    set({ dark: next });
    localStorage.setItem('dark-mode', String(next));
    document.documentElement.classList.toggle('dark', next);
  },
}));

if (useDarkMode.getState().dark) {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

type MainMode = null | 'idcard' | 'accessories' | 'result' | 'finance' | 'attendance' | 'routine' | 'exam-routine' | 'session-year' | 'announcements' | 'services';
type IdSubMode = 'student' | 'teacher' | 'staff';

interface UIState {
  activeMode: MainMode;
  activeSubMode: IdSubMode;
  setMode: (mode: MainMode) => void;
  setIdSubMode: (sub: IdSubMode) => void;
  swipeBack: () => void;
  registerSwipeBack: (fn: () => void) => void;
}

let _swipeBackFn: (() => void) | null = null;

export const useUIStore = create<UIState>((set, get) => ({
  activeMode: null,
  activeSubMode: 'student',
  setMode: (mode) => set({ activeMode: mode }),
  setIdSubMode: (sub) => set({ activeSubMode: sub }),
  swipeBack: () => {
    const { activeMode, activeSubMode, setMode, setIdSubMode } = get();
    if (_swipeBackFn) {
      _swipeBackFn();
      _swipeBackFn = null;
      return;
    }
    if (activeMode === 'idcard' && activeSubMode !== 'student') {
      setIdSubMode('student');
    } else if (activeMode) {
      setMode(null);
    }
  },
  registerSwipeBack: (fn) => { _swipeBackFn = fn; },
}));
