const fs = require('fs');
const path = require('path');

/**
 * fix-phonemizer.cjs
 * 
 * Solves Emscripten microtask race conditions when phonemizer is bundled by Vite/Rollup for web workers.
 * In production builds (e.g. on Vercel), Emscripten's asynchronous DecompressionStream("gzip") loop
 * may finish extracting eSpeak-NG voice dictionaries moments after onRuntimeInitialized fires.
 * Without this patch, phonemizer immediately calls list_voices() on an empty virtual filesystem,
 * permanently caching an empty set of voices and throwing:
 * 'Invalid language identifier: "en-us". Should be one of: .'
 * 
 * This script modifies the one-time promise (oe) to retry checking A.list_voices() until voice files appear.
 */

const targetStrings = [
  'oe=ne.then((A=>{const e=A.list_voices().map((({name:A,identifier:e,languages:g})=>({name:A,identifier:e,languages:g.filter((A=>ke.includes(A.name.split("-")[0])))}))).filter((A=>A.languages.length>0)),g=new Set;for(const A of e){g.add(A.identifier);for(const e of A.languages)g.add(e.name)}return{voices:e,identifiers:g}}))',
];

const replacement = 'oe=ne.then((async A=>{let e=A.list_voices();let idx=0;while(e.length===0&&idx<100){await new Promise(r=>setTimeout(r,50));e=A.list_voices();idx++;}const v=e.map((({name:A,identifier:e,languages:g})=>({name:A,identifier:e,languages:g.filter((A=>ke.includes(A.name.split("-")[0])))}))).filter((A=>A.languages.length>0)),g=new Set;for(const A of v){g.add(A.identifier);for(const e of A.languages)g.add(e.name)}return{voices:v,identifiers:g}}))';

const candidatePaths = [
  path.resolve(__dirname, '../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../../node_modules/phonemizer/dist/phonemizer.js'),
  path.resolve(__dirname, '../sandbox/node_modules/phonemizer/dist/phonemizer.js'),
];

candidatePaths.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('while(e.length===0')) {
      console.log(`[fix-phonemizer] Already patched: ${filePath}`);
      return;
    }
    let patched = false;
    targetStrings.forEach((target) => {
      if (content.includes(target)) {
        content = content.replace(target, replacement);
        patched = true;
      }
    });
    if (patched) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[fix-phonemizer] Successfully patched Emscripten voice loading timing in: ${filePath}`);
    } else {
      console.warn(`[fix-phonemizer] Target string not found in ${filePath} (may already be updated or structured differently)`);
    }
  } catch (err) {
    console.error(`[fix-phonemizer] Error processing ${filePath}:`, err);
  }
});
