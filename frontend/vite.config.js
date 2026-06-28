import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Vitest 3 still routes JSX through esbuild; production builds use Vite 8's OXC transform.
  ...(mode === 'test' && {
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
  }),
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/__tests__/setup.js',
  },
  build: {
    // Mermaid is lazy-loaded and gzip-compresses well, but its parser chunk is ~594 kB raw.
    chunkSizeWarningLimit: 650,
  },
}))
