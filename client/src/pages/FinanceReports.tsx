import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { useSchoolStore, api } from '../store';
import { Calendar, BarChart3, Scale, Users, Loader } from 'lucide-react';
import { toast } from '../components/Toast';
import ExportMenu from '../components/ExportMenu';
import { getMonthName, fmt, headwise, pdfIncomeReport, pdfExpenseReport, pdfAudit, pdfYearlyAGM } from '../lib/financeReportPdf';
import { FISCAL_YEAR_START_MONTH, FISCAL_START_LABEL, FISCAL_END_LABEL } from '../lib/config';
import { ACCOUNT_IDS, PRIMARY_BANK, SECONDARY_BANK } from '../lib/accounts';


type ReportTab = 'income-report' | 'expense-report' | 'audit' | 'yearly-agm';

function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}

async function downloadExcel(filename: string, headers: string[], rows: any[][]) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const colWidths = headers.map((h, i) => {
    const max = rows.reduce((m, r) => Math.max(m, String(r[i] || '').length), h.length);
    return { wch: Math.min(max + 3, 40) };
  });
  ws['!cols'] = colWidths;
  XLSX.writeFile(wb, filename);
}

const REPORT_TABS: { key: ReportTab; label: string; icon: ReactNode }[] = [
  { key: 'income-report', label: 'Income Report', icon: <BarChart3 size={14} /> },
  { key: 'expense-report', label: 'Expense Report', icon: <BarChart3 size={14} /> },
  { key: 'audit', label: 'Audit Report', icon: <Scale size={14} /> },
  { key: 'yearly-agm', label: 'Yearly AGM', icon: <Users size={14} /> },
];

const MONTHS_INPUT = (() => {
  const now = new Date();
  const months: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ value: v, label: `${getMonthName(d.getMonth())} ${d.getFullYear()}` });
  }
  return months;
})();

function printDiv(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<html><head><title>Print</title><style>
    body{font-family:system-ui,sans-serif;padding:20px;color:#1a1a2e;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{padding:6px 10px;border:1px solid #d7d2c8;text-align:left;font-size:12px}
    th{background:#1a1a2e;color:#fff;font-size:10px;text-transform:uppercase}
    .total{font-weight:bold;background:#f0ece3}
    h2{font-size:16px;margin:0 0 4px}h3{font-size:13px;margin:0 0 8px;color:#827c72}
    @media print{body{padding:10px}}
  </style></head><body>${DOMPurify.sanitize(el.innerHTML)}</body></html>`);
  w.document.close(); w.print();
}

const FinanceReports = () => {
  useEffect(() => { document.title = 'Finance Reports - AL RAWA English School'; }, []);
  const { transactions, fetchTransactions, fetchStudents, fetchFinance, fetchOpeningBalances, setOpeningBalances, openingBalancesHistory, fetchOpeningBalanceHistory, revertOpeningBalance } = useSchoolStore();
  const [tab, setTab] = useState<ReportTab>('income-report');
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [dateTo, setDateTo] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));
  const [showOpeningBalModal, setShowOpeningBalModal] = useState(false);
  const [editOpenBal, setEditOpenBal] = useState<Record<string, string>>({});
  const [savingOpenBal, setSavingOpenBal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [agmData, setAgmData] = useState<any>(null);
  const [agmLoading, setAgmLoading] = useState(false);

  useEffect(() => {
    if (tab === 'yearly-agm') {
      setAgmLoading(true);
      api.get('/finance/reports/agm', { params: { year: yearFilter } })
        .then(res => setAgmData(res.data))
        .catch(() => { setAgmData(null); toast('Failed to load AGM report from server', 'error'); })
        .finally(() => setAgmLoading(false));
    }
  }, [tab, yearFilter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTransactions(); fetchStudents(undefined, true); fetchFinance(); fetchOpeningBalances(); }, []);

  const openOpeningBalModal = async () => {
    await fetchOpeningBalances(yearFilter);
    await fetchOpeningBalanceHistory(yearFilter);
    const fresh = useSchoolStore.getState().openingBalances;
    const ob: Record<string, string> = {};
    ACCOUNT_IDS.forEach(id => { ob[id] = String(fresh[id] || 0); });
    setEditOpenBal(ob);
    setShowOpeningBalModal(true);
  };

  const handleSaveOpeningBal = async () => {
    setSavingOpenBal(true);
    try {
      const payload: Record<string, number> = {};
      ACCOUNT_IDS.forEach(id => { payload[id] = Number(editOpenBal[id]) || 0; });
      await setOpeningBalances(yearFilter, payload);
      toast('Opening balances saved ✓', 'success');
      setShowOpeningBalModal(false);
    } catch { toast('Failed to save opening balances', 'error'); }
    finally { setSavingOpenBal(false); }
  };

  const handleRevert = async (historyId: string) => {
    try {
      await revertOpeningBalance(historyId);
      await fetchOpeningBalances(yearFilter);
      toast('Reverted ✓', 'success');
    } catch { toast('Revert failed', 'error'); }
  };

  const filtered = transactions.filter((t: any) => {
    if (t.isCancelled || t.reversalOfId) return false;
    const d = new Date(t.transactionDate);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return ym >= dateFrom && ym <= dateTo;
  });

  const yearFiltered = transactions.filter((t: any) => {
    if (t.isCancelled || t.reversalOfId) return false;
    const d = new Date(t.transactionDate);
    const month = d.getMonth();
    const year = d.getFullYear();
    const filterYear = Number(yearFilter);
    if (month >= FISCAL_YEAR_START_MONTH) { return year === filterYear - 1; } else { return year === filterYear; }
  });

  const isCrossBankIncome = (t: any) => t.transactionType === 'INTERNAL_TRANSFER' && t.sourceAccount === SECONDARY_BANK && t.destinationAccount === PRIMARY_BANK;
  const isCrossBankExpense = (t: any) => t.transactionType === 'INTERNAL_TRANSFER' && t.sourceAccount === PRIMARY_BANK && t.destinationAccount === SECONDARY_BANK;
  const incomeTx = filtered.filter((t: any) => (t.transactionType === 'INCOME' && t.affectsIncomeLedger) || isCrossBankIncome(t));
  const expenseTx = filtered.filter((t: any) => (t.transactionType === 'EXPENSE' && t.affectsExpenseLedger) || isCrossBankExpense(t));
  const yearIncome = yearFiltered.filter((t: any) => (t.transactionType === 'INCOME' && t.affectsIncomeLedger) || isCrossBankIncome(t));
  const yearExpense = yearFiltered.filter((t: any) => (t.transactionType === 'EXPENSE' && t.affectsExpenseLedger) || isCrossBankExpense(t));
  const fmtDate = (d: string | undefined) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';





  const handleCsv = () => {
    if (tab === 'income-report') {
      const hwRows = headwise(incomeTx).map(([cat, amt]: [string, number]) => [cat, fmt(amt), incomeTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length]);
      downloadCSV(`Income_Report_${dateFrom}_${dateTo}.csv`, ['Category', 'Amount', 'Count'], hwRows);
      toast('CSV downloaded ✓', 'success');
    } else if (tab === 'expense-report') {
      const hwRows = headwise(expenseTx).map(([cat, amt]: [string, number]) => [cat, fmt(amt), expenseTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length]);
      downloadCSV(`Expense_Report_${dateFrom}_${dateTo}.csv`, ['Category', 'Amount', 'Count'], hwRows);
      toast('CSV downloaded ✓', 'success');
    } else if (tab === 'audit' || tab === 'yearly-agm') {
      const incRows = headwise(yearIncome).map(([cat, amt]: [string, number]) => ['Income', cat, fmt(amt)]);
      const expRows = headwise(yearExpense).map(([cat, amt]: [string, number]) => ['Expense', cat, fmt(amt)]);
      downloadCSV(`Annual_Report_${yearFilter}.csv`, ['Type', 'Category', 'Amount'], [...incRows, ...expRows]);
      toast('CSV downloaded ✓', 'success');
    }
  };

  const handleExcel = async () => {
    if (tab === 'income-report') {
      const rows = headwise(incomeTx).map(([cat, amt]: [string, number]) => [cat, Number(amt), incomeTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length]);
      downloadExcel(`Income_Report_${dateFrom}_${dateTo}.xlsx`, ['Category', 'Amount', 'Count'], rows);
    } else if (tab === 'expense-report') {
      const rows = headwise(expenseTx).map(([cat, amt]: [string, number]) => [cat, Number(amt), expenseTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length]);
      downloadExcel(`Expense_Report_${dateFrom}_${dateTo}.xlsx`, ['Category', 'Amount', 'Count'], rows);
    } else if (tab === 'audit' || tab === 'yearly-agm') {
      const incRows = headwise(yearIncome).map(([cat, amt]: [string, number]) => ['Income', cat, Number(amt)]);
      const expRows = headwise(yearExpense).map(([cat, amt]: [string, number]) => ['Expense', cat, Number(amt)]);
      downloadExcel(`Annual_Report_${yearFilter}.xlsx`, ['Type', 'Category', 'Amount'], [...incRows, ...expRows]);
    }
    toast('Excel downloaded ✓', 'success');
  };

  const handlePdf = () => {
    try {
      if (tab === 'income-report') {
        const hw = headwise(incomeTx);
        const categories = hw.map(([cat, amt]) => ({
          category: cat,
          total: amt,
          count: incomeTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length,
          uniqueStudents: new Set(incomeTx.filter((t: any) => (t.category || 'Uncategorized') === cat && t.studentName).map((t: any) => t.studentName)).size,
        }));
        const grandTotal = hw.reduce((s: number, x: [string, number]) => s + x[1], 0);
        pdfIncomeReport(categories, grandTotal, incomeTx, dateFrom, dateTo);
      }
      else if (tab === 'expense-report') {
        const hw = headwise(expenseTx);
        const categories = hw.map(([cat, amt]) => ({
          category: cat,
          total: amt,
          count: expenseTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length,
        }));
        const grandTotal = hw.reduce((s: number, x: [string, number]) => s + x[1], 0);
        pdfExpenseReport(categories, grandTotal, expenseTx, dateFrom, dateTo);
      }
      else if (tab === 'audit') {
        const incHw = headwise(yearIncome);
        const expHw = headwise(yearExpense);
        const ti = incHw.reduce((s: number, x: [string, number]) => s + x[1], 0);
        const te = expHw.reduce((s: number, x: [string, number]) => s + x[1], 0);
        pdfAudit({ totalIncome: ti, totalExpense: te, netSurplus: ti - te, incomeByCategory: incHw, expenseByCategory: expHw }, yearFilter);
      }
      else if (tab === 'yearly-agm' && agmData) {
        const { income, expense, totalIncome, totalExpense, netSurplus, opening, closing, totalAssets, totalTransfers, transactionCount } = agmData;
        pdfYearlyAGM(income, expense, totalIncome, totalExpense, netSurplus, opening, closing, totalAssets, totalTransfers, transactionCount, yearFilter);
      }
      toast('PDF downloaded ✓', 'success');
    } catch { toast('PDF generation failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {REPORT_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all shrink-0 ${tab === t.key ? 'bg-school-primary text-white border-school-primary shadow-sm' : 'bg-white border-school-border text-school-muted hover:border-school-accent'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-school-border p-4 flex flex-wrap gap-4 items-end">
        {(tab === 'income-report' || tab === 'expense-report') && (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">From</label>
              <select value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                {MONTHS_INPUT.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">To</label>
              <select value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
                {MONTHS_INPUT.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </>
        )}
        {(tab === 'audit' || tab === 'yearly-agm') && (
          <div>
            <label className="text-[10px] font-bold uppercase text-school-muted mb-1 block">Financial Year</label>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="border border-school-border rounded-xl px-3 py-2 text-sm bg-white">
              {[0, 1, 2].map(i => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{`${y-1}-${y}`}</option>; })}
            </select>
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          {tab === 'yearly-agm' && (
            <button onClick={openOpeningBalModal} className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold hover:bg-amber-100">
              <Calendar size={14} /> Opening Balances
            </button>
          )}
          {(tab === 'income-report' || tab === 'expense-report' || tab === 'audit' || tab === 'yearly-agm') && (
            <ExportMenu onCSV={handleCsv} onExcel={handleExcel} onPDF={handlePdf} onPrint={() => printDiv('print-area')} />
          )}
        </div>
      </div>

      {/* Report Content */}
      {tab === 'income-report' && (
        <div className="bg-white rounded-xl border border-school-border overflow-hidden p-4" id="print-area">
          <h4 className="font-serif text-sm text-school-primary mb-3">Income Report — {getMonthName(Number(dateFrom.split('-')[1]) - 1)} {dateFrom.split('-')[0]} to {getMonthName(Number(dateTo.split('-')[1]) - 1)} {dateTo.split('-')[0]}</h4>
          {(() => { const hw = headwise(incomeTx); const total = hw.reduce((s, x) => s + x[1], 0); return (
            <div className="space-y-6">
              {/* Headwise Summary */}
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Income by Category</h5>
                <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">%</th><th className="px-3 py-2 text-right">Txns</th><th className="px-3 py-2 text-right">Students</th></tr></thead>
                  <tbody>{hw.map(([cat, amt], idx) => {
                    const catTx = incomeTx.filter((t: any) => (t.category || 'Uncategorized') === cat);
                    const uniqueStudents = new Set(catTx.filter((t: any) => t.studentName).map((t: any) => t.studentName)).size;
                    return <tr key={cat} className="border-t border-school-border/50"><td className="px-3 py-2 text-xs text-school-muted">{idx + 1}</td><td className="px-3 py-2 font-medium">{cat}</td><td className="px-3 py-2 text-right">{fmt(amt)} /-</td><td className="px-3 py-2 text-right">{total > 0 ? ((amt / total) * 100).toFixed(1) : 0}%</td><td className="px-3 py-2 text-right">{catTx.length}</td><td className="px-3 py-2 text-right">{uniqueStudents || '—'}</td></tr>;
                  })}</tbody>
                  <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2" colSpan={1}></td><td className="px-3 py-2">Total Income</td><td className="px-3 py-2 text-right">{fmt(total)} /-</td><td></td><td className="px-3 py-2 text-right">{incomeTx.length}</td><td className="px-3 py-2 text-right">{new Set(incomeTx.filter((t: any) => t.studentName).map((t: any) => t.studentName)).size || '—'}</td></tr></tfoot>
                </table>
              </div>
              {/* Monthly Detail */}
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Monthly Income Detail</h5>
                {(() => { if (!incomeTx.length) return <p className="text-sm text-school-muted">No income data for this period.</p>;
                  const sorted = [...incomeTx].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());
                  const sortedTotal = sorted.reduce((s, t) => s + Number(t.amount), 0);
                  return (
                  <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Class</th><th className="px-3 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                    <tbody>{sorted.map((t, i) => <tr key={t.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                      <td className="px-3 py-2 text-xs text-school-muted">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs font-mono">{fmtDate(t.transactionDate)}</td>
                      <td className="px-3 py-2 text-xs">{t.className || '—'}</td>
                      <td className="px-3 py-2 text-xs font-medium">{t.studentName || '—'}</td>
                      <td className="px-3 py-2 font-medium">{t.category || 'Uncategorized'}</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-600">{fmt(Number(t.amount))} /-</td>
                    </tr>)}</tbody>
                    <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2" colSpan={5}>Total Income ({sorted.length} transactions)</td><td className="px-3 py-2 text-right text-emerald-600">{fmt(sortedTotal)} /-</td></tr></tfoot>
                  </table>
                ); })()}
              </div>
            </div>
          ); })()}
        </div>
      )}

      {tab === 'expense-report' && (
        <div className="bg-white rounded-xl border border-school-border overflow-hidden p-4" id="print-area">
          <h4 className="font-serif text-sm text-school-primary mb-3">Expense Report — {getMonthName(Number(dateFrom.split('-')[1]) - 1)} {dateFrom.split('-')[0]} to {getMonthName(Number(dateTo.split('-')[1]) - 1)} {dateTo.split('-')[0]}</h4>
          {(() => { const hw = headwise(expenseTx); const total = hw.reduce((s, x) => s + x[1], 0); return (
            <div className="space-y-6">
              {/* Headwise Summary */}
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Expense by Category</h5>
                <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">%</th><th className="px-3 py-2 text-right">Count</th></tr></thead>
                  <tbody>{hw.map(([cat, amt], idx) => <tr key={cat} className="border-t border-school-border/50"><td className="px-3 py-2 text-xs text-school-muted">{idx + 1}</td><td className="px-3 py-2 font-medium">{cat}</td><td className="px-3 py-2 text-right">{fmt(amt)} /-</td><td className="px-3 py-2 text-right">{total > 0 ? ((amt / total) * 100).toFixed(1) : 0}%</td><td className="px-3 py-2 text-right">{expenseTx.filter((t: any) => (t.category || 'Uncategorized') === cat).length}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2" colSpan={1}></td><td className="px-3 py-2">Total Expense</td><td className="px-3 py-2 text-right">{fmt(total)} /-</td><td></td><td className="px-3 py-2 text-right">{expenseTx.length}</td></tr></tfoot>
                </table>
              </div>
              {/* Monthly Detail */}
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Monthly Expense Detail</h5>
                {(() => { if (!expenseTx.length) return <p className="text-sm text-school-muted">No expense data for this period.</p>;
                  const sorted = [...expenseTx].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());
                  const sortedTotal = sorted.reduce((s, t) => s + Number(t.amount), 0);
                  return (
                  <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                    <tbody>{sorted.map((t, i) => <tr key={t.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                      <td className="px-3 py-2 text-xs text-school-muted">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs font-mono">{fmtDate(t.transactionDate)}</td>
                      <td className="px-3 py-2 font-medium">{t.category || 'Uncategorized'}</td>
                      <td className="px-3 py-2 text-xs text-school-muted">{t.description || '—'}</td>
                      <td className="px-3 py-2 text-right font-bold text-rose-600">{fmt(Number(t.amount))} /-</td>
                    </tr>)}</tbody>
                    <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2" colSpan={4}>Total Expense ({sorted.length} transactions)</td><td className="px-3 py-2 text-right text-rose-600">{fmt(sortedTotal)} /-</td></tr></tfoot>
                  </table>
                ); })()}
              </div>
            </div>
          ); })()}
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white rounded-xl border border-school-border p-4" id="print-area">
          {(() => { const ti = yearIncome.reduce((s, t) => s + Number(t.amount), 0); const te = yearExpense.reduce((s, t) => s + Number(t.amount), 0); const ns = ti - te; return (
            <div className="space-y-4">
              <h4 className="font-serif text-sm text-school-primary">Audit Report — FY {Number(yearFilter)-1}-{yearFilter}</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-emerald-600 font-bold">Total Income</div><div className="font-serif text-lg text-emerald-700">{fmt(ti)} /-</div></div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-rose-600 font-bold">Total Expense</div><div className="font-serif text-lg text-rose-700">{fmt(te)} /-</div></div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-blue-600 font-bold">Net Surplus</div><div className={`font-serif text-lg ${ns >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(ns)} /-</div></div>
              </div>
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Income Breakdown</h5>
                <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">%</th></tr></thead>
                  <tbody>{headwise(yearIncome).map(([cat, amt], idx) => <tr key={cat} className="border-t border-school-border/50"><td className="px-3 py-2 text-xs text-school-muted">{idx + 1}</td><td className="px-3 py-2 font-medium">{cat}</td><td className="px-3 py-2 text-right">{fmt(amt)} /-</td><td className="px-3 py-2 text-right">{ti > 0 ? ((amt / ti) * 100).toFixed(1) : 0}%</td></tr>)}</tbody>
                </table>
              </div>
              <div>
                <h5 className="font-bold text-xs uppercase text-school-muted mb-2">Expense Breakdown</h5>
                <table className="w-full text-sm"><thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left w-[40px]">S#</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">%</th></tr></thead>
                  <tbody>{headwise(yearExpense).map(([cat, amt], idx) => <tr key={cat} className="border-t border-school-border/50"><td className="px-3 py-2 text-xs text-school-muted">{idx + 1}</td><td className="px-3 py-2 font-medium">{cat}</td><td className="px-3 py-2 text-right">{fmt(amt)} /-</td><td className="px-3 py-2 text-right">{te > 0 ? ((amt / te) * 100).toFixed(1) : 0}%</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ); })()}
        </div>
      )}

      {tab === 'yearly-agm' && (
        <div className="bg-white rounded-xl border border-school-border p-4" id="print-area">
          {agmLoading ? (
            <div className="flex items-center justify-center py-12 text-school-muted text-sm gap-2"><Loader size={16} className="animate-spin" /> Loading AGM report…</div>
          ) : !agmData ? (
            <div className="text-center py-12 text-sm text-school-muted">Failed to load AGM report. Try again.</div>
          ) : (() => {
            const { totalIncome, totalExpense, netSurplus, opening, closing, totalAssets, totalTransfers, transactionCount } = agmData;
            const fyLabel = `${Number(yearFilter)-1}-${yearFilter}`;
            const openTotal = ACCOUNT_IDS.reduce((s, id) => s + (opening[id] || 0), 0);
            return (
            <div className="space-y-6">
              <h4 className="font-serif text-lg text-school-primary">Annual General Meeting Report — FY {fyLabel}</h4>
              <p className="text-xs text-school-muted">Financial Year {fyLabel} ({FISCAL_START_LABEL} {Number(yearFilter)-1} – {FISCAL_END_LABEL} {yearFilter})</p>

              {/* 1. Income & Expenditure */}
              <div>
                <h5 className="font-bold text-sm uppercase text-school-primary mb-3 border-b border-school-border pb-1">1. Income & Expenditure Statement</h5>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-emerald-700 uppercase mb-1">Income</div>
                  {agmData.income.map(([cat, amt]: [string, number]) => <div key={cat} className="flex justify-between py-1 border-b border-school-border/50 text-sm"><span>{cat}</span><span className="font-bold">{fmt(amt)} /-</span></div>)}
                  <div className="flex justify-between py-2 border-b-2 border-school-primary font-bold text-sm bg-school-paper rounded px-2"><span>Total Income</span><span className="text-emerald-600">{fmt(totalIncome)} /-</span></div>
                </div>
                <div className="space-y-1 mt-3">
                  <div className="text-xs font-bold text-rose-700 uppercase mb-1">Expenditure</div>
                  {agmData.expense.map(([cat, amt]: [string, number]) => <div key={cat} className="flex justify-between py-1 border-b border-school-border/50 text-sm"><span>{cat}</span><span className="font-bold">{fmt(amt)} /-</span></div>)}
                  <div className="flex justify-between py-2 border-b-2 border-school-primary font-bold text-sm bg-school-paper rounded px-2"><span>Total Expenditure</span><span className="text-rose-600">{fmt(totalExpense)} /-</span></div>
                </div>
                <div className="flex justify-between py-3 mt-2 bg-school-primary text-white rounded-xl px-4 font-bold"><span>Annual {netSurplus >= 0 ? 'Surplus' : 'Deficit'}</span><span>{fmt(Math.abs(netSurplus))} /-</span></div>
              </div>

              {/* 2. Balance Sheet */}
              <div>
                <h5 className="font-bold text-sm uppercase text-school-primary mb-3 border-b border-school-border pb-1">2. Balance Sheet — As at 31 Aug {yearFilter}</h5>
                <table className="w-full text-sm">
                  <thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-school-border/50"><td className="px-3 py-2">AL RAWA Bank</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.AL_RAWA_BANK || 0)} /-</td></tr>
                    <tr className="border-t border-school-border/50 bg-school-paper/30"><td className="px-3 py-2">Global Forum Bank</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.GLOBAL_FORUM_BANK || 0)} /-</td></tr>
                    <tr className="border-t border-school-border/50"><td className="px-3 py-2">Cash in Hand</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.CASH_IN_HAND || 0)} /-</td></tr>
                  </tbody>
                  <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2">Total Assets</td><td className="px-3 py-2 text-right">{fmt(totalAssets)} /-</td></tr></tfoot>
                </table>
                <div className="flex justify-between py-3 mt-2 bg-school-primary text-white rounded-xl px-4 font-bold"><span>Net Assets</span><span>{fmt(totalAssets)} /-</span></div>
              </div>

              {/* 3. Receipts & Payments */}
              <div>
                <h5 className="font-bold text-sm uppercase text-school-primary mb-3 border-b border-school-border pb-1">3. Receipts & Payments Statement</h5>
                <table className="w-full text-sm">
                  <thead><tr className="bg-school-primary text-white text-[10px] uppercase"><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Closing</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-school-border/50"><td className="px-3 py-2">AL RAWA Bank</td><td className="px-3 py-2 text-right">{fmt(opening.AL_RAWA_BANK || 0)} /-</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.AL_RAWA_BANK || 0)} /-</td></tr>
                    <tr className="border-t border-school-border/50 bg-school-paper/30"><td className="px-3 py-2">Global Forum Bank</td><td className="px-3 py-2 text-right">{fmt(opening.GLOBAL_FORUM_BANK || 0)} /-</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.GLOBAL_FORUM_BANK || 0)} /-</td></tr>
                    <tr className="border-t border-school-border/50"><td className="px-3 py-2">Cash in Hand</td><td className="px-3 py-2 text-right">{fmt(opening.CASH_IN_HAND || 0)} /-</td><td className="px-3 py-2 text-right font-bold">{fmt(closing.CASH_IN_HAND || 0)} /-</td></tr>
                  </tbody>
                  <tfoot><tr className="border-t-2 border-school-primary font-bold bg-school-paper"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{fmt(openTotal)} /-</td><td className="px-3 py-2 text-right">{fmt(totalAssets)} /-</td></tr></tfoot>
                </table>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-emerald-600 font-bold">Total Received</div><div className="font-bold text-emerald-700">{fmt(totalIncome)} /-</div></div>
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-rose-600 font-bold">Total Paid</div><div className="font-bold text-rose-700">{fmt(totalExpense)} /-</div></div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-blue-600 font-bold">Net Movement</div><div className={`font-bold ${netSurplus >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(netSurplus)} /-</div></div>
                </div>
              </div>

              {/* 4. Internal Transfers */}
              <div>
                <h5 className="font-bold text-sm uppercase text-school-primary mb-2 border-b border-school-border pb-1">4. Internal Transfers</h5>
                <p className="text-sm">Total: {fmt(totalTransfers)} /- ({agmData.transferCount || 0} transactions)</p>
                <p className="text-xs text-school-muted mt-1">Internal transfers between bank accounts and Cash in Hand do not affect income/expense.</p>
              </div>

              {/* 5. Recommendations */}
              <div>
                <h5 className="font-bold text-sm uppercase text-school-primary mb-2 border-b border-school-border pb-1">5. Recommendations</h5>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>Net surplus of {fmt(netSurplus)} /- for FY {fyLabel}.</li>
                  {totalIncome > 0 && <li>Expense-to-income ratio: {((totalExpense / totalIncome) * 100).toFixed(1)}%.</li>}
                  <li>Total assets stand at {fmt(totalAssets)} /- across 3 accounts.</li>
                  <li>{transactionCount} total transactions recorded during the year.</li>
                  <li>All financial records are available for detailed audit.</li>
                </ol>
              </div>

              {/* Signatures */}
              <div className="border-t border-school-border pt-4 mt-6">
                <div className="flex justify-between">
                  {([['Finance Director', 12], ['Managing Director', 82], ['Chairman', 144]] as const).map(([lbl, ml]) => (
                    <div key={lbl} className="text-center" style={{ marginLeft: `${ml / 16}rem` }}>
                      <div className="w-40 border-b border-gray-400 mb-1"></div>
                      <span className="text-[10px] text-school-muted font-bold uppercase">{lbl}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ); })()}
        </div>
      )}

      {/* Opening Balance Settings Modal */}
      {showOpeningBalModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowOpeningBalModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-school-primary mb-1">Opening Balances — FY {Number(yearFilter)-1}-{yearFilter}</h3>
            <p className="text-xs text-school-muted mb-4">Set the opening balances for each account at the start of the fiscal year ({FISCAL_START_LABEL} 1). Default is 0 for new schools.</p>
            <div className="space-y-3">
              {ACCOUNT_IDS.map(acct => (
                <div key={acct}>
                  <label className="text-xs font-bold uppercase text-school-muted block mb-1">{acct.replace(/_/g, ' ')}</label>
                  <input type="number" value={editOpenBal[acct] || '0'} onChange={e => setEditOpenBal({ ...editOpenBal, [acct]: e.target.value })}
                    className="w-full border border-school-border rounded-xl px-3 py-2 text-sm" />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-4">
              <button onClick={() => setShowHistory(!showHistory)} className="text-xs text-school-accent font-bold hover:underline">
                {showHistory ? 'Hide History' : 'View History'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowOpeningBalModal(false)} className="px-4 py-2 border border-school-border rounded-xl text-sm">Cancel</button>
                <button onClick={handleSaveOpeningBal} disabled={savingOpenBal} className="px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50">
                  {savingOpenBal ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {showHistory && openingBalancesHistory.length > 0 && (
              <div className="mt-4 max-h-48 overflow-y-auto border-t border-school-border pt-3">
                <h4 className="text-xs font-bold uppercase text-school-muted mb-2">Change History</h4>
                {openingBalancesHistory.map((h: any) => (
                  <div key={h.id} className="flex justify-between items-center py-1.5 border-b border-school-border/50 text-xs">
                    <div>
                      <span className="font-bold">{h.account.replace(/_/g, ' ')}</span>
                      <span className="text-school-muted ml-2">{Number(h.oldAmount).toLocaleString()} → {Number(h.newAmount).toLocaleString()}</span>
                    </div>
                    <button onClick={() => handleRevert(h.id)} className="text-amber-700 font-bold hover:underline">Undo</button>
                  </div>
                ))}
              </div>
            )}
            {showHistory && openingBalancesHistory.length === 0 && (
              <p className="mt-4 text-xs text-school-muted">No change history recorded yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceReports;
