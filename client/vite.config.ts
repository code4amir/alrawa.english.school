import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
