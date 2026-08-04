import { useEffect, useMemo, useState } from 'react';
import { api, useAuthStore } from '../store';
import { toast } from './Toast';
import {
  CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, Info,
} from 'lucide-react';
import type { Holiday } from '../lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function isoStr(year: number, month0: number, day: number) {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function HolidaysPanel() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'monitor';

  const now = new Date();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* calendar view */
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  /* add form */
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'school'>('public');
  const [rangeMode, setRangeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const fetchHolidays = function () {
    setLoading(true);
    api.get('/holidays/', { params: { limit: 1000 } })
      .then(function (res: any) {
        const list = (res.data.results || res.data || []) as Holiday[];
        list.sort(function (a, b) { return a.date.localeCompare(b.date); });
        setHolidays(list);
      })
      .catch(function () { toast('Failed to load holidays', 'error'); })
      .finally(function () { setLoading(false); });
  };

  useEffect(function () { fetchHolidays(); }, []);

  const holidayMap = useMemo(function () {
    const m: Record<string, Holiday> = {};
    holidays.forEach(function (h) { m[h.date] = h; });
    return m;
  }, [holidays]);

  const todayStr = isoStr(now.getFullYear(), now.getMonth(), now.getDate());

  /* month grid: leading nulls for weekday offset, trailing nulls to fill the week */
  const grid = useMemo(function () {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = function () {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = function () {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const toggleDay = function (d: number) {
    if (!canManage) return;
    const key = isoStr(viewYear, viewMonth, d);
    setSelected(function (prev: string[]) {
      if (!rangeMode) {
        return prev.length === 1 && prev[0] === key ? [] : [key];
      }
      if (prev.includes(key)) {
        return prev.filter(function (x) { return x !== key; });
      }
      if (prev.length >= 2) {
        return [prev[1], key]; // rolling start/end window
      }
      return [...prev, key];
    });
  };

  const handleAdd = async function () {
    if (!name.trim()) { toast('Enter a holiday name', 'error'); return; }
    if (selected.length === 0) { toast('Pick a date from the calendar', 'error'); return; }
    setSaving(true);
    try {
      if (rangeMode && selected.length === 2) {
        const [a, b] = [...selected].sort();
        const res = await api.post('/holidays/bulk/', {
          start_date: a, end_date: b, name: name.trim(), type,
        });
        const created = res.data.created;
        const skipped = (res.data.skipped || []).length;
        toast(`Added ${created} day${created === 1 ? '' : 's'}${skipped ? ` (${skipped} already existed)` : ''}`, 'success');
      } else {
        await api.post('/holidays/', {
          date: selected[0], name: name.trim(), type,
        });
        toast('Holiday added', 'success');
      }
      setName(''); setSelected([]);
      fetchHolidays();
    } catch (e: any) {
      toast((e.response && e.response.data && e.response.data.error) || 'Failed to add holiday', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async function (h: Holiday) {
    setSaving(true);
    try {
      await api.delete('/holidays/' + h.id + '/');
      toast(`Removed "${h.name}"`, 'success');
      fetchHolidays();
    } catch (_) {
      toast('Failed to remove holiday', 'error');
    }
    setSaving(false);
  };

  const upcoming = holidays.filter(function (h) { return h.date >= todayStr; });
  const past = holidays.filter(function (h) { return h.date < todayStr; });

  return (
    <div className="space-y-4">
      {/* Weekly holidays — fixed for Bangladesh */}
      <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-4 py-3">
        <Info size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">Weekly holidays: Friday &amp; Saturday</div>
          <div className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Applied automatically to every week — attendance cannot be marked on these days. No action needed.
          </div>
        </div>
      </div>

      {canManage && (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-school-primary dark:text-[#e0e0e8]">
              <CalendarDays size={16} /> Add holiday
            </div>
            <button
              onClick={function () { setRangeMode(!rangeMode); setSelected([]); }}
              className={'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ' +
                (rangeMode
                  ? 'bg-school-primary border-school-primary text-white'
                  : 'border-school-border text-school-muted hover:bg-school-paper dark:hover:bg-white/5')}
            >
              {rangeMode ? 'Range: pick start → end' : 'Single day'}
            </button>
          </div>

          <input
            value={name}
            onChange={function (e) { setName(e.target.value); }}
            placeholder="Holiday name (e.g. Eid ul-Fitr, Winter Break)"
            className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]"
          />

          <div className="flex gap-2">
            <select
              value={type}
              onChange={function (e) { setType(e.target.value as 'public' | 'school'); }}
              className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]"
            >
              <option value="public">Public holiday</option>
              <option value="school">School event</option>
            </select>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-school-primary text-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {rangeMode && selected.length === 2 ? 'Add range' : 'Add holiday'}
            </button>
          </div>

          {/* Month calendar picker */}
          <div className="rounded-xl border border-school-border dark:border-[#2a2a3e] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-school-paper dark:bg-[#2a2a3e]/60">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-school-border/30 dark:hover:bg-white/5 text-school-muted">
                <ChevronLeft size={16} />
              </button>
              <div className="text-sm font-semibold text-school-primary dark:text-[#e0e0e8]">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </div>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-school-border/30 dark:hover:bg-white/5 text-school-muted">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center">
              {WEEKDAY_LABELS.map(function (w, i) {
                return (
                  <div key={w} className={'py-1.5 text-[10px] font-bold uppercase ' + (i === 5 || i === 6 ? 'text-red-400' : 'text-school-muted')}>
                    {w}
                  </div>
                );
              })}
              {grid.map(function (d, idx) {
                if (d === null) return <div key={'x' + idx} />;
                const key = isoStr(viewYear, viewMonth, d);
                const isHoliday = !!holidayMap[key];
                const isWeekend = new Date(viewYear, viewMonth, d).getDay() === 5 || new Date(viewYear, viewMonth, d).getDay() === 6;
                const isSelected = selected.includes(key);
                const isToday = key === todayStr;
                return (
                  <button
                    key={key}
                    onClick={function () { toggleDay(d); }}
                    disabled={!canManage}
                    className={'relative aspect-square flex flex-col items-center justify-center text-xs rounded-lg transition-colors ' +
                      (isSelected
                        ? 'bg-school-primary text-white font-bold'
                        : isHoliday
                          ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold'
                          : isWeekend
                            ? 'text-school-muted/50'
                            : 'text-school-primary dark:text-[#e0e0e8] hover:bg-school-paper dark:hover:bg-white/5')}
                  >
                    {d}
                    {isHoliday && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-amber-500" />}
                    {isToday && !isSelected && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-school-accent" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-school-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Existing holiday</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-school-accent inline-block" /> Today</span>
            {rangeMode && selected.length === 2 && (
              <span className="text-school-primary dark:text-[#e0e0e8] font-medium">
                Range: {selected.sort()[0]} → {selected.sort()[1]} ({Math.round((new Date(selected.sort()[1]).getTime() - new Date(selected.sort()[0]).getTime()) / 86400000) + 1} days)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Holiday list */}
      <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4">
        <div className="text-sm font-semibold text-school-primary dark:text-[#e0e0e8] mb-3">Holidays</div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-school-muted" /></div>
        ) : holidays.length === 0 ? (
          <div className="text-center py-8 text-school-muted text-sm">No holidays yet — add one from the calendar above</div>
        ) : (
          <div className="space-y-4">
            {upcoming.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-school-muted mb-1.5">Upcoming</div>
                <div className="divide-y divide-school-border/50 dark:divide-[#2a2a3e]">
                  {upcoming.map(function (h) {
                    const d = new Date(h.date + 'T00:00:00');
                    return (
                      <div key={h.id} className="flex items-center gap-3 py-2.5">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex flex-col items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">{WEEKDAY_LABELS[d.getDay()]}</span>
                          <span className="text-sm font-bold text-amber-700 dark:text-amber-300 leading-none">{d.getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-school-primary dark:text-[#e0e0e8] truncate">{h.name}</div>
                          <div className="text-[10px] text-school-muted uppercase">{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {h.type === 'public' ? 'Public' : 'School event'}</div>
                        </div>
                        {canManage && (
                          <button onClick={function () { handleDelete(h); }} className="p-2 rounded-lg text-school-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" aria-label={'Remove ' + h.name}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-school-muted mb-1.5">Past</div>
                <div className="divide-y divide-school-border/50 dark:divide-[#2a2a3e]">
                  {past.slice(-15).reverse().map(function (h) {
                    const d = new Date(h.date + 'T00:00:00');
                    return (
                      <div key={h.id} className="flex items-center gap-3 py-2.5 opacity-70">
                        <div className="w-10 h-10 rounded-xl bg-school-border/20 dark:bg-[#2a2a3e] flex flex-col items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold uppercase text-school-muted">{WEEKDAY_LABELS[d.getDay()]}</span>
                          <span className="text-sm font-bold text-school-muted leading-none">{d.getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-school-muted truncate">{h.name}</div>
                          <div className="text-[10px] text-school-muted/70 uppercase">{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
                        </div>
                        {canManage && (
                          <button onClick={function () { handleDelete(h); }} className="p-2 rounded-lg text-school-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" aria-label={'Remove ' + h.name}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
