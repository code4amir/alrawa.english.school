import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`.replace(/\/+/g, '/');
    navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' })
      .then(() => {
        // When a newer service worker takes control (skipWaiting + clients.claim
        // in sw.js), reload once so the page stops executing a stale cached
        // bundle and picks up the fresh one. Without this, devices that kept
        // the app open across a deploy keep running old JS indefinitely.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      })
      .catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
