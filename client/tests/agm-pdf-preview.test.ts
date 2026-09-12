// AGM revamp proof: run the production pdfYearlyAGM() with realistic FY data
// (monthly series + prev year + dues, charts nulled — tables must still lay
// out) and assert it produces a multi-section PDF without throwing.
import { test, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { pdfYearlyAGM } from '../src/lib/financeReportPdf';
import { writeFileSync } from 'fs';
import path from 'path';

const OUT = (process.env.LOCALAPPDATA || 'C:/Users/Owner/AppData/Local') + '/Temp';

const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

test('revamped AGM PDF renders all sections', async () => {
  const saved: { bytes: number; pages: number; file: string }[] = [];
  const origSave = (jsPDF as any).API.save;
  (jsPDF as any).API.save = function (file: string) {
    const buf = Buffer.from(this.output('arraybuffer'));
    const p = path.join(OUT, file);
    writeFileSync(p, buf);
    saved.push({ bytes: buf.length, pages: this.getNumberOfPages(), file: p });
  };
  try {
    await pdfYearlyAGM({
      yearFilter: '2026',
      income: [['Tuition Fees', 1200000], ['Admission Fees', 150000], ['Other Income', 45000]],
      expense: [['Salaries', 800000], ['Rent', 240000], ['Utilities', 60000], ['Supplies', 55000]],
      totalIncome: 1395000,
      totalExpense: 1155000,
      netSurplus: 240000,
      opening: { AL_RAWA_BANK: 200000, GLOBAL_FORUM_BANK: 50000, CASH_IN_HAND: 10000 },
      closing: { AL_RAWA_BANK: 420000, GLOBAL_FORUM_BANK: 60000, CASH_IN_HAND: 20000 },
      totalAssets: 500000,
      totalTransfers: 300000,
      transactionCount: 412,
      transferCount: 18,
      monthlyIncome: MONTHS.map((label, i) => ({ label, total: 100000 + i * 3000 })),
      monthlyExpense: MONTHS.map((label, i) => ({ label, total: 85000 + (i % 3) * 8000 })),
      barPng: null,
      piePng: null,
      prev: { totalIncome: 1250000, totalExpense: 1100000, netSurplus: 150000 },
      duesOutstanding: 87500,
    });
  } finally {
    (jsPDF as any).API.save = origSave;
  }
  expect(saved.length).toBe(1);
  console.log(`agm_revamped.pdf: ${saved[0].pages} page(s), ${saved[0].bytes} bytes`);
  expect(saved[0].pages).toBeGreaterThanOrEqual(3);
  expect(saved[0].bytes).toBeGreaterThan(15000);
}, 60000);
