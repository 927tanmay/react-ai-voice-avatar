/**
 * Checks that model download progress only ever moves forward.
 *
 * The event sequences here are the shapes transformers.js actually emits: one
 * callback per file, interleaved, with files discovered while others are
 * already partway through. The first case is the one seen live in the demo,
 * where speech recognition read 67% and then 60%.
 *
 * Run with: node --experimental-strip-types scripts/test-download-progress.mjs
 */
import { createDownloadProgress } from '../src/lib/downloadProgress.ts';

/** Feed events through a fresh aggregator and collect every figure it reports. */
function replay(events) {
  const reports = [];
  const onEvent = createDownloadProgress(pct => reports.push(pct));
  for (const event of events) onEvent(event);
  return reports;
}

const MB = 1024 * 1024;
const progress = (file, loaded, total) => ({ status: 'progress', file, loaded, total });

/**
 * Emit events the way transformers.js 4.x does: it learns every file's size up
 * front, then sends a running total alongside each per-file event.
 */
function withTotals(sizes, steps) {
  const loaded = Object.fromEntries(Object.keys(sizes).map(f => [f, 0]));
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const events = [];
  for (const [file, bytes] of steps) {
    loaded[file] = bytes;
    const sum = Object.values(loaded).reduce((a, b) => a + b, 0);
    events.push({ status: 'progress_total', progress: (sum / total) * 100, loaded: sum, total });
    events.push(progress(file, bytes, sizes[file]));
  }
  return events;
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const neverDecreases = reports => reports.every((pct, i) => i === 0 || pct > reports[i - 1]);

check('a second file starting does not drag the figure backwards', () => {
  // Encoder two-thirds done, then the decoder begins at 5% of itself.
  const reports = replay([
    progress('encoder.onnx', 20 * MB, 30 * MB),
    progress('decoder.onnx', 2 * MB, 40 * MB),
    progress('decoder.onnx', 30 * MB, 40 * MB),
  ]);
  if (!neverDecreases(reports)) return `went backwards: ${reports.map(r => r.toFixed(1)).join(' -> ')}`;
  return null;
});

check('a finished config does not pin the bar at 99 while the weights download', () => {
  // The bug the first version of this fix had. Configs download before
  // weights, so summing per-file events read a finished 1 KB config as 100% of
  // everything seen, and holding the highest figure then froze the bar at 99%.
  const reports = replay(withTotals(
    { 'config.json': 1024, 'model.onnx': 400 * MB },
    [['config.json', 1024], ['model.onnx', 100 * MB], ['model.onnx', 300 * MB]],
  ));
  if ((reports[0] ?? 0) > 1) return `a 1 KB config reported ${reports[0].toFixed(1)}% of a 400 MB model`;
  if (!neverDecreases(reports)) return `went backwards: ${reports.map(r => r.toFixed(1)).join(' -> ')}`;
  const last = reports.at(-1) ?? 0;
  if (last < 74 || last > 76) return `expected ~75% at 300 of 400 MB, got ${last.toFixed(1)}`;
  return null;
});

check('per-file events are ignored once totals are arriving', () => {
  // A per-file event reading 100% for a small file must not jump the figure.
  const reports = replay([
    { status: 'progress_total', progress: 10, loaded: 40 * MB, total: 400 * MB },
    progress('config.json', 1024, 1024),
  ]);
  if (reports.length !== 1 || reports[0] !== 10) return `reported ${reports.join(', ')}`;
  return null;
});

check('never reports 100 before the caller says loading is complete', () => {
  const reports = replay([
    progress('model.onnx', 400 * MB, 400 * MB),
    { status: 'done', file: 'model.onnx' },
  ]);
  if (reports.some(pct => pct >= 100)) return `reported ${Math.max(...reports)}`;
  if ((reports.at(-1) ?? 0) < 99) return `stopped at ${reports.at(-1)} rather than 99`;
  return null;
});

check('a done event completes a file that stopped short', () => {
  const reports = replay([
    progress('a.onnx', 50 * MB, 100 * MB),
    progress('b.onnx', 100 * MB, 100 * MB),
    { status: 'done', file: 'a.onnx' },
  ]);
  if ((reports.at(-1) ?? 0) < 99) return `ended at ${reports.at(-1)}, expected 99`;
  return null;
});

check('repeated identical events report once', () => {
  const reports = replay([
    progress('model.onnx', 10 * MB, 100 * MB),
    progress('model.onnx', 10 * MB, 100 * MB),
    progress('model.onnx', 10 * MB, 100 * MB),
  ]);
  if (reports.length !== 1) return `reported ${reports.length} times`;
  return null;
});

check('events without a file, or with no size yet, are ignored', () => {
  const reports = replay([
    { status: 'initiate' },
    { status: 'initiate', file: 'model.onnx' },
    null,
    undefined,
  ]);
  if (reports.length !== 0) return `reported ${reports.join(', ')}`;
  return null;
});

check('a loaded count past the total is clamped', () => {
  const reports = replay([progress('model.onnx', 150 * MB, 100 * MB)]);
  if (reports.some(pct => pct > 99)) return `reported ${Math.max(...reports)}`;
  return null;
});

check('a realistic Whisper download climbs steadily and never runs backwards', () => {
  // Small files finish instantly, then the encoder and decoder race.
  const sizes = {
    'config.json': 2000,
    'tokenizer.json': 2 * MB,
    'generation_config.json': 3000,
    'encoder_model.onnx': 80 * MB,
    'decoder_model.onnx': 120 * MB,
  };
  const reports = replay(withTotals(sizes, [
    ['config.json', 2000],
    ['tokenizer.json', 2 * MB],
    ['encoder_model.onnx', 5 * MB],
    ['decoder_model.onnx', 1 * MB],
    ['encoder_model.onnx', 60 * MB],
    ['generation_config.json', 3000],
    ['decoder_model.onnx', 40 * MB],
    ['encoder_model.onnx', 80 * MB],
    ['decoder_model.onnx', 120 * MB],
  ]));
  if (!neverDecreases(reports)) return `went backwards: ${reports.map(r => r.toFixed(1)).join(' -> ')}`;
  if ((reports[0] ?? 0) > 2) return `opened at ${reports[0].toFixed(1)}% after only the small files`;
  if ((reports.at(-1) ?? 0) < 99) return `finished at ${reports.at(-1)}`;
  return null;
});

let failures = 0;
for (const { name, fn } of checks) {
  const problem = fn();
  if (problem) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${problem}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} download-progress check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} download-progress checks passed.`);
