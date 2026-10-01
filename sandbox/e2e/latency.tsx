import React, { useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

/**
 * Time each stage of a spoken turn, for scripts/measure-latency.mjs.
 *
 *   ?reply=fixed  an instant canned reply, so the speech pipeline is timed alone
 *   ?reply=local  the in-browser language model
 *
 * Each turn is published on `window.__turns` as performance.now() timestamps.
 */
type Turn = { end?: number; transcript?: number; reply?: number; audio?: number; text?: string };
const turns: Turn[] = [];
(window as unknown as { __turns: Turn[] }).__turns = turns;
const replyMode = new URLSearchParams(location.search).get('reply') ?? 'fixed';

const App: React.FC = () => {
  const current = useRef<Turn | null>(null);

  const voice = useAiVoiceAvatar({
    ttsVoice: 'af_heart',
    systemPrompt: 'Answer in one short spoken sentence.',
    // The voice detector has decided the turn is over: speech ended
    // `redemptionMs` (1400 by default) before this.
    onInferenceStart: () => {
      current.current = { end: performance.now() };
      turns.push(current.current);
    },
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user' && current.current && !current.current.transcript) {
        current.current.transcript = performance.now();
        current.current.text = text;
      }
    },
    onSubmit: replyMode === 'fixed'
      ? async () => {
          if (current.current) current.current.reply = performance.now();
          return 'The capital of France is Paris.';
        }
      : undefined,
    // The first sentence of the reply starts playing.
    onSpeechStart: () => {
      if (current.current && !current.current.audio) current.current.audio = performance.now();
    },
  });

  (window as unknown as { __status: string }).__status = voice.status;
  (window as unknown as { __start: () => void }).__start = () => { voice.startListening(); };
  return <p id="status">{voice.status}</p>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
