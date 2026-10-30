/**
 * measure-adapter-latency.mjs — how much sooner the reply is heard with the
 * streaming adapters, against stand-in providers with fixed delays.
 *
 * Drives sandbox/e2e/adapter-latency.html in Chromium, feeding
 * tests/fixtures/ptt-question.wav through a fake microphone, and times each
 * turn from the end of the user's speech, measured on the microphone, to the
 * first sound of the reply. The providers are the same in every run, so the
 * differences are how the hook uses them: the silence timer or the provider
 * ending the turn, a sentence's voice whole or streamed, text or a speech
 * reply. Real providers differ; the stand-in figures are printed with the
 * results so you can substitute your own.
 *
 * Starts the sandbox dev server unless one is already on --url.
 *
 *   node scripts/measure-adapter-latency.mjs [--turns 4] [--url http://localhost:5173]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const TURNS = Number(arg('turns', 4));
const BASE = arg('url', 'http://localhost:5173');
const root = resolve(import.meta.dirname, '..');

/**
 * The test question, 0.4 s to 1.9 s into the file, with quiet after it long
 * enough for the slowest reply to finish before the loop asks again.
 */
function paddedQuestion(padSeconds = 12) {
  const wav = readFileSync(join(root, 'tests/fixtures/ptt-question.wav'));
  const at = wav.indexOf('data');
  const pcm = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  const data = Buffer.concat([pcm, Buffer.alloc(16000 * 2 * padSeconds)]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const out = join(mkdtempSync(join(tmpdir(), 'rava-adapter-latency-')), 'question.wav');
  writeFileSync(out, Buffer.concat([h, data]));
  return out;
}

async function reachable(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

/** The sandbox's dev server, started here if it is not already running. */
async function ensureServer() {
  if (await reachable(BASE)) return null;
  const server = spawn('npm', ['run', 'dev'], { cwd: join(root, 'sandbox'), stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) {
    if (await reachable(BASE)) return server;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`The sandbox dev server did not come up on ${BASE}`);
}

const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const ms = x => (Number.isFinite(x) ? `${Math.round(x)} ms` : '—');

async function measure(query, question) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${question}`],
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/e2e/adapter-latency.html?${query}`);
  await page.waitForFunction(() => window.__status === 'idle', null, { timeout: 60_000 });
  await page.evaluate(() => window.__start());
  await page.waitForFunction(n => window.__turns.filter(t => t.audio).length >= n, TURNS + 1, { timeout: (TURNS + 2) * 20_000, polling: 250 });
  // The first turn starts before the microphone has heard a whole loop.
  const turns = (await page.evaluate(() => window.__turns)).filter(t => t.audio).slice(1, TURNS + 1);
  const provider = await page.evaluate(() => window.__provider);
  await browser.close();
  return { turns, provider };
}

const SCENARIOS = [
  { query: 'stt=batch&voice=whole&reply=text', label: 'Batch: onTranscribe, onSubmit text, onSynthesize whole' },
  { query: 'stt=batch&voice=stream&reply=text', label: '+ streamed voice' },
  { query: 'stt=stream&voice=stream&reply=text', label: '+ streaming speech-to-text' },
  { query: 'stt=stream&reply=speech', label: 'Streaming speech-to-text + speech reply' },
];

const server = await ensureServer();
const question = paddedQuestion();
const rows = [];
let provider;
try {
  for (const s of SCENARIOS) {
    const result = await measure(s.query, question);
    provider = result.provider;
    const t = result.turns;
    rows.push({
      ...s, n: t.length,
      total: median(t.map(x => x.audio - x.speechEnd)),
      decide: median(t.map(x => x.decided - x.speechEnd)),
      transcript: median(t.map(x => x.transcript - x.decided)),
      reply: median(t.map(x => x.audio - x.transcript)),
      // The hook's own share between the providers' answers.
      toVoice: median(t.map(x => x.synthAsked - x.firstSentence)),
      toSpeaker: median(t.map(x => x.audio - x.synthAudio)),
    });
  }
} finally {
  if (server) process.kill(-server.pid);
}

console.log(`\nMedian of ${TURNS} turns each, from the end of speech on the microphone to the first sound of the reply.`);
console.log('Stand-in providers (not measurements of any real one):');
console.log(`  speech-to-text: ${provider.sttBatchMs} ms per clip, or streaming with a ${provider.sttEndpointMs} ms endpoint + ${provider.sttNetworkMs} ms network`);
console.log(`  model: first token ${provider.llmFirstTokenMs} ms, then a word every ${provider.llmMsPerWord} ms`);
console.log(`  voice: first audio ${provider.ttsFirstAudioMs} ms, ${provider.ttsSpeed}x real time; speech reply: first audio ${provider.speechFirstAudioMs} ms\n`);
console.log('Setup                                                  | Heard after | Turn decided | Transcript | Transcript to sound');
for (const r of rows) {
  console.log(`${r.label.padEnd(54)} | ${ms(r.total).padEnd(11)} | ${ms(r.decide).padEnd(12)} | ${ms(r.transcript).padEnd(10)} | ${ms(r.reply)}`);
}
console.log('\nThe hook between providers: first sentence written to the voice asked, and the voice\'s audio to it playing.');
for (const r of rows.filter(r => Number.isFinite(r.toVoice))) {
  console.log(`${r.label.padEnd(54)} | ${ms(r.toVoice).padEnd(8)} | ${ms(r.toSpeaker)}`);
}
