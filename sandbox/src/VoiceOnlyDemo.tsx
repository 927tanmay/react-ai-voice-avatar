import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
// The headless entry point: the whole conversation loop with no three.js in
// the module graph. This file is what an app without an avatar would write.
import { useAiVoiceAvatar, type AiVoiceAvatarError } from 'react-ai-voice-avatar/headless';
import type { Status, TalkHandle } from './demoSession';

/** Driven through the same four calls as the avatar. */
export type VoiceOnlyHandle = TalkHandle;

interface VoiceOnlyDemoProps {
  loadModels: boolean;
  onSubmit?: (text: string) => Promise<string>;
  preloadLocalLlm: boolean;
  onLocalLlmReady: () => void;
  loadingProgress: (pct: number, label: string) => void;
  onStatusChange: (status: Status) => void;
  onUserInterrupt: () => void;
  onError: (error: AiVoiceAvatarError) => void;
  onTtsEngineChange: (engine: 'kokoro' | 'mms' | 'custom') => void;
  isMobile: boolean;
  /** Orb diameter in pixels. Defaults by screen width. */
  orbSize?: number;
  /**
   * Take the height of the orb and caption rather than filling a positioned
   * parent. A page that flows around it needs this, or a long caption would
   * spill out over whatever sits below.
   */
  inFlow?: boolean;
}

/** Colours per state, so the orb says what is happening without any text. */
const PALETTE: Record<Status, [string, string]> = {
  loading: ['#334155', '#1E293B'],
  idle: ['#38BDF8', '#6366F1'],
  listening: ['#22D3EE', '#38BDF8'],
  thinking: ['#818CF8', '#C084FC'],
  speaking: ['#38BDF8', '#A78BFA'],
};

const reduceMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Voice mode with no avatar: an orb that moves with whoever is talking, and a
 * line of captions.
 *
 * The level arrives sixty times a second from `onAudioLevelChange`, so it is
 * written straight to the DOM through a ref. Routing it through React state
 * would re-render this component every frame for the length of the call.
 */
export const VoiceOnlyDemo = forwardRef<VoiceOnlyHandle, VoiceOnlyDemoProps>((props, ref) => {
  const orbRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef(0);
  const [caption, setCaption] = useState<{ speaker: 'user' | 'avatar'; text: string } | null>(null);

  const engine = useAiVoiceAvatar({
    loadModels: props.loadModels,
    ttsVoice: 'af_heart',
    onSubmit: props.onSubmit,
    preloadLocalLlm: props.preloadLocalLlm,
    onLocalLlmReady: props.onLocalLlmReady,
    loadingProgress: props.loadingProgress,
    onUserInterrupt: props.onUserInterrupt,
    onError: props.onError,
    onTtsEngineChange: props.onTtsEngineChange,
    // What the user said, once it is transcribed.
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') setCaption({ speaker, text });
    },
    // Each sentence of the reply, as it starts to play, so the caption keeps
    // pace with the voice rather than showing the whole reply at once.
    onSpeechStart: text => setCaption({ speaker: 'avatar', text }),
    onAudioLevelChange: level => {
      levelRef.current = level;
    },
  });

  const { status } = engine;
  useEffect(() => {
    props.onStatusChange(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useImperativeHandle(ref, () => ({
    speak: engine.speak,
    startListening: () => { engine.startListening(); },
    stopListening: engine.stopListening,
    interrupt: engine.interrupt,
    sendText: engine.sendText,
  }), [engine.speak, engine.startListening, engine.stopListening, engine.interrupt, engine.sendText]);

  // Ease toward the latest level every frame. The raw figure jumps between
  // syllables; eased, the orb breathes with the voice instead of flickering.
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = (t: number) => {
      frame = requestAnimationFrame(tick);
      shown += (levelRef.current - shown) * 0.25;
      // A slow idle breath, so a quiet orb still reads as alive.
      const breath = reduceMotion ? 0 : Math.sin(t / 900) * 0.02;
      const scale = 1 + breath + shown * (reduceMotion ? 0.08 : 0.32);
      if (orbRef.current) orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      if (glowRef.current) {
        glowRef.current.style.opacity = (0.35 + shown * 0.6).toFixed(3);
        glowRef.current.style.transform = `scale(${(1.1 + shown * 0.5).toFixed(3)})`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Before anyone asks for the models, 'loading' only means "not started", and
  // a grey orb there reads as broken. Grey is for an actual download.
  const [from, to] = PALETTE[status === 'loading' && !props.loadModels ? 'idle' : status];
  const size = props.orbSize ?? (props.isMobile ? 150 : 200);
  const compact = size < 150;

  return (
    <div style={{
      ...(props.inFlow ? { position: 'relative' } : { position: 'absolute', inset: 0 }),
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: compact ? '24px' : '40px', padding: compact ? '16px 0' : '24px',
    }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <div
          ref={glowRef}
          style={{
            position: 'absolute', inset: '-30%', borderRadius: '50%',
            background: `radial-gradient(circle, ${from}66 0%, ${to}33 45%, transparent 70%)`,
            filter: 'blur(24px)', opacity: 0.35, transition: 'background 0.6s ease',
          }}
        />
        <div
          ref={orbRef}
          className={status === 'thinking' && !reduceMotion ? 'voice-orb-thinking' : undefined}
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #FFFFFF55 0%, transparent 35%), linear-gradient(135deg, ${from}, ${to})`,
            boxShadow: `0 0 60px ${from}55, inset 0 -12px 30px ${to}88`,
            transition: 'background 0.6s ease, box-shadow 0.6s ease',
            willChange: 'transform',
          }}
        />
      </div>

      <div aria-live="polite" style={{ minHeight: compact ? '64px' : '84px', maxWidth: '440px', textAlign: 'center' }}>
        {caption ? (
          <>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: caption.speaker === 'user' ? '#60A5FA' : '#A78BFA', marginBottom: '8px' }}>
              {caption.speaker === 'user' ? 'You' : 'Assistant'}
            </div>
            <div style={{ fontSize: props.isMobile ? '16px' : '18px', lineHeight: 1.5, color: '#E2E8F0' }}>
              {caption.text}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.6 }}>
            No avatar, no three.js. The same conversation, as a React hook.
          </div>
        )}
      </div>
    </div>
  );
});

VoiceOnlyDemo.displayName = 'VoiceOnlyDemo';
