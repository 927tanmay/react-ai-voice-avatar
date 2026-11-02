import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar, pcmStream, streamingTranscriber, speechReply } from 'react-ai-voice-avatar/headless';

/**
 * The hook with every stage handed to the host: transcription, replies and
 * the voice. Nothing local is needed, so nothing local should download.
 *
 * State is published on `window.__e2e` for tests/cloud-adapters.spec.ts.
 */
type Probe = {
  statuses: string[];
  synthesized: string[];
  submitted: string[];
  /** How many turns onInferenceEnd has closed. */
  inferenceEnded: number;
  /** Seconds of audio in each call to onTranscribe. */
  heard: number[];
  /** speechMs from each onSubmit. */
  speechMs: (number | undefined)[];
  /** How many times onUserInterrupt fired, and how many had when each onSubmit was called. */
  userInterrupts: number;
  interruptsAtSubmit: number[];
  /** Each piece of the reply as it began to play, from onSpeechStart. */
  played: string[];
  /** How many onSubmit signals have been aborted. */
  aborted: number;
  /** Every onError report, as stage, severity and detail. */
  errors: { stage: string; severity: string; detail?: string }[];
  /** What onTranscriptUpdate announced for the user. */
  userTranscripts: string[];
  /** Seconds of audio in each piece as it began to play. */
  durations: number[];
  /** The message of each onError report. */
  errorMessages: string[];
  /** Streamed voices that yielded their last chunk, and that were closed at all. */
  streamsEnded: number;
  streamsClosed: number;
  /** How many onSynthesize signals have been aborted, and onTranscribe ones. */
  synthAborted: number;
  transcribeAborted: number;
  /** From a streaming transcriber: what onUserPartial got, and its sessions. */
  partials: string[];
  sessionsOpened: number;
  sessionsFinished: number;
  sessionsAborted: number;
  /** Seconds of audio pushed to each session the moment it opened. */
  openingSeconds: number[];
  /** What onTranscriptUpdate announced for the avatar. */
  avatarTranscripts: string[];
  /** Speech replies that yielded their last chunk, and that were closed at all. */
  speechEnded: number;
  speechClosed: number;
  /**
   * Every suspend and resume of an AudioContext, and every status, in order.
   * `ctx` tells the contexts apart: the detector has one of its own.
   */
  audioLog: { kind: 'suspend' | 'resume' | 'status'; ctx?: number; value?: string }[];
  /** What onUnspokenText got, and each call to a ?synthError=fn policy. */
  unspoken: string[];
  policyCalls: { text: string; attempt: number }[];
  ttsEngine?: string;
  localSpeechReady?: boolean;
  sendText?: (text: string) => void;
  speak?: (text: string) => void;
  startListening?: () => Promise<boolean>;
  stopListening?: () => void;
  interrupt?: () => void;
  setMicMuted?: (muted: boolean) => void;
  isMicMuted?: boolean;
  isMicOpen?: boolean;
  /** Unmount the page's component. */
  unmount?: () => void;
  /** Stop supplying transcription and the voice, as a host falling back would. */
  dropSpeechAdapters?: () => void;
};
const probe: Probe = { statuses: [], synthesized: [], submitted: [], inferenceEnded: 0, heard: [], speechMs: [], userInterrupts: 0, interruptsAtSubmit: [], played: [], aborted: 0, errors: [], userTranscripts: [], durations: [], errorMessages: [], streamsEnded: 0, streamsClosed: 0, synthAborted: 0, transcribeAborted: 0, partials: [], sessionsOpened: 0, sessionsFinished: 0, sessionsAborted: 0, openingSeconds: [], avatarTranscripts: [], speechEnded: 0, speechClosed: 0, audioLog: [], unspoken: [], policyCalls: [] };
const params = new URLSearchParams(location.search);
/**
 * ?reply=empty or ?reply=empty-stream: the host answers with nothing.
 * ?reply=stream: three sentences streamed, the first of which the voice is
 * slowest to synthesise. ?reply=stream-fail: the voice fails on the second.
 * ?reply=stream-fail-once: it fails on the second only the first time asked.
 * ?reply=tool: one sentence, then twelve seconds of nothing, as a model calling
 * a tool would, then the answer. ?reply=slow: eight sentences a second and a
 * half apart, numbered by reply, from a host that ignores the signal.
 * ?reply=decimal: a sentence with "72.5" in it, one character at a time.
 * ?reply=bytes: Hindi as raw bytes, cut through the middle of letters, as a
 * ReadableStream. ?reply=bytes-iterator: the same from an async generator.
 * ?reply=response: a fetch Response, returned as it is.
 * ?reply=short: "Sure.", three seconds of nothing, then the answer.
 * ?reply=fail: onSubmit throws.
 * ?reply=barge: two sentences, the first eight seconds long so the user talks
 * over it, the second synthesised only once they do. With ?barge=duck it
 * arrives the moment the reply is ducked, before the sound is known to be
 * speech; with ?barge=decoded, as a WAV file just after the turn is taken.
 * ?reply=speech: a reply that is already audio, as a speech-to-speech model
 * gives: a caption, half a second of tone, a second and a half of nothing,
 * then half a second more with a second caption. ?reply=speech-silent: the
 * same audio with no transcript. ?reply=speech-empty: no chunks at all.
 * ?reply=numbered: three sentences at once, numbered by reply.
 */
const replyMode = params.get('reply');
/**
 * ?llm=<model>: no onSubmit, so the in-browser model answers and the host's
 * onSynthesize speaks. tests/local-llm-host-voice.spec.ts serves a tiny one.
 */
const localLlm = params.get('llm');
/**
 * ?voice=16k: the voice answers with one second of 16 kHz Float32 samples, as
 * { audio, sampleRate }. ?voice=int16: one second of 22.05 kHz Int16 samples.
 * ?voice=bare16k: one second at 16 kHz returned bare, which is taken as 24 kHz.
 * ?voice=stream: streamed, half a second of tone, a second and a half of
 * nothing, then another half second. ?voice=stream-bytes: one second of
 * 22.05 kHz Int16 PCM as bytes cut mid-sample, through pcmStream.
 * ?voice=stream-mp3: MP3 bytes streamed, which cannot be played a piece at a time.
 * ?voice=slow: the tone after 600 ms. ?voice=late: after a second and a half,
 * from a voice that ignores the signal; ?voice=late-fail: the same, failing
 * instead for the first reply's sentences. ?voice=wav: a WAV file, which the
 * hook decodes; with ?decode=slow that takes a second. ?voice=stream-fail: a
 * streamed voice that fails after its first chunk. ?voice=hang: the first
 * reply's sentences never answer, whatever the signal; ?voice=hang-stream:
 * they stream one chunk and then nothing more.
 */
const voiceMode = params.get('voice');
if (params.get('decode') === 'slow') {
  const native = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function (this: AudioContext, data: ArrayBuffer) {
    return new Promise<AudioBuffer>(r => setTimeout(r, 1000)).then(() => native.call(this, data));
  } as typeof native;
}
/** One second of a quiet tone at this rate. */
const second = (rate: number) => {
  const pcm = new Float32Array(rate);
  for (let i = 0; i < rate; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return pcm;
};
/** ?wasm=local: onnxruntime's .wasm files from this page's own origin. */
const onnxWasmPath = params.get('wasm') === 'local' ? `${location.origin}/__ort/` : undefined;
/**
 * ?transcribe=empty or ?transcribe=fail: onTranscribe hears nothing, or throws.
 * ?transcribe=stream: a streaming transcriber, with partials, that never ends
 * the turn itself. ?transcribe=stream-endturn: one that ends it after 300 ms
 * of quiet following speech, as a provider's endpointing does.
 * ?transcribe=stream-early: one that ends it after 0.6 s of speech, mid-sentence.
 * ?transcribe=slow: takes a second and a half, ignoring the signal.
 * ?transcribe=slow-fetch: the same, but rejects when the signal aborts, as fetch does.
 */
const transcribeMode = params.get('transcribe');
/**
 * ?synthError=skip|end-turn: onSynthesizeError. ?synthError=fn: a policy that
 * asks twice more, then skips. ?synthError=hang: one that never answers.
 */
const synthError = params.get('synthError');
const failedOnce = new Set<string>();

/** ?redemption=ms and ?minspeech=ms: the detector's silence timer and minimum speech. */
const speechDetection = {
  ...(params.has('redemption') ? { redemptionMs: Number(params.get('redemption')) } : {}),
  ...(params.has('minspeech') ? { minSpeechMs: Number(params.get('minspeech')) } : {}),
};

/** A stand-in streaming provider. It hears the fake microphone's question. */
const standInTranscriber = streamingTranscriber(({ signal, partial, endTurn, sampleRate }) => {
  probe.sessionsOpened++;
  signal.addEventListener('abort', () => { probe.sessionsAborted++; });
  let saidPartial = false;
  let speech = 0;
  let quietAfterSpeech = 0;
  let opening = true;
  let openingSamples = 0;
  queueMicrotask(() => {
    probe.openingSeconds.push(openingSamples / sampleRate);
    opening = false;
  });
  return {
    push(frame) {
      if (opening) openingSamples += frame.length;
      let sum = 0;
      for (const v of frame) sum += v * v;
      const loud = Math.sqrt(sum / frame.length) > 0.01;
      if (loud) {
        speech += frame.length;
        quietAfterSpeech = 0;
      } else if (speech > 0) {
        quietAfterSpeech += frame.length;
      }
      if (speech > 0.5 * sampleRate && !saidPartial) {
        saidPartial = true;
        partial('What is the');
      }
      if (transcribeMode === 'stream-early' && speech >= 0.6 * sampleRate) endTurn('What is');
      if (transcribeMode === 'stream-endturn' && quietAfterSpeech >= 0.3 * sampleRate) {
        endTurn('What is the capital of France?');
      }
    },
    async finish() {
      probe.sessionsFinished++;
      await wait(50);
      return 'What is the capital of France?';
    },
  };
});
/** ?listen=ptt: push-to-talk, driven by startListening and stopListening. */
const listenMode = params.get('listen') === 'ptt' ? 'push-to-talk' : 'continuous';
(window as unknown as { __e2e: Probe }).__e2e = probe;

const contextIds = new WeakMap<BaseAudioContext, number>();
let contexts = 0;
const contextId = (ctx: BaseAudioContext) => {
  if (!contextIds.has(ctx)) contextIds.set(ctx, ++contexts);
  return contextIds.get(ctx)!;
};
for (const kind of ['suspend', 'resume'] as const) {
  const native = AudioContext.prototype[kind];
  AudioContext.prototype[kind] = function (this: AudioContext) {
    probe.audioLog.push({ kind, ctx: contextId(this) });
    return native.call(this);
  };
}
/** Resolves once the log has, after the avatar began speaking, an entry that passes `test`. */
const afterSpeaking = (test: (e: Probe['audioLog'][number]) => boolean) => new Promise<void>(resolve => {
  const check = () => {
    const log = probe.audioLog;
    const from = log.findIndex(e => e.kind === 'status' && e.value === 'speaking');
    if (from !== -1 && log.slice(from).some(test)) resolve();
    else setTimeout(check, 10);
  };
  check();
});
/** A WAV file of half a second of tone, as an encoded voice would send. */
const wavFile = () => {
  const pcm = Int16Array.from(tone(false), v => Math.round(v * 32767));
  const out = new DataView(new ArrayBuffer(44 + pcm.byteLength));
  const text = (at: number, str: string) => [...str].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); out.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVE'); text(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 24000, true); out.setUint32(28, 48000, true); out.setUint16(32, 2, true);
  out.setUint16(34, 16, true); text(36, 'data'); out.setUint32(40, pcm.byteLength, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, v, true));
  return out.buffer;
};

/**
 * A quiet tone at 24 kHz, standing in for a cloud voice. Half a second, or
 * eight with ?reply=long, so a test can act while the avatar is speaking.
 */
const tone = (long = replyMode === 'long') => {
  const pcm = new Float32Array(long ? 24000 * 8 : 12000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / 24000);
  return pcm;
};

/** Each longer than the 35 characters a cloud voice is given at minimum. */
const STREAMED = [
  'The first sentence is the longest of the three, and slow.',
  'The second sentence is shorter and quick.',
  'The third sentence closes the reply.',
];

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const HINDI = 'नमस्ते, आज हम गणित के बारे में बात करेंगे।';
let replies = 0;

const App: React.FC = () => {
  const [adapters, setAdapters] = useState(true);
  const voice = useAiVoiceAvatar({
    listenMode,
    // ?preload=1: fetch the local hearing and voice behind the adapters.
    preloadLocalSpeech: params.has('preload'),
    onLocalSpeechReady: () => { probe.localSpeechReady = true; },
    speechDetection,
    onUserPartial: text => { probe.partials.push(text); },
    onTranscribe: !adapters ? undefined : transcribeMode?.startsWith('stream') ? standInTranscriber : adapters
      ? async (audio, details) => {
          probe.heard.push(audio.length / 16000);
          details?.signal.addEventListener('abort', () => { probe.transcribeAborted++; });
          if (transcribeMode === 'slow-fetch') {
            await new Promise((resolve, reject) => {
              setTimeout(resolve, 1500);
              details?.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
          } else if (transcribeMode === 'slow') {
            await wait(1500);
          }
          // A real service takes a moment. Answering in the same tick lets
          // React draw 'thinking' and the reply as one render.
          await wait(50);
          if (transcribeMode === 'empty') return '';
          if (transcribeMode === 'fail') throw new Error('transcription service down');
          return 'What is the capital of France?';
        }
      : undefined,
    llmModel: localLlm ?? undefined,
    onnxWasmPath,
    // ?tts=mms: the engine iPhones get by default.
    ttsEngine: params.get('tts') === 'mms' ? 'mms' : undefined,
    onSubmit: localLlm ? undefined : async (text, details) => {
      probe.submitted.push(text);
      probe.interruptsAtSubmit.push(probe.userInterrupts);
      probe.speechMs.push(details.speechMs);
      details.signal?.addEventListener('abort', () => { probe.aborted++; });
      if (replyMode === 'fail') throw new Error('model service down');
      if (replyMode === 'barge') {
        return (async function* () {
          yield 'The first sentence is long, and the user talks over it. ';
          yield 'The second sentence arrives while they are talking.';
        })();
      }
      if (replyMode?.startsWith('speech')) {
        const captions = replyMode === 'speech';
        return speechReply((async function* () {
          try {
            if (replyMode === 'speech-empty') return;
            if (captions) yield { text: 'Hello from a speech model.' };
            yield { audio: tone(), sampleRate: 24000 };
            await wait(1500);
            yield captions
              ? { audio: tone(), sampleRate: 24000, text: 'And a second sentence.' }
              : { audio: tone(), sampleRate: 24000 };
            probe.speechEnded++;
          } finally {
            probe.speechClosed++;
          }
        })());
      }
      if (replyMode === 'tool') {
        return (async function* () {
          yield 'Let me check that for you, one moment please. ';
          await wait(12_000);
          yield 'The answer is that Paris is the capital of France.';
        })();
      }
      if (replyMode === 'decimal') {
        return (async function* () {
          yield* 'In maths your score went up to 72.5 percent this term, a good jump. ';
        })();
      }
      if (replyMode === 'bytes-iterator') {
        const bytes = new TextEncoder().encode(HINDI);
        return (async function* () {
          for (let i = 0; i < bytes.length; i += 5) yield bytes.slice(i, i + 5);
        })();
      }
      if (replyMode === 'bytes') {
        const bytes = new TextEncoder().encode(HINDI);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            // Five bytes at a time: Devanagari letters are three, so most
            // chunks end partway through one.
            for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
            controller.close();
          },
        });
      }
      if (replyMode === 'response') return new Response('This is the reply from a Response object, spoken in full.');
      if (replyMode === 'short') {
        return (async function* () {
          yield 'Sure. ';
          await wait(3000);
          yield 'The capital of France is Paris, a lovely city. ';
        })();
      }
      if (replyMode === 'numbered') {
        const reply = ++replies;
        return (async function* () {
          for (let n = 1; n <= 3; n++) yield `Reply ${reply} sentence ${n} is long enough to be spoken. `;
        })();
      }
      if (replyMode === 'slow') {
        const reply = ++replies;
        return (async function* () {
          for (let n = 1; n <= 8; n++) {
            if (n > 1) await wait(1500);
            yield `Reply ${reply} sentence ${n} is long enough to be spoken. `;
          }
        })();
      }
      // After a moment, as a real host's request takes: answering in the same
      // tick lets React draw 'thinking' and 'idle' as one render.
      if (replyMode === 'empty') return wait(50).then(() => '');
      if (replyMode === 'empty-stream') return wait(50).then(() => (async function* () {})());
      if (replyMode?.startsWith('stream')) {
        return (async function* () {
          for (const sentence of STREAMED) yield sentence + ' ';
        })();
      }
      return 'This is the reply.';
    },
    onInferenceStart: () => { probe.audioLog.push({ kind: 'status', value: 'turn-ended' }); },
    onInferenceEnd: () => { probe.inferenceEnded++; },
    onError: e => {
      probe.errors.push({ stage: e.stage, severity: e.severity, detail: e.detail });
      probe.errorMessages.push(e.message);
    },
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') probe.userTranscripts.push(text);
      else probe.avatarTranscripts.push(text);
    },
    onSpeechStart: text => {
      probe.played.push(text);
      // Set by the hook for the piece that has just begun.
      probe.durations.push(voice.currentAudioDurationRef.current ?? 0);
    },
    onUserInterrupt: () => { probe.userInterrupts++; },
    onSynthesizeError: synthError === 'fn' || synthError === 'hang'
      ? (text, _err, attempt) => {
          probe.policyCalls.push({ text, attempt });
          if (synthError === 'hang') return new Promise<never>(() => {});
          return attempt < 3 ? 'retry' : 'skip';
        }
      : (synthError as 'skip' | 'end-turn' | null) ?? undefined,
    onUnspokenText: text => { probe.unspoken.push(text); },
    onSynthesize: adapters
      ? async (text, details) => {
          probe.synthesized.push(text);
          details?.signal.addEventListener('abort', () => { probe.synthAborted++; });
          // A long first sentence takes a cloud voice longer than a short second.
          if (text.startsWith('The first')) await new Promise(r => setTimeout(r, 800));
          if (replyMode === 'stream-fail' && text.startsWith('The second')) throw new Error('voice down');
          if (replyMode === 'stream-fail-once' && text.startsWith('The second') && !failedOnce.has(text)) {
            failedOnce.add(text);
            throw new Error('voice busy');
          }
          if (voiceMode === 'stream-fail') {
            return (async function* () {
              yield tone();
              await wait(100);
              throw new Error('voice dropped');
            })();
          }
          if (voiceMode === 'slow') await wait(600);
          const forever = () => new Promise<never>(() => {});
          if (voiceMode === 'hang' && text.startsWith('Reply 1')) await forever();
          if (voiceMode === 'hang-stream' && text.startsWith('Reply 1')) {
            return (async function* () {
              yield tone();
              await forever();
            })();
          }
          if (voiceMode?.startsWith('late')) {
            await wait(1500);
            if (voiceMode === 'late-fail' && text.startsWith('Reply 1')) throw new Error('voice down');
          }
          if (voiceMode === 'wav') return wavFile();
          if (voiceMode === '16k') return { audio: second(16000), sampleRate: 16000 };
          if (voiceMode === 'bare16k') return second(16000);
          if (replyMode === 'barge') {
            if (text.startsWith('The first')) return tone(true);
            if (params.get('barge') === 'decoded') {
              await afterSpeaking(e => e.kind === 'status' && e.value === 'listening');
              await wait(100);
              return wavFile();
            }
            await afterSpeaking(e => e.kind === 'suspend');
            return tone(false);
          }
          if (voiceMode === 'stream') {
            return (async function* () {
              try {
                yield tone();
                await wait(1500);
                yield tone();
                probe.streamsEnded++;
              } finally {
                probe.streamsClosed++;
              }
            })();
          }
          if (voiceMode === 'stream-bytes') {
            const pcm = Int16Array.from(second(22050), v => Math.round(v * 32767));
            const bytes = new Uint8Array(pcm.buffer);
            const body = new ReadableStream<Uint8Array>({
              start(c) {
                for (let at = 0, i = 0; at < bytes.length; i++) {
                  const n = [1001, 3, 4097][i % 3];
                  c.enqueue(bytes.slice(at, at + n));
                  at += n;
                }
                c.close();
              },
            });
            return pcmStream(body, { sampleRate: 22050 });
          }
          if (voiceMode === 'stream-mp3') {
            return (async function* () { yield new Uint8Array([0xff, 0xfb, 0x90, 0x44]); })();
          }
          if (voiceMode === 'int16') {
            const f = second(22050);
            return { audio: Int16Array.from(f, v => Math.round(v * 32767)), sampleRate: 22050 };
          }
          return tone();
        }
      : undefined,
  });

  const { status, sendText, speak, startListening, stopListening, interrupt, setMicMuted, isMicMuted, isMicOpen, activeTtsEngine } = voice;

  useEffect(() => {
    probe.statuses.push(status);
    probe.audioLog.push({ kind: 'status', value: status });
  }, [status]);
  probe.ttsEngine = activeTtsEngine;
  probe.sendText = sendText;
  probe.speak = speak;
  probe.startListening = startListening;
  probe.stopListening = stopListening;
  probe.interrupt = interrupt;
  probe.setMicMuted = setMicMuted;
  probe.isMicMuted = isMicMuted;
  probe.isMicOpen = isMicOpen;
  probe.dropSpeechAdapters = () => setAdapters(false);

  return <p id="status">{status}</p>;
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
probe.unmount = () => root.unmount();
root.render(<App />);
