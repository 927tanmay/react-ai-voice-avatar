/**
 * measure-latency.mjs — how long from when you stop talking to the first word
 * of the reply, stage by stage.
 *
 * Drives sandbox/e2e/latency.html in Chromium with WebGPU, feeding a spoken
 * question through a fake microphone, and times each turn with the hook's own
 * callbacks. Three reply modes: a canned reply, which isolates speech
 * recognition and the voice, and the in-browser language model asked for one
 * sentence and for three. For the model it also reports time to first token,
 * when the first sentence was written and handed to the voice, and tokens per
 * second, read from the worker's own token stream. With --hosted it also times
 * the live demo's hosted reply route.
 *
 * Needs the sandbox dev server running (cd sandbox && npm run dev) and, on
 * macOS, generates the question with `say`; elsewhere pass --audio with a
 * 16 kHz mono WAV of a short question. The first run downloads the models.
 *
 *   node scripts/measure-latency.mjs [--turns 5] [--audio question.wav] [--profile dir] [--hosted]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const TURNS = Number(arg('turns', 5));
const BASE = arg('url', 'http://localhost:5173');
// A persistent profile, so the models stay stored between runs.
const PROFILE = arg('profile', join(tmpdir(), 'rava-latency-profile'));
const work = mkdtempSync(join(tmpdir(), 'rava-latency-'));

/** The question, padded with silence so each loop of the fake mic is one turn. */
function questionWav(question, padSeconds = 8) {
  let src = arg('audio');
  if (!src) {
    src = join(work, `said-${question.length}.wav`);
    execFileSync('say', ['-o', src, '--data-format=LEI16@16000', question]);
  }
  const wav = readFileSync(src);
  const at = wav.indexOf('data');
  const pcm = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  const data = Buffer.concat([pcm, Buffer.alloc(16000 * 2 * padSeconds)]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const out = join(work, `question-${question.length}.wav`);
  writeFileSync(out, Buffer.concat([h, data]));
  return out;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const ms = x => (Number.isFinite(x) ? `${Math.round(x)} ms` : '—');

async function measure(reply, question) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${question}`],
  });
  await ctx.grantPermissions(['microphone'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/e2e/latency.html?reply=${reply}`);
  const gpu = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    return a ? [a.info?.vendor, a.info?.architecture].filter(Boolean).join(' ') : 'none';
  });
  await page.waitForFunction(() => window.__status === 'idle', null, { timeout: 30 * 60 * 1000, polling: 500 });
  await page.evaluate(() => window.__start());
  await page.waitForFunction(n => window.__turns.filter(t => t.audio).length >= n, TURNS + 1, { timeout: TURNS * 60000, polling: 250 });
  // The first turn warms every model's shaders and is not what anyone hears after.
  const turns = (await page.evaluate(() => window.__turns)).filter(t => t.audio).slice(1, TURNS + 1);
  await ctx.close();
  return { gpu, turns };
}

// A 0.5B model answers a factual question in one sentence whatever the system
// prompt says, so the longer reply is asked for out loud. That is the turn
// where the first sentence reaches the voice while the rest is still written.
const SHORT = 'What is the capital of France?';
const LONG = 'Tell me three things about Paris.';
const MODES = [
  { reply: 'fixed', question: SHORT, label: 'canned reply (no model)' },
  { reply: 'local', question: SHORT, label: 'Qwen 0.5B, short answer' },
  // Room for the whole reply to play before the question loops, so no turn
  // starts while the last one's voice is still working.
  { reply: 'local&sentences=3', question: LONG, pad: 30, label: 'Qwen 0.5B, longer answer' },
];
const rows = [];
for (const mode of MODES) {
  const { gpu, turns } = await measure(mode.reply, questionWav(mode.question, mode.pad));
  const model = turns.filter(t => t.firstToken !== undefined);
  rows.push({
    ...mode, gpu, n: turns.length,
    heard: turns.find(t => t.text)?.text ?? '',
    said: model.find(t => t.replyText)?.replyText ?? '',
    transcribe: median(turns.map(t => t.transcript - t.end)),
    toAudio: median(turns.map(t => t.audio - t.transcript)),
    total: median(turns.map(t => t.audio - t.end)),
    // The language model, timed from the transcript it was given.
    ttft: median(model.map(t => t.firstToken - t.transcript)),
    firstSentence: median(model.map(t => t.firstSentence - t.transcript)),
    tps: median(model.filter(t => t.tokens > t.firstTokens && t.lastToken > t.firstText)
      .map(t => ((t.tokens - t.firstTokens) / (t.lastToken - t.firstText)) * 1000)),
    tokens: median(model.map(t => t.tokens)),
    sentenceChars: median(model.map(t => t.firstSentenceText?.trim().length)),
    // From the first sentence being handed over to it playing: the voice alone.
    voice: median(model.map(t => t.audio - t.firstSentence)),
  });
}

console.log(`\nMedian of ${TURNS} turns after a warm-up turn. GPU: ${rows[0].gpu}.`);
for (const r of rows) console.log(`${r.label}: heard "${r.heard.trim()}"`);
console.log('The voice detector first waits redemptionMs (1400 ms by default) of silence; add that for the full gap.\n');
console.log('Reply                        | Transcribe | Reply + first sentence of voice | End of turn to first word');
for (const r of rows) {
  console.log(`${r.label.padEnd(28)} | ${ms(r.transcribe).padEnd(10)} | ${ms(r.toAudio).padEnd(31)} | ${ms(r.total)}`);
}
console.log('\nThe model, from the transcript: time to first token, first sentence written, then the voice on that sentence.');
console.log('Reply                        | TTFT     | First sentence | Tokens/s | Tokens | Voice on first sentence (its length)');
for (const r of rows.filter(r => r.reply !== 'fixed')) {
  const tps = Number.isFinite(r.tps) ? `${Math.round(r.tps)}` : '—';
  console.log(`${r.label.padEnd(28)} | ${ms(r.ttft).padEnd(8)} | ${ms(r.firstSentence).padEnd(14)} | ${tps.padEnd(8)} | ${String(r.tokens ?? '—').padEnd(6)} | ${ms(r.voice)} (${r.sentenceChars} chars)`);
}
for (const r of rows.filter(r => r.said)) console.log(`\n${r.label} said: "${r.said.trim()}"`);

if (args.includes('--hosted')) {
  // The live route answers only its own origin, so it is timed directly.
  const times = [];
  let model = '';
  for (let i = 0; i < TURNS; i++) {
    const t0 = performance.now();
    const res = await fetch('https://react-ai-voice-avatar.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://react-ai-voice-avatar.vercel.app' },
      body: JSON.stringify({ text: 'What is the capital of France?', history: [] }),
    });
    const body = await res.json();
    if (!res.ok) { console.log(`hosted route: ${res.status} ${JSON.stringify(body)}`); break; }
    times.push(performance.now() - t0);
    model = body.model;
  }
  if (times.length) console.log(`\nHosted reply (${model}, from this network): median ${ms(median(times))} over ${times.length} calls`);
}
