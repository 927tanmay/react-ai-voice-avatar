import React, { useState } from 'react';
import type { AiVoiceAvatarError } from 'react-ai-voice-avatar/headless';
import { OWN_KEY_EXAMPLE, type HostedRefusal } from './hostedBrain';

/**
 * What the homepage and the voice-only page share: the state of one
 * conversation as a visitor sees it, and the words that explain it.
 *
 * Free of three.js, like everything the voice page imports.
 */

export type Status = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';

/** The four calls a page makes, whichever view is on screen. */
export interface TalkHandle {
  speak: (text: string) => void;
  startListening: () => void;
  stopListening: () => void;
  interrupt: () => void;
  sendText: (text: string) => void;
}

/**
 * The download a visitor commits to, stated before they commit to it.
 *
 * Summed from the files the engine actually requests, not the model cards:
 * Whisper base 278 MB and Kokoro at fp32 310 MB. The 750 MB language model is
 * no longer part of it, because replies come from a hosted route
 * (hostedBrain.ts) — which is what makes the demo usable on a phone at all.
 *
 * iPhones and iPads get the MMS voice instead, because Kokoro runs Safari out
 * of memory: 38 MB at the q8 the wasm backend loads, in place of 310 MB. The
 * test is the engine's own, from src/lib/device.ts, which this demo cannot
 * import from the published package.
 */
const onIos = typeof navigator !== 'undefined' && (
  /iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);
export const DOWNLOAD_SIZE = onIos ? '~320 MB' : '~590 MB';

/** That download at 50 Mbit/s: 590 MB is 94 s, 320 MB is 51 s. */
export const DOWNLOAD_TIME = onIos ? 'under a minute' : 'about a minute and a half';

/**
 * How soon a return visit is talking, with the models already stored.
 * Measured on an Apple M4 with WebGPU: ready in 1.8 to 2.5 s, the greeting
 * audible by 3 s, and nothing downloaded.
 */
export const RETURN_VISIT = 'about 2 seconds';

/** Both together, said the same way on every page. */
export const DownloadNote: React.FC<{ local: string; canRunLocalLlm: boolean }> = ({ local, canRunLocalLlm }) => (
  <>
    {local} run in your browser. The first visit downloads {DOWNLOAD_SIZE} of models, {DOWNLOAD_TIME} on
    a 50 Mbit/s connection. Your browser keeps them, so next time it's talking in {RETURN_VISIT}, with
    nothing to download. Replies come from a hosted model on a free tier shared by everyone here
    {canRunLocalLlm ? ', until the in-browser one finishes downloading behind the conversation.' : '.'}
  </>
);

/** Under the progress bars, while the first download runs. */
export const KEPT_NOTE = `Your browser keeps these. Next time it's talking in ${RETURN_VISIT}, with nothing to download.`;

export function useDemoSession(engine: () => TalkHandle | null | undefined, logTag: string) {
  const [status, setStatus] = useState<Status>('loading');
  // One figure per model. The models download in parallel, so a single bar fed
  // by whichever reported last would jump between them even though each one
  // only moves forward.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [interrupted, setInterrupted] = useState(false);
  // Status alone cannot say whether the microphone is open: in continuous mode
  // a finished reply returns to 'idle' while the mic stays live, and the
  // greeting plays as 'speaking' before the mic was ever opened. Both states
  // need different instructions, so the page tracks it.
  const [micOpen, setMicOpen] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  // Which voice is speaking. Named on the page because it differs by device,
  // and a visitor who hears a different voice on their phone deserves to
  // know that is deliberate.
  const [ttsEngine, setTtsEngine] = useState<'kokoro' | 'mms' | 'custom' | null>(null);

  const talk = () => {
    setInterrupted(false);
    setMicBlocked(false);
    setMicOpen(true);
    engine()?.startListening();
  };

  const stop = () => {
    setMicOpen(false);
    engine()?.stopListening();
    engine()?.interrupt();
  };

  /**
   * Typed input. Stops a reply that is playing first, so typing during the
   * greeting behaves like talking over it.
   */
  const type = (text: string) => {
    setInterrupted(false);
    engine()?.interrupt();
    engine()?.sendText(text);
  };

  /** Back to the start, for a fresh engine. */
  const reset = () => {
    setStatus('loading');
    setProgress({});
    setMicOpen(false);
    setMicBlocked(false);
    setInterrupted(false);
  };

  const handleError = (e: AiVoiceAvatarError) => {
    console.warn(`[${logTag}] ${e.severity} in ${e.stage}: ${e.message}`);
    if (e.stage === 'microphone') {
      setMicOpen(false);
      setMicBlocked(true);
    }
  };

  const recordProgress = (pct: number, label: string) => {
    const key = label === 'tts' ? 'kokoro' : label;
    // Hold each model at its highest, so an out-of-order message can never
    // move a row backwards.
    setProgress(prev => (pct > (prev[key] ?? 0) ? { ...prev, [key]: pct } : prev));
  };

  /** One line telling the visitor what they can do right now. */
  const hint = (() => {
    if (micBlocked) {
      return 'The microphone is blocked. Allow it from the address bar, then tap again.';
    }
    if (!micOpen) {
      return status === 'speaking'
        ? 'Tap to talk. You can interrupt it mid-sentence.'
        : 'Ask about the project, or anything else.';
    }
    if (status === 'listening') return 'Listening…';
    if (status === 'thinking') return 'Thinking…';
    if (status === 'speaking') return 'Try talking over it. It stops and listens.';
    return interrupted
      ? 'You interrupted it, and it listened. Go on, ask something else.'
      : "Go ahead, it's listening.";
  })();

  return {
    status, setStatus, progress, recordProgress, micOpen, talk, stop, type, reset,
    handleError, hint, onUserInterrupt: () => setInterrupted(true),
    setTtsEngine, voiceLabel: voiceLabel(ttsEngine),
  };
}

/** The voice in use, for a visitor. */
function voiceLabel(engine: 'kokoro' | 'mms' | 'custom' | null) {
  if (engine === 'mms') return 'MMS, a lighter voice, since Kokoro needs more memory than this device allows';
  if (engine === 'custom') return 'a hosted voice';
  return 'Kokoro, in your browser';
}

/**
 * The models a visitor waits for, named for a visitor rather than an engineer.
 *
 * No language model row: replies start hosted, so nobody waits for one. On a
 * capable desktop it downloads later, behind the conversation, and is reported
 * under the button instead.
 */
const MODEL_ROWS: Array<{ key: string; label: string }> = [
  { key: 'asr', label: 'Speech recognition' },
  { key: 'kokoro', label: 'Voice' },
];

export const ModelProgress: React.FC<{ progress: Record<string, number>; accent: string }> = ({ progress, accent }) => (
  <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '360px' }}>
    {MODEL_ROWS.map(({ key, label }) => {
      const pct = progress[key] ?? 0;
      return (
        <div key={key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#CBD5E1', marginBottom: '6px' }}>
            <span>{label}</span>
            <span style={{ color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
          </div>
          <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: accent, transition: 'width 0.3s ease' }} />
          </div>
        </div>
      );
    })}
  </div>
);

/**
 * Which half runs where, and what to expect from the half that is hosted.
 *
 * The page claims the browser does the work, so the one part that does not is
 * named rather than glossed over: whose model replied, that it is a free tier
 * shared by everyone on the page, how long replies take, and what happens when
 * that tier runs out. The timings are the README's measurements (Apple M4,
 * WebGPU); scripts/measure-latency.mjs reproduces them.
 */
export const RunsWhere: React.FC<{
  local: string;
  answeredBy: string;
  hosted: boolean;
  refusal: HostedRefusal | null;
  canRunLocalLlm: boolean;
  localLlmProgress: number;
  voiceLabel: string;
  style: React.CSSProperties;
}> = p => {
  const line = { display: 'block', marginTop: '4px' } as const;
  const strong = { color: '#94A3B8' };
  const pct = p.localLlmProgress > 0 ? ` (${Math.round(p.localLlmProgress)}%)` : '';
  return (
    <p style={p.style}>
      {p.local}: your browser. Replies: <span style={strong}>{p.answeredBy}</span>
      {p.hosted && ', on its free tier, shared by everyone here'}
      <span style={line}>Voice: <span style={strong}>{p.voiceLabel}</span></span>
      <span style={line}>
        A reply starts about {p.hosted ? '3' : '2.5'} seconds after you stop talking.
      </span>
      {p.refusal && (
        <span style={{ ...line, color: '#F59E0B' }}>
          {p.refusal === 'visitor'
            ? "You've had your twelve free hosted replies for this hour."
            : p.refusal === 'site'
              ? 'The free hosted replies are used up for now.'
              : "The hosted model isn't answering right now."}{' '}
          {p.canRunLocalLlm
            ? `The in-browser model takes over when it finishes downloading${pct}.`
            : <>Run it on your own free key: <a href={OWN_KEY_EXAMPLE} target="_blank" rel="noreferrer" style={{ color: '#F59E0B' }}>examples/groq-voice</a>.</>}
        </span>
      )}
      {p.hosted && p.canRunLocalLlm && !p.refusal && (
        <span style={line}>Fetching the in-browser model too{pct}. It takes over when it lands, with no limit.</span>
      )}
    </p>
  );
};
