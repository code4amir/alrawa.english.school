import jsPDF from 'jspdf';
import { addLogo, fmt } from './financeReportPdf';

export interface ParentPayment {
  reference: string;
  amount: string;
  category: string;
  method: string;
  date: string;
  isCancelled: boolean;
}

interface ReceiptStudent {
  name: string;
  className: string;
  studentId?: string;
}

/* Render a single receipt copy at vertical position y0, stamped with the given
 * copy label (OFFICE COPY / PARENT AND STUDENT COPY). Returns the height used
 * so the caller can stack two copies plus a perforation line on one A4 page. */
function drawReceiptCopy(
  doc: jsPDF,
  p: ParentPayment,
  student: ReceiptStudent,
  y0: number,
  copyLabel: string,
): number {
  let y = y0;

  // Copy marker bar — redundant stamp so it reads after cutting.
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  doc.text(copyLabel, 14, y + 5.4);

  y += 10;
  addLogo(doc, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(26, 26, 46);
  doc.text('AL RAWA English School', 34, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130, 124, 114);
  doc.text('ESTD 2022  ·  Read in the name of your Lord', 34, y + 11.5);
  y += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 100, 60);
  doc.text(`PAYMENT RECEIPT — ${copyLabel}`, 12, y + 3);
  y += 7;

  // Bordered card
  const cardH = 42;
  doc.setDrawColor(140, 132, 122); doc.setLineWidth(0.3);
  doc.rect(12, y, 186, cardH);
  doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, cardH, 'F');

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(26, 26, 46);
  const rows: [string, string][] = [
    ['Student', student.name],
    ['Class', student.className],
    ['Receipt No', p.reference],
    ['Date', p.date],
    ['Payment Method', p.method],
    ['Status', p.isCancelled ? 'CANCELLED' : 'PAID'],
  ];
  let ry = y + 8;
  rows.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(k, 16, ry);
    doc.setFont('helvetica', 'normal'); doc.text(String(v), 62, ry);
    ry += 6;
  });

  // Amount bar
  y += cardH + 2;
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 11, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
  doc.text('AMOUNT TENDERED', 14, y + 7.5);
  doc.text(`${fmt(Number(p.amount))} /-`, 186, y + 7.5, { align: 'right' });

  // Category
  y += 14;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(26, 26, 46);
  doc.text('CATEGORY', 12, y); y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(String(p.category || '—'), 12, y);

  // Signature line
  y += 9;
  doc.setDrawColor(160, 152, 142); doc.setLineWidth(0.2);
  doc.line(110, y, 196, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(130, 124, 114);
  doc.text('Authorized Signature', 110, y + 3.5);

  y += 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(160, 152, 142);
  doc.text('This is a computer-generated receipt, valid without signature.', 12, y + 3);

  return (y + 4) - y0;
}

export function pdfPaymentReceipt(p: ParentPayment, student: ReceiptStudent) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });

  const startY = 8;
  const copy1 = drawReceiptCopy(doc, p, student, startY, 'OFFICE COPY');
  const dividerY = startY + copy1 + 6;

  // Perforation line (dashed) + cut label
  doc.setDrawColor(120, 110, 100); doc.setLineWidth(0.2);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(12, dividerY, 186, dividerY);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(150, 140, 130);
  doc.text('CUT HERE', 100, dividerY - 1.5, { align: 'center' });

  drawReceiptCopy(doc, p, student, dividerY + 6, 'PARENT AND STUDENT COPY');

  doc.save(`receipt-${p.reference}.pdf`);
}