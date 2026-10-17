import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { DEFAULT_ONNX_WASM_PATH } from './src/lib/onnxRuntime';

// Plugin to prevent Vite from converting static .wasm URL references into base64 data URIs in bundled workers
const excludeOnnxWasmPlugin = () => ({
  name: 'exclude-onnx-wasm',
  enforce: 'pre' as const,
  transform(code: string) {
    if (code.includes('.wasm')) {
      return {
        code: code.replace(/new\s+URL\(\s*['"]([^'"]+\.wasm)['"]\s*,\s*import\.meta\.url\s*\)/g, (_, wasmFile) => {
          return `new (globalThis.URL || URL)(${JSON.stringify(wasmFile)}, ${JSON.stringify(DEFAULT_ONNX_WASM_PATH)}).href`;
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
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        // Second entry so consumers who only want the voice loop never resolve
        // a module that imports three.js. See src/headless.ts.
        headless: resolve(import.meta.dirname, 'src/headless.ts'),
        // Third, so a model of the host's own can use the engine's model storage
        // from inside a worker. See src/model-cache.ts.
        'model-cache': resolve(import.meta.dirname, 'src/model-cache.ts'),
      },
      name: 'ReactAiVoiceAvatar',
      formats: ['es'],
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
