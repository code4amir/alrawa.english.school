import { create } from 'zustand';
import axios from 'axios';
import { api, setTokens, clearTokens, getRefreshToken } from './api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  hasTeacherProfile?: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  fetchSession: () => Promise<void>;
  logout: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ needsLinking?: boolean }>;
}

let refreshing: Promise<boolean> | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (error.response?.status === 401 && !config._retry) {
        config._retry = true;

        if (!refreshing) {
          refreshing = (async () => {
            try {
              const rt = getRefreshToken();
              const payload = rt ? { refresh: rt } : {};
              const res = await axios.post(
                `${api.defaults.baseURL}/auth/refresh/`,
                payload,
              );
              const { access, refresh: newRefresh } = res.data;
              setTokens(access, newRefresh || rt);
              return true;
            } catch {
              return false;
            } finally {
              refreshing = null;
            }
          })();
        }

        const ok = await refreshing;
        if (ok) {
          return api(config);
        }
        clearTokens();
        set({ user: null });
      }
      return Promise.reject(error);
    }
  );

  return {
    user: null,
    loading: true,

    login: async (email: string, password: string) => {
      const res = await api.post('/auth/login/', { email, password });
      const { access, refresh, needsLinking } = res.data;
      setTokens(access, refresh);
      await get().fetchSession();
      return { needsLinking: Boolean(needsLinking) };
    },

    fetchSession: async () => {
      try {
        if (get().user) {
          set({ loading: false });
          return;
        }
        const res = await api.get('/auth/get-session/');
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
