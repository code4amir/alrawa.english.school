import { useState, useEffect } from 'react';
import { api, useSchoolStore } from '../store';
import Toast, { toast } from '../components/Toast';
import { TERM_NAMES } from '../lib/config';
import { CalendarCheck, Check, X, Loader2, Download, FileText,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import HolidaysPanel from '../components/HolidaysPanel';

type StatusType = 'present' | 'absent' | 'unmarked';
type Tab = 'daily' | 'report' | 'holidays';
type RptTab = 'daily' | 'monthly';
type DailySub = 'classwise' | 'allclasses';

interface StudentInfo { id: string; name: string; roll: string; }
interface DailyReportData {
  class: { id: string; name: string };
  date: string;
  total_students: number;
  present: number;
  absent: number;
  unmarked: number;
  students: { id: string; name: string; roll: string; status: string }[];
}
interface AllClassesDailyData {
  date: string;
  classes: { class: { id: string; name: string }; total_students: number; present: number; absent: number; unmarked: number }[];
}
interface MonthlyReportData {
  class: { id: string; name: string };
  year: number;
  month: number;
  from_date?: string;
  to_date?: string;
  students: StudentInfo[];
  days: { date: string; weekday: number; type: string; present: number; absent: number; unmarked: number }[];
  student_days?: Record<string, Record<string, string | null>>;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function monthName(m: number) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '';
}

/* --- PDF helpers --- */

async function getJsPDF() {
  const mod = await import('jspdf');
  return mod.default;
}

async function downloadDailyReportPDF(data: DailyReportData) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ format: 'a4', unit: 'mm' });
  const M = 12, W = 210, CW = W - M * 2;
  const NAVY = [26, 26, 46] as const, MUTED = [130, 124, 114] as const;
  let y = 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY);
  doc.text('Daily Attendance Report', M, y); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text(data.class.name + ' --- ' + data.date, M, y); y += 8;
  doc.setFontSize(9);
  doc.text('Total: ' + data.total_students + '  |  Present: ' + data.present + '  |  Absent: ' + data.absent + '  |  Unmarked: ' + data.unmarked, M, y); y += 10;

  const HH = 7, RH = 6;
  doc.setFillColor(...NAVY); doc.rect(M, y, CW, HH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  const colW = [CW * 0.2, CW * 0.4, CW * 0.2];
  doc.text('Roll', M + 2, y + 4.5);
  doc.text('Name', M + colW[0] + 2, y + 4.5);
  doc.text('Status', M + colW[0] + colW[1] + 2, y + 4.5);
  y += HH;
  data.students.forEach(function(s, ri) {
    if (y > 275) { doc.addPage(); y = 14; }
    doc.setFillColor(ri % 2 === 0 ? 255 : 244, ri % 2 === 0 ? 253 : 239, ri % 2 === 0 ? 247 : 230);
    doc.rect(M, y, CW, RH, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...NAVY);
    doc.text(s.roll || '---', M + 2, y + 4);
    doc.text(s.name, M + colW[0] + 2, y + 4);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(s.status === 'present' ? 22 : 185, s.status === 'present' ? 163 : 28, s.status === 'present' ? 74 : 28);
    doc.text(s.status.charAt(0).toUpperCase() + s.status.slice(1), M + colW[0] + colW[1] + 2, y + 4);
    y += RH;
  });
  doc.save('Attendance_' + data.class.name + '_' + data.date + '.pdf');
}

async function downloadAllClassesPDF(data: AllClassesDailyData) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ format: 'a4', unit: 'mm' });
  const M = 12, W = 210, CW = W - M * 2;
  const NAVY = [26, 26, 46] as const, MUTED = [130, 124, 114] as const;
  let y = 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY);
  doc.text('All Classes --- Daily Attendance', M, y); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text('Date: ' + data.date, M, y); y += 10;

  const HH = 7, RH = 6;
  doc.setFillColor(...NAVY); doc.rect(M, y, CW, HH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  const cols = [CW * 0.3, CW * 0.175, CW * 0.175, CW * 0.175, CW * 0.175];
  doc.text('Class', M + 2, y + 4.5);
  doc.text('Total', M + cols[0] + 2, y + 4.5);
  doc.text('Present', M + cols[0] * 2 + 2, y + 4.5);
  doc.text('Absent', M + cols[0] * 3 + 2, y + 4.5);
  doc.text('Unmarked', M + cols[0] * 4 + 2, y + 4.5);
  y += HH;
  let gTot = 0, gPre = 0, gAbs = 0;
  data.classes.forEach(function(c, ri) {
    if (y > 275) { doc.addPage(); y = 14; }
    doc.setFillColor(ri % 2 === 0 ? 255 : 244, ri % 2 === 0 ? 253 : 239, ri % 2 === 0 ? 247 : 230);
    doc.rect(M, y, CW, RH, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...NAVY);
    doc.text(c.class.name, M + 2, y + 4);
    doc.text(String(c.total_students), M + cols[0] + 2, y + 4);
    doc.text(String(c.present), M + cols[0] * 2 + 2, y + 4);
    doc.text(String(c.absent), M + cols[0] * 3 + 2, y + 4);
    doc.text(String(c.unmarked), M + cols[0] * 4 + 2, y + 4);
    y += RH;
    gTot += c.total_students; gPre += c.present; gAbs += c.absent;
  });
  doc.setDrawColor(100); doc.setLineWidth(0.3); doc.line(M, y, M + CW, y); y += 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY);
  doc.text('Grand Total: ' + gTot + '  |  Total Present: ' + gPre + '  |  Total Absent: ' + gAbs, M, y + 4);
  doc.save('All_Classes_Attendance_' + data.date + '.pdf');
}

async function downloadMonthlyPDF(data: MonthlyReportData) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ format: 'a4', unit: 'mm', orientation: 'landscape' });
  const M = 10, W = 297;
  const NAVY = [26, 26, 46] as const, MUTED = [130, 124, 114] as const, WHITE = [255, 255, 255] as const;
  const isRange = Boolean(data.from_date && data.to_date);
  let y = 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NAVY);
  doc.text(isRange ? 'Attendance Register (Date Range)' : 'Monthly Attendance Register', M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(isRange
    ? data.class.name + ' --- ' + data.from_date + ' to ' + data.to_date
    : data.class.name + ' --- ' + monthName(data.month) + ' ' + data.year, M, y); y += 7;

  // Register matrix: Name | one col per day | Total P
  const NAME_W = 52, TOT_W = 14, CW = W - M * 2;
  const dayW = Math.max(6, (CW - NAME_W - TOT_W) / Math.max(data.days.length, 1));
  const HH = 7, RH = 6.5;

  doc.setFillColor(...NAVY); doc.rect(M, y, CW, HH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...WHITE);
  doc.text('Name', M + 2, y + 4.5);
  data.days.forEach(function (d, i) {
    const cx = M + NAME_W + i * dayW + dayW / 2;
    const off = d.type === 'weekend' || d.type === 'holiday';
    doc.setTextColor(off ? 180 : 255, off ? 180 : 255, off ? 190 : 255);
    doc.text(String(Number(d.date.slice(8, 10))), cx, y + 4.5, { align: 'center' });
  });
  doc.setTextColor(255, 255, 255);
  doc.text('P', M + NAME_W + data.days.length * dayW + TOT_W / 2, y + 4.5, { align: 'center' });
  y += HH;

  data.students.forEach(function (s, ri) {
    if (y > 195) { doc.addPage(); y = 12; }
    const row = (data.student_days || {})[s.id] || {};
    let presentCount = 0;
    data.days.forEach(function (d) { if (row[d.date] === 'present') presentCount++; });
    if (ri % 2) { doc.setFillColor(249, 250, 251); doc.rect(M, y, CW, RH, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...NAVY);
    let nm = (s.roll ? s.roll + '. ' : '') + s.name;
    while (doc.getTextWidth(nm) > NAME_W - 4 && nm.length > 3) nm = nm.slice(0, -1);
    doc.text(nm, M + 2, y + 4.5);
    data.days.forEach(function (d, i) {
      const st = row[d.date];
      const off = d.type === 'weekend' || d.type === 'holiday';
      const cx = M + NAME_W + i * dayW + dayW / 2;
      if (st === 'present') { doc.setTextColor(22, 163, 74); doc.text('P', cx, y + 4.5, { align: 'center' }); }
      else if (st === 'absent') { doc.setTextColor(220, 38, 38); doc.text('A', cx, y + 4.5, { align: 'center' }); }
      else if (st === 'late') { doc.setTextColor(217, 119, 6); doc.text('L', cx, y + 4.5, { align: 'center' }); }
      else if (st === 'excused') { doc.setTextColor(37, 99, 235); doc.text('E', cx, y + 4.5, { align: 'center' }); }
      else if (off) { doc.setTextColor(200, 200, 205); doc.text('·', cx, y + 4.5, { align: 'center' }); }
      doc.setTextColor(...NAVY);
    });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 163, 74);
    doc.text(String(presentCount), M + NAME_W + data.days.length * dayW + TOT_W / 2, y + 4.5, { align: 'center' });
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(215, 210, 200); doc.setLineWidth(0.1);
    doc.line(M, y + RH, M + CW, y + RH);
    y += RH;
  });

  const netDays = data.days.filter(function (d) { return d.type !== 'weekend' && d.type !== 'holiday'; }).length;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY);
  doc.text('Net School Days: ' + netDays + '   P = Present, A = Absent, L = Late, E = Excused', M, y + 5);
  const fname = isRange
    ? 'Attendance_Register_' + data.class.name + '_' + data.from_date + '_to_' + data.to_date + '.pdf'
    : 'Attendance_Register_' + data.class.name + '_' + monthName(data.month) + '_' + data.year + '.pdf';
  doc.save(fname);
}

/* --- Main component --- */

export default function AttendanceSection() {
  const { classes, fetchClasses } = useSchoolStore();
  const [tab, setTab] = useState<Tab>('daily');
  const [rptTab, setRptTab] = useState<RptTab>('daily');
  const [dailySub, setDailySub] = useState<DailySub>('classwise');

  /* daily marking */
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [term, setTerm] = useState('1');
  const [session, setSession] = useState(String(new Date().getFullYear()));
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [records, setRecords] = useState<Record<string, StatusType>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* daily report */
  const [dailyClassId, setDailyClassId] = useState('');
  const [dailyDate, setDailyDate] = useState(todayStr());
  const [dailyReport, setDailyReport] = useState<DailyReportData | null>(null);
  const [allClassesReport, setAllClassesReport] = useState<AllClassesDailyData | null>(null);
  const [rptLoading, setRptLoading] = useState(false);
  const [rptError, setRptError] = useState('');

  /* monthly report */
  const [monthlyClassId, setMonthlyClassId] = useState('');
  const [monthYear, setMonthYear] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
  const [rptRangeMode, setRptRangeMode] = useState<'month' | 'range'>('month');
  const [rptFrom, setRptFrom] = useState(todayStr());
  const [rptTo, setRptTo] = useState(todayStr());
  const [monthlyData, setMonthlyData] = useState<MonthlyReportData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState('');

  useEffect(function () { fetchClasses(); }, [fetchClasses]);

  /* load students for daily marking */
  useEffect(function () {
    if (!classId) return;
    setLoading(true);
    api.get('/students/', { params: { class_id: classId, limit: 200 } })
      .then(function (res: any) {
        var list = (res.data.results || res.data).map(function (s: any) { return { id: s.id, name: s.name, roll: s.roll || '' }; });
        list.sort(function (a: any, b: any) { return String(a.roll || '').localeCompare(String(b.roll || ''), undefined, { numeric: true }); });
        setStudents(list);
      })
      .catch(function () { toast('Failed to load students', 'error'); })
      .finally(function () { setLoading(false); });
  }, [classId]);

  /* load existing attendance for daily marking */
  useEffect(function () {
    if (!classId || !date || tab !== 'daily') return;
    api.get('/attendance/', { params: { class_id: classId, date: date } })
      .then(function (res: any) {
        var data = res.data.results || res.data;
        var map: Record<string, StatusType> = {};
        data.forEach(function (r: any) { if (r.status === 'present' || r.status === 'absent') map[r.student] = r.status; });
        setRecords(map);
      })
      .catch(function () { setRecords({}); });
  }, [classId, date, tab]);

  var markAllPresent = function () {
    var all: Record<string, StatusType> = {};
    students.forEach(function (s: any) { all[s.id] = 'present'; });
    setRecords(all);
  };

  var toggleStatus = function (sid: string) {
    setRecords(function (prev: Record<string, StatusType>) {
      var cur = prev[sid] || 'unmarked';
      var next: StatusType = cur === 'unmarked' ? 'present' : cur === 'present' ? 'absent' : 'unmarked';
      var copy: Record<string, StatusType> = {};
      Object.keys(prev).forEach(function (k: string) { copy[k] = prev[k]; });
      copy[sid] = next;
      return copy;
    });
  };

  var handleSave = async function () {
    if (!classId || !date) { toast('Select a class and date', 'error'); return; }
    var markedRecords: Record<string, StatusType> = {};
    Object.keys(records).forEach(function (sid: string) { if (records[sid] !== 'unmarked') markedRecords[sid] = records[sid]; });
    if (Object.keys(markedRecords).length === 0) { toast('Mark at least one student', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/attendance/batch/', { school_class: classId, date: date, term: term, session: session, records: markedRecords });
      toast('Attendance saved', 'success');
    } catch (e: any) {
      toast((e.response && e.response.data && e.response.data.error) || 'Failed to save attendance', 'error');
    }
    setSaving(false);
  };

  var markedCount = 0;
  Object.keys(records).forEach(function (sid) { if (records[sid] !== 'unmarked') markedCount++; });

  /* load daily report */
  var loadDailyReport = async function () {
    if (!dailyClassId || !dailyDate) { toast('Select class and date', 'error'); return; }
    setRptLoading(true); setRptError('');
    try {
      var res = await api.get('/attendance/class-daily-report/', { params: { class_id: dailyClassId, date: dailyDate } });
      setDailyReport(res.data);
      setAllClassesReport(null);
    } catch (_) { setRptError('Failed to load report'); }
    setRptLoading(false);
  };

  var loadAllClassesReport = async function () {
    if (!dailyDate) { toast('Select a date', 'error'); return; }
    setRptLoading(true); setRptError('');
    try {
      var res = await api.get('/attendance/all-classes-daily/', { params: { date: dailyDate } });
      setAllClassesReport(res.data);
      setDailyReport(null);
    } catch (_) { setRptError('Failed to load report'); }
    setRptLoading(false);
  };

  /* load monthly report */
  var loadMonthlyReport = async function () {
    if (!monthlyClassId) { toast('Select a class', 'error'); return; }
    if (rptRangeMode === 'range' && rptFrom > rptTo) { setMonthlyError('From date must be before To date'); return; }
    setMonthlyLoading(true); setMonthlyError('');
    try {
      var params: Record<string, string>;
      if (rptRangeMode === 'range') {
        params = { class_id: monthlyClassId, from_date: rptFrom, to_date: rptTo };
      } else {
        params = { class_id: monthlyClassId, year: String(monthYear.year), month: String(monthYear.month) };
      }
      var res = await api.get('/attendance/monthly-report/', { params });
      setMonthlyData(res.data);
    } catch (_) { setMonthlyError('Failed to load report'); }
    setMonthlyLoading(false);
  };

  useEffect(function () { if (monthlyClassId) loadMonthlyReport(); }, [monthlyClassId, monthYear, rptRangeMode, rptFrom, rptTo]);

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      <Toast />

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-2xl flex items-center justify-center">
          <CalendarCheck size={22} className="text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h2 className="font-bold text-lg text-school-primary dark:text-[#e0e0e8]">Attendance</h2>
          <p className="text-xs text-school-muted">Daily marking &amp; reports</p>
        </div>
      </div>

      <div className="flex bg-school-border/30 dark:bg-[#2a2a3e]/50 rounded-xl p-1">
        <button onClick={function () { setTab('daily'); }}
          className={'flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ' + (tab === 'daily' ? 'bg-white dark:bg-school-primary shadow-sm text-school-primary dark:text-white' : 'text-school-muted')}>
          Daily Marking
        </button>
        <button onClick={function () { setTab('report'); }}
          className={'flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ' + (tab === 'report' ? 'bg-white dark:bg-school-primary shadow-sm text-school-primary dark:text-white' : 'text-school-muted')}>
          Report
        </button>
        <button onClick={function () { setTab('holidays'); }}
          className={'flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ' + (tab === 'holidays' ? 'bg-white dark:bg-school-primary shadow-sm text-school-primary dark:text-white' : 'text-school-muted')}>
          Holidays
        </button>
      </div>

      {/* Daily Marking */}
      {tab === 'daily' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={classId} onChange={function (e) { setClassId(e.target.value); }}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8] col-span-2 sm:col-span-1">
              <option value="">Select Class</option>
              {classes.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
            </select>
            <input type="date" value={date} onChange={function (e) { setDate(e.target.value); }}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" />
            <select value={term} onChange={function (e) { setTerm(e.target.value); }}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]">
              {Object.entries(TERM_NAMES).map(function (kv) { return <option key={kv[0]} value={kv[0]}>{kv[1]}</option>; })}
            </select>
            <input type="number" value={session} onChange={function (e) { setSession(e.target.value); }}
              className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" placeholder="Session" />
          </div>

          {students.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <button onClick={markAllPresent}
                className="px-3 py-1.5 border border-school-border rounded-xl text-xs font-semibold text-school-primary dark:text-[#e0e0e8] hover:bg-school-paper dark:hover:bg-white/5 transition-colors flex items-center gap-1.5">
                <Check size={14} /> Mark All Present
              </button>
              <span className="text-xs text-school-muted">{markedCount}/{students.length} marked</span>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-school-muted" /></div>
          ) : students.length === 0 ? (
            <div className="text-center py-12 text-school-muted text-sm">{classId ? 'No students in this class' : 'Select a class to begin'}</div>
          ) : (
            <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] divide-y divide-school-border/50 dark:divide-[#2a2a3e] overflow-hidden">
              {students.map(function (s) {
                var status = records[s.id] || 'unmarked';
                return (
                  <button key={s.id} onClick={function () { toggleStatus(s.id); }}
                    className={'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-school-paper/50 dark:hover:bg-white/5 ' + (status === 'present' ? 'bg-green-50 dark:bg-green-500/10' : status === 'absent' ? 'bg-red-50 dark:bg-red-500/10' : '')}>
                    <div className={'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ' + (status === 'present' ? 'bg-green-100 dark:bg-green-500/20 text-green-600' : status === 'absent' ? 'bg-red-100 dark:bg-red-500/20 text-red-600' : 'bg-school-border/30 dark:bg-[#2a2a3e] text-school-muted')}>
                      {status === 'present' ? <Check size={16} /> : status === 'absent' ? <X size={16} /> : <span className="text-[10px]">---</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8] truncate">{s.name}</div>
                      {s.roll && <div className="text-[10px] text-school-muted uppercase">Roll {s.roll}</div>}
                    </div>
                    <div className="flex gap-1.5">
                      <div className={'w-2.5 h-2.5 rounded-full ' + (status === 'present' ? 'bg-green-500' : 'bg-school-border/40 dark:bg-[#3a3a4e]')} />
                      <div className={'w-2.5 h-2.5 rounded-full ' + (status === 'absent' ? 'bg-red-500' : 'bg-school-border/40 dark:bg-[#3a3a4e]')} />
                    </div>
                    <div className="text-[10px] font-bold uppercase text-school-muted min-w-[48px] text-right">
                      {status === 'unmarked' ? 'Tap' : status === 'present' ? 'Present' : 'Absent'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {students.length > 0 && (
            <button onClick={handleSave} disabled={saving || markedCount === 0}
              className="w-full px-4 py-3 bg-school-accent text-white rounded-xl text-sm font-bold hover:bg-school-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <CalendarCheck size={18} />}
              {saving ? 'Saving...' : 'Save Attendance (' + markedCount + ')'}
            </button>
          )}
        </>
      ) : tab === 'report' ? (

        <>
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-school-muted shrink-0" />
            <select value={rptTab} onChange={function (e) { setRptTab(e.target.value as RptTab); }}
              className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]">
              <option value="daily">Daily Report</option>
              <option value="monthly">Monthly Report</option>
            </select>
          </div>

          {/* Daily Report */}
          {rptTab === 'daily' ? (
            <>
              <div className="flex gap-2">
                <button onClick={function () { setDailySub('classwise'); }}
                  className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ' + (dailySub === 'classwise' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'text-school-muted hover:bg-school-paper/50')}>
                  Class Wise
                </button>
                <button onClick={function () { setDailySub('allclasses'); }}
                  className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ' + (dailySub === 'allclasses' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'text-school-muted hover:bg-school-paper/50')}>
                  All Classes
                </button>
              </div>

              {dailySub === 'classwise' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={dailyClassId} onChange={function (e) { setDailyClassId(e.target.value); }}
                      className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]">
                      <option value="">Select Class</option>
                      {classes.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
                    </select>
                    <input type="date" value={dailyDate} onChange={function (e) { setDailyDate(e.target.value); }}
                      className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" />
                  </div>
                  <button onClick={loadDailyReport} disabled={!dailyClassId || !dailyDate || rptLoading}
                    className="w-full px-3 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {rptLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    {rptLoading ? 'Loading...' : 'Load Daily Report'}
                  </button>
                  {rptError && <div className="text-center text-red-500 text-sm">{rptError}</div>}
                  {dailyReport && (
                    <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-school-primary dark:text-[#e0e0e8]">{dailyReport.class.name}</p>
                          <p className="text-xs text-school-muted">{dailyReport.date}</p>
                        </div>
                        <button onClick={function () { downloadDailyReportPDF(dailyReport); }}
                          className="px-3 py-1.5 bg-school-accent text-white rounded-xl text-xs font-semibold hover:bg-school-accent/90 transition-colors flex items-center gap-1.5">
                          <Download size={14} /> PDF
                        </button>
                      </div>

                      <div className="flex gap-4 text-sm">
                        <div><span className="font-bold text-green-600">{dailyReport.present}</span> <span className="text-school-muted">Present</span></div>
                        <div><span className="font-bold text-red-600">{dailyReport.absent}</span> <span className="text-school-muted">Absent</span></div>
                        <div><span className="font-bold text-school-muted">{dailyReport.unmarked}</span> <span className="text-school-muted">Unmarked</span></div>
                        <div><span className="font-bold">{dailyReport.total_students}</span> <span className="text-school-muted">Total</span></div>
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-school-border/30 dark:divide-[#2a2a3e] text-sm">
                        {dailyReport.students.map(function (s) {
                          return (
                            <div key={s.id} className="flex items-center gap-2 py-1.5">
                              <div className={'w-2 h-2 rounded-full ' + (s.status === 'present' ? 'bg-green-500' : s.status === 'absent' ? 'bg-red-500' : 'bg-gray-400')} />
                              <span className="text-school-muted text-xs w-8">{s.roll || '---'}</span>
                              <span className="font-medium text-school-primary dark:text-[#e0e0e8]">{s.name}</span>
                              <span className={'ml-auto text-xs font-semibold ' + (s.status === 'present' ? 'text-green-600' : s.status === 'absent' ? 'text-red-600' : 'text-school-muted')}>
                                {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <input type="date" value={dailyDate} onChange={function (e) { setDailyDate(e.target.value); }}
                    className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" />
                  <button onClick={loadAllClassesReport} disabled={!dailyDate || rptLoading}
                    className="w-full px-3 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {rptLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    {rptLoading ? 'Loading...' : 'Load All Classes Report'}
                  </button>
                  {rptError && <div className="text-center text-red-500 text-sm">{rptError}</div>}
                  {allClassesReport && (
                    <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-school-muted">Date: {allClassesReport.date}</p>
                        <button onClick={function () { downloadAllClassesPDF(allClassesReport); }}
                          className="px-3 py-1.5 bg-school-accent text-white rounded-xl text-xs font-semibold hover:bg-school-accent/90 transition-colors flex items-center gap-1.5">
                          <Download size={14} /> PDF
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-school-paper dark:bg-[#2a2a3e]">
                              <th className="text-left px-2 py-1.5 font-bold text-school-muted">Class</th>
                              <th className="text-center px-2 py-1.5 font-bold text-school-muted">Total</th>
                              <th className="text-center px-2 py-1.5 font-bold text-green-600">Present</th>
                              <th className="text-center px-2 py-1.5 font-bold text-red-600">Absent</th>
                              <th className="text-center px-2 py-1.5 font-bold text-school-muted">Unmarked</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allClassesReport.classes.map(function (c, i) {
                              return (
                                <tr key={c.class.id} className={'border-t border-school-border/30 dark:border-[#2a2a3e] ' + (i % 2 === 0 ? '' : 'bg-school-paper/50 dark:bg-[#2a2a3e]/30')}>
                                  <td className="px-2 py-1.5 font-semibold text-school-primary dark:text-[#e0e0e8]">{c.class.name}</td>
                                  <td className="px-2 py-1.5 text-center">{c.total_students}</td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-green-600">{c.present}</td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-red-600">{c.absent}</td>
                                  <td className="px-2 py-1.5 text-center text-school-muted">{c.unmarked}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-school-border dark:border-[#2a2a3e] font-bold">
                              <td className="px-2 py-1.5 text-school-primary dark:text-[#e0e0e8]">Total</td>
                              <td className="px-2 py-1.5 text-center">{allClassesReport.classes.reduce(function (s, c) { return s + c.total_students; }, 0)}</td>
                              <td className="px-2 py-1.5 text-center text-green-600">{allClassesReport.classes.reduce(function (s, c) { return s + c.present; }, 0)}</td>
                              <td className="px-2 py-1.5 text-center text-red-600">{allClassesReport.classes.reduce(function (s, c) { return s + c.absent; }, 0)}</td>
                              <td className="px-2 py-1.5 text-center text-school-muted">{allClassesReport.classes.reduce(function (s, c) { return s + c.unmarked; }, 0)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (

            /* Monthly Report */
            <>
              <div className="grid grid-cols-2 gap-2">
                <select value={monthlyClassId} onChange={function (e) { setMonthlyClassId(e.target.value); }}
                  className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]">
                  <option value="">Select Class</option>
                  {classes.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
                </select>
                <div className="flex bg-school-border/30 dark:bg-[#2a2a3e]/50 rounded-xl p-1">
                  <button onClick={function () { setRptRangeMode('month'); }}
                    className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ' + (rptRangeMode === 'month' ? 'bg-white dark:bg-school-primary shadow-sm text-school-primary dark:text-white' : 'text-school-muted')}>
                    Month
                  </button>
                  <button onClick={function () { setRptRangeMode('range'); }}
                    className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ' + (rptRangeMode === 'range' ? 'bg-white dark:bg-school-primary shadow-sm text-school-primary dark:text-white' : 'text-school-muted')}>
                    Date Range
                  </button>
                </div>
              </div>

              {rptRangeMode === 'month' ? (
                <div className="flex items-center gap-2">
                  <button onClick={function () { setMonthYear(function (p) { var m = p.month - 1; return m < 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: m }; }); }}
                    className="p-2 hover:bg-school-paper dark:hover:bg-white/5 rounded-xl transition-colors">
                    <ChevronLeft size={18} className="text-school-muted" />
                  </button>
                  <span className="flex-1 text-center font-bold text-sm text-school-primary dark:text-[#e0e0e8]">
                    {monthName(monthYear.month)} {monthYear.year}
                  </span>
                  <button onClick={function () { setMonthYear(function (p) { var m = p.month + 1; return m > 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: m }; }); }}
                    className="p-2 hover:bg-school-paper dark:hover:bg-white/5 rounded-xl transition-colors">
                    <ChevronRight size={18} className="text-school-muted" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-school-muted tracking-wider mb-1 block">From</label>
                    <input type="date" value={rptFrom} onChange={function (e) { setRptFrom(e.target.value); }}
                      className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-school-muted tracking-wider mb-1 block">To</label>
                    <input type="date" value={rptTo} onChange={function (e) { setRptTo(e.target.value); }}
                      className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white dark:bg-[#1a1a2e] text-school-primary dark:text-[#e0e0e8]" />
                  </div>
                </div>
              )}

              {monthlyError && <div className="text-center text-red-500 text-sm">{monthlyError}</div>}

              {monthlyLoading ? (
                <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-school-muted" /></div>
              ) : monthlyData ? (
                <div className="space-y-3">
                  {monthlyData && (function () {
                    var schoolDays = monthlyData.days.filter(function (d) { return d.type !== 'weekend' && d.type !== 'holiday'; });
                    var totalPre = schoolDays.reduce(function (s, d) { return s + d.present; }, 0);
                    var totalAbs = schoolDays.reduce(function (s, d) { return s + d.absent; }, 0);
                    return (
                      <div className="flex items-center justify-between">
                        <div className="flex gap-3 text-xs">
                          <span><span className="font-bold text-green-600">{totalPre}</span> Present</span>
                          <span><span className="font-bold text-red-600">{totalAbs}</span> Absent</span>
                          <span><span className="font-bold">{schoolDays.length}</span> Days</span>
                        </div>
                        <button onClick={function () { downloadMonthlyPDF(monthlyData); }}
                          className="px-3 py-1.5 bg-school-accent text-white rounded-xl text-xs font-semibold hover:bg-school-accent/90 transition-colors flex items-center gap-1.5">
                          <Download size={14} /> PDF
                        </button>
                      </div>
                    );
                  })()}

                  {/* Register matrix: students as rows, dates as columns, total-present last */}
                  <div className="overflow-x-auto rounded-xl border border-school-border dark:border-[#2a2a3e]">
                    <table className="w-full text-xs" style={{ minWidth: 120 + monthlyData.days.length * 26 + 56 }}>
                      <thead>
                        <tr className="bg-school-paper dark:bg-[#2a2a3e]">
                          <th className="text-left px-2 py-1.5 font-bold text-school-muted sticky left-0 bg-school-paper dark:bg-[#2a2a3e] z-10" style={{ minWidth: 120 }}>Name</th>
                          {monthlyData.days.map(function (d) {
                            var off = d.type === 'weekend' || d.type === 'holiday';
                            return (
                              <th key={d.date} title={d.date + (off ? ' (' + d.type + ')' : '')}
                                className={'text-center px-0.5 py-1.5 font-bold ' + (off ? 'text-school-muted/50' : 'text-school-primary dark:text-[#e0e0e8]')}
                                style={{ minWidth: 26 }}>
                                {Number(d.date.slice(8, 10))}
                                {d.type === 'holiday' ? <span className="block text-[7px] text-amber-600 leading-none">H</span> : null}
                              </th>
                            );
                          })}
                          <th className="text-center px-1.5 py-1.5 font-bold text-green-600" style={{ minWidth: 56 }}>Total P</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyData.students.map(function (s, si) {
                          var row = (monthlyData.student_days || {})[s.id] || {};
                          var presentCount = 0;
                          monthlyData.days.forEach(function (d) {
                            var st = row[d.date];
                            if (st === 'present') presentCount++;
                          });
                          return (
                            <tr key={s.id} className={'border-t border-school-border/30 dark:border-[#2a2a3e] ' + (si % 2 ? 'bg-gray-50 dark:bg-transparent' : '')}>
                              <td className="px-2 py-1.5 font-semibold text-school-primary dark:text-[#e0e0e8] sticky left-0 bg-white dark:bg-[#1a1a2e] z-10 truncate max-w-[120px]" title={s.name}>
                                {s.roll ? <span className="text-school-muted font-normal mr-1">{s.roll}.</span> : null}{s.name}
                              </td>
                              {monthlyData.days.map(function (d) {
                                var st = row[d.date];
                                var off = d.type === 'weekend' || d.type === 'holiday';
                                var cell = st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'late' ? 'L' : st === 'excused' ? 'E' : '';
                                var cls = st === 'present' ? 'text-green-600 font-bold'
                                  : st === 'absent' ? 'text-red-600 font-bold'
                                  : st === 'late' ? 'text-amber-600 font-bold'
                                  : st === 'excused' ? 'text-blue-600 font-bold'
                                  : 'text-school-muted/40';
                                return (
                                  <td key={d.date} title={s.name + ' — ' + d.date + (off ? ' (' + d.type + ')' : st ? ': ' + st : ': unmarked')}
                                    className={'text-center py-1.5 ' + cls + (off ? ' bg-school-paper/50 dark:bg-[#2a2a3e]/30' : '')}>
                                    {cell || (off ? '·' : '')}
                                  </td>
                                );
                              })}
                              <td className="text-center py-1.5 font-bold text-green-600 bg-school-paper/50 dark:bg-[#2a2a3e]/30">{presentCount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap gap-3 text-[10px] text-school-muted pt-2 border-t border-school-border/30 dark:border-[#2a2a3e]">
                    {[
                      { color: 'bg-green-500', label: 'Present' },
                      { color: 'bg-red-500', label: 'Absent' },
                      { color: 'bg-amber-300', label: 'Holiday' },
                      { color: 'bg-school-border/40', label: 'Weekend' },
                    ].map(function (l) {
                      return (
                        <div key={l.label} className="flex items-center gap-1.5">
                          <div className={'w-2.5 h-2.5 rounded-full ' + l.color} />
                          <span>{l.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-school-muted text-sm">Select a class to view monthly report</div>
              )}
            </>
          )}
        </>
      ) : (
        <HolidaysPanel />
      )}
    </div>
  );
}
