import { describe, expect, it } from 'vitest';
import { mergeSavedAttendance, mergeSavedComments, mergeSavedMarks } from '../src/lib/resultsMerge';

describe('mergeSavedMarks', () => {
  it('updates the subject while preserving sibling subjects', () => {
    const rows = [{ studentId: 's1', term: '1', marks: { Bangla: 80 } }];
    const out = mergeSavedMarks(rows, ['s1'], '1', 'Math', { s1: '75' }, 100);
    expect(out[0].marks).toEqual({ Bangla: 80, Math: 75 });
  });

  it('clamps to full marks and adds a row when missing', () => {
    const out = mergeSavedMarks([], ['s9'], 1, 'Math', { s9: '120' }, 100);
    expect(out).toHaveLength(1);
    expect(out[0].marks).toEqual({ Math: 100 });
    expect(String(out[0].term)).toBe('1');
  });

  it('removes the subject on empty input without touching siblings', () => {
    const rows = [{ studentId: 's1', term: '1', marks: { Bangla: 80, Math: 70 } }];
    const out = mergeSavedMarks(rows, ['s1'], '1', 'Math', { s1: '' }, 100);
    expect(out[0].marks).toEqual({ Bangla: 80 });
  });

  it('matches term across string/number types (no sibling wipe)', () => {
    const rows = [{ studentId: 's1', term: 1, marks: { Bangla: 80 } }];
    const out = mergeSavedMarks(rows, ['s1'], '1', 'Math', { s1: '75' }, 100);
    expect(out).toHaveLength(1);
    expect(out[0].marks).toEqual({ Bangla: 80, Math: 75 });
  });
});

describe('mergeSavedAttendance', () => {
  it('merges days/present into the existing row', () => {
    const rows = [{ studentId: 's1', term: '1', marks: { Math: 75 } }];
    const out = mergeSavedAttendance(rows, ['s1'], '1', { s1: { days: '20', present: '18' } });
    expect(out[0].attendance).toEqual({ days: 20, present: 18 });
    expect(out[0].marks).toEqual({ Math: 75 });
  });
});

describe('mergeSavedComments', () => {
  it('merges the comment into the existing row', () => {
    const rows = [{ studentId: 's1', term: '1' }];
    const out = mergeSavedComments(rows, ['s1'], '1', { s1: 'Good' });
    expect(out[0].comment).toBe('Good');
  });
});
