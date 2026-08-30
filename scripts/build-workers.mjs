import * as esbuild from 'esbuild';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';

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

async function getOrtVersion(filePath) {
  let dir = path.dirname(filePath);
  while (dir !== '/' && dir !== '.' && dir.length > 3) {
    const pkgPath = path.join(dir, 'node_modules', 'onnxruntime-web', 'package.json');
    try {
      const stat = await fs.stat(pkgPath);
      if (stat.isFile()) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        return pkg.version;
      }
    } catch (_) {}
    
    // Also check if dir itself is onnxruntime-web
    if (dir.endsWith('onnxruntime-web')) {
      const directPkgPath = path.join(dir, 'package.json');
      try {
        const stat = await fs.stat(directPkgPath);
        if (stat.isFile()) {
          const pkg = JSON.parse(await fs.readFile(directPkgPath, 'utf8'));
          return pkg.version;
        }
      } catch (_) {}
    }
    dir = path.dirname(dir);
  }
  return '1.29.0'; // Default fallback
}

// Prevent base64 inlining of ONNX Runtime WASM assets by rewriting URL constructors to CDN links
const ignoreWasmPlugin = {
  name: 'ignore-wasm',
  setup(build) {
    build.onLoad({ filter: /\.(js|mjs|cjs|ts)$/ }, async (args) => {
      if (args.path.includes('onnxruntime-web') || args.path.includes('transformers') || args.path.includes('kokoro') || args.path.includes('phonemizer')) {
        let code = await fs.readFile(args.path, 'utf8');
        if (code.includes('.wasm')) {
          const ortVersion = await getOrtVersion(args.path);
          code = code.replace(/new\s+URL\(\s*['"]([^'"]+\.wasm)['"]\s*,\s*import\.meta\.url\s*\)/g, (_, wasmFile) => {
            return `new (globalThis.URL || URL)(${JSON.stringify(wasmFile)}, "https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/").href`;
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

  // Post-process the compiled worker files to apply the promise chain rejection fix
  for (const file of ['dist/assets/kokoroTts.worker.js', 'dist/assets/mlPipeline.worker.js']) {
    let workerCode = await fs.readFile(file, 'utf8');
    workerCode = workerCode.replace(/(\w+)\s*=\s*\1\s*\.\s*then\s*\(\s*(\w+)\s*\)/g, (match, chainVar, callbackVar) => {
      console.log(`[Esbuild Worker Post-Process] Applied rejection recovery to promise chain: ${chainVar} in ${file}`);
      return `${chainVar}=${chainVar}.then(${callbackVar}).catch(err=>{${chainVar}=Promise.resolve();throw err;})`;
    });
    await fs.writeFile(file, workerCode, 'utf8');
  }

  // Build-time asset validation and SHA-256 generation
  const kokoroBuffer = await fs.readFile('dist/assets/kokoroTts.worker.js');
  const mlBuffer = await fs.readFile('dist/assets/mlPipeline.worker.js');
  
  const kokoroHash = crypto.createHash('sha256').update(kokoroBuffer).digest('hex');
  const mlHash = crypto.createHash('sha256').update(mlBuffer).digest('hex');

  console.log(`[Esbuild Verification] Kokoro Worker -> Size: ${kokoroBuffer.length} bytes | SHA-256: ${kokoroHash}`);
  console.log(`[Esbuild Verification] ML Pipeline Worker -> Size: ${mlBuffer.length} bytes | SHA-256: ${mlHash}`);

  if (kokoroBuffer.length < 2000000) {
    throw new Error(`Build failure: Kokoro worker size (${kokoroBuffer.length} bytes) is unusually small (<2MB). Emscripten dependencies may not have bundled correctly.`);
  }

  // Convert worker output to TypeScript string modules for zero-config blob loading
  const kokoroCodeStr = kokoroBuffer.toString('utf8') + '\n//# sourceURL=kokoroTts.worker.js\n';
  const mlCodeStr = mlBuffer.toString('utf8') + '\n//# sourceURL=mlPipeline.worker.js\n';

  await fs.mkdir('src/workers/generated', { recursive: true });
  await fs.writeFile('src/workers/generated/kokoroTts.worker.code.ts', `export const kokoroWorkerCode: string = ${JSON.stringify(kokoroCodeStr)};`);
  await fs.writeFile('src/workers/generated/mlPipeline.worker.code.ts', `export const mlWorkerCode: string = ${JSON.stringify(mlCodeStr)};`);

  console.log('[Esbuild] Workers successfully pre-bundled and stringified into src/workers/generated/ !');
}

build().catch((err) => {
  console.error('[Esbuild] Error building workers:', err);
  process.exit(1);
});
