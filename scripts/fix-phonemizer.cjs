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

const candidatePaths = [
  path.resolve(__dirname, '../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../sandbox/node_modules/phonemizer/dist/phonemizer.js'),
];

candidatePaths.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('A.__espeakDataLoaded=true')) {
      console.log(`[fix-phonemizer] Already patched with filesystem readiness check: ${filePath}`);
      return;
    }
    let patched = false;
    if (content.includes(targetData) && content.includes(targetNe)) {
      content = content.replace(targetData, repData).replace(targetNe, repNe);
      patched = true;
    } else {
      // Handle fallback or partial matches if needed
      if (content.includes(targetData) && !content.includes(repData)) {
        content = content.replace(targetData, repData);
        patched = true;
      }
      if (content.includes(targetNe) && !content.includes(repNe)) {
        content = content.replace(targetNe, repNe);
        patched = true;
      }
    }

    if (patched) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[fix-phonemizer] Successfully injected Emscripten filesystem readiness patch into: ${filePath}`);
    } else {
      console.warn(`[fix-phonemizer] Target strings not matched in ${filePath} (may already be updated or custom format)`);
    }
  } catch (err) {
    console.error(`[fix-phonemizer] Error processing ${filePath}:`, err);
  }
});
