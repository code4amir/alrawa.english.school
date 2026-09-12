// AGM chart + aggregation helpers (no dependencies: pure SVG strings).
// The same SVG renders inline on screen and is rasterized to PNG for jsPDF.

export const FY_MONTH_ORDER = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

export const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Collapse reports/monthly rows ({month: 1-12, category, total}) into FY-ordered monthly totals. */
export function aggregateMonthly(rows: any[]): { month: number; label: string; total: number }[] {
  const byMonth: Record<number, number> = {};
  (rows || []).forEach(r => {
    const m = Number(r.month);
    if (m >= 1 && m <= 12) byMonth[m] = (byMonth[m] || 0) + Number(r.total || 0);
  });
  return FY_MONTH_ORDER.map(m => ({ month: m, label: MONTH_SHORT[m], total: byMonth[m] || 0 }));
}

/** Grouped vertical bar chart: income (green) vs expense (rose) per FY month. */
export function monthlyBarChartSvg(income: number[], expense: number[], labels: string[]): string {
  const W = 640, H = 300, padL = 46, padB = 26, padT = 12;
  const max = Math.max(1, ...income, ...expense);
  const cw = W - padL - 8;
  const ch = H - padT - padB;
  const n = income.length;
  const slot = cw / Math.max(1, n);
  const bw = Math.min(22, slot / 3);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif">`;
  // gridlines (4)
  for (let g = 0; g <= 4; g++) {
    const v = (max * g) / 4;
    const y = padT + ch - (ch * g) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}" stroke="#e5e0d5" stroke-width="1"/>`;
    s += `<text x="${padL - 5}" y="${y + 3}" font-size="9" fill="#827c72" text-anchor="end">${fmtShort(v)}</text>`;
  }
  income.forEach((v, i) => {
    const e = expense[i] || 0;
    const x = padL + slot * i + slot / 2;
    const ih = (v / max) * ch;
    const eh = (e / max) * ch;
    s += `<rect x="${(x - bw - 1).toFixed(1)}" y="${(padT + ch - ih).toFixed(1)}" width="${bw}" height="${ih.toFixed(1)}" rx="2" fill="#059669"/>`;
    s += `<rect x="${(x + 1).toFixed(1)}" y="${(padT + ch - eh).toFixed(1)}" width="${bw}" height="${eh.toFixed(1)}" rx="2" fill="#e11d48"/>`;
    s += `<text x="${x.toFixed(1)}" y="${H - 8}" font-size="9" fill="#57534e" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  s += `<rect x="${padL}" y="2" width="9" height="9" fill="#059669"/><text x="${padL + 12}" y="10" font-size="9" fill="#57534e">Income</text>`;
  s += `<rect x="${padL + 70}" y="2" width="9" height="9" fill="#e11d48"/><text x="${padL + 82}" y="10" font-size="9" fill="#57534e">Expense</text>`;
  return s + '</svg>';
}

const PIE_COLORS = ['#1a1a2e', '#059669', '#d97706', '#2563eb', '#e11d48', '#7c3aed', '#0d9488', '#a16207', '#475569', '#be185d', '#4d7c0f', '#0e7490'];

/** Donut chart of expense heads with legend. Returns {svg, slices} for reuse. */
export function expensePieSvg(heads: [string, number][]): string {
  const W = 640, H = 240, cx = 120, cy = 120, r = 88, ir = 52;
  const total = heads.reduce((s, [, v]) => s + v, 0) || 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif">`;
  let angle = -Math.PI / 2;
  const top = heads.slice(0, 12);
  top.forEach(([, v], i) => {
    const frac = v / total;
    if (frac <= 0) return;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
    s += `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large},1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi1.toFixed(1)},${yi1.toFixed(1)} A${ir},${ir} 0 ${large},0 ${xi0.toFixed(1)},${yi0.toFixed(1)} Z" fill="${PIE_COLORS[i % PIE_COLORS.length]}"/>`;
  });
  s += `<text x="${cx}" y="${cy - 2}" font-size="13" font-weight="bold" fill="#1a1a2e" text-anchor="middle">${fmtShort(total)}</text>`;
  s += `<text x="${cx}" y="${cy + 12}" font-size="9" fill="#827c72" text-anchor="middle">total</text>`;
  // legend, 2 columns
  top.forEach(([name, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 250 + col * 195, y = 18 + row * 20;
    if (y > H - 8) return;
    const pct = ((v / total) * 100).toFixed(1);
    s += `<rect x="${x}" y="${y - 8}" width="9" height="9" fill="${PIE_COLORS[i % PIE_COLORS.length]}"/>`;
    s += `<text x="${x + 13}" y="${y}" font-size="9" fill="#44403c">${esc(name.length > 24 ? name.slice(0, 23) + '…' : name)} (${pct}%)</text>`;
  });
  return s + '</svg>';
}

/** Rasterize an SVG string to a PNG data URL (for jsPDF addImage). */
export function svgToPngDataUrl(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = width * scale;
        c.height = height * scale;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
