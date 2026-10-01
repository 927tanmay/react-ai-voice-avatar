/**
 * test-worker-contract.mjs
 *
 * WHAT THIS DOES, AND WHAT IT DOES NOT
 *
 * The engine talks to its workers through `postMessage`, so the two sides agree
 * on nothing but a string. Rename `'loadLocalLlm'` on one side and TypeScript
 * says nothing, the build passes, and the feature stops working in a way no
 * suite here would notice — the hooks are verified by hand in a browser.
 *
 * These tests read the source and check that both ends still name the same
 * messages and fields. That is all. They do not run a worker, download a model
 * or prove that loading works: that was verified by hand, watching the hand-over
 * fire in Chrome. What they catch is the realistic regression — one side of a
 * conversation being renamed or removed during a refactor.
 *
 * Run: node scripts/test-worker-contract.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const worker = read('src/workers/mlPipeline.worker.ts');
const mlHook = read('src/hooks/useMLWorker.ts');
const engine = read('src/hooks/useAiVoiceAvatar.ts');
const component = read('src/components/AiVoiceAvatar.tsx');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nLoading a local model after startup skipped it');
check(
  'the worker handles loadLocalLlm',
  /type === 'loadLocalLlm'/.test(worker)
);
check(
  'the hook sends that exact message',
  /type: 'loadLocalLlm'/.test(mlHook)
);
check(
  'the worker answers with localLlmReady',
  /type: 'localLlmReady'/.test(worker)
);
check(
  'the hook listens for that answer',
  /type === 'localLlmReady'/.test(mlHook)
);
check(
  'and forwards it to onLocalLlmReady',
  /onLocalLlmReady\?\.\(\)/.test(mlHook)
);

console.log('\nThe conversation is carried across');
check(
  'the hook sends the turns the host answered',
  /type: 'loadLocalLlm'[\s\S]{0,200}history/.test(mlHook),
  'loadLocalLlm payload has no history field'
);
check(
  'the worker seeds its history from them',
  /payload\?\.history/.test(worker) && /chatHistory = \[chatHistory\[0\], \.\.\.seed/.test(worker)
);
check(
  'the engine records hosted turns to send',
  /rememberHostedTurn\('user'/.test(engine) && /rememberHostedTurn\('assistant'/.test(engine)
);
check(
  'a model name travels with the request',
  /type: 'loadLocalLlm'[\s\S]{0,200}llmModel/.test(mlHook)
);

console.log('\nThe props reach the engine');
check(
  'the component declares both props',
  /preloadLocalLlm\?: boolean/.test(component) && /onLocalLlmReady\?: \(\) => void/.test(component)
);
check(
  'and passes them down',
  /preloadLocalLlm: props\.preloadLocalLlm/.test(component) &&
    /onLocalLlmReady: props\.onLocalLlmReady/.test(component)
);
check(
  'the engine asks for the download only when told to',
  /if \(!config\.preloadLocalLlm \|\| !isMLReady \|\| !config\.onSubmit\) return;/.test(engine)
);
check(
  'and asks once',
  /preloadRequestedRef\.current = true/.test(engine)
);

console.log('\nA model that could not be kept is reported, not fatal');
const kokoroWorker = read('src/workers/kokoroTts.worker.ts');
const kokoroHook = read('src/hooks/useKokoroWorker.ts');
check(
  'both workers install the OPFS cache',
  /env\.customCache = createModelCache/.test(worker) && /transformersEnv\.customCache = createModelCache/.test(kokoroWorker)
);
check(
  'both workers report a failed save as modelStorage',
  /type: 'modelStorage'/.test(worker) && /type: 'modelStorage'/.test(kokoroWorker)
);
check(
  'both hooks listen for it',
  /type === 'modelStorage'/.test(mlHook) && /type === 'modelStorage'/.test(kokoroHook)
);
check(
  'and neither sends it down the error path, which abandons the voice or fails the turn',
  !/type === 'modelStorage'[\s\S]{0,120}onError/.test(mlHook) &&
    !/type === 'modelStorage'[\s\S]{0,120}onError/.test(kokoroHook)
);
check(
  'the engine reports it as degraded',
  (engine.match(/onModelStorageFailed: msg => reportError\('model-storage', [^)]*'degraded'\)/g) || []).length === 2
);

console.log('\nThe local model is still skipped when a host supplies replies');
check(
  'loadLlm follows onSubmit',
  /loadLlm: !config\.onSubmit/.test(engine)
);
check(
  'and the worker honours it',
  /payload\.loadLlm !== false/.test(worker)
);

console.log('\nLocal speech models are skipped when a host supplies its own');
check(
  'the engine tells the worker whether it needs recognition and the voice',
  /loadAsr: needsLocalAsr/.test(engine) && /loadTts: needsLocalVoice/.test(engine)
);
check(
  'and derives both from the adapters',
  /needsLocalAsr = !config\.onTranscribe/.test(engine) && /needsLocalVoice = !config\.onSynthesize/.test(engine)
);
check(
  'Kokoro is not loaded for a host that synthesises, unless asked to preload',
  /enabled: loadModels && activeTtsEngine === 'kokoro' && \(needsLocalVoice \|\| preloadSpeech\)/.test(engine)
);
check(
  'the init message carries both flags',
  /loadAsr: configRef\.current\.loadAsr/.test(mlHook) && /loadTts: configRef\.current\.loadTts/.test(mlHook)
);
check(
  'the worker reads them',
  /payload\.loadAsr !== false/.test(worker) && /payload\.loadTts !== false/.test(worker)
);
check(
  'a later change is sent as localModels',
  /type: 'localModels'/.test(mlHook) && /type === 'localModels'/.test(worker)
);
check(
  'with the field names the worker reads',
  /asr: config\.loadAsr !== false/.test(mlHook) && /tts: config\.loadTts !== false/.test(mlHook) &&
    /payload\.asr !== false/.test(worker) && /payload\.tts !== false/.test(worker)
);

console.log('\nLocal speech can be preloaded behind the adapters');
check(
  'the worker announces recognition and the MMS voice once loaded',
  /type: 'localAsrReady'/.test(worker) && /type: 'localTtsReady'/.test(worker)
);
check(
  'the hook listens for both',
  /type === 'localAsrReady'/.test(mlHook) && /type === 'localTtsReady'/.test(mlHook)
);
check(
  'a preload asks for both through localModels',
  /asr: config\.loadAsr !== false \|\| !!config\.preloadSpeech/.test(mlHook) &&
    /tts: config\.loadTts !== false \|\| !!config\.preloadSpeech/.test(mlHook)
);

console.log('\nAudio from an interrupted turn is dropped');
check(
  'both hooks send their turn with every request that produces speech',
  /payload: \{ text, isLast, turn: turnRef\.current \}/.test(kokoroHook) &&
    /payload: \{ text, skipLlm, turn: turnRef\.current \}/.test(mlHook) &&
    /payload: \{ text, isLast, turn: turnRef\.current \}/.test(mlHook)
);
check(
  'both workers echo it with the audio',
  /turn: item\.turn/.test(kokoroWorker) && /turn: item\.turn/.test(worker)
);
check(
  'both hooks advance it on interrupt and drop audio from an older turn',
  /turnRef\.current \+= 1/.test(kokoroHook) && /turnRef\.current \+= 1/.test(mlHook) &&
    /isStale\(payload\)/.test(kokoroHook) && /payload\.turn !== turnRef\.current/.test(mlHook)
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
