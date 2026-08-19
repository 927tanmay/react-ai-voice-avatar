import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// Plugin to prevent Vite from converting static .wasm URL references into base64 data URIs in bundled workers
const excludeOnnxWasmPlugin = () => ({
  name: 'exclude-onnx-wasm',
  enforce: 'pre' as const,
  transform(code: string) {
    if (code.includes('.wasm')) {
      return {
        code: code.replace(/new\s+URL\(\s*['"]([^'"]+\.wasm)['"]\s*,\s*import\.meta\.url\s*\)/g, (_, wasmFile) => {
          return `new (globalThis.URL || URL)(${JSON.stringify(wasmFile)}, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/").href`;
        }),
        map: null
      };
    }
    return null;
  }
});

export default defineConfig({
  plugins: [
    excludeOnnxWasmPlugin(),
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx']
    })
  ],
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ReactAiVoiceAvatar',
      formats: ['es'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      // Externalize all dependencies and peerDependencies (including subpaths like react/jsx-runtime)
      external: (id) => /^(react|react-dom|three|@react-three\/(fiber|drei)|@huggingface\/transformers|@ricky0123\/vad-web|kokoro-js|phonemizer|leva|onnxruntime-web|web-audio-api)(\/|$)/.test(id),
      output: {
        preserveModules: true,
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
    plugins: () => [excludeOnnxWasmPlugin()],
    rollupOptions: {
      external: (id) => /\.wasm($|\?)/.test(id),
      output: { codeSplitting: false }
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
