import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve directly from source so Vite handles workers natively in dev
      'react-ai-voice-avatar': resolve(import.meta.dirname, '../src/index.ts'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei']
  },
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer']
  },
  worker: {
    format: 'es'
  },
  server: {
    fs: {
      // Allow serving worker files and assets from the parent workspace root (~/react-indic-avatar/src)
      allow: ['..']
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
