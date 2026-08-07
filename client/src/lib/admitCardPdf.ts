import { SCHOOL_LOGO } from './logo';

// Color palette — mirrors reportPdf.ts
const NAVY = [26, 26, 46] as const;
const RED = [200, 75, 49] as const;
const GOLD = [209, 250, 229] as const;
const MUTED = [130, 124, 114] as const;

let jsPDFClass: any = null;
async function getJsPDF() {
  if (!jsPDFClass) {
    const mod = await import('jspdf');
    jsPDFClass = mod.default;
  }
  return jsPDFClass;
}

/**
 * Fetch a student photo as a data-URI (best-effort). Returns null on failure.
 */
async function fetchPhotoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>(res => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

interface AdmitStudent {
  id: string;
  studentId: string;
  name: string;
  roll: string;
  session: string;
  fatherName: string;
  motherName: string;
  contact: string;
  className: string;
  photoUrl?: string | null;
  hasPhoto?: boolean;
  result?: { marks?: Record<string, number>; attendance?: { days: number; present: number }; comment?: string } | null;
}

export interface AdmitCardPayload {
  className: string;
  session: string;
  term: string;
  termLabel: string;
  examType: string;
  subjects: { id: string; name: string; fullMarks: number }[];
  students: AdmitStudent[];
  settings: { school_name?: string; address?: string; phone?: string; email?: string; website?: string } | undefined;
  coordinatorSignatureNote: string;
}

/**
 * Draw a single admit card inside the given jsPDF doc at (x, y) with width w.
 * Returns the next y cursor position.
 */
function drawCard(
  doc: any,
  student: AdmitStudent,
  subjects: AdmitCardPayload['subjects'],
  session: string,
  termLabel: string,
  examType: string,
  settings: AdmitCardPayload['settings'],
  coordinatorSignatureNote: string,
  x: number,
  y: number,
  w: number,
  photoDataUri: string | null,
): number {
  const h = 78; // card height (mm) — fits 4 per A4 with margins
  const M = 4; // internal card margin
  const CW = w - M * 2; // content width
  let cy = y + M;

  // --- Card background border ---
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, w, h, 1, 1, 'S');

  // --- Header (logo + school name) ---
  const logoW = 10;
  try {
    doc.addImage(SCHOOL_LOGO, SCHOOL_LOGO.match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'PNG', x + M, cy, logoW, logoW);
  } catch { /* logo fail — skip */ }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text(settings?.school_name || 'AL RAWA English School', x + M + logoW + 3, cy + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.setTextColor(...MUTED);
  doc.text('ESTD: 2022', x + M + logoW + 3, cy + 6.5);

  // ADMIT CARD badge
  const badgeTxt = 'ADMIT CARD';
  doc.setFillColor(...RED);
  doc.roundedRect(x + CW - M - 22, cy - 0.5, 22, 6, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(255, 255, 255);
  doc.text(badgeTxt, x + CW - M - 11, cy + 3.5, { align: 'center' });

  cy += 9;

  // --- Term / Session sub-badge ---
  const sessionTxt = `FY${session}`;
  const termTxt = termLabel;
  const subBadge = `${sessionTxt}  ·  ${termTxt}${examType ? '  ·  ' + examType : ''}`;
  const bw = doc.getTextWidth(subBadge) + 6;
  doc.setFillColor(...GOLD);
  doc.roundedRect(x + M, cy, bw, 4.5, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(...NAVY);
  doc.text(subBadge, x + M + 3, cy + 3.1);
  cy += 7;

  // --- Photo + Info grid ---
  const photoW = 12;
  let photoH = photoW * 1.2; // portrait aspect
  const infoX = x + M + (photoDataUri ? photoW + 4 : 0);
  const infoW = CW - (photoDataUri ? photoW + 8 : 4);
  const lineHeight = 3.2;

  // Photo (left)
  if (photoDataUri) {
    try {
      const fmt = photoDataUri.match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'JPEG';
      doc.addImage(photoDataUri, fmt, x + M, cy, photoW, photoH);
      doc.setDrawColor(...MUTED);
      doc.setLineWidth(0.2);
      doc.rect(x + M, cy, photoW, photoH, 'S');
    } catch { /* skip */ }
  }

  // Info grid (right of photo)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(...NAVY);
  const infoRows: [string, string][] = [
    ['Student Name', student.name],
    ['Student ID', student.studentId || student.id.slice(0, 8).toUpperCase()],
    ['Class', student.className],
    ['Roll No.', student.roll || '—'],
    ["Father's Name", student.fatherName || '—'],
    ["Mother's Name", student.motherName || '—'],
    ['Session', sessionTxt],
  ];

  let iy = cy + 0.5;
  infoRows.forEach(([k, v]) => {
    if (iy > cy + photoH - 1) return; // clip to photo height
    doc.setTextColor(...MUTED);
    doc.text(k, infoX, iy);
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.text(v, infoX + 14, iy);
    doc.setFont('helvetica', 'normal');
    iy += lineHeight;
  });

  cy += photoH + 3;

  // --- Subjects table ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(...NAVY);
  doc.text('SUBJECTS', x + M, cy);
  cy += 3;

  const colW = infoW - 4;
  const subjW = colW * 0.65;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(...NAVY);
  doc.rect(x + M, cy, colW, 3, 'F');
  doc.text('Subject', x + M + 1, cy + 2);
  doc.text('Full Marks', x + M + subjW + 1, cy + 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.2);
  doc.setTextColor(...NAVY);
  cy += 3;

  const displaySubjects = subjects.length ? subjects : [{ name: '—', fullMarks: 0 }];
  const rowsToShow = displaySubjects.slice(0, 8); // fit vertically
  rowsToShow.forEach((s, i) => {
    const rowY = cy + i * 2.8;
    if (rowY > y + h - 20) return;
    doc.setDrawColor(...MUTED);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(x + M, rowY + 0.5, x + M + colW, rowY + 0.5);
    doc.setLineDashPattern([], 0);

    let nm = s.name;
    while (doc.getTextWidth(nm) > subjW - 2 && nm.length > 2) nm = nm.slice(0, -1);
    doc.text(nm, x + M + 1, rowY + 2);
    doc.text(String(s.fullMarks), x + M + subjW + 2, rowY + 2);
  });

  const subjectsRows = rowsToShow.length;
  cy += subjectsRows * 2.8 + 1;

  // --- Result summary ---
  const res = student.result;
  if (res) {
    doc.setFillColor(...NAVY);
    doc.roundedRect(x + M, cy, colW, 4.5, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.5);
    doc.setTextColor(255, 255, 255);
    doc.text('RESULT SUMMARY', x + M + 1.5, cy + 1.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.2);
    const att = res.attendance;
    let attPct = '—';
    if (att && att.days > 0) {
      attPct = ((att.present / att.days) * 100).toFixed(1) + '%';
    }
    const summaryCols = [
      ['Attend%', attPct],
    ];
    if (res.marks) {
      // compute GPA
      let tot = 0, full = 0;
      displaySubjects.forEach(sub => {
        const m = res.marks?.[sub.name];
        if (m !== undefined && m !== null && !isNaN(+m)) {
          tot += +m;
          full += sub.fullMarks;
        }
      });
      if (full > 0) {
        const pct = (tot / full) * 100;
        const gradeLabel = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : 'F';
        const gpa = Math.min(5, (pct / 100) * 5).toFixed(2);
        summaryCols.push(['GPA', gpa], ['Grade', gradeLabel]);
      }
    }
    summaryCols.forEach(([lbl, v], i) => {
      const sw = colW / summaryCols.length;
      doc.setTextColor(...MUTED);
      doc.text(lbl, x + M + 1.5 + i * sw, cy + 3.8);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(String(v), x + M + 1.5 + i * sw, cy + 6.2);
      doc.setFont('helvetica', 'normal');
    });
    cy += 5.5;
  }

  // --- Signature line at bottom of card ---
  const sigY = y + h - 8;
  const sigW = colW * 0.8;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(x + M + (colW - sigW) / 2, sigY, x + M + (colW + sigW) / 2, sigY);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(...NAVY);
  doc.text('Co-ordinator', x + M + colW / 2, sigY + 3, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.5);
  doc.setTextColor(...MUTED);
  const noteLines = doc.splitTextToSize(coordinatorSignatureNote, colW - 4);
  noteLines.forEach((l: string, i: number) => {
    if (i === 0) return; // skip "Authorized Signatory" — already handled
    doc.text(l, x + M + 2, sigY + 7 + i * 2.2);
  });

  return y + h;
}

/**
 * Generate a class-wide admit card PDF — 4 cards per A4 page.
 */
export async function downloadAdmitCardsPDF(payload: AdmitCardPayload) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ format: 'a4', unit: 'mm' });

  const W = 210;
  const PAGE_M = 10;
  const COLS = 2;
  const ROWS = 2;
  const GAP = 4;
  const cardW = (W - PAGE_M * 2 - GAP) / COLS;

  // Pre-fetch all photos
  const photoCache: Record<string, string> = {};
  await Promise.all(
    payload.students
      .filter((s) => s.photoUrl || s.hasPhoto)
      .map(async (s) => {
        const url = s.photoUrl && s.photoUrl.startsWith('http')
          ? s.photoUrl
          : s.photoUrl
            ? `${window.location.origin}${s.photoUrl}`
            : null;
        if (url) {
          const data = await fetchPhotoDataUri(url);
          if (data) photoCache[s.id] = data;
        }
      }),
  );

  let x = PAGE_M;
  let y = PAGE_M;
  let col = 0;
  let row = 0;

  payload.students.forEach((s, i) => {
    if (row === ROWS) {
      // finished current page
      if (i < payload.students.length - 1) {
        doc.addPage();
        x = PAGE_M;
        y = PAGE_M;
        col = 0;
        row = 0;
      }
    }

    drawCard(
      doc, s, payload.subjects, payload.session, payload.termLabel,
      payload.examType, payload.settings, payload.coordinatorSignatureNote,
      x, y, cardW, photoCache[s.id] || null,
    );

    col++;
    if (col >= COLS) {
      col = 0;
      row++;
      x = PAGE_M;
      y = y + cardW * 0.866 + GAP; // cardW * 78/91 (aspect)
    } else {
      x = PAGE_M + col * (cardW + GAP);
    }

    if (row >= ROWS) {
      doc.addPage();
      x = PAGE_M;
      y = PAGE_M;
      col = 0;
      row = 0;
    }
  });

  const safeName = (payload.className || 'Class').replace(/\s+/g, '_');
  doc.save(`${safeName}_AdmitCards_${payload.termLabel.replace(/\s+/g, '_')}.pdf`);
}
// trigger CI redeploy
