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

export function pdfPaymentReceipt(p: ParentPayment, student: ReceiptStudent) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  let y = 10;
  addLogo(doc, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26, 26, 46);
  doc.text('AL RAWA English School', 34, y + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130, 124, 114);
  doc.text('ESTD: 2022  ·  Read in the name of your Lord', 34, y + 13);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 26, 46);
  doc.text('PAYMENT RECEIPT', 12, y + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 124, 114);
  doc.text(`Receipt No: ${p.reference}`, 12, y + 31);
  y += 40;

  // Bordered card
  doc.setDrawColor(140, 132, 122); doc.setLineWidth(0.3);
  doc.rect(12, y, 186, 44);
  doc.setFillColor(255, 253, 247); doc.rect(12, y, 186, 44, 'F');

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
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
    ry += 7;
  });

  // Amount
  y += 52;
  doc.setFillColor(26, 26, 46); doc.rect(12, y, 186, 14, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  doc.text('AMOUNT TENDERED', 16, y + 9);
  doc.text(`${fmt(Number(p.amount))} /-`, 186, y + 9, { align: 'right' });

  y += 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(26, 26, 46);
  doc.text('CATEGORY', 12, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(String(p.category || '—'), 12, y);

  y += 12;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 124, 114);
  doc.text('This is a computer-generated receipt.', 12, y + 4);

  doc.save(`receipt-${p.reference}.pdf`);
}
