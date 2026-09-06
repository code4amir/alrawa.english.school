import { describe, expect, it } from 'vitest';
import { canManageClassStudents, canManageIdCard } from '../src/lib/permissions';

const PLAY = [{ id: 'c1', name: 'Play' }];

describe('canManageIdCard', () => {
  it('allows admin and monitor only', () => {
    expect(canManageIdCard('admin')).toBe(true);
    expect(canManageIdCard('monitor')).toBe(true);
    expect(canManageIdCard('teacher')).toBe(false);
    expect(canManageIdCard('viewer')).toBe(false);
    expect(canManageIdCard(undefined)).toBe(false);
  });
});

describe('canManageClassStudents', () => {
  it('allows admin and monitor for any class', () => {
    expect(canManageClassStudents('admin', [], 'KG')).toBe(true);
    expect(canManageClassStudents('monitor', [], 'KG')).toBe(true);
  });

  it('allows teachers only for their assigned classes', () => {
    expect(canManageClassStudents('teacher', PLAY, 'Play')).toBe(true);
    expect(canManageClassStudents('teacher', PLAY, 'KG')).toBe(false);
  });

  it('denies teachers with no assignments and non-teacher roles', () => {
    expect(canManageClassStudents('teacher', [], 'Play')).toBe(false);
    expect(canManageClassStudents('teacher', undefined, 'Play')).toBe(false);
    expect(canManageClassStudents('viewer', PLAY, 'Play')).toBe(false);
    expect(canManageClassStudents('accountant', PLAY, 'Play')).toBe(false);
  });
});
