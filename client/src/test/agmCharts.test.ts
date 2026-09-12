import { describe, it, expect } from 'vitest';
import { aggregateMonthly, monthlyBarChartSvg, expensePieSvg, fmtShort, FY_MONTH_ORDER } from '../lib/agmCharts';

describe('agmCharts', () => {
  it('orders months Sep->Aug regardless of input order', () => {
    const rows = [
      { month: 1, category: 'Fees', total: 100 },
      { month: 9, category: 'Fees', total: 50 },
      { month: 9, category: 'Other', total: 25 },
    ];
    const out = aggregateMonthly(rows);
    expect(out.map(o => o.month)).toEqual(FY_MONTH_ORDER);
    expect(out[0]).toEqual({ month: 9, label: 'Sep', total: 75 });
    expect(out[4]).toEqual({ month: 1, label: 'Jan', total: 100 });
    expect(out[1].total).toBe(0);
  });

  it('ignores out-of-range months', () => {
    const out = aggregateMonthly([{ month: 13, total: 999 }, { month: 0, total: 1 }]);
    expect(out.every(o => o.total === 0)).toBe(true);
  });

  it('bar chart escapes labels and renders 12 groups', () => {
    const svg = monthlyBarChartSvg(new Array(12).fill(10), new Array(12).fill(5), ['Sep', '<b>Oct</b>', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']);
    expect(svg).not.toContain('<b>Oct</b>');
    expect(svg).toContain('&lt;b&gt;');
    // 24 bars + 2 legend swatches
    expect(svg.match(/<rect/g)?.length).toBe(26);
  });

  it('pie chart slices sum to full circle and escape names', () => {
    const svg = expensePieSvg([['Salaries & Wages', 80], ['Rent <hall>', 20]]);
    expect(svg).toContain('Salaries &amp; Wages');
    expect(svg).toContain('80.0%');
    expect(svg.match(/<path/g)?.length).toBe(2);
  });

  it('single-head pie draws a full ring, never NaN', () => {
    const svg = expensePieSvg([['Electricity Bill', '5500.00' as any]]);
    expect(svg).not.toContain('NaN');
    expect(svg.match(/<circle/g)?.length).toBe(2);
    expect(svg).toContain('100.0%');
  });

  it('fmtShort compacts large taka amounts', () => {
    expect(fmtShort(15000000)).toBe('1.5Cr');
    expect(fmtShort(250000)).toBe('2.5L');
    expect(fmtShort(1500)).toBe('1.5k');
    expect(fmtShort(999)).toBe('999');
  });
});
