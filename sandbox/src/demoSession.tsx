import React, { useState } from 'react';
import type { AiVoiceAvatarError } from 'react-ai-voice-avatar/headless';

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
    status, setStatus, progress, recordProgress, micOpen, talk, stop, reset,
    handleError, hint, onUserInterrupt: () => setInterrupted(true),
  };
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
