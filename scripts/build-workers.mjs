import * as esbuild from 'esbuild';
import fs from 'fs/promises';

const nodeBuiltins = [
  'fs', 'path', 'crypto', 'os', 'url', 'module', 'worker_threads', 'perf_hooks',
  'child_process', 'util', 'events', 'stream', 'buffer', 'assert', 'tty', 'net',
  'http', 'https', 'zlib', 'querystring', 'node:fs', 'node:path', 'node:os',
  'node:crypto', 'node:url', 'node:module', 'node:worker_threads', 'node:child_process'
];

// Stub Node.js built-ins to prevent bundling or browser resolution errors
const stubNodeBuiltinsPlugin = {
  name: 'stub-node-builtins',
  setup(build) {
    build.onResolve({ filter: new RegExp(`^(${nodeBuiltins.join('|')})$`) }, (args) => {
      return { path: args.path, namespace: 'stub-node' };
    });
    build.onLoad({ filter: /.*/, namespace: 'stub-node' }, () => {
      return {
        contents: 'export default {}; export const promises = {};',
        loader: 'js',
      };
    });
  }
};

// Prevent base64 inlining of ONNX Runtime WASM assets by rewriting URL constructors to CDN links
const ignoreWasmPlugin = {
  name: 'ignore-wasm',
  setup(build) {
    build.onLoad({ filter: /\.(js|mjs|cjs|ts)$/ }, async (args) => {
      if (args.path.includes('onnxruntime-web') || args.path.includes('transformers') || args.path.includes('kokoro') || args.path.includes('phonemizer')) {
        let code = await fs.readFile(args.path, 'utf8');
        if (code.includes('.wasm')) {
          code = code.replace(/new\s+URL\(\s*['"]([^'"]+\.wasm)['"]\s*,\s*import\.meta\.url\s*\)/g, (_, wasmFile) => {
            return `new (globalThis.URL || URL)(${JSON.stringify(wasmFile)}, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/").href`;
          });
          return { contents: code, loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
        }
      }
      return null;
    });
  }
};

async function build() {
  console.log('[Esbuild] Pre-bundling workers to ensure Emscripten initialization order...');
  await fs.mkdir('dist/assets', { recursive: true });
  
  await esbuild.build({
    entryPoints: ['src/workers/kokoroTts.worker.ts'],
    outfile: 'dist/assets/kokoroTts.worker.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    minify: true,
    plugins: [stubNodeBuiltinsPlugin, ignoreWasmPlugin],
  });

  await esbuild.build({
    entryPoints: ['src/workers/mlPipeline.worker.ts'],
    outfile: 'dist/assets/mlPipeline.worker.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    minify: true,
    plugins: [stubNodeBuiltinsPlugin, ignoreWasmPlugin],
  });

  // Remove @vite-ignore comments from the published library so consumer bundlers (Vite/Webpack)
  // properly recognize and copy the pre-bundled worker assets into their production outputs.
  for (const file of ['dist/index.js', 'dist/index.cjs']) {
    try {
      let content = await fs.readFile(file, 'utf8');
      content = content.replace(/\/\*\s*@vite-ignore\s*\*\//g, '');
      await fs.writeFile(file, content, 'utf8');
    } catch {
      // Ignore if file doesn't exist
    }
  }

  console.log('[Esbuild] Workers successfully pre-bundled and consumer asset links cleaned!');
}

build().catch((err) => {
  console.error('[Esbuild] Error building workers:', err);
  process.exit(1);
});
