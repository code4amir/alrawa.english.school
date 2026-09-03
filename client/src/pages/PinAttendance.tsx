import { useState, useEffect, useRef, useCallback } from 'react';
import Toast, { toast } from '../components/Toast';
import { setTokens } from '../stores/api';
import { API_URL, TERM_NAMES } from '../lib/config';

const API_BASE = API_URL.replace(/\/+$/, '');
const LS_QUEUE_KEY = 'pin_attendance_queue';
const LS_TOKEN_KEY = 'pin_auth_token';
const LS_TEACHER_KEY = 'pin_teacher';

type StatusType = 'present' | 'absent' | 'unmarked';

interface Teacher { id: string; name: string; }
interface ClassInfo { id: string; name: string; }
interface Student { id: string; name: string; roll: string; }
interface QueuedRecord { school_class: string; date: string; term: string; session: string; records: Record<string, string>; timestamp: number; }
interface Holiday { id: string; date: string; name: string; type: string; }

const STATUS_NAMES: Record<string, string> = { present: 'Present', absent: 'Absent' };

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function apiGet(path: string, token: string = import.meta.env.VITE_API_TOKEN || '', params?: Record<string, string>) {
  const url = new URL(`${API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = {};
  const authToken = token || import.meta.env.VITE_API_TOKEN || '';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, token: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path: string, token: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

function loadQueue(): QueuedRecord[] {
  try { return JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || '[]'); } catch { return []; }
}

function saveQueue(queue: QueuedRecord[]) {
  localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(queue));
}

function safeToast(msg: string, type?: 'success' | 'error' | 'info' | '') {
  try { toast(msg, type); } catch { /* toast component not mounted */ }
}

export default function PinAttendance() {
  const [screen, setScreen] = useState<'teachers' | 'pin' | 'classes' | 'attendance'>('teachers');
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [token, setToken] = useState('');
    const [teacherRole, setTeacherRole] = useState<string | null>(null);
    const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [term, setTerm] = useState('1');
  const [session, setSession] = useState(String(new Date().getFullYear()));
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<Record<string, StatusType>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [refreshKey, setRefreshKey] = useState(0);
    const [tab, setTab] = useState<'daily' | 'report' | 'holidays'>('daily');
    const [rptTab, setRptTab] = useState<'daily' | 'monthly'>('daily');
    const [rptSub, setRptSub] = useState<'classwise' | 'allclasses'>('classwise');
    const [rptRangeMode, setRptRangeMode] = useState<'month' | 'range'>('month');
    const [rptFrom, setRptFrom] = useState(() => todayStr());
    const [rptTo, setRptTo] = useState(() => todayStr());
    const [dailyDate, setDailyDate] = useState(() => todayStr());
    const [dailyReport, setDailyReport] = useState<any>(null);
    const [allClassesReport, setAllClassesReport] = useState<any>(null);
    const [monthYear, setMonthYear] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
    const [monthlyReport, setMonthlyReport] = useState<any>(null);
    const [rptLoading, setRptLoading] = useState(false);
    const [rptError, setRptError] = useState('');
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [holidayLoading, setHolidayLoading] = useState(false);
    const [holidayError, setHolidayError] = useState('');
    const [hForm, setHForm] = useState({ date: todayStr(), name: '', type: 'public' });
    const [hBulkForm, setHBulkForm] = useState({ start_date: todayStr(), end_date: todayStr(), name: '', type: 'public' });
    const [holidaySaving, setHolidaySaving] = useState(false);

  function monthName(m: number) {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '';
  }

  const loadingStudentsRef = useRef(false);

  useEffect(() => {
    const savedToken = localStorage.getItem(LS_TOKEN_KEY);
        const savedTeacher = localStorage.getItem(LS_TEACHER_KEY);
        const savedClasses = localStorage.getItem('pin_classes');
        if (savedToken && savedTeacher) {
          setToken(savedToken);
          setSelectedTeacher(JSON.parse(savedTeacher));
          try { setTeacherRole(localStorage.getItem('pin_role')); } catch { /* ignore */ }
          if (savedClasses) {
        try {
          setClasses(JSON.parse(savedClasses));
        } catch { /* ignore */ }
      }
      setScreen('classes');
    }
  }, []);

  useEffect(() => {
    const handler = () => setOffline(!navigator.onLine);
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return () => {
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  }, []);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    const queue = loadQueue();
    if (queue.length === 0) return;
    const t = localStorage.getItem(LS_TOKEN_KEY);
    if (!t) return;
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i];
      try {
        await apiPost('/m/attendance/batch/', t, {
          school_class: item.school_class, date: item.date, term: item.term, session: item.session, records: item.records,
        });
        queue.splice(i, 1);
      } catch { /* keep for retry */ }
    }
    saveQueue(queue);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (navigator.onLine) syncQueue();
    window.addEventListener('online', syncQueue); // ponytail: instant drain, no polling
    return () => window.removeEventListener('online', syncQueue);
  }, [syncQueue]);

  useEffect(() => {
    (async () => {
      try {
        const data: any = await apiGet('/m/teachers/', token);
        const list = data.teachers || data.results || data;
        if (Array.isArray(list)) {
          const mapped = list.map((t: any) => ({ id: t.id, name: t.name }));
          setTeachers(mapped);
          localStorage.setItem('pin_teachers', JSON.stringify(mapped));
        }
      } catch {
        const cached = localStorage.getItem('pin_teachers');
        if (cached) {
          try {
            setTeachers(JSON.parse(cached));
          } catch { /* ignore */ }
        }
      }
    })();
  }, []);

  function goToTeacherList() {
    setScreen('teachers');
  }

  function selectTeacher(t: Teacher) {
    setSelectedTeacher(t);
    setPin('');
    setPinError('');
    setScreen('pin');
  }

  async function handlePinSubmit() {
    if (pin.length !== 6) return;
    if (!selectedTeacher) return;
    setPinLoading(true);
    setPinError('');
    try {
      const data = await apiPost('/m/auth/pin/', '', { teacher_id: selectedTeacher.id, pin });
            const jwt = data.access || data.token;
            setTokens(jwt, null);
            setToken(jwt);
            const role = data.teacher?.role || null;
            setTeacherRole(role);
            const mappedClasses = (data.classes || []).map((c: any) => ({ id: c.id, name: c.name }));
            setClasses(mappedClasses);
            localStorage.setItem(LS_TOKEN_KEY, jwt);
            localStorage.setItem(LS_TEACHER_KEY, JSON.stringify(selectedTeacher));
            localStorage.setItem('pin_role', role || '');
            localStorage.setItem('pin_classes', JSON.stringify(mappedClasses));
            setScreen('classes');
    } catch (e: any) {
      setPinError(e.message || 'Invalid PIN');
    }
    setPinLoading(false);
  }

  function selectClass(c: ClassInfo) {
    setClassId(c.id);
    setScreen('attendance');
  }

  function logout() {
      localStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_TEACHER_KEY);
      localStorage.removeItem('pin_role');
      localStorage.removeItem('pin_classes');
      setToken('');
      setTeacherRole(null);
      setSelectedTeacher(null);
      setClasses([]);
      setClassId('');
      setDate(todayStr());
      setStudents([]);
      setRecords({});
      setScreen('teachers');
    }

  useEffect(() => {
    if (!classId || !token) return;
    if (loadingStudentsRef.current) return;
    loadingStudentsRef.current = true;
    setLoading(true);
    apiGet('/m/students/', token, { class_id: classId })
      .then((data: any) => {
        const raw = data.students || data.results || data;
        const list = (Array.isArray(raw) ? raw : []).map((s: any) => ({
          id: s.id, name: s.name, roll: s.roll || '',
        }));
        list.sort((a: any, b: any) => String(a.roll || '').localeCompare(String(b.roll || ''), undefined, { numeric: true }));
        setStudents(list);
        localStorage.setItem(`pin_students_${classId}`, JSON.stringify(list));
      })
      .catch((e) => {
        const cached = localStorage.getItem(`pin_students_${classId}`);
        if (cached) {
          try {
            setStudents(JSON.parse(cached));
            safeToast('Loaded students from cache (offline)', 'info');
          } catch {
            safeToast(e.message, 'error');
          }
        } else {
          safeToast(e.message, 'error');
        }
      })
      .finally(() => { setLoading(false); loadingStudentsRef.current = false; });
  }, [classId, token]);

  useEffect(() => {
    if (!classId || !date || !token || tab !== 'daily') return;
    (async () => {
      try {
        const data: any = await apiGet('/m/attendance/', token, { class_id: classId, date });
        const list = Array.isArray(data) ? data : data.results || data;
        if (list.length > 0) {
          const map: Record<string, StatusType> = {};
          for (const r of list) map[r.student] = r.status;
          setRecords(map);
          if (list[0].term) setTerm(list[0].term);
          if (list[0].session) setSession(list[0].session);
          localStorage.setItem(`pin_attendance_${classId}_${date}`, JSON.stringify({
            records: map,
            term: list[0].term || '1',
            session: list[0].session || String(new Date().getFullYear())
          }));
        } else {
          setRecords({});
          localStorage.setItem(`pin_attendance_${classId}_${date}`, JSON.stringify({
            records: {},
            term: '1',
            session: String(new Date().getFullYear())
          }));
        }
      } catch (e) {
        const cached = localStorage.getItem(`pin_attendance_${classId}_${date}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setRecords(parsed.records || {});
            if (parsed.term) setTerm(parsed.term);
            if (parsed.session) setSession(parsed.session);
            safeToast('Loaded existing attendance from cache (offline)', 'info');
          } catch {
            setRecords({});
            safeToast((e as any)?.message || 'Failed to load attendance', 'error');
          }
        } else {
          setRecords({});
          if (classId) safeToast((e as any)?.message || 'Failed to load attendance', 'error');
        }
      }
    })();
  }, [classId, date, token, tab, refreshKey]);

  function cycleStatus(studentId: string) {
    setRecords((prev) => {
      const current = prev[studentId] || 'unmarked';
      const order: StatusType[] = ['unmarked', 'present', 'absent'];
      const idx = order.indexOf(current);
      return { ...prev, [studentId]: order[(idx + 1) % order.length] };
    });
  }

  function markAllPresent() {
    const all: Record<string, StatusType> = {};
    for (const s of students) all[s.id] = 'present';
    setRecords(all);
  }

  async function handleSave() {
    const markedRecords: Record<string, string> = {};
    Object.entries(records).forEach(([sid, status]) => {
      if (status !== 'unmarked') markedRecords[sid] = status;
    });
    if (Object.keys(markedRecords).length === 0) return;
    setSaving(true);
    const payload = { school_class: classId, date, term, session, records: markedRecords };

    try {
      if (!navigator.onLine) {
        const queue = loadQueue();
        queue.unshift({ ...payload, timestamp: Date.now() });
        saveQueue(queue);
        return;
      }

      await apiPost('/m/attendance/batch/', token, payload);
      setRefreshKey((k) => k + 1);
    } catch {
      safeToast('Server unavailable — queued for retry', 'info');
      const queue = loadQueue();
      queue.unshift({ ...payload, timestamp: Date.now() });
      saveQueue(queue);
    } finally {
      setSaving(false);
    }
  }

  async function loadDailyReport() {
    if (!classId || !dailyDate || !token) return;
    setRptLoading(true);
    setRptError('');
    try {
      const data = await apiGet('/m/attendance/class-daily-report/', token, { class_id: classId, date: dailyDate });
      setDailyReport(data);
    } catch (e: any) {
      setRptError(e.message || 'Failed to load report');
      setDailyReport(null);
    }
    setRptLoading(false);
  }

  async function loadMonthlyReport() {
    if (!classId || !token) return;
    setRptLoading(true);
    setRptError('');
    try {
      let params: Record<string, string>;
      if (rptRangeMode === 'range') {
        params = { class_id: classId, from_date: rptFrom, to_date: rptTo };
      } else {
        params = { class_id: classId, year: String(monthYear.year), month: String(monthYear.month) };
      }
      const data = await apiGet('/m/attendance/monthly-report/', token, params);
      setMonthlyReport(data);
    } catch (e: any) {
      setRptError(e.message || 'Failed to load report');
      setMonthlyReport(null);
    }
    setRptLoading(false);
  }

  async function loadAllClassesReport() {
    if (!dailyDate || !token) return;
    setRptLoading(true);
    setRptError('');
    try {
      const data = await apiGet('/m/attendance/all-classes-daily/', token, { date: dailyDate });
      setAllClassesReport(data);
    } catch (e: any) {
      setRptError(e.message || 'Failed to load report');
      setAllClassesReport(null);
    }
    setRptLoading(false);
  }

  async function loadHolidays() {
    if (!token) return;
    setHolidayLoading(true);
    setHolidayError('');
    try {
      const data = await apiGet('/m/holidays/', token);
      setHolidays(data.holidays || []);
    } catch (e: any) {
      setHolidayError(e.message || 'Failed to load holidays');
    }
    setHolidayLoading(false);
  }

  async function addHoliday() {
    if (!hForm.date || !hForm.name.trim() || !token) return;
    setHolidaySaving(true);
    setHolidayError('');
    try {
      await apiPost('/m/holidays/', token, { date: hForm.date, name: hForm.name.trim(), type: hForm.type });
      setHForm({ date: todayStr(), name: '', type: 'public' });
      await loadHolidays();
      safeToast('Holiday added', 'success');
    } catch (e: any) {
      setHolidayError(e.message || 'Failed to add holiday');
    }
    setHolidaySaving(false);
  }

  async function addHolidayRange() {
    if (!hBulkForm.start_date || !hBulkForm.end_date || !hBulkForm.name.trim() || !token) return;
    setHolidaySaving(true);
    setHolidayError('');
    try {
      const data = await apiPost('/m/holidays/bulk/', token, { ...hBulkForm, name: hBulkForm.name.trim() });
      await loadHolidays();
      safeToast(`Added ${data.created?.length || 0} holiday(s)`, 'success');
    } catch (e: any) {
      setHolidayError(e.message || 'Failed to add holidays');
    }
    setHolidaySaving(false);
  }

  async function deleteHoliday(id: string) {
    if (!token) return;
    setHolidayError('');
    try {
      await apiDelete(`/m/holidays/${id}/`, token);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      safeToast('Holiday deleted', 'success');
    } catch (e: any) {
      setHolidayError(e.message || 'Failed to delete holiday');
    }
  }

  const canManageHolidays = teacherRole === 'admin' || teacherRole === 'monitor';

  useEffect(() => {
    if (tab === 'holidays' && token && holidays.length === 0 && !holidayLoading) {
      loadHolidays();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token]);

  const markedCount = Object.values(records).filter(s => s !== 'unmarked').length;
  const queueCount = loadQueue().length;
  const filteredTeachers = teachers.filter((t) =>
    t.name.toLowerCase().includes(teacherSearch.toLowerCase())
  );

  if (screen === 'teachers') {
    return (
      <div className="min-h-screen bg-school-paper dark:bg-[#0f0f1a] flex flex-col">
        <div className="bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 p-5 pb-8 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3"/></svg>
            </div>
            <div>
              <h1 className="font-bold text-lg">Quick Attendance</h1>
              <p className="text-sm text-white/70">Sign in with your PIN</p>
            </div>
          </div>
          {!offline && <p className="text-xs text-white/50">Select your name to begin</p>}
          {offline && <p className="text-xs text-amber-200">Offline mode — showing cached data</p>}
        </div>
        <div className="px-4 -mt-4 mb-3">
          <input
            type="text"
            value={teacherSearch}
            onChange={(e) => setTeacherSearch(e.target.value)}
            placeholder="Search teacher name..."
            className="w-full px-4 py-2.5 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8] shadow-sm"
          />
        </div>
        <div className="flex-1 px-4 pb-4 overflow-y-auto">
          {filteredTeachers.length === 0 ? (
            <div className="text-center py-12 text-school-muted text-sm">
              {teachers.length === 0 ? 'Loading teachers...' : 'No teacher matches your search'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredTeachers.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTeacher(t)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] text-left hover:border-school-accent/50 transition-colors shadow-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-school-primary to-school-accent2 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8]">{t.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Toast />
      </div>
    );
  }

  if (screen === 'pin') {
    return (
      <div className="min-h-screen bg-school-paper dark:bg-[#0f0f1a] flex flex-col">
        <div className="bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 p-5 pb-8 text-white">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={goToTeacherList} className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center hover:bg-white/25 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div>
              <h1 className="font-bold text-lg">Enter PIN</h1>
              <p className="text-sm text-white/70">{selectedTeacher?.name}</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-4">
          <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-8 w-full max-w-xs shadow-sm">
            <div className="flex justify-center gap-3 mb-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    pin.length > i
                      ? 'bg-school-accent border-school-accent'
                      : 'border-school-muted/40'
                  }`}
                />
              ))}
            </div>
            {pinError && (
              <p className="text-center text-red-500 text-sm mb-4 font-semibold">{pinError}</p>
            )}
            <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => { if (pin.length < 6) setPin((p) => p + n); }}
                  className="w-full aspect-square rounded-2xl bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8] font-bold text-xl hover:bg-school-border/50 dark:hover:bg-white/10 transition-colors active:scale-95"
                >
                  {n}
                </button>
              ))}
              <div />
              <button
                onClick={() => { if (pin.length < 6) setPin((p) => p + '0'); }}
                className="w-full aspect-square rounded-2xl bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8] font-bold text-xl hover:bg-school-border/50 dark:hover:bg-white/10 transition-colors active:scale-95"
              >
                0
              </button>
              <button
                onClick={() => setPin((p) => p.slice(0, -1))}
                className="w-full aspect-square rounded-2xl bg-school-paper dark:bg-[#2a2a3e] text-school-muted hover:bg-school-border/50 dark:hover:bg-white/10 transition-colors active:scale-95 flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM18 9l-6 6M12 9l6 6"/></svg>
              </button>
            </div>
            <button
              onClick={handlePinSubmit}
              disabled={pin.length !== 6 || pinLoading}
              className="w-full mt-6 px-4 py-3 bg-school-accent text-white rounded-xl text-sm font-bold hover:bg-school-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {pinLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : 'Verify PIN'}
            </button>
          </div>
        </div>
        <Toast />
      </div>
    );
  }

  if (screen === 'classes') {
    return (
      <div className="min-h-screen bg-school-paper dark:bg-[#0f0f1a] flex flex-col">
        <div className="bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 p-5 pb-8 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5zM6 12v5c3 3 9 3 12 0v-5"/></svg>
            </div>
            <div className="flex-1">
              <h1 className="font-bold text-lg">Select Class</h1>
              <p className="text-sm text-white/70">{selectedTeacher?.name}</p>
            </div>
            <button onClick={logout} className="px-3 py-1.5 bg-white/15 rounded-lg text-xs font-semibold hover:bg-white/25 transition-colors">
              Switch
            </button>
          </div>
        </div>
        <div className="flex-1 px-4 pt-4 pb-4 -mt-4">
          {classes.length === 0 ? (
            <div className="text-center py-12 text-school-muted text-sm">No classes assigned</div>
          ) : (
            <div className="space-y-2">
              {classes.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClass(c)}
                  className="w-full flex items-center gap-4 px-5 py-4 bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] text-left hover:border-school-accent/50 transition-colors shadow-sm"
                >
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white font-bold text-lg">
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-school-primary dark:text-[#e0e0e8]">{c.name}</div>
                    <div className="text-xs text-school-muted">Tap to mark attendance</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Toast />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-school-paper dark:bg-[#0f0f1a] flex flex-col">
      <div className="sticky top-0 z-20 bg-white dark:bg-[#1a1a2e] border-b border-school-border dark:border-[#2a2a3e]">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => setScreen('classes')} className="w-9 h-9 rounded-xl bg-school-paper dark:bg-[#2a2a3e] flex items-center justify-center hover:bg-school-border/50 dark:hover:bg-white/10 transition-colors flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] truncate">
              {classes.find((c) => c.id === classId)?.name || 'Attendance'}
            </div>
            <div className="text-[10px] text-school-muted font-medium">
              {selectedTeacher?.name} {!offline && queueCount > 0 && `· ${queueCount} pending`}
              {offline && '· Offline'}
            </div>
          </div>
          {offline && (
            <div className="px-2 py-1 bg-amber-100 dark:bg-amber-500/20 rounded-lg text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Offline
            </div>
          )}
        </div>
        <div className="flex px-4 pb-2 gap-1">
                  <button
                    onClick={() => setTab('daily')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                      tab === 'daily' ? 'bg-school-accent text-white shadow-sm' : 'bg-school-paper dark:bg-[#2a2a3e] text-school-muted'
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setTab('report')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                      tab === 'report' ? 'bg-school-accent text-white shadow-sm' : 'bg-school-paper dark:bg-[#2a2a3e] text-school-muted'
                    }`}
                  >
                    Range Report
                  </button>
                  <button
                    onClick={() => setTab('holidays')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                      tab === 'holidays' ? 'bg-school-accent text-white shadow-sm' : 'bg-school-paper dark:bg-[#2a2a3e] text-school-muted'
                    }`}
                  >
                    Holidays
                  </button>
                </div>
      </div>

      <div className="flex-1 px-4 pt-3 pb-6 overflow-y-auto space-y-3 max-w-xl mx-auto w-full">
        {tab === 'daily' ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8] col-span-2"
              />
              <select value={term} onChange={(e) => setTerm(e.target.value)} className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]">
                {Object.entries(TERM_NAMES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <input
              type="number"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]"
              placeholder="Session"
            />

            {students.length > 0 && (
              <div className="flex items-center justify-between">
                <button onClick={markAllPresent} className="px-3 py-1.5 border border-school-border rounded-xl text-xs font-semibold text-school-primary dark:text-[#e0e0e8] hover:bg-school-paper dark:hover:bg-white/5 transition-colors flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                  All Present
                </button>
                <span className="text-xs text-school-muted">{markedCount}/{students.length} marked</span>
              </div>
            )}

            {queueCount > 0 && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  {queueCount} record{queueCount > 1 ? 's' : ''} pending sync
                </span>
                {!offline && (
                  <button onClick={syncQueue} className="px-2 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-lg hover:bg-amber-600 transition-colors">
                    Sync Now
                  </button>
                )}
                <button onClick={() => { saveQueue([]); setRefreshKey((k) => k + 1); safeToast('Queue cleared', 'info'); }} className="px-2 py-1 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
                  Clear
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 border-3 border-school-primary/20 border-t-school-primary rounded-full animate-spin" />
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 text-school-muted text-sm">
                {classId ? 'No students in this class' : 'Select a class'}
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] divide-y divide-school-border/50 dark:divide-[#2a2a3e] overflow-hidden">
                {students.map((s) => {
                  const status = records[s.id] || 'unmarked';
                  const bgColor = status === 'present' ? 'bg-green-50 dark:bg-green-500/10'
                    : status === 'absent' ? 'bg-red-50 dark:bg-red-500/10'
                    : '';
                  const icon = status === 'present' ? '✓' : status === 'absent' ? '✗' : '○';
                  const iconColor = status === 'present' ? 'text-green-600'
                    : status === 'absent' ? 'text-red-600'
                    : 'text-school-muted';
                  return (
                    <button
                      key={s.id}
                      onClick={() => cycleStatus(s.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-school-paper/50 dark:hover:bg-white/5 ${bgColor}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        status !== 'unmarked' ? 'bg-white/80 dark:bg-white/10 shadow-sm ' + iconColor : 'bg-school-border/20 dark:bg-[#2a2a3e] text-school-muted'
                      }`}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8] truncate">{s.name}</div>
                        {s.roll && <div className="text-[10px] text-school-muted">Roll {s.roll}</div>}
                      </div>
                      <div className="text-[10px] font-bold uppercase text-school-muted min-w-[48px] text-right">
                        {status === 'unmarked' ? 'Tap' : STATUS_NAMES[status]}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {students.length > 0 && (
              <button
                onClick={handleSave}
                disabled={saving || markedCount === 0}
                className="w-full px-4 py-3 bg-school-accent text-white rounded-xl text-sm font-bold hover:bg-school-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
              >
                {saving ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                )}
                {saving ? 'Saving...' : `Save (${markedCount})`}
              </button>
            )}
          </>
                  ) : tab === 'holidays' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-school-muted">School Holidays</span>
                        <button onClick={loadHolidays} disabled={holidayLoading} className="px-3 py-1.5 border border-school-border rounded-xl text-xs font-semibold text-school-primary dark:text-[#e0e0e8] hover:bg-school-paper dark:hover:bg-white/5 transition-colors">
                          {holidayLoading ? '...' : 'Refresh'}
                        </button>
                      </div>
                      {holidayError && <div className="text-red-500 text-sm">{holidayError}</div>}
                      {canManageHolidays && (
                        <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border p-3 space-y-3 shadow-sm">
                          <div className="text-xs font-bold text-school-primary dark:text-[#e0e0e8]">Add Holiday</div>
                          <div className="flex gap-2">
                            <input type="date" value={hForm.date} onChange={e => setHForm(p => ({ ...p, date: e.target.value }))} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e] text-school-primary" />
                            <select value={hForm.type} onChange={e => setHForm(p => ({ ...p, type: e.target.value }))} className="w-28 px-3 py-2 border border-school-border rounded-xl text-sm bg-white dark:bg-[#1a1a2e] text-school-primary">
                              <option value="public">Public</option>
                              <option value="school">School Event</option>
                            </select>
                          </div>
                          <input type="text" value={hForm.name} onChange={e => setHForm(p => ({ ...p, name: e.target.value }))} placeholder="Holiday name (e.g. Eid Day)" className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e] text-school-primary" />
                          <button onClick={addHoliday} disabled={holidaySaving || !hForm.date || !hForm.name.trim()} className="w-full px-4 py-2 bg-school-accent text-white rounded-xl text-sm font-bold disabled:opacity-50 shadow-sm">
                            {holidaySaving ? '...' : 'Add Single Day'}
                          </button>
                          <div className="border-t border-school-border/50 pt-3 text-xs font-bold text-school-muted">Long Holiday (range)</div>
                          <div className="flex gap-2">
                            <input type="date" value={hBulkForm.start_date} onChange={e => setHBulkForm(p => ({ ...p, start_date: e.target.value }))} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm bg-white dark:bg-[#1a1a2e] text-school-primary" />
                            <input type="date" value={hBulkForm.end_date} onChange={e => setHBulkForm(p => ({ ...p, end_date: e.target.value }))} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm bg-white dark:bg-[#1a1a2e] text-school-primary" />
                          </div>
                          <input type="text" value={hBulkForm.name} onChange={e => setHBulkForm(p => ({ ...p, name: e.target.value }))} placeholder="Name (all dates)" className="w-full px-3 py-2 border border-school-border rounded-xl text-sm bg-white dark:bg-[#1a1a2e] text-school-primary" />
                          <button onClick={addHolidayRange} disabled={holidaySaving || !hBulkForm.start_date || !hBulkForm.end_date || !hBulkForm.name.trim()} className="w-full px-4 py-2 bg-school-secondary text-white rounded-xl text-sm font-bold disabled:opacity-50 shadow-sm">
                            {holidaySaving ? '...' : 'Add Range'}
                          </button>
                        </div>
                      )}
                      {holidayLoading ? (
                        <div className="flex justify-center py-8">
                          <div className="w-6 h-6 border-2 border-school-primary/20 border-t-school-primary rounded-full animate-spin" />
                        </div>
                      ) : holidays.length === 0 ? (
                        <div className="text-center py-10 text-school-muted text-sm">No holidays found</div>
                      ) : (
                        <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border divide-y divide-school-border/50 overflow-hidden shadow-sm">
                          {holidays.map((h) => (
                            <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold ${h.type === 'school' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                                {h.type === 'school' ? 'SE' : 'PH'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8] truncate">{h.name}</div>
                                <div className="text-[10px] text-school-muted">{h.date}</div>
                              </div>
                              {canManageHolidays && (
                                <button onClick={() => deleteHoliday(h.id)} className="px-2 py-1 text-[10px] font-bold text-red-500 border border-red-200 dark:border-red-500/30 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                                  Delete
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
          <>
            <div className="flex bg-school-paper dark:bg-[#2a2a3e] p-1 rounded-xl mb-4 mt-2 border border-school-border/50">
              <button onClick={() => { setRptTab('daily'); setDailyReport(null); setRptError(''); }} className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg ${rptTab === 'daily' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>Daily Report</button>
              <button onClick={() => { setRptTab('monthly'); setMonthlyReport(null); setRptError(''); }} className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg ${rptTab === 'monthly' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>Monthly Report</button>
            </div>

            {rptTab === 'daily' && (
                          <div className="space-y-3">
                            <div className="flex bg-school-paper dark:bg-[#2a2a3e] p-1 rounded-xl border border-school-border/50">
                              <button onClick={() => { setRptSub('classwise'); setDailyReport(null); setRptError(''); }} className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg ${rptSub === 'classwise' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>Class-wise</button>
                              <button onClick={() => { setRptSub('allclasses'); setAllClassesReport(null); setRptError(''); }} className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg ${rptSub === 'allclasses' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>All Classes</button>
                            </div>
                            <div className="flex gap-2">
                              <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary" />
                              <button onClick={rptSub === 'classwise' ? loadDailyReport : loadAllClassesReport} disabled={!dailyDate || rptLoading} className="px-4 py-2 bg-school-accent text-white rounded-xl text-sm font-bold flex items-center justify-center min-w-[80px] shadow-sm">
                                {rptLoading ? '...' : 'Load'}
                              </button>
                            </div>
                            {rptError && <div className="text-red-500 text-sm">{rptError}</div>}
                            {rptSub === 'allclasses' && allClassesReport && (
                              <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border p-3 overflow-x-auto shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-school-muted">All Classes · {allClassesReport.date}</span>
                                  <button onClick={async () => {
                                                          const jsPDF = (await import('jspdf')).default;
                                                          const { autoTable } = await import('jspdf-autotable');
                                                          const doc = new jsPDF(); doc.text(`All Classes Daily Report - ${allClassesReport.date}`, 14, 15);
                                                                                                                    const head = [['Class', 'Total', 'Present', 'Absent', 'Unmarked']];
                                                                                                                    const body = allClassesReport.classes.map((c: any) => [c.class.name, c.total_students, c.present, c.absent, c.unmarked]);
                                                                                                                    const tot = allClassesReport.classes.reduce((acc: any, c: any) => ({ total: acc.total + (Number(c.total_students) || 0), present: acc.present + (Number(c.present) || 0), absent: acc.absent + (Number(c.absent) || 0), unmarked: acc.unmarked + (Number(c.unmarked) || 0) }), { total: 0, present: 0, absent: 0, unmarked: 0 });
                                                                                                                    autoTable(doc, {
                                                                                                                                                                              head,
                                                                                                                                                                              body,
                                                                                                                      startY: 20,
                                                                                                                      foot: [['Total', tot.total, tot.present, tot.absent, tot.unmarked]],
                                                                                                                      footStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
                                                                                                                    });
                                                                                                                    doc.save(`all_classes_${allClassesReport.date}.pdf`);
                                                        }} className="px-2 py-1 text-[10px] font-bold bg-school-accent text-white rounded-md shadow-sm">PDF</button>
                                </div>
                                <table className="w-full text-xs text-left">
                                  <thead><tr className="border-b"><th className="pb-1 text-school-muted">Class</th><th className="pb-1 text-school-muted">Total</th><th className="pb-1 text-green-600">P</th><th className="pb-1 text-red-600">A</th><th className="pb-1 text-school-muted">U</th></tr></thead>
                                  <tbody>
                                    {allClassesReport.classes.map((c: any) => (
                                      <tr key={c.class.id} className="border-b last:border-0 border-school-border/50">
                                        <td className="py-1.5 font-medium">{c.class.name}</td>
                                        <td className="py-1.5 text-school-muted">{c.total_students}</td>
                                        <td className="py-1.5 text-green-600 font-bold">{c.present}</td>
                                        <td className="py-1.5 text-red-600 font-bold">{c.absent}</td>
                                        <td className="py-1.5 text-school-muted">{c.unmarked}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t-2 border-school-accent bg-school-accent/10 font-bold">
                                      <td className="py-1.5 text-school-accent">Total</td>
                                      <td className="py-1.5 text-school-accent">{allClassesReport.classes.reduce((acc: number, c: any) => acc + (Number(c.total_students) || 0), 0)}</td>
                                      <td className="py-1.5 text-green-600">{allClassesReport.classes.reduce((acc: number, c: any) => acc + (Number(c.present) || 0), 0)}</td>
                                      <td className="py-1.5 text-red-600">{allClassesReport.classes.reduce((acc: number, c: any) => acc + (Number(c.absent) || 0), 0)}</td>
                                      <td className="py-1.5 text-school-muted">{allClassesReport.classes.reduce((acc: number, c: any) => acc + (Number(c.unmarked) || 0), 0)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            )}
                            {rptSub === 'classwise' && dailyReport && (
                              <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border p-3 overflow-x-auto shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-school-muted">{dailyReport.total_students} students · <span className="text-green-600">P: {dailyReport.present}</span> · <span className="text-red-600">A: {dailyReport.absent}</span></span>
                                  <button onClick={async () => {
                                                          const jsPDF = (await import('jspdf')).default;
                                                          const { autoTable } = await import('jspdf-autotable');
                                                          const doc = new jsPDF(); doc.text(`Daily Report - ${dailyReport.date}`, 14, 15);
                                                          const head = [['Name', 'Roll', 'Status']];
                                                          const body = dailyReport.students.map((s: any) => [s.name, s.roll || '-', STATUS_NAMES[s.status] || s.status]);
                                                          autoTable(doc, { head, body, startY: 20 });
                                                          doc.save(`daily_report_${dailyReport.date}.pdf`);
                                                        }} className="px-2 py-1 text-[10px] font-bold bg-school-accent text-white rounded-md shadow-sm">PDF</button>
                                </div>
                                <table className="w-full text-xs text-left">
                                  <thead><tr className="border-b"><th className="pb-1 text-school-muted">Name</th><th className="pb-1 text-school-muted">Roll</th><th className="pb-1 text-school-muted">Status</th></tr></thead>
                                  <tbody>
                                    {dailyReport.students.map((s: any) => (
                                      <tr key={s.id} className="border-b last:border-0 border-school-border/50">
                                        <td className="py-1.5 font-medium">{s.name}</td><td className="py-1.5 text-school-muted">{s.roll}</td>
                                        <td className={`py-1.5 font-bold ${s.status === 'present' ? 'text-green-600' : s.status === 'absent' ? 'text-red-600' : 'text-school-muted'}`}>
                                          {STATUS_NAMES[s.status] || s.status}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

            {rptTab === 'monthly' && (
              <div className="space-y-3">
                <div className="flex bg-school-border/30 dark:bg-[#2a2a3e]/50 rounded-xl p-1">
                  <button onClick={() => setRptRangeMode('month')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${rptRangeMode === 'month' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>
                    Month
                  </button>
                  <button onClick={() => setRptRangeMode('range')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${rptRangeMode === 'range' ? 'bg-white dark:bg-[#1a1a2e] text-school-primary shadow-sm' : 'text-school-muted'}`}>
                    Date Range
                  </button>
                </div>
                {rptRangeMode === 'range' ? (
                  <div className="flex gap-2">
                    <input type="date" value={rptFrom} onChange={e => setRptFrom(e.target.value)} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e]" />
                    <input type="date" value={rptTo} onChange={e => setRptTo(e.target.value)} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e]" />
                    <button onClick={loadMonthlyReport} disabled={rptLoading || !rptFrom || !rptTo || rptFrom > rptTo} className="px-4 py-2 bg-school-accent text-white rounded-xl text-sm font-bold min-w-[80px] shadow-sm disabled:opacity-50">
                      {rptLoading ? '...' : 'Load'}
                    </button>
                  </div>
                ) : (
                <div className="flex gap-2">
                  <input type="number" value={monthYear.year} onChange={e => setMonthYear(p => ({...p, year: parseInt(e.target.value)}))} className="w-20 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e]" />
                  <select value={monthYear.month} onChange={e => setMonthYear(p => ({...p, month: parseInt(e.target.value)}))} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none bg-white dark:bg-[#1a1a2e]">
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{monthName(m)}</option>)}
                  </select>
                  <button onClick={loadMonthlyReport} disabled={rptLoading} className="px-4 py-2 bg-school-accent text-white rounded-xl text-sm font-bold min-w-[80px] shadow-sm">
                    {rptLoading ? '...' : 'Load'}
                  </button>
                </div>
                )}
                {rptError && <div className="text-red-500 text-sm">{rptError}</div>}
                {monthlyReport && (
                  <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border overflow-hidden shadow-sm">
                    <div className="p-3 border-b flex items-center justify-between">
                      <span className="text-xs font-bold text-school-primary">{monthlyReport.from_date ? `${monthlyReport.from_date} → ${monthlyReport.to_date}` : `${monthName(monthlyReport.month)} ${monthlyReport.year}`}</span>
                      <button onClick={async () => {
                                              const jsPDF = (await import('jspdf')).default;
                                              const { autoTable } = await import('jspdf-autotable');
                                              const isR = Boolean(monthlyReport.from_date && monthlyReport.to_date);
                                              const hdr = isR ? `Attendance Register ${monthlyReport.from_date} to ${monthlyReport.to_date}` : `Attendance Register - ${monthName(monthlyReport.month)} ${monthlyReport.year}`;
                                              const doc = new jsPDF({ orientation: 'landscape' });
                                              const days = monthlyReport.days || [];
                                              const head = [['Name', ...days.map((d: any) => String(Number(d.date.slice(8, 10)))), 'P']];
                                              const body = (monthlyReport.students || []).map((s: any) => {
                                                const row = (monthlyReport.student_days || {})[s.id] || {};
                                                let pc = 0;
                                                days.forEach((d: any) => { if (row[d.date] === 'present') pc++; });
                                                const cells = days.map((d: any) => {
                                                  const st = row[d.date];
                                                  const off = d.type === 'weekend' || d.type === 'holiday';
                                                  return st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'late' ? 'L' : st === 'excused' ? 'E' : (off ? '' : '');
                                                });
                                                return [s.name, ...cells, String(pc)];
                                              });
                                              doc.text(hdr, 14, 15);
                                              autoTable(doc, { head, body, startY: 20, styles: { fontSize: 7, cellPadding: 1.2 }, columnStyles: { 0: { cellWidth: 52, halign: 'left' } } });
                                              const fname = isR ? `attendance_register_${monthlyReport.from_date}_to_${monthlyReport.to_date}.pdf` : `attendance_register_${monthlyReport.year}_${monthlyReport.month}.pdf`;
                                              doc.save(fname);
                                            }} className="px-2 py-1 text-[10px] font-bold bg-school-accent text-white rounded-md shadow-sm">PDF</button>
                    </div>
                    <div className="overflow-x-auto p-2">
                      <table className="text-xs" style={{ minWidth: 110 + (monthlyReport.days?.length || 0) * 22 + 48 }}>
                        <thead>
                          <tr className="border-b">
                            <th className="pb-1 pr-2 text-left text-school-muted sticky left-0 bg-white dark:bg-[#1a1a2e]">Name</th>
                            {(monthlyReport.days || []).map((d: any) => {
                              const off = d.type === 'weekend' || d.type === 'holiday';
                              return <th key={d.date} className={'pb-1 px-0.5 text-center ' + (off ? 'text-school-muted/50' : 'text-school-primary')}>{Number(d.date.slice(8,10))}</th>;
                            })}
                            <th className="pb-1 px-1 text-center text-green-600">P</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(monthlyReport.students || []).map((s: any) => {
                            const row = (monthlyReport.student_days || {})[s.id] || {};
                            let pc = 0;
                            (monthlyReport.days || []).forEach((d: any) => { if (row[d.date] === 'present') pc++; });
                            return (
                              <tr key={s.id} className="border-b last:border-0 border-school-border/50">
                                <td className="py-1 pr-2 text-left font-medium sticky left-0 bg-white dark:bg-[#1a1a2e] truncate max-w-[110px]" title={s.name}>{s.name}</td>
                                {(monthlyReport.days || []).map((d: any) => {
                                  const st = row[d.date];
                                  const off = d.type === 'weekend' || d.type === 'holiday';
                                  const cell = st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'late' ? 'L' : st === 'excused' ? 'E' : (off ? '·' : '');
                                  const cls = st === 'present' ? 'text-green-600 font-bold' : st === 'absent' ? 'text-red-600 font-bold' : st === 'late' ? 'text-amber-600 font-bold' : st === 'excused' ? 'text-blue-600 font-bold' : 'text-school-muted/40';
                                  return <td key={d.date} className={'py-1 px-0.5 text-center ' + cls}>{cell}</td>;
                                })}
                                <td className="py-1 px-1 text-center font-bold text-green-600 bg-school-paper/50 dark:bg-[#2a2a3e]/30">{pc}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <Toast />
    </div>
  );
}
