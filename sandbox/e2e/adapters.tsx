import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

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
  /** How many times onUserInterrupt fired. */
  userInterrupts: number;
  /** Each piece of the reply as it began to play, from onSpeechStart. */
  played: string[];
  /** How many onSubmit signals have been aborted. */
  aborted: number;
  ttsEngine?: string;
  localSpeechReady?: boolean;
  sendText?: (text: string) => void;
  startListening?: () => Promise<void>;
  stopListening?: () => void;
  interrupt?: () => void;
  /** Stop supplying transcription and the voice, as a host falling back would. */
  dropSpeechAdapters?: () => void;
};
const probe: Probe = { statuses: [], synthesized: [], submitted: [], inferenceEnded: 0, heard: [], speechMs: [], userInterrupts: 0, played: [], aborted: 0 };
const params = new URLSearchParams(location.search);
/**
 * ?reply=empty or ?reply=empty-stream: the host answers with nothing.
 * ?reply=stream: three sentences streamed, the first of which the voice is
 * slowest to synthesise. ?reply=stream-fail: the voice fails on the second.
 * ?reply=tool: one sentence, then twelve seconds of nothing, as a model calling
 * a tool would, then the answer. ?reply=slow: eight sentences a second and a
 * half apart, numbered by reply, from a host that ignores the signal.
 * ?reply=decimal: a sentence with "72.5" in it, one character at a time.
 * ?reply=bytes: Hindi as raw bytes, cut through the middle of letters, as a
 * ReadableStream. ?reply=bytes-iterator: the same from an async generator.
 * ?reply=response: a fetch Response, returned as it is.
 * ?reply=short: "Sure.", three seconds of nothing, then the answer.
 */
const replyMode = params.get('reply');
/**
 * ?llm=<model>: no onSubmit, so the in-browser model answers and the host's
 * onSynthesize speaks. tests/local-llm-host-voice.spec.ts serves a tiny one.
 */
const localLlm = params.get('llm');
/** ?listen=ptt: push-to-talk, driven by startListening and stopListening. */
const listenMode = params.get('listen') === 'ptt' ? 'push-to-talk' : 'continuous';
(window as unknown as { __e2e: Probe }).__e2e = probe;

/**
 * A quiet tone at 24 kHz, standing in for a cloud voice. Half a second, or
 * eight with ?reply=long, so a test can act while the avatar is speaking.
 */
const tone = () => {
  const pcm = new Float32Array(replyMode === 'long' ? 24000 * 8 : 12000);
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
  const { status, sendText, startListening, stopListening, interrupt, activeTtsEngine } = useAiVoiceAvatar({
    listenMode,
    // ?preload=1: fetch the local hearing and voice behind the adapters.
    preloadLocalSpeech: params.has('preload'),
    onLocalSpeechReady: () => { probe.localSpeechReady = true; },
    onTranscribe: adapters
      ? async audio => {
          probe.heard.push(audio.length / 16000);
          return 'What is the capital of France?';
        }
      : undefined,
    llmModel: localLlm ?? undefined,
    // ?tts=mms: the engine iPhones get by default.
    ttsEngine: params.get('tts') === 'mms' ? 'mms' : undefined,
    onSubmit: localLlm ? undefined : async (text, details) => {
      probe.submitted.push(text);
      probe.speechMs.push(details.speechMs);
      details.signal?.addEventListener('abort', () => { probe.aborted++; });
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
      if (replyMode === 'slow') {
        const reply = ++replies;
        return (async function* () {
          for (let n = 1; n <= 8; n++) {
            if (n > 1) await wait(1500);
            yield `Reply ${reply} sentence ${n} is long enough to be spoken. `;
          }
        })();
      }
      if (replyMode === 'empty') return '';
      if (replyMode === 'empty-stream') return (async function* () {})();
      if (replyMode?.startsWith('stream')) {
        return (async function* () {
          for (const sentence of STREAMED) yield sentence + ' ';
        })();
      }
      return 'This is the reply.';
    },
    onInferenceEnd: () => { probe.inferenceEnded++; },
    onSpeechStart: text => { probe.played.push(text); },
    onUserInterrupt: () => { probe.userInterrupts++; },
    onSynthesize: adapters
      ? async text => {
          probe.synthesized.push(text);
          // A long first sentence takes a cloud voice longer than a short second.
          if (text.startsWith('The first')) await new Promise(r => setTimeout(r, 800));
          if (replyMode === 'stream-fail' && text.startsWith('The second')) throw new Error('voice down');
          return tone();
        }
      : undefined,
  });

  useEffect(() => {
    probe.statuses.push(status);
  }, [status]);
  probe.ttsEngine = activeTtsEngine;
  probe.sendText = sendText;
  probe.startListening = startListening;
  probe.stopListening = stopListening;
  probe.interrupt = interrupt;
  probe.dropSpeechAdapters = () => setAdapters(false);

  return <p id="status">{status}</p>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
