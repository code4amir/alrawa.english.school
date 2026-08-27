import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

// Stamp the build time into public/sw.js so the service worker's bytes change
// on every deploy. The browser then always detects a new SW, which takes over
// (skipWaiting + clients.claim) and triggers the controllerchange reload in
// main.tsx — devices can never get stuck executing a stale cached bundle.
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js')
      if (!fs.existsSync(swPath)) return
      const stamp = Date.now().toString(36)
      const content = fs.readFileSync(swPath, 'utf8').replace(/__BUILD_STAMP__/g, stamp)
      fs.writeFileSync(swPath, content)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  base: '/alrawa.english.school/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const setCookie = proxyRes.headers['set-cookie'];
            if (setCookie) {
              proxyRes.headers['set-cookie'] = setCookie.map((c) =>
                c.replace(/Domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '')
              );
            }
          });
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { test: /node_modules\/(react|react-dom|react-router)/, name: 'vendor-react' },
            { test: /node_modules\/jspdf/, name: 'vendor-jspdf' },
            { test: /node_modules\/xlsx/, name: 'vendor-xlsx' },
            { test: /node_modules\/framer-motion/, name: 'vendor-framer' },
            { test: /node_modules\/axios/, name: 'vendor-axios' },
            { test: /node_modules\/lucide/, name: 'vendor-lucide' },
            { test: /node_modules\/zustand/, name: 'vendor-zustand' },
            { test: /node_modules\/@supabase/, name: 'vendor-supabase' },
            { test: /node_modules\/zod/, name: 'vendor-zod' },
          ],
        },
      },
    },
  },
})
