import { describe, expect, it } from 'vitest';
import { mergeSavedAttendance, mergeSavedComments, mergeSavedMarks, rebuildBulkValues } from '../src/lib/resultsMerge';

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

describe('rebuildBulkValues', () => {
  const ids = ['s1', 's2'];
  const get = (sid: string) => `server-${sid}`;

  it('does a full rebuild when the basis changes (subject/term/class switch)', () => {
    const out = rebuildBulkValues({ s1: 'typed-85', s2: 'typed-90' }, true, ids, get);
    expect(out).toEqual({ s1: 'server-s1', s2: 'server-s2' });
  });

  it('preserves unsaved typing when late data arrives on the same basis', () => {
    // Slow initial load resolving AFTER the user typed: typed values survive,
    // only students missing from state get server values.
    const out = rebuildBulkValues({ s1: 'typed-85' }, false, ids, get);
    expect(out).toEqual({ s1: 'typed-85', s2: 'server-s2' });
  });

  it('drops students no longer in the class', () => {
    const out = rebuildBulkValues({ s1: 'a', gone: 'b' }, false, ids, get);
    expect(out).toEqual({ s1: 'a', s2: 'server-s2' });
  });
});
