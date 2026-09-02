// Visual inspection harness: generate REAL report-card PDFs from the production
// downloadReportCardPDF() using vitest's vite-transformed imports, then save to disk
// so we can render pages to PNG and inspect the design.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pdf-preview.test.ts'],
    testTimeout: 60000,
    setupFiles: ['tests/shims.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      jspdf: path.resolve(__dirname, 'node_modules/jspdf/dist/jspdf.node.min.js'),
    },
  },
});
