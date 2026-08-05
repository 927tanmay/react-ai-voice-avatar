import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
    include: ['@ricky0123/vad-web'],
  },
  worker: {
    format: 'es'
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by VAD / WASM workers)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
