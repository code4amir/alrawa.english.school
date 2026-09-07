import { create } from 'zustand';
import axios from 'axios';
import { api, setTokens, clearTokens, getRefreshToken, getCsrfToken, getAccessToken } from './api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  hasTeacherProfile?: boolean;
  teacherClasses?: { id: string; name: string }[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  fetchSession: () => Promise<void>;
  logout: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ needsLinking?: boolean }>;
}

let refreshing: Promise<boolean> | null = null;

// POST /auth/refresh/ using the HttpOnly refresh cookie (plus the persisted
// in-memory/body token as fallback — see api.ts). Returns true on success.
// Check getLastRefreshStatus() on failure: 401/403 means the session is
// truly dead; anything else (network drop, 5xx, throttle) must NOT log out.
let lastRefreshStatus: number | null = null;
export function getLastRefreshStatus(): number | null {
  return lastRefreshStatus;
}

export async function refreshSession(): Promise<boolean> {
  try {
    const rt = getRefreshToken();
    const payload = rt ? { refresh: rt } : {};
    const res = await axios.post(
      `${api.defaults.baseURL}/auth/refresh/`,
      payload,
      { withCredentials: true },
    );
    const { access, refresh: newRefresh, csrfToken } = res.data;
    setTokens(access, newRefresh || rt, csrfToken || getCsrfToken());
    lastRefreshStatus = 200;
    return true;
  } catch (e: any) {
    lastRefreshStatus = e?.response?.status ?? 0;
    return false;
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (error.response?.status === 401 && !config._retry) {
        config._retry = true;

        if (!refreshing) {
          refreshing = refreshSession().finally(() => {
            refreshing = null;
          });
        }

        const ok = await refreshing;
        if (ok) {
          return api(config);
        }
        // One retry: a parallel tab may have just rotated the shared cookie;
        // the second attempt then reads the fresh token from the cookie jar.
        await new Promise((r) => setTimeout(r, 800));
        if (await refreshSession()) {
          return api(config);
        }
        // Log out ONLY when the server explicitly rejected the refresh
        // (401/403 = dead session). Transport failures (offline, 5xx,
        // throttle) keep the session — the tokens may be perfectly fine.
        if (getLastRefreshStatus() === 401 || getLastRefreshStatus() === 403) {
          clearTokens();
          set({ user: null });
        }
      }
      return Promise.reject(error);
    }
  );

  return {
    user: null,
    loading: true,

    login: async (email: string, password: string) => {
      const res = await api.post('/auth/login/', { email, password });
      const { access, refresh, needsLinking, csrfToken } = res.data;
      setTokens(access, refresh || null, csrfToken);
      await get().fetchSession();
      return { needsLinking: Boolean(needsLinking) };
    },

    fetchSession: async () => {
      try {
        const res = await api.get('/auth/get-session/');
        if (res.data?.csrfToken) {
          const access = getAccessToken();
          const refresh = getRefreshToken();
          setTokens(access, refresh, res.data.csrfToken); // keep existing tokens, only update CSRF
        }
        set({ user: res.data?.user ?? null, loading: false });
      } catch {
        set({ user: null, loading: false });
      }
    },

    logout: async () => {
      await api.post('/auth/logout/').catch(() => {});
      clearTokens();
      set({ user: null });
    },
  };
});
