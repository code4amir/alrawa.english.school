// Pure number/date/aggregation formatters shared by finance report views.
// Split out of financeReportPdf.ts (which statically imports jspdf) so that
// pages can import these for RENDERING without pulling the jspdf bundle into
// the initial chunk — the jspdf-backed pdf* builders stay behind click-time
// `await import()` and land in the vendor-jspdf async chunk.

export function getMonthName(m: number) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];
}

export function getMonthNameShort(m: number) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
}

export function fmt(n: number) {
  return n.toLocaleString('en-BD');
}

export function headwise(data: any[]) {
  const map: Record<string, number> = {};
  data.forEach(t => { const cat = t.category || 'Uncategorized'; map[cat] = (map[cat] || 0) + Number(t.amount); });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
