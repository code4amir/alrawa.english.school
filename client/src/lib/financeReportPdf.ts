import jsPDF from 'jspdf';
import { FISCAL_START_LABEL, FISCAL_END_LABEL } from './config';
import { getLogoDataUri, logoImageFormat } from './logo';
import { getMonthName, getMonthNameShort, fmt, headwise } from './reportFormat';

// Re-exported for backward compat (tests + any lingering static imports).
export { getMonthName, getMonthNameShort, fmt, headwise };

export async function addLogo(doc: jsPDF, y: number) {
  try {
    const uri = await getLogoDataUri();
    doc.addImage(uri, logoImageFormat(uri), 12, y, 18, 18);
  } catch { console.debug('Photo load skipped'); }
}

export async function addHeader(doc: jsPDF, title: string, subtitle: string, y: number) {
  await addLogo(doc, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26, 26, 46);
  doc.text('AL RAWA English School', 34, y + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130, 124, 114);
  doc.text('ESTD: 2022  ·  Read in the name of your Lord', 34, y + 13);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
  doc.text(title, 12, y + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 124, 114);
  doc.text(subtitle, 12, y + 31);
  return y + 38;
}

function subtitleForRange(dateFrom: string, dateTo: string) {
  return `${getMonthName(Number(dateFrom.split('-')[1]) - 1)} ${dateFrom.split('-')[0]} — ${getMonthName(Number(dateTo.split('-')[1]) - 1)} ${dateTo.split('-')[0]}`;
}

export async function pdfIncomeReport(
  hwData: { category: string; total: number; count: number; uniqueStudents: number }[],
  grandTotal: number, data: any[], dateFrom: string, dateTo: string,
) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  let y = await addHeader(doc, 'INCOME REPORT', subtitleForRange(dateFrom, dateTo), 10);

  // ── SECTION 1: Headwise Summary ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Income by Category', 12, y); y += 6;

  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('Category', 14, y + 4.5); doc.text('Amount', 110, y + 4.5, { align: 'right' }); doc.text('% Share', 150, y + 4.5, { align: 'right' }); doc.text('Txns', 172, y + 4.5, { align: 'right' }); doc.text('Students', 186, y + 4.5, { align: 'right' });
  y += 7;

  hwData.forEach(({ category: cat, total: amt, count, uniqueStudents }, i) => {
    const pct = grandTotal > 0 ? ((amt / grandTotal) * 100).toFixed(1) : '0';
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4); doc.text(fmt(amt), 110, y + 4, { align: 'right' });
    doc.text(`${pct}%`, 150, y + 4, { align: 'right' }); doc.text(String(count), 172, y + 4, { align: 'right' });
    doc.text(String(uniqueStudents || '—'), 186, y + 4, { align: 'right' });
    y += 6;
  });

  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
  doc.text(`TOTAL INCOME: ${fmt(grandTotal)} /-`, 14, y + 4.5);
  doc.text(`${hwData.length} categories  ·  ${data.length} transactions`, 186, y + 4.5, { align: 'right' });
  y += 14;

  // ── SECTION 2: Monthly Detail ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Monthly Income Detail', 12, y); y += 6;

  if (!data.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 124, 114);
    doc.text('No transactions for this period.', 12, y + 6);
    doc.save(`Income_Report_${dateFrom}_to_${dateTo}.pdf`);
    return;
  }

  const M = 12, PW = 186;
  const dateW = 24, classW = 28, studentW = 38, catW = 32, amtW = 24, balW = 24;
  const headerH = 7, rowH = 5;
  const catX = M + dateW + classW + studentW;
  const amtX = catX + catW;
  const balX = amtX + amtW;

  const sorted = [...data].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

  let running = 0;

  function drawDetailHeader() {
    doc.setFillColor(26, 26, 46); doc.rect(M, y, PW, headerH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255);
    doc.text('Date', M + 2, y + 4.5);
    doc.text('Class', M + dateW + 2, y + 4.5);
    doc.text('Student', M + dateW + classW + 2, y + 4.5);
    doc.text('Category', catX + 2, y + 4.5);
    doc.text('Amount', amtX + amtW - 2, y + 4.5, { align: 'right' });
    doc.text('Running', balX + balW - 2, y + 4.5, { align: 'right' });
    y += headerH;
  }

  drawDetailHeader();

  sorted.forEach((t, i) => {
    if (y > 270) { doc.addPage(); y = 14; drawDetailHeader(); }
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(M, y, PW, rowH, 'F'); }

    const dateStr = new Date(t.transactionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    running += Number(t.amount);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80); doc.text(dateStr, M + 2, y + 3.5);
    doc.setTextColor(26, 26, 46); doc.text((t.className || '—').substring(0, 16), M + dateW + 2, y + 3.5);
    doc.setTextColor(26, 26, 46); doc.text((t.studentName || '—').substring(0, 24), M + dateW + classW + 2, y + 3.5);
    doc.setTextColor(130, 124, 114); doc.text((t.category || 'Uncategorized').substring(0, 18), catX + 2, y + 3.5);
    doc.setTextColor(22, 101, 52); doc.text(fmt(Number(t.amount)) + ' /-', amtX + amtW - 2, y + 3.5, { align: 'right' });
    doc.setTextColor(130, 124, 114); doc.text(fmt(running) + ' /-', balX + balW - 2, y + 3.5, { align: 'right' });
    y += rowH;
  });

  if (y > 260) { doc.addPage(); y = 14; }
  doc.setFillColor(26, 26, 46); doc.rect(M, y, PW, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text(`TOTAL (${sorted.length} transactions)`, M + 2, y + 5.5);
  doc.text(fmt(running) + ' /-', balX + balW - 2, y + 5.5, { align: 'right' });

  doc.save(`Income_Report_${dateFrom}_to_${dateTo}.pdf`);
}

export async function pdfExpenseReport(
  hwData: { category: string; total: number; count: number }[],
  grandTotal: number, data: any[], dateFrom: string, dateTo: string,
) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  let y = await addHeader(doc, 'EXPENSE REPORT', subtitleForRange(dateFrom, dateTo), 10);

  // ── SECTION 1: Headwise Summary ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Expense by Category', 12, y); y += 6;

  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('Category', 14, y + 4.5); doc.text('Amount', 120, y + 4.5, { align: 'right' }); doc.text('% Share', 160, y + 4.5, { align: 'right' }); doc.text('Count', 186, y + 4.5, { align: 'right' });
  y += 7;

  hwData.forEach(({ category: cat, total: amt, count }, i) => {
    const pct = grandTotal > 0 ? ((amt / grandTotal) * 100).toFixed(1) : '0';
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4); doc.text(fmt(amt), 120, y + 4, { align: 'right' });
    doc.text(`${pct}%`, 160, y + 4, { align: 'right' }); doc.text(String(count), 186, y + 4, { align: 'right' });
    y += 6;
  });

  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
  doc.text(`TOTAL EXPENSE: ${fmt(grandTotal)} /-`, 14, y + 4.5);
  doc.text(`${hwData.length} categories  ·  ${data.length} transactions`, 186, y + 4.5, { align: 'right' });
  y += 14;

  // ── SECTION 2: Monthly Detail ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Monthly Expense Detail', 12, y); y += 6;

  if (!data.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 124, 114);
    doc.text('No transactions for this period.', 12, y + 6);
    doc.save(`Expense_Report_${dateFrom}_to_${dateTo}.pdf`);
    return;
  }

  const M = 12, PW = 186;
  const dateW = 24, catW = 32, descW = 80, amtW = 24, balW = 24;
  const headerH = 7, rowH = 5;
  const catX = M + dateW + catW;
  const descX = catX;
  const amtX = M + dateW + catW + descW;
  const balX = amtX + amtW;

  const sorted = [...data].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

  let running = 0;

  function drawDetailHeader() {
    doc.setFillColor(26, 26, 46); doc.rect(M, y, PW, headerH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255);
    doc.text('Date', M + 2, y + 4.5);
    doc.text('Category', M + dateW + 2, y + 4.5);
    doc.text('Description', descX + catW + 2, y + 4.5);
    doc.text('Amount', amtX + amtW - 2, y + 4.5, { align: 'right' });
    doc.text('Running', balX + balW - 2, y + 4.5, { align: 'right' });
    y += headerH;
  }

  drawDetailHeader();

  sorted.forEach((t, i) => {
    if (y > 270) { doc.addPage(); y = 14; drawDetailHeader(); }
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(M, y, PW, rowH, 'F'); }

    const dateStr = new Date(t.transactionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    running += Number(t.amount);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80); doc.text(dateStr, M + 2, y + 3.5);
    doc.setTextColor(26, 26, 46); doc.text((t.category || 'Uncategorized').substring(0, 18), M + dateW + 2, y + 3.5);
    doc.setTextColor(130, 124, 114); doc.text((t.description || '—').substring(0, 50), descX + catW + 2, y + 3.5);
    doc.setTextColor(185, 28, 28); doc.text(fmt(Number(t.amount)) + ' /-', amtX + amtW - 2, y + 3.5, { align: 'right' });
    doc.setTextColor(130, 124, 114); doc.text(fmt(running) + ' /-', balX + balW - 2, y + 3.5, { align: 'right' });
    y += rowH;
  });

  if (y > 260) { doc.addPage(); y = 14; }
  doc.setFillColor(26, 26, 46); doc.rect(M, y, PW, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text(`TOTAL (${sorted.length} transactions)`, M + 2, y + 5.5);
  doc.text(fmt(running) + ' /-', balX + balW - 2, y + 5.5, { align: 'right' });

  doc.save(`Expense_Report_${dateFrom}_to_${dateTo}.pdf`);
}

export async function pdfAudit(data: { totalIncome: number; totalExpense: number; netSurplus: number; incomeByCategory: [string, number][]; expenseByCategory: [string, number][] }, yearFilter: string) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  let y = await addHeader(doc, 'ANNUAL AUDIT REPORT', `Financial Year ${Number(yearFilter)-1}-${yearFilter} (${FISCAL_START_LABEL} ${Number(yearFilter)-1} – ${FISCAL_END_LABEL} ${yearFilter})`, 10);

  const { totalIncome, totalExpense, netSurplus, incomeByCategory: inc, expenseByCategory: exp } = data;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 26, 46);
  doc.text('FINANCIAL SUMMARY', 12, y); y += 7;

  const summaryRows: [string, string][] = [
    ['Total Income', `${fmt(totalIncome)} /-`],
    ['Total Expense', `${fmt(totalExpense)} /-`],
    ['Net Surplus / (Deficit)', `${fmt(netSurplus)} /-`],
  ];
  summaryRows.forEach(([k, v], i) => {
    doc.setFillColor(i % 2 === 0 ? 255 : 244, i % 2 === 0 ? 253 : 239, i % 2 === 0 ? 247 : 230);
    doc.rect(12, y, 186, 7, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(k, 14, y + 4.5); doc.setFont('helvetica', 'bold');
    doc.text(v, 196, y + 4.5, { align: 'right' });
    y += 7;
  });
  y += 6;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('INCOME BY CATEGORY', 12, y); y += 7;
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('Category', 14, y + 4); doc.text('Amount', 120, y + 4, { align: 'right' }); doc.text('%', 160, y + 4, { align: 'right' }); doc.text('Count', 186, y + 4, { align: 'right' });
  y += 6;
  inc.forEach(([cat, amt]: [string, number], i: number) => {
    if (y > 270) { doc.addPage(); y = 14; }
    const pct = totalIncome > 0 ? ((amt / totalIncome) * 100).toFixed(1) : '0';
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4); doc.text(fmt(amt), 120, y + 4, { align: 'right' });
    doc.text(`${pct}%`, 160, y + 4, { align: 'right' });
    y += 6;
  });
  y += 6;

  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 26, 46);
  doc.text('EXPENSE BY CATEGORY', 12, y); y += 7;
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('Category', 14, y + 4); doc.text('Amount', 120, y + 4, { align: 'right' }); doc.text('%', 160, y + 4, { align: 'right' }); doc.text('Count', 186, y + 4, { align: 'right' });
  y += 6;
  exp.forEach(([cat, amt]: [string, number], i: number) => {
    if (y > 270) { doc.addPage(); y = 14; }
    const pct = totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : '0';
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4); doc.text(fmt(amt), 120, y + 4, { align: 'right' });
    doc.text(`${pct}%`, 160, y + 4, { align: 'right' });
    y += 6;
  });
  y += 8;

  if (y > 230) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 26, 46);
  doc.text('AUDIT CERTIFICATE', 12, y); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  const certText = `This is to certify that the accounts of AL RAWA English School for the financial year ${Number(yearFilter)-1}-${yearFilter} (${FISCAL_START_LABEL} ${Number(yearFilter)-1} – ${FISCAL_END_LABEL} ${yearFilter}) have been examined. Total income stood at ${fmt(totalIncome)} /- and total expenditure at ${fmt(totalExpense)} /-, resulting in a net surplus of ${fmt(netSurplus)} /-. All transactions have been verified against supporting documents.`;
  const lines = doc.splitTextToSize(certText, 186);
  doc.text(lines, 12, y); y += lines.length * 5 + 10;

  const sigW = 60;
  ([['Prepared By', 12], ['Finance Officer', 82], ['Principal', 152]] as const).forEach(([lbl, sx]) => {
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3);
    doc.line(sx, y, sx + sigW, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130, 124, 114);
    doc.text(lbl, sx + sigW / 2, y + 4, { align: 'center' });
  });

  doc.save(`Audit_Report_${yearFilter}.pdf`);
}

export interface AgmPdfData {
  yearFilter: string;
  income: [string, number][];
  expense: [string, number][];
  totalIncome: number;
  totalExpense: number;
  netSurplus: number;
  opening: Record<string, number>;
  closing: Record<string, number>;
  totalAssets: number;
  totalTransfers: number;
  transactionCount: number;
  transferCount?: number;
  monthlyIncome: { label: string; total: number }[];
  monthlyExpense: { label: string; total: number }[];
  barPng: string | null;
  piePng: string | null;
  prev: { totalIncome: number; totalExpense: number; netSurplus: number } | null;
  duesOutstanding: number | null;
}

export async function pdfYearlyAGM(d: AgmPdfData) {
  const {
    income, expense, totalIncome, totalExpense, netSurplus,
    opening, closing, totalAssets, totalTransfers, transactionCount,
    monthlyIncome, monthlyExpense, barPng, piePng, prev, duesOutstanding,
    yearFilter,
  } = d;
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  let y = await addHeader(doc, 'ANNUAL GENERAL MEETING REPORT', `Session: ${Number(yearFilter)-1}-${yearFilter} (${FISCAL_START_LABEL} ${Number(yearFilter)-1} – ${FISCAL_END_LABEL} ${yearFilter})`, 10);

  const fyLabel = `${Number(yearFilter)-1}-${yearFilter}`;

  // ── KEY FIGURES STRIP ──
  const figs: [string, number][] = [
    ['Income', totalIncome], ['Expenditure', totalExpense],
    [netSurplus >= 0 ? 'Surplus' : 'Deficit', Math.abs(netSurplus)], ['Closing Assets', totalAssets],
  ];
  figs.forEach(([lbl, val], i) => {
    const x = 12 + i * 47;
    doc.setFillColor(245, 242, 235); doc.rect(x, y, 45, 12, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(130, 124, 114);
    doc.text(lbl.toUpperCase(), x + 22.5, y + 4, { align: 'center' });
    doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(fmt(val) + ' /-', x + 22.5, y + 9, { align: 'center' });
  });
  y += 17;

  // ── 1. INCOME AND EXPENDITURE STATEMENT ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
  doc.text('1. INCOME AND EXPENDITURE STATEMENT', 12, y); y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 124, 114);
  doc.text(`For the financial year ${fyLabel} (${FISCAL_START_LABEL} ${Number(yearFilter)-1} – ${FISCAL_END_LABEL} ${yearFilter})`, 12, y); y += 6;

  // Income heads
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Income', 12, y); y += 5;
  (income as [string, number][]).forEach(([cat, amt]) => {
    if (y > 270) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4);
    if (totalIncome > 0) { doc.setFontSize(7); doc.setTextColor(130, 124, 114); doc.text(`${((Number(amt) / totalIncome) * 100).toFixed(1)}%`, 140, y + 4); }
    doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(fmt(amt) + ' /-', 196, y + 4, { align: 'right' });
    y += 5;
  });
  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Total Income', 14, y + 4); doc.text(fmt(totalIncome) + ' /-', 196, y + 4, { align: 'right' });
  y += 9;

  // Expense heads
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Expenditure', 12, y); y += 5;
  (expense as [string, number][]).forEach(([cat, amt]) => {
    if (y > 270) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(cat, 14, y + 4);
    if (totalExpense > 0) { doc.setFontSize(7); doc.setTextColor(130, 124, 114); doc.text(`${((Number(amt) / totalExpense) * 100).toFixed(1)}%`, 140, y + 4); }
    doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(fmt(amt) + ' /-', 196, y + 4, { align: 'right' });
    y += 5;
  });
  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Total Expenditure', 14, y + 4); doc.text(fmt(totalExpense) + ' /-', 196, y + 4, { align: 'right' });
  y += 9;

  // Expense mix donut
  if (piePng) {
    if (y > 190) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
    doc.text('Expenditure Mix', 12, y); y += 4;
    doc.addImage(piePng, 'PNG', 12, y, 186, 70);
    y += 74;
  }

  // Annual Surplus / Deficit
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text(`ANNUAL ${netSurplus >= 0 ? 'SURPLUS' : 'DEFICIT'}`, 14, y + 4.5);
  doc.text(fmt(Math.abs(netSurplus)) + ' /-', 196, y + 4.5, { align: 'right' });
  y += 12;

  // ── 2. MONTHLY INCOME AND EXPENDITURE ──
  if (monthlyIncome.length > 0) {
    if (y > 200) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
    doc.text('2. MONTHLY INCOME AND EXPENDITURE', 12, y); y += 8;
    if (barPng) {
      doc.addImage(barPng, 'PNG', 12, y, 186, 87);
      y += 91;
    }
    doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
    doc.text('Month', 14, y + 4); doc.text('Income', 120, y + 4, { align: 'right' });
    doc.text('Expenditure', 158, y + 4, { align: 'right' }); doc.text('Net', 196, y + 4, { align: 'right' });
    y += 6;
    monthlyIncome.forEach((m, i) => {
      if (y > 270) { doc.addPage(); y = 14; }
      const exp = monthlyExpense[i]?.total || 0;
      if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 5.5, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
      doc.text(m.label, 14, y + 4);
      doc.text(fmt(m.total) + ' /-', 120, y + 4, { align: 'right' });
      doc.text(fmt(exp) + ' /-', 158, y + 4, { align: 'right' });
      doc.text(fmt(m.total - exp) + ' /-', 196, y + 4, { align: 'right' });
      y += 5.5;
    });
    y += 4;
  }

  // ── 3. BALANCE SHEET ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
  doc.text('3. BALANCE SHEET', 12, y); y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 124, 114);
  doc.text(`As at 31 August ${yearFilter}`, 12, y); y += 6;

  // Assets table
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('Assets', 12, y); y += 6;

  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('Account', 14, y + 4); doc.text('Balance', 196, y + 4, { align: 'right' });
  y += 6;

  const assetRows: [string, number][] = ['AL_RAWA_BANK', 'GLOBAL_FORUM_BANK', 'CASH_IN_HAND'].map(id => [LEDGER_LABELS[id], closing[id]]);
  assetRows.forEach(([name, val], i) => {
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(name, 14, y + 4); doc.text(fmt(val) + ' /-', 196, y + 4, { align: 'right' });
    y += 6;
  });
  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Total Assets', 14, y + 4); doc.text(fmt(totalAssets) + ' /-', 196, y + 4, { align: 'right' });
  y += 9;

  // Net Assets
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text('NET ASSETS (Total Assets)', 14, y + 4.5);
  doc.text(fmt(totalAssets) + ' /-', 196, y + 4.5, { align: 'right' });
  y += 12;

  // ── 4. RECEIPTS AND PAYMENTS STATEMENT ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
  doc.text('4. RECEIPTS AND PAYMENTS STATEMENT', 12, y); y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130, 124, 114);
  doc.text(`For the financial year ${fyLabel}`, 12, y); y += 6;

  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('', 14, y + 4); doc.text('Opening', 130, y + 4, { align: 'right' }); doc.text('Closing', 196, y + 4, { align: 'right' });
  y += 6;

  const ACCT_IDS = ['AL_RAWA_BANK', 'GLOBAL_FORUM_BANK', 'CASH_IN_HAND'] as const;
  const rpRows: [string, number, number][] = ACCT_IDS.map(id => [LEDGER_LABELS[id], opening[id] ?? 0, closing[id]]);
  rpRows.forEach(([name, open, close], i) => {
    if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
    doc.text(name, 14, y + 4); doc.text(fmt(open) + ' /-', 130, y + 4, { align: 'right' }); doc.text(fmt(close) + ' /-', 196, y + 4, { align: 'right' });
    y += 6;
  });

  // Totals row
  const openTotal = rpRows.reduce((s, [, o]) => s + o, 0);
  const closeTotal = totalAssets;
  doc.setFillColor(240, 235, 225); doc.rect(12, y, 186, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Total', 14, y + 4); doc.text(fmt(openTotal) + ' /-', 130, y + 4, { align: 'right' }); doc.text(fmt(closeTotal) + ' /-', 196, y + 4, { align: 'right' });
  y += 9;

  // Summary
  const totalReceived = totalIncome;
  const totalPaid = totalExpense;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
  doc.text(`Total Cash Received: ${fmt(totalReceived)} /-`, 14, y + 4); y += 5;
  doc.text(`Total Cash Paid: ${fmt(totalPaid)} /-`, 14, y + 4); y += 5;
  doc.text(`Net Movement: ${fmt(totalReceived - totalPaid)} /-`, 14, y + 4); y += 12;

  // ── 5. INTERNAL TRANSFERS ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
  doc.text('5. INTERNAL TRANSFERS', 12, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
  doc.text(`Total Internal Transfers: ${fmt(totalTransfers)} /-`, 14, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 124, 114);
  doc.text('Note: Internal transfers between bank accounts and Cash in Hand do not affect the income/expense ledger.', 14, y); y += 10;

  // ── 6. YEAR-ON-YEAR COMPARISON ──
  if (prev) {
    if (y > 220) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
    doc.text('6. COMPARISON WITH PREVIOUS YEAR', 12, y); y += 8;
    doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
    doc.text('Head', 14, y + 4);
    doc.text(`FY ${Number(yearFilter) - 2}-${Number(yearFilter) - 1}`, 130, y + 4, { align: 'right' });
    doc.text(`FY ${fyLabel}`, 163, y + 4, { align: 'right' });
    doc.text('Change', 196, y + 4, { align: 'right' });
    y += 6;
    ([
      ['Total Income', prev.totalIncome, totalIncome],
      ['Total Expenditure', prev.totalExpense, totalExpense],
      ['Annual Surplus', prev.netSurplus, netSurplus],
    ] as [string, number, number][]).forEach(([lbl, p, c], i) => {
      if (i % 2 === 0) { doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 6, 'F'); }
      const diff = Number(c) - Number(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
      doc.text(lbl, 14, y + 4);
      doc.text(fmt(p) + ' /-', 130, y + 4, { align: 'right' });
      doc.text(fmt(c) + ' /-', 163, y + 4, { align: 'right' });
      doc.text(`${diff >= 0 ? '+' : ''}${fmt(diff)} /-`, 196, y + 4, { align: 'right' });
      y += 6;
    });
    y += 4;
  }

  // ── 7. NOTES AND RECOMMENDATIONS ──
  if (y > 200) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(26, 26, 46);
  doc.text('7. NOTES AND RECOMMENDATIONS', 12, y); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  const recs = [
    `Net surplus of ${fmt(netSurplus)} /- for FY ${fyLabel}.`,
    totalIncome > 0 ? `Expense-to-income ratio: ${((totalExpense / totalIncome) * 100).toFixed(1)}%.` : 'No income recorded.',
    `Total assets stand at ${fmt(totalAssets)} /- across 3 accounts.`,
    ...(duesOutstanding !== null ? [`Fee dues outstanding for the year: ${fmt(duesOutstanding)} /-.`] : []),
    `${transactionCount} total transactions recorded during the year.`,
    'All financial records are available for detailed audit.',
  ];
  recs.forEach((r, i) => {
    doc.text(`${i + 1}. ${r}`, 14, y); y += 5;
  });
  y += 10;

  // ── SIGNATURES ──
  if (y > 240) { doc.addPage(); y = 14; }
  const sigW = 55;
  ([['Finance Director', 12], ['Managing Director', 82], ['Chairman', 144]] as const).forEach(([lbl, sx]) => {
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3);
    doc.line(sx, y, sx + sigW, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130, 124, 114);
    doc.text(lbl, sx + sigW / 2, y + 4, { align: 'center' });
  });

  doc.save(`AGM_Report_${fyLabel.replace('-', '_')}.pdf`);
}

const LEDGER_LABELS: Record<string, string> = { AL_RAWA_BANK: 'AL RAWA Bank', GLOBAL_FORUM_BANK: 'Global Forum Bank', CASH_IN_HAND: 'Cash in Hand' };

export async function pdfLedger(entries: any[], account: string, dateFrom: string, dateTo: string, openingBalance: number, closingBalance: number, totalDebit?: number, totalCredit?: number) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
  const accLabel = LEDGER_LABELS[account] || account;
  const rangeStr = dateFrom || dateTo ? `${dateFrom || 'earliest'} — ${dateTo || 'latest'}` : 'All dates';
  let y = await addHeader(doc, `${accLabel} Ledger`, rangeStr, 10);

  const M = 10, PW = 277;
  const colW = { voucher: 28, txnDate: 20, entryDate: 20, type: 14, cat: 26, desc: 70, student: 32, class: 22, debit: 24, credit: 24, balance: 28, status: 12 };
  const headerH = 7, rowH = 5;

  function drawTableHeader() {
    doc.setFillColor(26, 26, 46);
    doc.rect(M, y, PW, headerH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(255, 255, 255);
    let cx = M + 2;
    doc.text('Voucher', cx, y + 4.5); cx += colW.voucher;
    doc.text('Txn Date', cx, y + 4.5); cx += colW.txnDate;
    doc.text('Entry Date', cx, y + 4.5); cx += colW.entryDate;
    doc.text('Type', cx, y + 4.5); cx += colW.type;
    doc.text('Category', cx, y + 4.5); cx += colW.cat;
    doc.text('Description', cx, y + 4.5); cx += colW.desc;
    doc.text('Student', cx, y + 4.5); cx += colW.student;
    doc.text('Class', cx, y + 4.5); cx += colW.class;
    doc.text('Debit', cx + colW.debit - 2, y + 4.5, { align: 'right' }); cx += colW.debit;
    doc.text('Credit', cx + colW.credit - 2, y + 4.5, { align: 'right' }); cx += colW.credit;
    doc.text('Balance', cx + colW.balance - 2, y + 4.5, { align: 'right' }); cx += colW.balance;
    doc.text('St', cx + 2, y + 4.5);
    y += headerH;
  }

  if (!entries.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(130, 124, 114);
    doc.text('No entries for this period.', M, y + 10);
    doc.save(`${accLabel.replace(/\s+/g, '_')}_Ledger_${dateFrom || 'all'}_to_${dateTo || 'all'}.pdf`);
    return;
  }

  function drawOpeningRow() {
    doc.setFillColor(244, 244, 244);
    doc.rect(M, y, PW, rowH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
    doc.text('Opening Balance', M + 2, y + 3.5);
    doc.text(fmt(openingBalance) + ' /-', M + PW - 2, y + 3.5, { align: 'right' });
    y += rowH;
  }

  drawTableHeader();
  drawOpeningRow();

  entries.forEach((e: any, i: number) => {
    if (y > 195) { doc.addPage(); y = 14; drawTableHeader(); drawOpeningRow(); }

    const isCancelled = e.status === 'Cancelled';
    const isReversal = e.status === 'Reversal';

    if (isCancelled) {
      doc.setFillColor(254, 226, 226); doc.rect(M, y, PW, rowH, 'F');
    } else if (isReversal) {
      doc.setFillColor(243, 232, 255); doc.rect(M, y, PW, rowH, 'F');
    } else if (i % 2 === 0) {
      doc.setFillColor(255, 253, 247); doc.rect(M, y, PW, rowH, 'F');
    }

    const txnDateStr = e.transactionDate ? new Date(e.transactionDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const entryDateStr = e.entryDate || '—';
    const typeLabel = e.transactionType === 'INTERNAL_TRANSFER' ? 'Xfer' : e.transactionType;
    const debit = e.debit || 0;
    const credit = e.credit || 0;
    const statusChar = e.status === 'Active' ? 'OK' : e.status === 'Cancelled' ? 'X' : 'R';
    const textColor: [number, number, number] = isCancelled ? [180, 80, 80] : [26, 26, 46];

    let cx = M + 2;
    doc.setFont('helvetica', isCancelled ? 'normal' : 'bold'); doc.setFontSize(5.5); doc.setTextColor(...textColor);
    doc.text((e.voucher || '—').substring(0, 18), cx, y + 3.5); cx += colW.voucher;

    doc.setFont('helvetica', 'normal');
    doc.text(txnDateStr, cx, y + 3.5); cx += colW.txnDate;
    doc.text(entryDateStr, cx, y + 3.5); cx += colW.entryDate;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(5);
    const typeColor: [number, number, number] = e.transactionType === 'INCOME' ? [22, 101, 52] : e.transactionType === 'EXPENSE' ? [185, 28, 28] : [30, 64, 175];
    doc.setTextColor(...typeColor);
    doc.text(typeLabel, cx, y + 3.5); cx += colW.type;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.setTextColor(130, 124, 114);
    doc.text((e.category || '—').substring(0, 16), cx, y + 3.5); cx += colW.cat;
    const descText = isCancelled && e.cancelledByName ? `${(e.description || '—').substring(0, 36)} [by ${e.cancelledByName}]` : (e.description || '—');
    doc.text(descText.substring(0, 50), cx, y + 3.5); cx += colW.desc;
    doc.text((e.studentName || '—').substring(0, 20), cx, y + 3.5); cx += colW.student;
    doc.text((e.className || '—').substring(0, 14), cx, y + 3.5); cx += colW.class;

    if (debit) {
      doc.setTextColor(22, 101, 52); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
      doc.text(fmt(debit) + ' /-', cx + colW.debit - 2, y + 3.5, { align: 'right' });
    }
    cx += colW.debit;
    if (credit) {
      doc.setTextColor(185, 28, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
      doc.text(fmt(credit) + ' /-', cx + colW.credit - 2, y + 3.5, { align: 'right' });
    }
    cx += colW.credit;

    doc.setTextColor(26, 26, 46); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
    doc.text(fmt(e.runningBalance) + ' /-', cx + colW.balance - 2, y + 3.5, { align: 'right' });
    cx += colW.balance;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
    const statusColor: [number, number, number] = e.status === 'Active' ? [22, 101, 52] : e.status === 'Cancelled' ? [185, 28, 28] : [126, 34, 206];
    doc.setTextColor(...statusColor);
    doc.text(statusChar, cx + 2, y + 3.5);

    y += rowH;
  });

  if (y > 185) { doc.addPage(); y = 14; }
  const tDebit = totalDebit ?? entries.reduce((s: number, e: any) => s + (e.debit || 0), 0);
  const tCredit = totalCredit ?? entries.reduce((s: number, e: any) => s + (e.credit || 0), 0);
  doc.setFillColor(26, 26, 46);
  doc.rect(M, y, PW, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
  doc.text(`Total Dr: ${fmt(tDebit)}  /  Total Cr: ${fmt(tCredit)}  /  Closing: ${fmt(closingBalance)} /-`, M + 2, y + 5.5);

  doc.save(`${accLabel.replace(/\s+/g, '_')}_Ledger_${dateFrom || 'all'}_to_${dateTo || 'all'}.pdf`);
}

export function buildLedgerPrintHtml(entries: any[], account: string, dateFrom: string, dateTo: string, openingBalance: number, closingBalance: number, fmt: (n: number) => string, totalDebit?: number, totalCredit?: number) {
  const accLabel = LEDGER_LABELS[account] || account;
  const rangeStr = dateFrom || dateTo ? `${dateFrom || 'earliest'} — ${dateTo || 'latest'}` : 'All dates';

  const rows = entries.map((e: any) => {
    const txnDateStr = e.transactionDate ? new Date(e.transactionDate + 'T00:00:00').toLocaleDateString() : '—';
    const typeLabel = e.transactionType === 'INTERNAL_TRANSFER' ? 'Xfer' : e.transactionType;
    const debit = e.debit || 0;
    const credit = e.credit || 0;
    const rowClass = e.status === 'Cancelled' ? 'cancelled' : e.status === 'Reversal' ? 'reversal' : '';
    const statusChar = e.status === 'Active' ? 'OK' : e.status === 'Cancelled' ? 'X' : 'R';
    const typeClass = `type-${(e.transactionType || '').toLowerCase()}`;
    return `<tr class="${rowClass}">
      <td class="mono">${e.voucher || '—'}</td>
      <td>${txnDateStr}</td>
      <td>${e.entryDate || '—'}</td>
      <td><span class="${typeClass}">${typeLabel}</span></td>
      <td>${e.category || '—'}</td>
      <td>${e.status === 'Cancelled' && e.cancelledByName ? `${e.description || '—'} <span class="cancel-by">by ${e.cancelledByName}</span>` : (e.description || '—')}</td>
      <td>${e.studentName || '—'}</td>
      <td>${e.className || '—'}</td>
      <td class="debit">${debit ? fmt(debit) : ''}</td>
      <td class="credit">${credit ? fmt(credit) : ''}</td>
      <td class="balance">${fmt(e.runningBalance)}</td>
      <td class="status status-${(e.status || '').toLowerCase()}">${statusChar}</td>
    </tr>`;
  }).join('');

  const tDebit = totalDebit ?? entries.reduce((s: number, e: any) => s + (e.debit || 0), 0);
  const tCredit = totalCredit ?? entries.reduce((s: number, e: any) => s + (e.credit || 0), 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${accLabel} Ledger</title>
<style>
  body{font-family:system-ui,sans-serif;padding:20px;color:#1a1a2e;font-size:11px;margin:auto}
  h1{font-size:16px;margin:0 0 2px}h2{font-size:11px;margin:0 0 14px;color:#827c72;font-weight:normal}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{padding:6px 8px;border:1px solid #d7d2c8;background:#1a1a2e;color:#fff;font-size:8px;text-transform:uppercase;text-align:left;white-space:nowrap}
  td{padding:5px 8px;border:1px solid #d7d2c8}
  .mono{font-family:monospace;font-size:9px;font-weight:bold}
  .opening td{background:#f0f0f0;font-weight:bold;color:#666}
  .debit{color:#166634;font-weight:bold;text-align:right}.credit{color:#b91c1c;font-weight:bold;text-align:right}.balance{font-weight:bold;text-align:right;font-family:monospace}
  .type-income{color:#166634;font-weight:bold}.type-expense{color:#b91c1c;font-weight:bold}.type-internal_transfer,.type-xfer{color:#1e40af;font-weight:bold}
  .cancelled{background:#fef2f2;color:#b91c1c;text-decoration:line-through;opacity:0.7}
  .cancel-by{font-size:8px;color:#b91c1c;text-decoration:none;font-style:italic}
  .reversal{background:#f5f3ff;color:#7e22ce}
  .status{font-weight:bold;text-align:center;font-size:9px}
  .status-active{color:#166634}.status-cancelled{color:#b91c1c}.status-reversal{color:#7e22ce}
  .summary td{background:#1a1a2e;color:#fff;font-weight:bold;font-size:10px;padding:7px 8px}
  @media print{body{padding:10px}@page{size:landscape;margin:8mm}}
</style></head><body>
  <h1>AL RAWA English School</h1>
  <h2>${accLabel} Ledger — ${rangeStr}</h2>
  <table><thead><tr>
    <th>Voucher</th><th>Txn Date</th><th>Entry Date</th><th>Type</th><th>Category</th><th>Description</th><th>Student</th><th>Class</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th><th>St</th>
  </tr></thead><tbody>
    <tr class="opening"><td colspan="10">Opening Balance</td><td colspan="2" style="text-align:right">${fmt(openingBalance)}</td></tr>
    ${rows}
  </tbody><tfoot>
    <tr class="summary"><td colspan="8">Total Dr: ${fmt(tDebit)}  |  Total Cr: ${fmt(tCredit)}</td><td colspan="2" style="text-align:right">Closing: ${fmt(closingBalance)}</td><td colspan="2"></td></tr>
  </tfoot></table>
</body></html>`;
}
