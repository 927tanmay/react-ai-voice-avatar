import React, { useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

/**
 * Time each stage of a spoken turn, for scripts/measure-latency.mjs.
 *
 *   ?reply=fixed  an instant canned reply, so the speech pipeline is timed alone
 *   ?reply=local  the in-browser language model
 *   &sentences=3  ask the model for that many sentences rather than one, so the
 *                 first sentence is handed to the voice while the rest is still
 *                 being written, and tokens per second has enough to measure
 *
 * Each turn is published on `window.__turns` as performance.now() timestamps.
 */
type Turn = {
  end?: number; transcript?: number; reply?: number; audio?: number; text?: string;
  /** How long the user spoke, as onSubmit is told. Only with ?reply=fixed. */
  speechMs?: number;
  /** The language model, from the worker's own token stream. */
  firstToken?: number; firstText?: number; firstTokens?: number; firstSentence?: number;
  lastToken?: number; tokens?: number;
  replyText?: string; firstSentenceText?: string;
};
const turns: Turn[] = [];
(window as unknown as { __turns: Turn[] }).__turns = turns;
const params = new URLSearchParams(location.search);
const replyMode = params.get('reply') ?? 'fixed';
const sentences = Number(params.get('sentences') ?? 1);
let current: Turn | null = null;

/**
 * Watch the language model's tokens as they leave the worker. The hook does not
 * publish them, and should not for a benchmark's sake, so every worker the page
 * creates gets a listener of its own. `firstToken` and `streamWord` come only
 * from the language model worker.
 */
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.addEventListener('message', (e: MessageEvent) => {
      if (!current) return;
      const now = performance.now();
      if (e.data?.type === 'firstToken') {
        current.firstToken ??= now;
        return;
      }
      if (e.data?.type !== 'streamWord') return;
      const { fullText, tokens } = e.data.payload as { fullText: string; tokens?: number };
      // Tokens per second runs from the first printable text, which can
      // already be several tokens: a word is held back until it is whole.
      if (current.firstTokens === undefined) {
        current.firstTokens = tokens;
        current.firstText = now;
      }
      current.lastToken = now;
      current.tokens = tokens;
      current.replyText = fullText;
      // The worker's own rule for when a sentence is ready for the voice
      // (mlPipeline.worker.ts), applied to the same text at the same moment.
      const ended = /([.!?।]|\n\n+)/.test(fullText) && fullText.trim().length > 5;
      if (current.firstSentence === undefined && (ended || fullText.trim().length > 150)) {
        current.firstSentence = now;
        current.firstSentenceText = fullText;
      }
    });
  }
};

const App: React.FC = () => {
  const turnRef = useRef<Turn | null>(null);

  const voice = useAiVoiceAvatar({
    ttsVoice: 'af_heart',
    systemPrompt: sentences === 1
      ? 'Answer in one short spoken sentence.'
      // A 0.5B model ignores a bare "answer in three sentences" for a factual
      // question, so it is told what to put in the rest.
      : `Always reply with exactly ${sentences} short sentences: the answer first, then a related fact in each one after it.`,
    // The voice detector has decided the turn is over: speech ended
    // `redemptionMs` (1400 by default) before this.
    onInferenceStart: () => {
      current = turnRef.current = { end: performance.now() };
      turns.push(current);
    },
    onTranscriptUpdate: (text, speaker) => {
      const turn = turnRef.current;
      if (speaker === 'user' && turn && !turn.transcript) {
        turn.transcript = performance.now();
        turn.text = text;
      }
    },
    onSubmit: replyMode === 'fixed'
      ? async (_text, { speechMs }) => {
          if (turnRef.current) {
            turnRef.current.reply = performance.now();
            turnRef.current.speechMs = speechMs;
          }
          return 'The capital of France is Paris.';
        }
      : undefined,
    // The first sentence of the reply starts playing.
    onSpeechStart: () => {
      const turn = turnRef.current;
      if (turn && !turn.audio) turn.audio = performance.now();
    },
  });

  (window as unknown as { __status: string }).__status = voice.status;
  (window as unknown as { __start: () => void }).__start = () => { voice.startListening(); };
  return <p id="status">{voice.status}</p>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
