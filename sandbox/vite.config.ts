import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    // Resolve directly from source so Vite handles workers natively in dev.
    // Anchored, because a plain string alias also matches as a prefix, and
    // would send `react-ai-voice-avatar/headless` to `src/index.ts/headless`.
    alias: mode === 'development' ? [
      { find: /^react-ai-voice-avatar\/headless$/, replacement: resolve(import.meta.dirname, '../src/headless.ts') },
      { find: /^react-ai-voice-avatar$/, replacement: resolve(import.meta.dirname, '../src/index.ts') },
    ] : [],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei']
  },
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
    include: ['@ricky0123/vad-web'],
  },
  worker: {
    format: 'es'
  },
  build: {
    rollupOptions: {
      // Two pages. The voice page is its own entry, not a route, so its bundle
      // leaves out three.js and the avatar; see src/voice/main.tsx.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        voice: resolve(import.meta.dirname, 'voice.html'),
      },
    },
  },
  server: {
    fs: {
      // Allow serving worker files and assets from the parent workspace root (~/react-indic-avatar/src)
      allow: ['..']
    }
  }
}))
