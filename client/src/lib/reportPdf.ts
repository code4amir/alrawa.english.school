import { gradeFromMarks, gpaToGrade, calcYearSummary, calcTermRanks, calcYearRanks, calcAttendPct } from './grading';
import { TERM_NAMES } from './config';
import { SCHOOL_LOGO } from './logo';

const SUBJECT_KEY_MAP: Record<string, string> = {
  'General knowledge': 'General Knowledge',
  'Religion & Quran Learning': 'Religion and Quran Learning',
  'Quran Learning': 'Religion and Quran Learning',
};

let jsPDFClass: any = null;
async function getJsPDF() {
  if (!jsPDFClass) {
    const mod = await import('jspdf');
    jsPDFClass = mod.default;
  }
  return jsPDFClass;
}

export function _pdfGradeChip(doc: any, cx: number, cy: number, grade: string) {
  const map: Record<string, [number[], number[]]> = {
    'A+': [[209, 250, 229], [6, 95, 70]], 'A': [[220, 252, 231], [22, 101, 52]],
    'A-': [[209, 250, 229], [21, 128, 61]], 'B+': [[219, 234, 254], [30, 64, 175]],
    'B': [[239, 246, 255], [29, 78, 216]], 'B-': [[240, 249, 255], [3, 105, 161]],
    'C+': [[254, 249, 195], [133, 77, 14]], 'C': [[254, 252, 232], [161, 98, 7]],
    'D': [[255, 237, 213], [194, 65, 12]], 'F': [[254, 226, 226], [185, 28, 28]],
  };
  const [bg, fg] = (map[grade] || [[243, 244, 246], [107, 114, 128]]) as unknown as [number[], number[]];
  doc.setFillColor(...(bg as [number, number, number]));
  doc.roundedRect(cx - 9, cy - 3, 18, 6, 3, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.setTextColor(...(fg as [number, number, number]));
  doc.text(grade, cx, cy + 0.8, { align: 'center' });
  doc.setTextColor(26, 26, 46); doc.setFont('helvetica', 'normal');
}

export async function downloadReportCardPDF(student: any, clsName: string, subjects: any[], allResults: any[], term: string, sharedDoc?: any) {
  const JsPDF = await getJsPDF();
  const doc = sharedDoc || new JsPDF({ format: 'a4', unit: 'mm' });
  if (sharedDoc) doc.addPage();

  // Fetch photo on-demand
  let photoDataUri: string | null = null;
  if (student.hasPhoto) {
    try { const r = await fetch(student.photoUrl, { credentials: 'omit' }); const blob = await r.blob(); photoDataUri = await new Promise<string>(res => { const reader = new FileReader(); reader.onload = () => res(reader.result as string); reader.readAsDataURL(blob); }); } catch { console.warn('Photo fetch failed for', student.id); }
  }

  const W = 210, M = 15, CW = W - M * 2;
  // Brand palette (mirrors client/src/index.css tokens — same as online report card)
  const NAVY = [26, 26, 46] as const, RED = [200, 75, 49] as const, WHITE = [255, 255, 255] as const, MUTED = [140, 140, 140] as const, BORDER = [212, 207, 196] as const, PAPER = [245, 240, 232] as const, ROW2 = [249, 250, 251] as const, NAVY2 = [38, 38, 60] as const;
  const isFinal = term === 'final';
  const label = isFinal ? 'Annual Result' : TERM_NAMES[term];
  const clsStudents = (await import('../store')).useSchoolStore.getState().students.filter((s: any) => s.class === clsName);
  const ranks = isFinal ? calcYearRanks(clsStudents, subjects, allResults) : calcTermRanks(clsStudents, term, subjects, allResults);
  const rank = ranks[student.id] || '—';
  const res = allResults.find((r: any) => r.studentId === student.id && r.term === (isFinal ? '3' : term));

  let y = 14;

  // HEADER — centered like the online card: logo, serif name, red badge text, hairline
  try {
    doc.addImage(SCHOOL_LOGO, 'JPEG', W / 2 - 7, y, 14, 14);
  } catch { console.warn('Logo addImage failed'); }
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY);
  doc.text('AL RAWA English School', W / 2, y + 20, { align: 'center' });
  doc.setFont('times', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text('ESTD: 2022  ·  Read in the name of your Lord', W / 2, y + 25, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text(isFinal ? 'ANNUAL REPORT CARD' : `TERM REPORT CARD — ${label.toUpperCase()}`, W / 2, y + 31, { align: 'center' });
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
  doc.line(M, y + 35, W - M, y + 35);
  y += 41;

  // STUDENT INFO — photo left, rows right (mirrors online card)
  if (photoDataUri) { try { doc.addImage(photoDataUri, 'JPEG', M, y, 20, 24); } catch { console.warn('Photo addImage failed'); } }
  const infoX = M + (photoDataUri ? 26 : 0);
  doc.setFontSize(9.5);
  const infoRows: [string, string][] = [['Student Name', student.name], ['Class', clsName]];
  if (student.roll) infoRows.push(['Roll', String(student.roll)]);
  if (student.fatherName) infoRows.push(["Father's Name", student.fatherName]);
  if (student.motherName) infoRows.push(["Mother's Name", student.motherName]);
  infoRows.forEach(([k, v]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
    doc.text(k + ':', infoX, y + 3);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY);
    doc.text(String(v), infoX + 32, y + 3);
    y += 6;
  });
  y = Math.max(y + 4, y);

  // Divider
  doc.setDrawColor(215, 210, 200); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6;

  // SECTION TITLE
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
  doc.text(isFinal ? 'ANNUAL ACADEMIC RESULT' : `${label.toUpperCase()} — ACADEMIC RESULT`, M, y); y += 5;

  if (!isFinal) {
    // Term table: Subject | Full | Marks | Grade | GPA (mirrors online card)
    const C = { s: { x: M, w: 72 }, fl: { x: M + 72, w: 20 }, mo: { x: M + 92, w: 26 }, gr: { x: M + 118, w: 24 }, gp: { x: M + 142, w: 26 } };
    const TW = CW, HH = 8, RH = 8;

    doc.setFillColor(...NAVY); doc.rect(M, y, TW, HH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...WHITE);
    doc.text('Subject', C.s.x + 4, y + HH / 2 + 1);
    doc.text('Full', C.fl.x + C.fl.w / 2, y + HH / 2 + 1, { align: 'center' });
    doc.text('Marks', C.mo.x + C.mo.w / 2, y + HH / 2 + 1, { align: 'center' });
    doc.text('Grade', C.gr.x + C.gr.w / 2, y + HH / 2 + 1, { align: 'center' });
    doc.text('GPA', C.gp.x + C.gp.w / 2, y + HH / 2 + 1, { align: 'center' });
    y += HH;

    const tm = res?.marks || {};
    let totObt = 0, totFull = 0, hasF = false; const gpas: number[] = [];

    subjects.forEach((subj, ri) => {
      if (y > 248) { doc.addPage(); y = 14; }
      const canonical = SUBJECT_KEY_MAP[subj.name] || subj.name;
      const m = tm[subj.name] !== undefined ? tm[subj.name] : tm[canonical];
      const obt = (m !== undefined && m !== null) ? +m : null;
      const g = obt !== null ? gradeFromMarks(obt, subj.fullMarks) : null;
      if (g) { gpas.push(g.gpa); if (g.grade === 'F') hasF = true; totObt += obt!; totFull += subj.fullMarks; }

      // gray zebra on odd rows (bg-gray-50 like the online card); white on even
      if (ri % 2) { doc.setFillColor(...ROW2); doc.rect(M, y, TW, RH, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...NAVY);
      let nm = subj.name;
      while (doc.getTextWidth(nm) > C.s.w - 6 && nm.length > 2) nm = nm.slice(0, -1);
      doc.text(nm, C.s.x + 4, y + RH / 2 + 1);

      doc.text(String(subj.fullMarks), C.fl.x + C.fl.w / 2, y + RH / 2 + 1, { align: 'center' });
      if (obt !== null) doc.text(String(obt), C.mo.x + C.mo.w / 2, y + RH / 2 + 1, { align: 'center' });
      else { doc.setTextColor(...MUTED); doc.text('—', C.mo.x + C.mo.w / 2, y + RH / 2 + 1, { align: 'center' }); doc.setTextColor(...NAVY); }

      if (g) _pdfGradeChip(doc, C.gr.x + C.gr.w / 2, y + RH / 2 + 0.5, g.grade);
      if (g) doc.text(g.gpa.toFixed(2), C.gp.x + C.gp.w / 2, y + RH / 2 + 1, { align: 'center' });

      doc.setDrawColor(...BORDER); doc.setLineWidth(0.15); doc.line(M, y + RH, M + TW, y + RH); y += RH;
    });

    if (gpas.length) {
      doc.setFillColor(...NAVY); doc.rect(M, y, TW, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...WHITE);
      doc.text('TOTAL', C.s.x + 4, y + 4.5);
      doc.text(`${totObt} / ${totFull}`, C.mo.x + C.mo.w / 2, y + 4.5, { align: 'center' });
      y += 7;
    }
    y += 6;

    // Result chips — three cream boxes (mirrors online card's bg-school-paper chips)
    if (gpas.length) {
      if (y > 248) { doc.addPage(); y = 14; }
      const tGPA = gpas.reduce((a, b) => a + b, 0) / gpas.length;
      const tGr = hasF ? 'F' : gpaToGrade(tGPA);
      const BH = 18, GAPC = 5;
      const cw = (CW - GAPC * 2) / 3;
      const chips: [string, string][] = [[`${label.toUpperCase()} GPA`, tGPA.toFixed(2)], ['GRADE', tGr], ['CLASS RANK', String(rank)]];
      chips.forEach(([lbl, val], i) => {
        const x = M + i * (cw + GAPC);
        doc.setFillColor(...PAPER);
        doc.roundedRect(x, y, cw, BH, 3, 3, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
        doc.text(lbl, x + cw / 2, y + 6, { align: 'center' });
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY);
        doc.text(val, x + cw / 2, y + 14, { align: 'center' });
      });
      y += BH + 8;
    }
  } else {
    // Annual table: Subject | 1st | 2nd | Final | Average | Grade | GPA
    const C = { s: { x: M, w: 50 }, t1: { x: M + 50, w: 22 }, t2: { x: M + 72, w: 22 }, t3: { x: M + 94, w: 22 }, avg: { x: M + 116, w: 22 }, gr: { x: M + 138, w: 26 }, gp: { x: M + 164, w: 22 } };
    const TW = CW, H1 = 8, H2 = 7, RH = 8;

    // Header row 1
    doc.setFillColor(...NAVY);
    doc.rect(C.s.x, y, C.s.w, H1 + H2, 'F');
    doc.rect(C.t1.x, y, C.t1.w + C.t2.w + C.t3.w, H1, 'F');
    doc.setFillColor(...NAVY2);
    doc.rect(C.avg.x, y, C.avg.w + C.gr.w + C.gp.w, H1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...WHITE);
    doc.text('Subject', C.s.x + C.s.w / 2, y + H1 / 2 + 0.5, { align: 'center' });
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('(Full Marks)', C.s.x + C.s.w / 2, y + H1 / 2 + 4, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Term Marks', C.t1.x + (C.t1.w + C.t2.w + C.t3.w) / 2, y + H1 / 2 + 1, { align: 'center' });
    doc.text('Annual Result', C.avg.x + (C.avg.w + C.gr.w + C.gp.w) / 2, y + H1 / 2 + 1, { align: 'center' });
    y += H1;

    // Header row 2
    doc.setFillColor(...NAVY2);
    [C.t1, C.t2, C.t3, C.avg].forEach(col => doc.rect(col.x, y, col.w, H2, 'F'));
    doc.setFillColor(31, 31, 54);
    [C.gr, C.gp].forEach(col => doc.rect(col.x, y, col.w, H2, 'F'));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...WHITE);
    ([['1st Term', C.t1], ['2nd Term', C.t2], ['Final Exam', C.t3], ['Average', C.avg], ['Grade', C.gr], ['GPA', C.gp]] as const).forEach(([lbl, col]) => {
      doc.text(lbl, (col as any).x + (col as any).w / 2, y + H2 / 2 + 0.8, { align: 'center' });
    });
    y += H2;

    // Data rows
    subjects.forEach((subj, ri) => {
      if (y > 248) { doc.addPage(); y = 14; }
      const canonical = SUBJECT_KEY_MAP[subj.name] || subj.name;
      const getM = (t: string) => { 
        const r = allResults.find((x: any) => x.studentId === student.id && x.term === t); 
        const v = (r?.marks?.[subj.name] !== undefined && r?.marks?.[subj.name] !== null) ? r.marks[subj.name] : r?.marks?.[canonical];
        return (v !== undefined && v !== null) ? +v : null; 
      };
      const m1 = getM('1'), m2 = getM('2'), m3 = getM('3');
      const vals = [m1, m2, m3].filter(m => m !== null) as number[];
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const gAvg = avg !== null ? gradeFromMarks(avg, subj.fullMarks) : null;

      // gray zebra on odd rows (mirrors online card)
      if (ri % 2) { doc.setFillColor(...ROW2); doc.rect(M, y, TW, RH, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...NAVY);
      let nm = subj.name;
      while (doc.getTextWidth(nm) > C.s.w - 5 && nm.length > 2) nm = nm.slice(0, -1);
      doc.text(nm, C.s.x + 3, y + RH / 2 + 1);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...NAVY);
      ([[m1, C.t1], [m2, C.t2], [m3, C.t3]] as const).forEach(([m, col]) => {
        if (m !== null) doc.text(String(m), col.x + col.w / 2, y + 5.5, { align: 'center' });
        else { doc.setTextColor(...MUTED); doc.text('—', col.x + col.w / 2, y + 5.5, { align: 'center' }); doc.setTextColor(...NAVY); }
      });
      if (avg !== null) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY); doc.text(avg.toFixed(1), C.avg.x + C.avg.w / 2, y + 5.5, { align: 'center' }); }
      if (gAvg) _pdfGradeChip(doc, C.gr.x + C.gr.w / 2, y + RH / 2, gAvg.grade);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...NAVY);
      if (gAvg) doc.text(gAvg.gpa.toFixed(2), C.gp.x + C.gp.w / 2, y + 5.5, { align: 'center' });
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.15); doc.line(M, y + RH, M + TW, y + RH); y += RH;
    });
    y += 6;

    // Annual result chips — three cream boxes (mirrors online card)
    const { finalGPA } = calcYearSummary(student.id, subjects, allResults);
    const finalGrade = finalGPA !== null ? gpaToGrade(finalGPA) : '—';
    if (y > 248) { doc.addPage(); y = 14; }
    const BH = 18, GAPC = 5;
    const cw = (CW - GAPC * 2) / 3;
    const chips: [string, string][] = [['ANNUAL GPA', finalGPA !== null ? finalGPA.toFixed(2) : '—'], ['FINAL GRADE', finalGrade], ['YEAR RANK', String(rank)]];
    chips.forEach(([lbl, val], i) => {
      const x = M + i * (cw + GAPC);
      doc.setFillColor(...PAPER);
      doc.roundedRect(x, y, cw, BH, 3, 3, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text(lbl, x + cw / 2, y + 6, { align: 'center' });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY);
      doc.text(val, x + cw / 2, y + 14, { align: 'center' });
    });
    y += BH + 8;
  }

  // ATTENDANCE + COMMENT (side by side)
  const GAP = 8;
  const COLW = (CW - GAP) / 2;
  const attX = M, cmtX = M + COLW + GAP;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...NAVY);
  doc.text(isFinal ? 'ATTENDANCE SUMMARY' : `ATTENDANCE — ${label.toUpperCase()}`, attX, y + 4.5);
  doc.text("TEACHER'S COMMENT", cmtX, y + 4.5);
  y += 8;

  const attStartY = y;
  if (!isFinal) {
    const att = res?.attendance;
    [['Total School Days', att?.days || '—'], ['Days Present', att?.present || '—'], ['Attendance', calcAttendPct(att)]].forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(k, attX + 2, y + 4);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...NAVY); doc.text(String(v), attX + COLW - 2, y + 4, { align: 'right' });
      y += 6.5;
    });
  } else {
    const aC = [31, 22, 18, 18]; const AH = 6;
    let ax = attX;
    doc.setFillColor(26, 26, 46); aC.forEach(w => { doc.rect(ax, y, w, AH, 'F'); ax += w; });
    ax = attX;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
    ['Term', 'Total Days', 'Present', 'Att%'].forEach((h, i) => {
      doc.setTextColor(255, 255, 255);
      const tw = doc.getTextWidth(h); const tx = i === 0 ? ax + 2 : ax + (aC[i] - tw) / 2;
      doc.text(h, tx, y + AH / 2 + 0.8); ax += aC[i];
    });
    y += AH;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    ['1', '2', '3'].forEach((t, ri) => {
      const att = allResults.find((x: any) => x.studentId === student.id && x.term === t)?.attendance;
      const vals = [TERM_NAMES[t], att?.days || '—', att?.present || '—', calcAttendPct(att)];
      ax = attX;
      if (ri % 2) { doc.setFillColor(...ROW2); } else { doc.setFillColor(...WHITE); } aC.forEach(w => { doc.rect(ax, y, w, AH, 'F'); ax += w; });
      ax = attX;
      vals.forEach((v, i) => {
        doc.setTextColor(26, 26, 46);
        const tw = doc.getTextWidth(String(v)); const tx = i === 0 ? ax + 2 : ax + (aC[i] - tw) / 2;
        doc.text(String(v), tx, y + AH / 2 + 0.8); ax += aC[i];
      });
      doc.setDrawColor(215, 210, 200); doc.setLineWidth(0.15); doc.line(attX, y + AH, attX + aC.reduce((a, b) => a + b, 0), y + AH); y += AH;
    });
  }
  const attEndY = y;

  // Comment box (rounded, paper-tinted — mirrors online card)
  const boxH = Math.max(attEndY - attStartY, 20);
  const comment = res?.comment || '';
  doc.setFillColor(...PAPER); doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
  doc.roundedRect(cmtX, attStartY, COLW, boxH, 2, 2, 'FD');
  const cmtLines = doc.splitTextToSize(comment || 'No comment added.', COLW - 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.setTextColor(!comment ? MUTED[0] : NAVY[0], !comment ? MUTED[1] : NAVY[1], !comment ? MUTED[2] : NAVY[2]);
  doc.text(cmtLines, cmtX + 4, attStartY + 5);

  // SIGNATURES — anchored at fixed bottom, never overlapping content.
  // Content max is ~248 (table overflow guard) + chips/comment ≈ 278 worst-case;
  // sig block occupies 271–281 so even the tallest card (Class Five annual, 10
  // subjects) leaves ≥10mm clearance. If content somehow passes 268, shrink gap.
  const sigY = Math.max(Math.min(y + 12, 268), 252);
  const sigW = (CW - 20) / 3;
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.4);
  ['CLASS TEACHER', 'CO-ORDINATOR', 'PRINCIPAL'].forEach((lbl, i) => {
    const sx = M + i * (sigW + 10);
    doc.line(sx, sigY, sx + sigW, sigY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(lbl, sx + sigW / 2, sigY + 5, { align: 'center' });
  });

  if (!sharedDoc) doc.save(`${student.name.replace(/\s+/g, '_')}_${isFinal ? 'Annual' : label.replace(/ /g, '_')}_Report.pdf`);
}
