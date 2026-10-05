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
  ttsEngine?: string;
  localSpeechReady?: boolean;
  sendText?: (text: string) => void;
  startListening?: () => Promise<void>;
  stopListening?: () => void;
  interrupt?: () => void;
  /** Stop supplying transcription and the voice, as a host falling back would. */
  dropSpeechAdapters?: () => void;
};
const probe: Probe = { statuses: [], synthesized: [], submitted: [], inferenceEnded: 0, heard: [], speechMs: [], userInterrupts: 0 };
const params = new URLSearchParams(location.search);
/** ?reply=empty or ?reply=empty-stream: the host answers with nothing. */
const replyMode = params.get('reply');
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
    onSubmit: async (text, details) => {
      probe.submitted.push(text);
      probe.speechMs.push(details.speechMs);
      if (replyMode === 'empty') return '';
      if (replyMode === 'empty-stream') return (async function* () {})();
      return 'This is the reply.';
    },
    onInferenceEnd: () => { probe.inferenceEnded++; },
    onUserInterrupt: () => { probe.userInterrupts++; },
    onSynthesize: adapters
      ? async text => {
          probe.synthesized.push(text);
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
