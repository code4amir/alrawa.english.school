import { useState, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useSchoolStore, api } from '../store';
import { toast } from '../components/Toast';
import { AlertTriangle, Download, Printer, Check, X } from 'lucide-react';
import { defaulterPDF } from '../lib/defaulterPdf';
import { getMonthNameShort, fmt } from '../lib/financeReportPdf';
import DatePicker from '../components/DatePicker';
import type { DefaulterStudent, DefaulterFee } from '../lib/types';

function shortName(s: string) {
  const p = s.trim().split(/\s+/);
  return p.length > 2 ? p.slice(0, 2).join(' ') : s;
}

function buildMonthRange(from: string, to: string): string[] {
  const range: string[] = [];
  if (!from || !to) return range;
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    range.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return range;
}

function findFee(fees: DefaulterFee[], name: string): DefaulterFee | undefined {
  return fees.find(f => f.name === name);
}

function findMonthlyFee(fees: DefaulterFee[], name: string, month: string) {
  const fee = fees.find(f => f.name === name && (f.type === 'recurring' || f.type === 'special'));
  return fee?.months?.find(m => m.month === month) || null;
}

export default function DefaulterTab() {
  const { classes, students, feeSchedules, fetchClasses, fetchStudents, fetchFeeSchedules } = useSchoolStore();

  const [data, setData] = useState<DefaulterStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterClass, setFilterClass] = useState('');
  const [filterStudent, setFilterStudent] = useState('');
  const [filterFee, setFilterFee] = useState('');
  const [monthFrom, setMonthFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthTo, setMonthTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { fetchClasses(); fetchStudents(undefined, true); fetchFeeSchedules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params: Record<string, string> = {};
    if (filterClass) params.className = filterClass;
    if (filterStudent) params.studentId = filterStudent;
    if (filterFee) params.feeCategory = filterFee;
    params.monthFrom = monthFrom;
    params.monthTo = monthTo;
    params.year = monthTo.split('-')[0];
    api.get('/finance/defaulter', { params, signal: controller.signal })
      .then(res => setData(res.data.results || res.data.data || res.data))
      .catch(() => { if (!controller.signal.aborted) toast('Failed to load defaulter data', 'error'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filterClass, filterStudent, filterFee, monthFrom, monthTo]);

  const filtered = useMemo(() =>
    filterFee ? data.filter(r => r.fees.some(f => f.name === filterFee)) : data,
    [data, filterFee]
  );

  const monthRange = useMemo(() => buildMonthRange(monthFrom, monthTo), [monthFrom, monthTo]);

  const yearlyFeeNames = useMemo(() =>
    [...new Set(filtered.flatMap(r => r.fees.filter(f => f.type === 'onetime' || f.type === 'global').map(f => f.name)))],
    [filtered]
  );

  const monthlyFeeNames = useMemo(() =>
    [...new Set(filtered.flatMap(r => r.fees.filter(f => f.type === 'recurring' || f.type === 'special').map(f => f.name)))],
    [filtered]
  );

  const hasMonthly = monthlyFeeNames.length > 0 && monthRange.length > 0;

  const totalDue = useMemo(() => filtered.reduce((s, r) => s + r.totalDue, 0), [filtered]);
  const totalPaid = useMemo(() => filtered.reduce((s, r) => s + r.totalPaid, 0), [filtered]);
  const totalBalance = totalDue - totalPaid;

  const colCount = 1 + yearlyFeeNames.length + (hasMonthly ? monthRange.length * monthlyFeeNames.length : 0) + 3;

  const subtitle = `${getMonthNameShort(Number(monthFrom.split('-')[1]) - 1)} ${monthFrom.split('-')[0]} — ${getMonthNameShort(Number(monthTo.split('-')[1]) - 1)} ${monthTo.split('-')[0]}`;

  function handlePrint() {
    const el = document.getElementById('defaulter-print-area');
    if (!el) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Defaulter Report</title><style>
      @page{size:landscape;margin:10mm}
      body{font-family:system-ui,sans-serif;padding:20px;color:#1a1a2e;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{padding:4px 6px;border:1px solid #d7d2c8;text-align:center;vertical-align:middle;font-size:10px}
      th{background:#1a1a2e;color:#fff;font-size:9px;text-transform:uppercase}
      td:first-child{text-align:left}
      .paid{color:#059669;font-weight:bold}.unpaid{color:#dc2626;font-weight:bold}
      h2{font-size:14px;margin:0}h3{font-size:11px;margin:2px 0 8px;color:#827c72}
      tfoot td{background:#1a1a2e;color:#fff;font-weight:bold;font-size:11px}
      @media print{body{padding:10px}}
    </style></head><body><h2>AL RAWA English School</h2><h3>Fee Defaulter Report — ${subtitle}</h3>${DOMPurify.sanitize(el.innerHTML)}</body></html>`);
    w.document.close();
    w.print();
  }

  function handlePdf() {
    try {
      defaulterPDF({
        displayData: filtered,
        monthRange,
        classLabel: filterClass || 'All Classes',
        subtitle,
        totalDueAll: totalDue,
        totalPaidAll: totalPaid,
        filterClass,
        monthFrom,
        monthTo,
        yearlyFeeNames,
        monthlyFeeNames,
      });
      toast('PDF downloaded', 'success');
    } catch { toast('PDF generation failed', 'error'); }
  }

  function handleClassChange(value: string) {
    setFilterClass(value);
    setFilterStudent('');
  }

  function FeeCell({ amount, paid }: { amount: number; paid: boolean }) {
    return (
      <span className={`font-bold text-[10px] ${paid ? 'text-emerald-600' : 'text-rose-600'}`}>
        {fmt(amount)}/- {paid ? <Check size={10} className="inline" /> : <X size={10} className="inline" />}
      </span>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-school-border p-4 flex flex-wrap gap-4 items-end">
        <FilterSelect label="Class" value={filterClass} onChange={handleClassChange}>
          <option value="">Whole School</option>
          {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </FilterSelect>

        {filterClass && (
          <FilterSelect label="Student" value={filterStudent} onChange={setFilterStudent}>
            <option value="">All Students</option>
            {students.filter(s => s.class === filterClass).map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.fatherName ? ` (${s.fatherName})` : ''}</option>
            ))}
          </FilterSelect>
        )}

        <FilterSelect label="Fee Type" value={filterFee} onChange={setFilterFee}>
          <option value="">All Fees</option>
          {(() => {
            const monthly = feeSchedules.filter(fs => fs.frequency === 'MONTHLY');
            const yearly = feeSchedules.filter(fs => fs.frequency === 'YEARLY' || fs.frequency === 'ONE_TIME');
            return (
              <>
                {monthly.length > 0 && (
                  <optgroup label="Monthly">
                    {[...new Set(monthly.map(fs => fs.category))].map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
                {yearly.length > 0 && (
                  <optgroup label="Yearly">
                    {[...new Set(yearly.map(fs => fs.category))].map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                )}
              </>
            );
          })()}
        </FilterSelect>

        <div className="border-l border-school-border pl-4 flex gap-3 items-end">
          <DatePicker type="month" value={monthFrom} onChange={setMonthFrom} label="Month From" />
          <DatePicker type="month" value={monthTo} onChange={setMonthTo} label="Month To" />
        </div>

        <div className="ml-auto flex gap-6 text-right">
          <SummaryCard label="Total Due" value={totalDue} color="text-rose-600" />
          <SummaryCard label="Total Paid" value={totalPaid} color="text-emerald-600" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-school-border overflow-hidden">
        <div className="px-5 py-4 border-b border-school-border flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" />
          <h4 className="font-serif text-sm text-school-primary">Fee Defaulters</h4>
          <span className="text-[10px] text-school-muted">({filtered.length} students)</span>
          <div className="ml-auto flex gap-2">
            <button onClick={handlePdf}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-school-primary text-white rounded-xl text-xs font-bold hover:opacity-90">
              <Download size={14} /> PDF
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-school-border rounded-xl text-xs font-bold hover:border-school-accent">
              <Printer size={14} /> Print
            </button>
          </div>
        </div>

        <div id="defaulter-print-area" className="overflow-x-auto">
          <table className="w-full text-sm mobile-card-table">
            <thead className="bg-school-paper/50 text-[10px] uppercase tracking-widest text-school-muted font-bold">
              <tr>
                <th className="px-4 py-3 text-left sticky left-0 bg-school-paper/50 z-10" rowSpan={2}>
                  Student<br /><span className="text-[9px] font-normal">Class</span>
                </th>
                {yearlyFeeNames.map(name => (
                  <th key={name} className="px-2 py-3 text-center" rowSpan={2}>{shortName(name)}</th>
                ))}
                {hasMonthly && monthRange.map(m => {
                  const [yr, mn] = m.split('-');
                  return (
                    <th key={m} className="px-2 py-3 text-center" colSpan={monthlyFeeNames.length}>
                      {getMonthNameShort(Number(mn) - 1)}<br />'{yr.slice(2)}
                    </th>
                  );
                })}
                <th className="px-3 py-3 text-right" rowSpan={2}>Due</th>
                <th className="px-3 py-3 text-right" rowSpan={2}>Paid</th>
                <th className="px-3 py-3 text-right" rowSpan={2}>Balance</th>
              </tr>
              {hasMonthly && (
                <tr>
                  {monthRange.flatMap(m => monthlyFeeNames.map(name => (
                    <th key={`${m}_${name}`} className="px-1 py-2 text-center text-[9px] font-semibold tracking-normal">
                      {shortName(name)}
                    </th>
                  )))}
                </tr>
              )}
            </thead>

            <tbody className="divide-y divide-school-border/50">
              {loading ? (
                <LoadingSkeleton yearlyCount={yearlyFeeNames.length} hasMonthly={hasMonthly} monthRange={monthRange} monthlyCount={monthlyFeeNames.length} />
              ) : filtered.length > 0 ? (
                filtered.map(row => (
                  <tr key={row.studentId} className="hover:bg-school-paper/30 transition-colors border-t-2 border-school-primary/20">
                    <td className="px-4 py-2 sticky left-0 bg-white z-10 font-bold text-xs border-r border-school-border/30" data-label="Student">
                      {row.name}<br /><span className="text-[10px] text-school-muted font-normal">{row.class}</span>
                    </td>
                    {yearlyFeeNames.map(name => {
                      const fee = findFee(row.fees, name);
                      if (!fee) return <td key={name} className="px-2 py-2 text-center text-[8px] text-school-muted">—</td>;
                      return <td key={name} className="px-2 py-2 text-center"><FeeCell amount={fee.amount} paid={fee.paid} /></td>;
                    })}
                    {hasMonthly && monthRange.flatMap(m => monthlyFeeNames.map(name => {
                      const md = findMonthlyFee(row.fees, name, m);
                      if (!md) return (
                        <td key={`${m}_${name}`} className="px-1 py-2 text-center">
                          <span className="text-rose-500"><X size={12} className="inline" /></span>
                        </td>
                      );
                      return <td key={`${m}_${name}`} className="px-1 py-2 text-center"><FeeCell amount={md.amount} paid={md.paid} /></td>;
                    }))}
                    <td className="px-3 py-2 text-right font-bold text-xs" data-label="Due">{fmt(row.totalDue)} /-</td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-emerald-600" data-label="Paid">{fmt(row.totalPaid)} /-</td>
                    <td className="px-3 py-2 text-right font-bold text-xs" data-label="Balance">
                      <span className={row.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}>{fmt(Math.abs(row.balance))} /-</span>
                      {row.balance <= 0 && <span className="text-[9px] text-emerald-500 ml-1">(clear)</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-school-muted italic">
                    No defaulter data found.
                  </td>
                </tr>
              )}
            </tbody>

            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-school-primary/5 border-t-2 border-school-primary/20">
                  <td className="px-4 py-3 sticky left-0 bg-school-primary/5 text-xs font-bold" colSpan={1 + yearlyFeeNames.length}>
                    Grand Total
                  </td>
                  {hasMonthly && monthRange.flatMap(m => monthlyFeeNames.map(name => (
                    <td key={`gt_${m}_${name}`} className="px-2 py-3" />
                  )))}
                  <td className="px-3 py-3 text-right font-bold text-xs">{fmt(totalDue)} /-</td>
                  <td className="px-3 py-3 text-right font-bold text-xs text-emerald-600">{fmt(totalPaid)} /-</td>
                  <td className={`px-3 py-3 text-right font-bold text-xs ${totalBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {fmt(Math.abs(totalBalance))} /-
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
        {children}
      </select>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-school-muted font-bold">{label}</div>
      <div className={`font-serif text-lg font-bold ${color}`}>{fmt(value)} /-</div>
    </div>
  );
}

function LoadingSkeleton({ yearlyCount, hasMonthly, monthRange, monthlyCount }: {
  yearlyCount: number;
  hasMonthly: boolean;
  monthRange: string[];
  monthlyCount: number;
}) {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i}>
          <td className="px-4 py-3"><div className="h-4 bg-school-paper rounded animate-pulse w-24" /></td>
          {Array.from({ length: yearlyCount }).map((_, j) => (
            <td key={j} className="px-2 py-3"><div className="h-4 bg-school-paper rounded animate-pulse w-12 mx-auto" /></td>
          ))}
          {hasMonthly && monthRange.flatMap(m => Array.from({ length: monthlyCount }).map((_, j) => (
            <td key={`sk_${m}_${j}`} className="px-1 py-3"><div className="h-4 w-8 bg-school-paper rounded animate-pulse mx-auto" /></td>
          )))}
          <td className="px-3 py-3"><div className="h-4 bg-school-paper rounded animate-pulse w-16 ml-auto" /></td>
          <td className="px-3 py-3"><div className="h-4 bg-school-paper rounded animate-pulse w-16 ml-auto" /></td>
          <td className="px-3 py-3"><div className="h-4 bg-school-paper rounded animate-pulse w-16 ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}
