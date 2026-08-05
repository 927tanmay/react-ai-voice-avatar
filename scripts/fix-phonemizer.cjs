const fs = require('fs');
const path = require('path');

/**
 * fix-phonemizer.cjs
 * 
 * Solves Emscripten microtask race conditions when phonemizer is bundled by Vite/Rollup for web workers.
 * In production builds (e.g. on Vercel), Emscripten's asynchronous DecompressionStream("gzip") loop
 * finishes extracting eSpeak-NG voice dictionaries moments after onRuntimeInitialized fires.
 * If new eSpeakNGWorker() or list_voices() is invoked before the virtual filesystem is fully populated,
 * eSpeak-NG's C library caches an empty static voice array into memory permanently, throwing:
 * 'Invalid language identifier: "en-us". Should be one of: .'
 * 
 * This script injects a filesystem readiness flag (A.__espeakDataLoaded = true) at the end of the data
 * extraction loop and defers constructing eSpeakNGWorker until that flag resolves.
 */

const targetData = `A.removeRunDependency("datafile_js/espeakng.worker.data")}`;
const repData = `A.removeRunDependency("datafile_js/espeakng.worker.data");A.__espeakDataLoaded=true}`;

const targetNe = `const ne=new Promise((e=>{A.calledRun?e(new A.eSpeakNGWorker):A.onRuntimeInitialized=()=>e(new A.eSpeakNGWorker)}))`;
const repNe = `const ne=new Promise((async e=>{while(!A.__espeakDataLoaded){await new Promise(r=>setTimeout(r,10));}A.calledRun?e(new A.eSpeakNGWorker):A.onRuntimeInitialized=()=>e(new A.eSpeakNGWorker)}))`;

const targetCe = `ce=async(A,e="en-us")=>{const g=await ne,{identifiers:r}=await oe;if(!r.has(e))throw new Error(\`Invalid language identifier: "\${e}". Should be one of: \${Array.from(r).toSorted().join(", ")}.\`);`;
const repCe = `ce=async(A,e="en-us")=>{const g=await ne,{identifiers:r}=await oe;if(!r.has(e)){try{for(const v of g.list_voices()){if(v.identifier)r.add(v.identifier);if(v.languages){for(const l of v.languages)if(l.name)r.add(l.name);}}}catch(_){}r.add("en-us");r.add("en");r.add("us");}if(!r.has(e))throw new Error(\`Invalid language identifier: "\${e}". Should be one of: \${Array.from(r).toSorted().join(", ")}.\`);`;

const rawCandidatePaths = [
  path.resolve(__dirname, '../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../sandbox/node_modules/phonemizer/dist/phonemizer.js'),
];

// 1. Try native Node module resolution
try {
  rawCandidatePaths.push(require.resolve('phonemizer/dist/phonemizer.js'));
} catch (e) {}

// 2. Try resolving relative to kokoro-js (nested node_modules)
try {
  const kokoroPath = require.resolve('kokoro-js');
  let dir = path.dirname(kokoroPath);
  while (dir && dir !== path.parse(dir).root) {
    rawCandidatePaths.push(path.join(dir, 'node_modules/phonemizer/dist/phonemizer.js'));
    dir = path.dirname(dir);
  }
} catch (e) {}

// 3. Walk upwards from __dirname and check pnpm virtual stores (crucial for Vercel/pnpm builds)
let currentDir = __dirname;
while (currentDir && currentDir !== path.parse(currentDir).root) {
  rawCandidatePaths.push(path.join(currentDir, 'node_modules/phonemizer/dist/phonemizer.js'));
  rawCandidatePaths.push(path.join(currentDir, 'node_modules/kokoro-js/node_modules/phonemizer/dist/phonemizer.js'));
  
  const pnpmDir = path.join(currentDir, 'node_modules/.pnpm');
  if (fs.existsSync(pnpmDir)) {
    try {
      const entries = fs.readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.includes('phonemizer')) {
          rawCandidatePaths.push(path.join(pnpmDir, entry, 'node_modules/phonemizer/dist/phonemizer.js'));
        }
      }
    } catch (e) {}
  }
  currentDir = path.dirname(currentDir);
}

const candidatePaths = Array.from(new Set(rawCandidatePaths.map(p => path.normalize(p))));
let patchedCount = 0;

candidatePaths.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let patched = false;

    // 1. Data load flag injection
    if (content.includes(targetData) && !content.includes(repData)) {
      content = content.replace(targetData, repData);
      patched = true;
    }

    // 2. eSpeakNGWorker construction deferral
    if (content.includes(targetNe) && !content.includes(repNe)) {
      content = content.replace(targetNe, repNe);
      patched = true;
    }

    // 3. Dynamic voice recovery patch for ce/phonemize
    if (content.includes(targetCe) && !content.includes(repCe)) {
      content = content.replace(targetCe, repCe);
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[fix-phonemizer] Successfully injected Emscripten filesystem readiness & voice recovery patch into: ${filePath}`);
      patchedCount++;
    } else if (content.includes('__espeakDataLoaded=true') && content.includes('r.add("en-us")')) {
      console.log(`[fix-phonemizer] Already fully patched: ${filePath}`);
      patchedCount++;
    }
  } catch (err) {
    console.error(`[fix-phonemizer] Error processing ${filePath}:`, err);
  }
});

if (patchedCount === 0) {
  console.warn('[fix-phonemizer] Warning: Could not find or patch any phonemizer.js file across candidate paths.');
}
