import { describe, it, expect } from 'vitest';

/**
 * Mirror of the receipt's month-run compressor. The PDF helper itself needs a
 * jsPDF document, so the logic is duplicated here purely as a regression
 * guard — keep both in sync when changing either.
 */
function compressMonths(periods: string[]): string {
  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = (m: string) => {
    const [yy, mm] = m.split('-');
    if (!yy || !mm) return m;
    return `${NAMES[Number(mm) - 1] || mm} ${yy.slice(2)}`;
  };
  const valid = periods.filter((p) => /^\d{4}-\d{2}$/.test(p)).sort();
  if (!valid.length) return '';
  const runs: string[][] = [];
  for (const p of valid) {
    const last = runs[runs.length - 1];
    if (last) {
      const [py, pm] = last[last.length - 1].split('-').map(Number);
      const [cy, cm] = p.split('-').map(Number);
      if (cy * 12 + cm === py * 12 + pm + 1) {
        last.push(p);
        continue;
      }
    }
    runs.push([p]);
  }
  return runs
    .map((run) => {
      if (run.length === 1) return label(run[0]);
      if (run.length === 2) return `${label(run[0])}, ${label(run[1])}`;
      return `${label(run[0])} - ${label(run[run.length - 1])}`;
    })
    .join(';  ');
}

describe('receipt month compression', () => {
  it('ranges a consecutive in-year run', () => {
    expect(
      compressMonths(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']),
    ).toBe('Jan 26 - Sep 26');
  });

  it('renders a two-month run without a dash', () => {
    expect(compressMonths(['2026-01', '2026-02'])).toBe('Jan 26, Feb 26');
  });

  it('keeps single months as-is', () => {
    expect(compressMonths(['2026-05'])).toBe('May 26');
  });

  it('separates non-consecutive runs', () => {
    // Two-month runs use a comma (see the case above); three-or-more use a range.
    expect(compressMonths(['2026-01', '2026-02', '2026-05', '2026-06', '2026-07'])).toBe(
      'Jan 26, Feb 26;  May 26 - Jul 26',
    );
  });

  it('crosses a year boundary', () => {
    expect(compressMonths(['2025-12', '2026-01', '2026-02'])).toBe('Dec 25 - Feb 26');
  });

  it('returns empty for junk input', () => {
    expect(compressMonths([])).toBe('');
    expect(compressMonths(['nope'])).toBe('');
  });
});