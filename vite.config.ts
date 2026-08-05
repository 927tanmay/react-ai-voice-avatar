import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx']
    })
  ],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ReactAiVoiceAvatar',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      // Externalize all dependencies and peerDependencies (including subpaths like react/jsx-runtime)
      external: (id) => /^(react|react-dom|three|@react-three\/(fiber|drei)|@huggingface\/transformers|@ricky0123\/vad-web|kokoro-js|phonemizer|leva|onnxruntime-web|web-audio-api)(\/|$)/.test(id),
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          three: 'THREE',
          '@react-three/fiber': 'ReactThreeFiber',
          '@react-three/drei': 'ReactThreeDrei',
          '@huggingface/transformers': 'Transformers',
          '@ricky0123/vad-web': 'vad',
          'kokoro-js': 'Kokoro',
          'phonemizer': 'phonemizer',
          'leva': 'Leva',
          'onnxruntime-web': 'ort',
        }
      }
    }
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
