import { useEffect, useRef, useState } from 'react';
import { api, useAuthStore } from '../store';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array(rawData.split('').map((c) => c.charCodeAt(0)));
}

const SUBSCRIBED_FLAG = 'push-subscribed-endpoint';

/** Best-effort unsubscribe: browser + server row, then clear the flag. */
export async function unsubscribePush(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await api.delete('/parents/push/subscribe/', { data: { endpoint } }).catch(() => {});
      } else {
        const known = localStorage.getItem(SUBSCRIBED_FLAG);
        if (known) {
          await api.delete('/parents/push/subscribe/', { data: { endpoint: known } }).catch(() => {});
        }
      }
    }
  } catch {
    // Teardown must never break logout/navigation.
  } finally {
    localStorage.removeItem(SUBSCRIBED_FLAG);
  }
}

export function usePushSubscription() {
  const [error, setError] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? null;

  useEffect(() => {
    // Auth-aware: skip entirely when logged out (no session = no push
    // registration), and (re)run after login when the session arrives.
    if (!userId) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'denied') return;

    let cancelled = false;
    const init = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        // Subscribe once: skip the network round-trip when the stored
        // endpoint still matches the browser's active subscription.
        if (existing && localStorage.getItem(SUBSCRIBED_FLAG) === existing.endpoint) return;

        const permission = Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission !== 'granted') return;

        const vapidRes = await api.get('/parents/push/vapid-key/');
        const vapidKey = vapidRes.data.publicKey;
        if (!vapidKey) {
          throw new Error('Push is not configured on the server.');
        }

        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
        });

        await api.post('/parents/push/subscribe/', sub.toJSON());
        localStorage.setItem(SUBSCRIBED_FLAG, sub.endpoint);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Push subscription failed.');
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Unsubscribe on logout: when the session transitions from a signed-in
  // user to null, tear down the browser subscription and delete the server
  // row so a shared device stops receiving this account's pushes. The ref
  // guard keeps the initial (pre-session) null from wiping a valid sub.
  const prevUser = useRef(user);
  useEffect(() => {
    if (prevUser.current !== null && user === null) {
      void unsubscribePush();
    }
    prevUser.current = user;
  }, [user]);

  return { error };
}
