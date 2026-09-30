import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { groq } from './server/groq';

export default defineConfig(({ mode }) => {
  // '' loads every variable, not only VITE_ ones. The key stays in this Node
  // process: nothing here is exposed to the page, which is why it has no
  // VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), groq(env.GROQ_API_KEY)],
    optimizeDeps: {
      exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
      include: ['@ricky0123/vad-web'],
    },
    worker: {
      format: 'es',
    },
  };
});
