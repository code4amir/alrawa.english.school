import axios from 'axios';
import { API_URL } from '../lib/config';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let csrfToken: string | null = null;

const LS_REFRESH_KEY = 'refresh_token';

try {
  // Survive reloads: the SPA re-sends this in the refresh body when the
  // HttpOnly cookie is unavailable (ITP / third-party-cookie blocking).
  refreshToken = localStorage.getItem(LS_REFRESH_KEY);
} catch { refreshToken = null; }

export function setTokens(access: string | null, refresh: string | null, csrf?: string | null) {
  accessToken = access;
  if (refresh) {
    refreshToken = refresh;
    try { localStorage.setItem(LS_REFRESH_KEY, refresh); } catch { /* ignore */ }
  } else if (access === null) {
    // Full clear only when both are nulled alongside clearTokens();
    // a null refresh ALONE (e.g. PIN screen swapping the access token)
    // must not wipe the persisted web session.
    refreshToken = null;
  }
  if (csrf !== undefined) csrfToken = csrf;
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function getCsrfToken() {
  return csrfToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  csrfToken = null;
  try { localStorage.removeItem(LS_REFRESH_KEY); } catch { /* ignore */ }
}

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // CSRF: echo the token on any state-changing request. Cookie-based auth is
  // the vulnerable path — the backend rejects it without a valid X-CSRFToken.
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head' && method !== 'options' && csrfToken) {
    config.headers['X-CSRFToken'] = csrfToken;
  }
  return config;
});

const inflight = new Map<string, Promise<unknown>>();
export function dedupedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
