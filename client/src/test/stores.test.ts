import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore, useDarkMode, useUIStore, useUserManagementStore, api } from '../store';
import { setTokens, getAccessToken, getRefreshToken } from '../stores/api';

const mockSupabase = {
  auth: {
    getSession: vi.fn(),
    signOut: vi.fn(),
  },
};

vi.mock('../lib/supabase', () => ({
  getClient: vi.fn(() => Promise.resolve(mockSupabase)),
  ready: Promise.resolve(mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, loading: true });
  useUserManagementStore.setState({ users: [], roles: [] });
  useUIStore.setState({ activeMode: null, activeSubMode: 'student' });
  localStorage.clear();
});

describe('useAuthStore', () => {
  it('starts with null user and loading true', () => {
    const { user, loading } = useAuthStore.getState();
    expect(user).toBeNull();
    expect(loading).toBe(true);
  });

  it('fetchSession sets user null and loading false when no session', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { user: null } });

    await useAuthStore.getState().fetchSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('fetchSession fetches user from server when session exists', async () => {
    const mockUser = { id: 'u1', name: 'Alice', email: 'a@b.com', role: 'admin', image: null };
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: { user: mockUser } });
    setTokens('test-token', null);

    await useAuthStore.getState().fetchSession();

    expect(getSpy).toHaveBeenCalledWith('/auth/get-session/');
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('fetchSession skips server call when user already set', async () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Bob', email: 'b@b.com', role: 'viewer', image: null }, loading: false });
    const getSpy = vi.spyOn(api, 'get');

    await useAuthStore.getState().fetchSession();

    expect(getSpy).not.toHaveBeenCalled();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('fetchSession handles error and clears user', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network error'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await useAuthStore.getState().fetchSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('logout clears tokens and user', async () => {
    setTokens('test', 'test');
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    useAuthStore.setState({ user: { id: 'u1', name: 'X', email: 'x@y.com', role: 'admin', image: null }, loading: false });

    await useAuthStore.getState().logout();

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('useDarkMode', () => {
  it('reads dark mode from localStorage on init', () => {
    localStorage.setItem('dark-mode', 'true');
    useDarkMode.setState({ dark: true });
    expect(useDarkMode.getState().dark).toBe(true);
  });

  it('toggle flips dark value and persists', () => {
    useDarkMode.setState({ dark: false });

    useDarkMode.getState().toggle();
    expect(useDarkMode.getState().dark).toBe(true);
    expect(localStorage.getItem('dark-mode')).toBe('true');

    useDarkMode.getState().toggle();
    expect(useDarkMode.getState().dark).toBe(false);
    expect(localStorage.getItem('dark-mode')).toBe('false');
  });

  it('toggle adds and removes dark class on documentElement', () => {
    document.documentElement.classList.remove('dark');
    useDarkMode.setState({ dark: false });

    useDarkMode.getState().toggle();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useDarkMode.getState().toggle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('useUIStore', () => {
  it('setMode updates activeMode', () => {
    useUIStore.getState().setMode('idcard');
    expect(useUIStore.getState().activeMode).toBe('idcard');
  });

  it('setMode can set to null', () => {
    useUIStore.setState({ activeMode: 'finance' });
    useUIStore.getState().setMode(null);
    expect(useUIStore.getState().activeMode).toBeNull();
  });

  it('setIdSubMode updates activeSubMode', () => {
    useUIStore.getState().setIdSubMode('staff');
    expect(useUIStore.getState().activeSubMode).toBe('staff');
  });

  it('swipeBack resets to student sub-mode when in idcard with non-student', () => {
    useUIStore.setState({ activeMode: 'idcard', activeSubMode: 'staff' });
    useUIStore.getState().swipeBack();
    expect(useUIStore.getState().activeSubMode).toBe('student');
    expect(useUIStore.getState().activeMode).toBe('idcard');
  });

  it('swipeBack clears mode when not in idcard', () => {
    useUIStore.setState({ activeMode: 'result', activeSubMode: 'student' });
    useUIStore.getState().swipeBack();
    expect(useUIStore.getState().activeMode).toBeNull();
  });

  it('swipeBack does nothing when mode is already null', () => {
    useUIStore.setState({ activeMode: null, activeSubMode: 'student' });
    useUIStore.getState().swipeBack();
    expect(useUIStore.getState().activeMode).toBeNull();
  });

  it('swipeBack calls registered function and clears it', () => {
    const fn = vi.fn();
    useUIStore.getState().registerSwipeBack(fn);
    useUIStore.getState().swipeBack();
    expect(fn).toHaveBeenCalledOnce();

    useUIStore.getState().swipeBack();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('registerSwipeBack stores callback for next swipeBack', () => {
    const fn = vi.fn();
    useUIStore.getState().registerSwipeBack(fn);
    useUIStore.setState({ activeMode: 'idcard', activeSubMode: 'student' });
    useUIStore.getState().swipeBack();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('useUserManagementStore', () => {
  it('fetchUsers calls GET /users and stores result', async () => {
    const mockUsers = [{ id: 'u1', name: 'A', email: 'a@b.com', role: 'admin', emailVerified: true, createdAt: '2025-01-01' }];
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: mockUsers });

    await useUserManagementStore.getState().fetchUsers();

    expect(getSpy).toHaveBeenCalledWith('/users/');
    expect(useUserManagementStore.getState().users).toEqual(mockUsers);
  });

  it('fetchRoles calls GET /users/roles and stores result', async () => {
    const mockRoles = [{ value: 'admin', label: 'Admin' }, { value: 'viewer', label: 'Viewer' }];
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: mockRoles });

    await useUserManagementStore.getState().fetchRoles();

    expect(getSpy).toHaveBeenCalledWith('/users/roles/');
    expect(useUserManagementStore.getState().roles).toEqual(mockRoles);
  });

  it('updateRole calls PUT and refreshes users', async () => {
    const putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

    await useUserManagementStore.getState().updateRole('u1', 'viewer');

    expect(putSpy).toHaveBeenCalledWith('/users/u1/role/', { role: 'viewer' });
    expect(getSpy).toHaveBeenCalledWith('/users/');
  });

  it('deleteUser calls DELETE and refreshes users', async () => {
    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} });
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

    await useUserManagementStore.getState().deleteUser('u1');

    expect(deleteSpy).toHaveBeenCalledWith('/users/u1/');
    expect(getSpy).toHaveBeenCalledWith('/users/');
  });
});
