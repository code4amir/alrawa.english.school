import jsPDF from 'jspdf';
import { getMonthNameShort, fmt } from './reportFormat';

function shortName(s: string) { const p = s.trim().split(/\s+/); return p.length > 2 ? p.slice(0, 2).join(' ') : s; }

export function defaulterPDF(params: {
  displayData: any[];
  monthRange: string[];
  classLabel: string;
  subtitle: string;
  totalDueAll: number;
  totalPaidAll: number;
  filterClass: string;
  monthFrom: string;
  monthTo: string;
  yearlyFeeNames: string[];
  monthlyFeeNames: string[];
}) {
  const { displayData, monthRange, classLabel, subtitle, totalDueAll, totalPaidAll, filterClass, monthFrom, monthTo, yearlyFeeNames, monthlyFeeNames } = params;
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
  const M = 10, PW = 277;
  let y = 12;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(26, 26, 46);
  doc.text('AL RAWA English School', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130, 124, 114);
  doc.text('ESTD: 2022  ·  Read in the name of your Lord', M, y + 5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 46);
  doc.text('FEE DEFAULTER REPORT', M, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130, 124, 114);
  doc.text(`${classLabel}  |  ${subtitle}  |  ${displayData.length} students`, M, y + 19);
  doc.text(`Total Due: ${fmt(totalDueAll)} /-   |   Total Paid: ${fmt(totalPaidAll)} /-`, M, y + 24);
  y += 32;

  const nameW = 40, yearlyW = 20, dueW = 20, paidW = 20, balW = 20;
  const hasMonthly = monthlyFeeNames.length > 0 && monthRange.length > 0;

  let monthSubW = 0;
  if (hasMonthly) {
    const remaining = PW - nameW - yearlyFeeNames.length * yearlyW - dueW - paidW - balW;
    monthSubW = Math.max(14, Math.floor(remaining / (monthRange.length * monthlyFeeNames.length)));
  }

  const colWidths: number[] = [nameW];
  yearlyFeeNames.forEach(() => colWidths.push(yearlyW));
  if (hasMonthly) monthRange.forEach(() => monthlyFeeNames.forEach(() => colWidths.push(monthSubW)));
  colWidths.push(dueW, paidW, balW);
  const totalW = colWidths.reduce((s, c) => s + c, 0);
  const rowH = 6;
  const headerH = hasMonthly ? 10 : 7;
  const headSp = hasMonthly ? 5 : 3.5;

  function drawHdrCell(cx: number, w: number, label: string, fontSize: number, yOff: number, align: 'center' | 'left' | 'right' | 'justify') {
    doc.setFontSize(fontSize);
    doc.text(label, cx + (align === 'right' ? w - 1 : align === 'center' ? w / 2 : 1), y + yOff, { align });
  }

  function drawHeader() {
    doc.setFillColor(26, 26, 46);
    doc.rect(M, y, totalW, headerH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    let cx = M;

    drawHdrCell(cx, nameW, 'Student', 6, headSp, 'left'); cx += nameW;
    yearlyFeeNames.forEach(n => { drawHdrCell(cx, yearlyW, shortName(n), 5.5, headSp, 'center'); cx += yearlyW; });
    if (hasMonthly) {
      const ms = monthlyFeeNames.length * monthSubW;
      monthRange.forEach(m => {
        const [yr, mn] = m.split('-');
        drawHdrCell(cx, ms, `${getMonthNameShort(Number(mn) - 1)} '${yr.slice(2)}`, 5.5, 3.5, 'center');
        cx += ms;
      });
    }
    drawHdrCell(cx, dueW, 'Due', 6, headSp, 'center'); cx += dueW;
    drawHdrCell(cx, paidW, 'Paid', 6, headSp, 'center'); cx += paidW;
    drawHdrCell(cx, balW, 'Balance', 6, headSp, 'center'); cx += balW;

    if (hasMonthly) {
      doc.setFontSize(5);
      cx = M + nameW + yearlyFeeNames.length * yearlyW;
      monthRange.forEach(() => {
        monthlyFeeNames.forEach(n => { drawHdrCell(cx, monthSubW, shortName(n).substring(0, 8), 5, 8, 'center'); cx += monthSubW; });
      });
    }
    y += headerH;
  }

  drawHeader();

  const lightBg: [number, number, number] = [248, 247, 244];

  displayData.forEach((row: any, ri: number) => {
    if (y + rowH > 195) { doc.addPage(); y = 12; drawHeader(); }

    // Row background
    doc.setFillColor(...(ri % 2 === 0 ? lightBg : [255, 255, 255] as [number, number, number]));
    doc.rect(M, y, totalW, rowH, 'F');

    let cx = M;

    // Student + Class
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(26, 26, 46);
    doc.text(row.name.substring(0, 20), cx + 1, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 124, 114);
    doc.text(row.class, cx + 1, y + 5.5);
    cx += nameW;

    // Yearly fees
    yearlyFeeNames.forEach(name => {
      const fee = row.fees.find((f: any) => f.name === name) || null;
      if (fee) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
        doc.setTextColor(fee.paid ? 22 : 185, fee.paid ? 101 : 28, fee.paid ? 52 : 28);
        doc.text(fmt(fee.amount) + '/- ' + (fee.paid ? '\u2713' : '\u2717'), cx + yearlyW / 2, y + 3.5, { align: 'center' });
      }
      cx += yearlyW;
    });

    // Monthly sub-cells
    if (hasMonthly) {
      monthRange.forEach(m => {
        monthlyFeeNames.forEach(name => {
          const fee = row.fees.find((f: any) => f.name === name && (f.type === 'recurring' || f.type === 'special'));
          const md = fee?.months ? fee.months.find((x: any) => x.month === m) : null;
          if (md) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
            doc.setTextColor(md.paid ? 22 : 185, md.paid ? 101 : 28, md.paid ? 52 : 28);
            doc.text(fmt(md.amount) + '/- ' + (md.paid ? '\u2713' : '\u2717'), cx + monthSubW / 2, y + 3.5, { align: 'center' });
          } else {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
            doc.setTextColor(185, 28, 28);
            doc.text('\u2717', cx + monthSubW / 2, y + 3.5, { align: 'center' });
          }
          cx += monthSubW;
        });
      });
    }

    // Due, Paid, Balance
    const vals = [row.totalDue, row.totalPaid, row.balance];
    const widths = [dueW, paidW, balW];
    const colors = [[26, 26, 46], [22, 101, 52], row.balance > 0 ? [185, 28, 28] : [22, 101, 52]];
    for (let i = 0; i < 3; i++) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
      doc.setTextColor(colors[i][0], colors[i][1], colors[i][2]);
      doc.text(fmt(Math.abs(vals[i])) + ' /-', cx + widths[i] - 1, y + 3.5, { align: 'right' });
      cx += widths[i];
    }

    // Grid lines
    doc.setDrawColor(215, 210, 200);
    doc.setLineWidth(0.2);
    cx = M;
    colWidths.forEach(w => { doc.line(cx, y, cx, y + rowH); cx += w; });
    doc.line(M, y, M + totalW, y);

    y += rowH;
  });

  // Bottom line
  doc.setDrawColor(215, 210, 200); doc.setLineWidth(0.2);
  doc.line(M, y, M + totalW, y);

  // Grand total
  y += 1;
  doc.setFillColor(26, 26, 46);
  doc.rect(M, y, totalW, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
  doc.text('GRAND TOTAL', M + 2, y + 4.5);

  let cx = M + nameW;
  yearlyFeeNames.forEach(() => cx += yearlyW);
  if (hasMonthly) cx += monthRange.length * monthlyFeeNames.length * monthSubW;
  doc.text(fmt(totalDueAll) + ' /-', cx + dueW - 1, y + 4.5, { align: 'right' });
  doc.text(fmt(totalPaidAll) + ' /-', cx + dueW + paidW - 1, y + 4.5, { align: 'right' });
  const gBal = totalDueAll - totalPaidAll;
  doc.text(fmt(Math.abs(gBal)) + ' /-', cx + dueW + paidW + balW - 1, y + 4.5, { align: 'right' });

  doc.save(`Defaulter_Report_${filterClass || 'All'}_${monthFrom}_to_${monthTo}.pdf`);
}
