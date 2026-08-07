import { SCHOOL_LOGO } from './logo';

// Color palette — modern navy / gold
const NAVY = [26, 26, 46] as const;
const RED = [200, 75, 49] as const;
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
 * Draw a single admit card — 1 column layout, full page width.
 * Each card uses the full horizontal width with a small bottom border line.
 * Returns the next y position.
 */
function drawCard(
  doc: any,
  student: AdmitStudent,
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
  const h = 62; // card height (mm) — one card per page row, 4 rows
  const M = 5; // internal card margin
  const CW = w - M * 2; // content width
  let cy = y + M;

  // --- Card border (rounded, full width) ---
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');

  // --- Header: Logo + School Name ---
  const logoW = 10;
  try {
    doc.addImage(SCHOOL_LOGO, SCHOOL_LOGO.match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'PNG', x + M, cy, logoW, logoW);
  } catch { /* logo fail — skip */ }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(settings?.school_name || 'AL RAWA English School', x + M + logoW + 3, cy + 3.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...MUTED);
  if (settings?.address) {
    doc.text(settings.address, x + M + logoW + 3, cy + 6.5);
  } else {
    doc.text('ESTD: 2022', x + M + logoW + 3, cy + 6.5);
  }

  // --- ADMIT CARD badge (top right) ---
  const badgeTxt = 'ADMIT CARD';
  doc.setFillColor(...RED);
  doc.roundedRect(x + CW - M - 24, cy - 0.5, 24, 7, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(255, 255, 255);
  doc.text(badgeTxt, x + CW - M - 12, cy + 4.5, { align: 'center' });

  cy += 10;

  // --- Session / Exam label (full line, centered, larger) ---
  // Format: "2nd Term Examination - 2026"
  const sessionYear = session.replace(/^FY/, '');
  const examLabel = `${termLabel} Examination - ${sessionYear}${examType ? ' • ' + examType : ''}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(examLabel, x + M + CW / 2, cy, { align: 'center' });
  cy += 7;

  // --- Photo on left, info grid on right ---
  const photoW = 16;
  const photoH = 20;
  const infoX = x + M + (photoDataUri ? photoW + 6 : 0);
  const infoW = CW - (photoDataUri ? photoW + 10 : 4);
  const lineHeight = 3.8;

  // Photo
  if (photoDataUri) {
    try {
      const fmt = photoDataUri.match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'JPEG';
      doc.addImage(photoDataUri, fmt, x + M, cy, photoW, photoH);
      doc.setDrawColor(...MUTED);
      doc.setLineWidth(0.3);
      doc.rect(x + M, cy, photoW, photoH, 'S');
    } catch { /* skip */ }
  }

  // Info grid
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  const infoRows: [string, string][] = [
    ['Student Name', student.name],
    ['Class', student.className],
    ['Roll No.', student.roll || '—'],
    ["Father's Name", student.fatherName || '—'],
    ["Mother's Name", student.motherName || '—'],
  ];

  let iy = cy + 1;
  infoRows.forEach(([k, v]) => {
    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    doc.text(k, infoX, iy);
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(v, infoX + 30, iy);
    doc.setFont('helvetica', 'normal');
    iy += lineHeight;
  });

  cy += photoH + 5;

  // --- Result summary (if data exists) ---
  const res = student.result;
  if (res) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text('RESULT SUMMARY', x + M, cy);
    cy += 3.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    const att = res.attendance;
    let attPct = '—';
    if (att && att.days > 0) {
      attPct = `${Math.round((att.present / att.days) * 100)}%`;
    }

    const summaryCols: [string, string][] = [['Attendance', attPct]];
    if (res.marks && res.marks['total'] && !isNaN(Number(res.marks['total']))) {
      // Use precomputed totals if available
      const tm = res.marks['total'];
      const tf = res.marks['totalFull'];
      if (tm && tf) {
        const pct = Number(tm) / Number(tf) * 100;
        const grade = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : 'F';
        summaryCols.push(['Grade', grade]);
      } else if (res.marks['percentage']) {
        const pct = Number(res.marks['percentage']);
        const grade = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : 'F';
        summaryCols.push(['Grade', grade]);
      }
    }

    summaryCols.forEach(([lbl, v], i) => {
      const sw = (infoW - 4) / summaryCols.length;
      doc.setTextColor(...MUTED);
      doc.setFontSize(7);
      doc.text(lbl, x + M + 2 + i * sw, cy);
      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.text(String(v), x + M + 2 + i * sw + sw / 2, cy, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    });
    cy += 5;
  }

  // --- Co-ordinator signature (small line at bottom RIGHT) ---
  const sigY = y + h - 6;
  const sigW = 28; // small signature line
  // Dashed line
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(x + CW - M - sigW, sigY, x + CW - M, sigY);
  doc.setLineDashPattern([], 0);
  // Co-ordinator label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(...NAVY);
  doc.text('Co-ordinator', x + CW - M - sigW / 2, sigY + 3.5, { align: 'center' });

  // Certification note below signature
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.5);
  doc.setTextColor(...MUTED);
  const noteLines = doc.splitTextToSize(coordinatorSignatureNote, infoW - 4);
  noteLines.forEach((l: string, idx: number) => {
    doc.text(l, x + M + 2, sigY + 2 + (idx + 1) * 2.2);
  });

  return y + h;
}

/**
 * Generate a class-wide admit card PDF — 1 column × 4 rows per A4 page
 * (each card spans full page width).
 */
export async function downloadAdmitCardsPDF(payload: AdmitCardPayload) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ format: 'a4', unit: 'mm' });

  const W = 210; // A4 width
  const PAGE_M = 10; // page margin
  const ROWS = 4;
  const GAP = 6;
  const cardW = W - PAGE_M * 2; // full width
  const cardH = (297 - PAGE_M * 2 - GAP * (ROWS - 1)) / ROWS; // full height divided by rows

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

  let y = PAGE_M;
  let row = 0;

  payload.students.forEach((s) => {
    // Start new page if we've filled the current page
    if (row >= ROWS) {
      doc.addPage();
      y = PAGE_M;
      row = 0;
    }

    drawCard(
      doc, s, payload.session, payload.termLabel,
      payload.examType, payload.settings, payload.coordinatorSignatureNote,
      PAGE_M, y, cardW, photoCache[s.id] || null,
    );

    row++;
    y += cardH + GAP;
  });

  // Trim the last page if it's empty
  if (row === 0 && payload.students.length > 0) {
    doc.deletePage(); // remove the extra blank page if added
  }

  const safeName = (payload.className || 'Class').replace(/\s+/g, '_');
  doc.save(`${safeName}_AdmitCards_${payload.termLabel.replace(/\s+/g, '_')}.pdf`);
}
