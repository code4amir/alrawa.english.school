// Generate REAL Class Five (worst case, 10 subjects) PDFs for visual inspection.
// No monkey-patching: pass our own doc as sharedDoc, then dump bytes ourselves.
import { beforeAll, test, expect } from 'vitest';
import { downloadReportCardPDF } from '../src/lib/reportPdf';
import { useSchoolStore } from '../src/store';
import { writeFileSync } from 'fs';
import path from 'path';

const OUT = 'C:/Users/Owner/AppData/Local/Temp';

const NAMES = ['MD. JAWADUR RAHMAN', 'Ayesha Siddika', 'Tanvir Hasan', 'Fatima Begum', 'Rafid Mahmud', 'Nusrat Jahan', 'Shakib Al Hasan', 'Maliha Rahman', 'Zayan Chowdhury', 'Sumaiya Akter', 'Arif Hossain', 'Laiba Noor', 'Ibrahim Khalil', 'Zara Ahmed'];
// Class Five REAL subjects (verified from live API 2026-09-02)
const SUBJECTS = [
  { id: 's1', classId: 'c5', name: 'Bangla', fullMarks: 100 },
  { id: 's2', classId: 'c5', name: 'English', fullMarks: 100 },
  { id: 's3', classId: 'c5', name: 'Mathematics', fullMarks: 100 },
  { id: 's4', classId: 'c5', name: 'Science', fullMarks: 100 },
  { id: 's5', classId: 'c5', name: 'BGS', fullMarks: 100 },
  { id: 's6', classId: 'c5', name: 'Religion and Quran Learning', fullMarks: 100 },
  { id: 's7', classId: 'c5', name: 'ICT', fullMarks: 50 },
  { id: 's8', classId: 'c5', name: 'Drawing', fullMarks: 50 },
  { id: 's9', classId: 'c5', name: 'General Knowledge', fullMarks: 20 },
  { id: 's10', classId: 'c5', name: 'Spoken', fullMarks: 20 },
];
const students = NAMES.map((name, i) => ({ id: 'u' + (i + 1), name, roll: String(i + 1), class: 'Class Five', fatherName: 'Mohammad ' + name.split(' ').slice(1).join(' '), motherName: 'Mrs. ' + name.split(' ')[0], hasPhoto: false, photoUrl: null }));

function marksFor(i: number, t: number) {
  const base = [92, 84, 76, 68, 61, 55, 48, 41, 30, 18][i % 10];
  const jitter = [4, -3, 6, -5, 3, -2, 5, -4, 2, -1][(i + t) % 10];
  const out: Record<string, number> = {};
  SUBJECTS.forEach((s, si) => {
    const raw = Math.round(base + jitter + si * 1.5 + t * 2);
    out[s.name] = Math.max(0, Math.min(s.fullMarks, Math.round(raw * s.fullMarks / 100)));
  });
  return out;
}
const allResults = students.flatMap((s, i) => [1, 2, 3].map((t) => ({
  id: 'r' + s.id + '-' + t, studentId: s.id, term: String(t), marks: marksFor(i, t),
  attendance: { days: 87, present: 80 - i },
  comment: i === 0 ? 'Jawadur has shown excellent improvement this term. Consistent with homework and very attentive in class. Keep it up!' : '',
})));

let JsPDF: any = null;
beforeAll(async () => {
  useSchoolStore.setState({ students });
  const mod: any = await import('jspdf');
  JsPDF = mod.jsPDF || mod.default;
});

async function gen(term: string, file: string) {
  const doc = new JsPDF({ format: 'a4', unit: 'mm' });
  await downloadReportCardPDF(students[0], 'Class Five', SUBJECTS, allResults, term, doc);
  // sharedDoc adds a leading blank page — drop it
  if (doc.getNumberOfPages() > 1) doc.deletePage(1);
  const pages = doc.getNumberOfPages();
  const buf = Buffer.from(doc.output('arraybuffer'));
  const p = path.join(OUT, file);
  writeFileSync(p, buf);
  console.log(`${file}: ${pages} page(s), ${buf.length} bytes`);
  return { pages, bytes: buf.length, p };
}

test('Class Five term card fits one page', async () => {
  const r = await gen('1', 'marksheet_c5_term.pdf');
  expect(r.pages).toBe(1);
  expect(r.bytes).toBeGreaterThan(10000);
}, 60000);

test('Class Five annual card (10 subjects, worst case) fits one page', async () => {
  const r = await gen('final', 'marksheet_c5_annual.pdf');
  expect(r.pages).toBe(1);
  expect(r.bytes).toBeGreaterThan(10000);
}, 60000);
