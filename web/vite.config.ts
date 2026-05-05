import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root so we have one source of truth.
  envDir: '..',
  server: {
    port: 5173,
    // Proxy API + auth requests to Hono so the browser sees a single origin
    // (avoids CORS issues for cookies during local dev).
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
