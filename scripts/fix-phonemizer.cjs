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
    if (content.includes('__espeakDataLoaded=true')) {
      console.log(`[fix-phonemizer] Already patched with filesystem readiness check: ${filePath}`);
      patchedCount++;
      return;
    }
    let patched = false;
    if (content.includes(targetData) && content.includes(targetNe)) {
      content = content.replace(targetData, repData).replace(targetNe, repNe);
      patched = true;
    } else {
      // Try exact or regex fallback matching
      if (content.includes(targetData) && !content.includes(repData)) {
        content = content.replace(targetData, repData);
        patched = true;
      } else {
        const regexData = /([a-zA-Z0-9_$]+)\.removeRunDependency\("datafile_js\/espeakng\.worker\.data"\)\}/;
        const matchData = content.match(regexData);
        if (matchData) {
          content = content.replace(matchData[0], `${matchData[1]}.removeRunDependency("datafile_js/espeakng.worker.data");${matchData[1]}.__espeakDataLoaded=true}`);
          patched = true;
        }
      }
      if (content.includes(targetNe) && !content.includes(repNe)) {
        content = content.replace(targetNe, repNe);
        patched = true;
      } else {
        const regexNe = /const ([a-zA-Z0-9_$]+)=new Promise\(\(([a-zA-Z0-9_$]+)=>\{([a-zA-Z0-9_$]+)\.calledRun\?[a-zA-Z0-9_$]+\(new \3\.eSpeakNGWorker\):\3\.onRuntimeInitialized=\(\)=>[a-zA-Z0-9_$]+\(new \3\.eSpeakNGWorker\)\}\)\)/;
        const matchNe = content.match(regexNe);
        if (matchNe) {
          const varProm = matchNe[1];
          const varRes = matchNe[2];
          const varMod = matchNe[3];
          const replacement = `const ${varProm}=new Promise((async ${varRes}=>{while(!${varMod}.__espeakDataLoaded){await new Promise(r=>setTimeout(r,10));}${varMod}.calledRun?${varRes}(new ${varMod}.eSpeakNGWorker):${varMod}.onRuntimeInitialized=()=>${varRes}(new ${varMod}.eSpeakNGWorker)}))`;
          content = content.replace(matchNe[0], replacement);
          patched = true;
        }
      }
    }

    if (patched) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[fix-phonemizer] Successfully injected Emscripten filesystem readiness patch into: ${filePath}`);
      patchedCount++;
    } else {
      console.warn(`[fix-phonemizer] Target strings not matched in ${filePath} (may already be updated or custom format)`);
    }
  } catch (err) {
    console.error(`[fix-phonemizer] Error processing ${filePath}:`, err);
  }
});

if (patchedCount === 0) {
  console.warn('[fix-phonemizer] Warning: Could not find or patch any phonemizer.js file across candidate paths.');
}
