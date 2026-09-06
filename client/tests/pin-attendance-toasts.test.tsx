import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.stubEnv('VITE_API_URL', 'http://test.local/api');

let PinAttendance: React.ComponentType;

const STUDENTS = [{ id: 's1', name: 'Asha Test', roll: '1' }];
const QUEUE_KEY = 'pin_attendance_queue';

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

function seedSession() {
  localStorage.setItem('pin_auth_token', 'test-token');
  localStorage.setItem('pin_teacher', JSON.stringify({ id: 't1', name: 'Test Teacher' }));
  localStorage.setItem('pin_classes', JSON.stringify([{ id: 'c1', name: 'Class Test' }]));
}

function queue(): unknown[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

async function openAttendance(user: ReturnType<typeof userEvent.setup>) {
  render(<PinAttendance />);
  await user.click(await screen.findByRole('button', { name: /Class Test/ }));
  await screen.findByText('Asha Test');
  await user.click(screen.getByRole('button', { name: /Asha Test/ }));
}

beforeAll(async () => {
  ({ default: PinAttendance } = await import('../src/pages/PinAttendance'));
});

beforeEach(() => {
  localStorage.clear();
  seedSession();
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('PIN attendance save notifications', () => {
  test('online save shows success toast', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/m/attendance/batch/')) {
        posted.push(JSON.parse(String(init?.body)));
        return json(200, { status: 'ok', count: 1 });
      }
      if (url.includes('/m/students/')) return json(200, { students: STUDENTS });
      if (url.includes('/m/attendance/')) return json(200, []);
      if (url.includes('/m/teachers/')) return json(200, { teachers: [] });
      return json(200, {});
    }));

    await openAttendance(user);
    await user.click(screen.getByRole('button', { name: /Save \(1\)/ }));

    await waitFor(() => expect(screen.getByText('Attendance saved')).toBeTruthy(), { timeout: 5000 });
    expect(posted).toHaveLength(1);
    expect(queue()).toHaveLength(0);
  });

  test('offline save queues and shows offline toast', async () => {
    const user = userEvent.setup();
    setOnline(false);
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/m/students/')) return json(200, { students: STUDENTS });
      if (url.includes('/m/attendance/')) return json(200, []);
      if (url.includes('/m/teachers/')) return json(200, { teachers: [] });
      return json(200, {});
    }));

    await openAttendance(user);
    await user.click(screen.getByRole('button', { name: /Save \(1\)/ }));

    await waitFor(() => expect(screen.getByText('Saved offline — will sync when online')).toBeTruthy(), { timeout: 5000 });
    expect(queue()).toHaveLength(1);
  });

  test('queued record syncs on reconnect with success toast', async () => {
    const user = userEvent.setup();
    localStorage.setItem(QUEUE_KEY, JSON.stringify([
      { school_class: 'c1', date: '2026-09-01', term: '1', session: '2026', records: { s1: 'present' }, timestamp: 1 },
    ]));
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/m/attendance/batch/') && init?.method === 'POST') {
        return json(200, { status: 'ok', count: 1 });
      }
      if (url.includes('/m/students/')) return json(200, { students: STUDENTS });
      if (url.includes('/m/attendance/')) return json(200, []);
      if (url.includes('/m/teachers/')) return json(200, { teachers: [] });
      return json(200, {});
    }));

    render(<PinAttendance />);
    void user;
    await waitFor(() => expect(screen.getByText('Synced 1 queued record')).toBeTruthy(), { timeout: 5000 });
    expect(queue()).toHaveLength(0);
  });

  test('server validation error surfaces and is never queued', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/m/attendance/batch/') && init?.method === 'POST') {
        return json(400, { error: 'Cannot mark attendance on a weekend day' });
      }
      if (url.includes('/m/students/')) return json(200, { students: STUDENTS });
      if (url.includes('/m/attendance/')) return json(200, []);
      if (url.includes('/m/teachers/')) return json(200, { teachers: [] });
      return json(200, {});
    }));

    await openAttendance(user);
    await user.click(screen.getByRole('button', { name: /Save \(1\)/ }));

    await waitFor(() => expect(screen.getByText('Cannot mark attendance on a weekend day')).toBeTruthy(), { timeout: 5000 });
    expect(queue()).toHaveLength(0);
  });
});
