import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
    include: ['@ricky0123/vad-web'],
  },
  worker: {
    format: 'es',
  },
});
