import { describe, expect, it } from 'vitest';
import {
  canAddStudents,
  canManageClassStudents,
  canManageIdCard,
  canUseModule,
  MODULE_ROLES,
} from '../src/lib/permissions';
import type { ModuleKey } from '../src/lib/permissions';

const PLAY = [{ id: 'c1', name: 'Play' }];

const ALL_MODULES = Object.keys(MODULE_ROLES) as ModuleKey[];

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

describe('canAddStudents', () => {
  it('allows admin, monitor and accountant', () => {
    expect(canAddStudents('admin')).toBe(true);
    expect(canAddStudents('monitor')).toBe(true);
    expect(canAddStudents('accountant')).toBe(true);
  });

  it('denies teacher, viewer, super_viewer, parent and unknown roles', () => {
    // Teacher stays scoped per-class via canManageClassStudents instead.
    expect(canAddStudents('teacher')).toBe(false);
    expect(canAddStudents('viewer')).toBe(false);
    expect(canAddStudents('super_viewer')).toBe(false);
    expect(canAddStudents('parent')).toBe(false);
    expect(canAddStudents('principal')).toBe(false);
    expect(canAddStudents(undefined)).toBe(false);
    expect(canAddStudents(null)).toBe(false);
  });
});

describe('MODULE_ROLES', () => {
  it('covers every dashboard mode and keeps scheduler admin-only', () => {
    expect(ALL_MODULES.sort()).toEqual([
      'accessories',
      'announcements',
      'attendance',
      'exam-routine',
      'finance',
      'idcard',
      'result',
      'routine',
      'scheduler',
      'services',
      'session-year',
    ]);
    expect(MODULE_ROLES.scheduler).toEqual(['admin']);
  });

  it('has no duplicate role entries per module', () => {
    for (const [key, roles] of Object.entries(MODULE_ROLES)) {
      expect(new Set(roles).size, `duplicate role in ${key}`).toBe(roles.length);
    }
  });

  it('never lists a role the backend does not know', () => {
    // Mirrors User.ROLE_CHOICES in accounts/models.py. 'principal' is the
    // phantom role removed from BottomNav — it must not creep back in here.
    const KNOWN_ROLES = ['admin', 'teacher', 'monitor', 'accountant', 'super_viewer', 'viewer', 'parent'];
    for (const [key, roles] of Object.entries(MODULE_ROLES)) {
      for (const role of roles) {
        expect(KNOWN_ROLES, `${key} lists unknown role ${role}`).toContain(role);
      }
    }
  });
});

describe('canUseModule — accountant scope', () => {
  it('sees exactly accessories, finance, services, announcements and idcard', () => {
    const seen = ALL_MODULES.filter((m) => canUseModule('accountant', m)).sort();
    expect(seen).toEqual(['accessories', 'announcements', 'finance', 'idcard', 'services']);
  });

  it('cannot reach the academic modules or the scheduler', () => {
    for (const m of ['attendance', 'result', 'routine', 'exam-routine', 'session-year', 'scheduler'] as ModuleKey[]) {
      expect(canUseModule('accountant', m), `accountant must not use ${m}`).toBe(false);
    }
  });
});

describe('canUseModule — other roles are unchanged', () => {
  it('gives admin every module', () => {
    for (const m of ALL_MODULES) expect(canUseModule('admin', m)).toBe(true);
  });

  it('gives teacher idcard, accessories, attendance and result only', () => {
    const seen = ALL_MODULES.filter((m) => canUseModule('teacher', m)).sort();
    expect(seen).toEqual(['accessories', 'attendance', 'idcard', 'result']);
  });

  it('gives monitor everything except finance and scheduler', () => {
    const seen = ALL_MODULES.filter((m) => canUseModule('monitor', m)).sort();
    expect(seen).toEqual([
      'accessories', 'announcements', 'attendance', 'exam-routine', 'idcard', 'result',
      'routine', 'services', 'session-year',
    ]);
  });

  it('gives the pending viewer nothing', () => {
    for (const m of ALL_MODULES) expect(canUseModule('viewer', m)).toBe(false);
  });

  it('keeps super_viewer read-only: no scheduler', () => {
    const seen = ALL_MODULES.filter((m) => canUseModule('super_viewer', m)).sort();
    expect(seen).toContain('finance');
    expect(seen).not.toContain('scheduler');
  });

  it('denies the phantom principal role and other unknown roles', () => {
    for (const m of ALL_MODULES) {
      expect(canUseModule('principal', m)).toBe(false);
      expect(canUseModule('headmaster', m)).toBe(false);
      expect(canUseModule(undefined, m)).toBe(false);
      expect(canUseModule(null, m)).toBe(false);
    }
  });

  it('is symmetric with MODULE_ROLES', () => {
    for (const m of ALL_MODULES) {
      for (const role of ['admin', 'teacher', 'monitor', 'accountant', 'super_viewer', 'viewer', 'parent', 'principal']) {
        expect(canUseModule(role, m)).toBe(MODULE_ROLES[m].includes(role));
      }
    }
  });
});