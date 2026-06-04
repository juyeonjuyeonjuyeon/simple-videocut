import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// We use the SINGLE-THREADED @ffmpeg/core, which does not need SharedArrayBuffer,
// so no Cross-Origin-Isolation (COOP/COEP) headers are required. Leaving them OFF
// keeps third-party resources (e.g. Google Fonts) from being blocked by COEP and
// makes local dev behave exactly like the header-less static deployment.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
