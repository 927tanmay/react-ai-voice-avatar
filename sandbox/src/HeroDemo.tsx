import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';
import { VoiceOnlyDemo, type VoiceOnlyHandle } from './VoiceOnlyDemo';
import { TypeBox } from './TypeBox';
import { hasWebGpu, useHostedBrain } from './hostedBrain';
import { DownloadNote, KEPT_NOTE, ModelProgress, RunsWhere, useDemoSession } from './demoSession';

/**
 * With a face, or voice alone.
 *
 * Voice alone is the more common case: most apps want ChatGPT-style voice mode
 * and have no use for a character. Both are on the first screen so neither
 * kind of visitor has to go looking.
 */
type Mode = 'avatar' | 'voice';

const ACCENT = '#38BDF8';

/**
 * What the avatar says first.
 *
 * It exists to teach the one thing a visitor would not think to try: talking
 * over it. Everything else about a voice avatar is obvious from looking at one.
 */
const GREETING: Record<Mode, string> = {
  avatar:
    "Hi! My voice, my face and my hearing all run in your browser. My answers come from a hosted model. " +
    "Tap the button and ask me something. And if I ramble, just start talking. I'll stop and listen.",
  voice:
    "Hi! This is the same conversation with no avatar. My voice and my hearing run in your browser, " +
    "and my answers come from a hosted model. Tap the button and ask me something. If I ramble, just start talking.",
};

/** The headline and the line under it, per mode. */
const COPY: Record<Mode, { title: string; lede: string }> = {
  avatar: {
    title: "A talking avatar that runs on your visitor's GPU.",
    lede: 'The open-source alternative to real-time avatar APIs. No video stream, no per-minute billing. Bring your own model, or run one in the browser. This demo does both.',
  },
  voice: {
    title: "Voice mode for your app, running on your visitor's GPU.",
    lede: 'Talk to your app the way you talk to ChatGPT or Gemini, with speech recognition and the voice running in the browser. No avatar and no three.js: one React hook, and your own UI.',
  },
};

const SYSTEM_PROMPT =
  'You are Ananya, the demo avatar for react-ai-voice-avatar, an open-source React component. ' +
  'Facts you may use: it renders a lip-synced 3D avatar on the user\'s own GPU; speech recognition, ' +
  'the voice and facial animation run in the browser; developers can connect their own language model ' +
  'such as OpenAI or Claude through an onSubmit prop, which is how this demo gets its replies; ' +
  'it is MIT licensed and installs from npm. ' +
  'If you do not know something, say so. Answer in one or two short spoken sentences. ' +
  'Never use markdown, lists or emoji.';

interface HeroDemoProps {
  isMobile: boolean;
  /** How many scenarios the page offers below, named in the link to them. */
  scenarioCount: number;
  onShowScenarios: () => void;
  /** Height of the page header above, so the hero still fills one screen. */
  headerHeight: number;
}

export const HeroDemo: React.FC<HeroDemoProps> = ({ isMobile, scenarioCount, onShowScenarios, headerHeight }) => {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const voiceRef = useRef<VoiceOnlyHandle>(null);
  const [mode, setMode] = useState<Mode>('avatar');
  /** Whichever engine is on screen. Only one exists at a time. */
  const engine = () => (mode === 'avatar' ? avatarRef.current : voiceRef.current);

  // Nothing downloads until this is true. The avatar still renders and idles,
  // which is the point: a visitor sees the product before deciding to spend
  // half a gigabyte on it.
  const [engaged, setEngaged] = useState(false);
  // The mesh takes several seconds to parse, and an empty dark panel in that
  // time reads as a broken page rather than a loading one.
  const [meshReady, setMeshReady] = useState(false);
  const session = useDemoSession(engine, 'hero');
  const { status, progress } = session;
  /** Each mode greets once, the first time it is ready. */
  const greetedRef = useRef<Record<Mode, boolean>>({ avatar: false, voice: false });

  /** Only a desktop with WebGPU is asked to fetch 750 MB in the background. */
  const canRunLocalLlm = !isMobile && hasWebGpu;
  const hosted = useHostedBrain(canRunLocalLlm);

  const ready = engaged && status !== 'loading';
  /** The background download of the local model, once it has started. */
  const localLlmProgress = progress['llm'] ?? 0;

  // Greet once, the moment the models are up. The click that set `engaged` was
  // the user gesture, so the browser lets this play without another tap.
  useEffect(() => {
    if (!ready || greetedRef.current[mode]) return;
    greetedRef.current[mode] = true;
    engine()?.speak(GREETING[mode]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode]);

  /**
   * Swap views. The outgoing engine unmounts and releases its workers and
   * microphone; the incoming one loads the same models from the browser's
   * store, so nothing downloads twice. Running both at once would hold every
   * model in memory twice over.
   *
   * The hosted conversation lives here rather than in either engine, so it
   * carries across. The in-browser model starts over, and takes over again
   * when it has loaded.
   */
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    session.reset();
    hosted.reset();
  };

  return (
    <section
      style={{
        minHeight: `calc(100dvh - ${headerHeight}px)`,
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.1fr)',
        alignItems: 'center',
        gap: isMobile ? '24px' : '48px',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: isMobile ? '24px 16px 40px' : '48px 24px',
      }}
    >
      {/* ── Copy and call to action ── */}
      <div style={{ order: isMobile ? 2 : 1 }}>
        <p style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: ACCENT, margin: '0 0 16px' }}>
          Open source · MIT · React
        </p>
        <h1 style={{ fontSize: isMobile ? '34px' : '48px', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-1px', color: '#FFF', margin: '0 0 20px' }}>
          {COPY[mode].title}
        </h1>
        <p style={{ fontSize: isMobile ? '16px' : '18px', lineHeight: 1.6, color: '#94A3B8', margin: '0 0 32px', maxWidth: '520px' }}>
          {COPY[mode].lede}
        </p>

        {!engaged && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px' }}>
              <button onClick={() => setEngaged(true)} style={primaryButton}>
                Talk to it
              </button>
              <button onClick={onShowScenarios} style={textButton}>
                See all {scenarioCount} scenarios ↓
              </button>
            </div>
            <p style={noteStyle}>
              <DownloadNote local={mode === 'avatar' ? 'Hearing, voice and lip-sync' : 'Hearing and voice'} canRunLocalLlm={canRunLocalLlm} />
              {!hasWebGpu && (
                <span style={{ display: 'block', marginTop: '8px', color: '#F59E0B' }}>
                  Your browser doesn't expose WebGPU, so the voice will be slow. Chrome or Edge on a desktop is best.
                </span>
              )}
              {hasWebGpu && isMobile && (
                <span style={{ display: 'block', marginTop: '8px', color: '#F59E0B' }}>
                  That's a sizeable download for a phone — best on wifi.
                </span>
              )}
            </p>
          </>
        )}

        {engaged && !ready && (
          <div>
            <ModelProgress progress={progress} accent={ACCENT} />
            {/* True since the models moved to OPFS. The Cache API refused any
                file of 256 MiB or more, so the ~310 MB voice used to be fetched
                again on every visit; OPFS has no such limit. It can still be
                refused — a full disk, a private window — and the engine reports
                that through onError as 'model-storage', so this stays a plain
                statement rather than a promise. See src/lib/modelCache.ts. */}
            <p style={{ ...noteStyle, marginTop: '16px' }}>
              {KEPT_NOTE}
            </p>
          </div>
        )}

        {ready && (
          <div aria-live="polite">
            {session.micOpen ? (
              <button onClick={session.stop} style={secondaryButton}>Stop</button>
            ) : (
              <button onClick={session.talk} style={primaryButton}>Tap to talk</button>
            )}
            <p style={noteStyle}>{session.hint}</p>
            <TypeBox onSend={session.type} accent={ACCENT} style={{ marginTop: '18px' }} />

            {/* Which half runs where, stated plainly and kept accurate as it
                changes. The page claims the browser does the work, so the one
                part that does not has to be named rather than glossed over. */}
            <RunsWhere
              local={mode === 'avatar' ? 'Hearing, voice and lip-sync' : 'Hearing and voice'}
              answeredBy={hosted.answeredBy}
              hosted={hosted.brain === 'hosted'}
              refusal={hosted.refusal}
              canRunLocalLlm={canRunLocalLlm}
              localLlmProgress={localLlmProgress}
              voiceLabel={session.voiceLabel}
              style={{ ...noteStyle, marginTop: '10px', fontSize: '13px', color: '#64748B' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '32px', alignItems: 'center' }}>
          <code style={codeChip}>npm install react-ai-voice-avatar</code>
          {/* Once the visitor has engaged the call to action above is gone, so
              the way to the scenarios moves down here rather than vanishing. */}
          {engaged && (
            <button onClick={onShowScenarios} style={textButton}>See all {scenarioCount} scenarios ↓</button>
          )}
        </div>
      </div>

      {/* ── The avatar ── */}
      <div
        style={{
          order: isMobile ? 1 : 2,
          position: 'relative',
          height: isMobile ? '52dvh' : 'min(78dvh, 720px)',
          borderRadius: '24px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.06)',
          background: '#101116',
        }}
      >
        {mode === 'avatar' ? (
          // Framed on the face rather than the whole figure: lip sync is the
          // part worth watching, and at full-body distance the mouth is a few
          // pixels.
          <Canvas camera={{ position: [0, 0.37, 0.93], fov: 30 }} style={{ width: '100%', height: '100%' }}>
            <color attach="background" args={['#101116']} />
            <AimCamera at={[0, 0.37, 0]} />
            <AiVoiceAvatar
              ref={avatarRef}
              loadModels={engaged}
              avatarPreset="ananya"
              ttsVoice="af_heart"
              systemPrompt={SYSTEM_PROMPT}
              // Hosted until the in-browser model is warm, then dropped, which
              // is what hands the conversation over. The engine carries the
              // turns across, so the local model knows what was already said.
              onSubmit={hosted.onSubmit}
              preloadLocalLlm={canRunLocalLlm}
              onLocalLlmReady={hosted.switchToLocal}
              showCaptions={true}
              // This page owns the call to action until the visitor engages;
              // the pill would otherwise announce a download that has not
              // started.
              hideStatusPill={true}
              scale={isMobile ? 0.4 : 0.5}
              position={[0, isMobile ? -0.26 : -0.36, 0]}
              loadingProgress={session.recordProgress}
              onStatusChange={session.setStatus}
              onModelLoaded={() => setMeshReady(true)}
              onUserInterrupt={session.onUserInterrupt}
              enableLocalAssetProbe={import.meta.env.DEV}
              onError={session.handleError}
              onTtsEngineChange={session.setTtsEngine}
            />
          </Canvas>
        ) : (
          <VoiceOnlyDemo
            ref={voiceRef}
            loadModels={engaged}
            onSubmit={hosted.onSubmit}
            preloadLocalLlm={canRunLocalLlm}
            onLocalLlmReady={hosted.switchToLocal}
            loadingProgress={session.recordProgress}
            onStatusChange={session.setStatus}
            onUserInterrupt={session.onUserInterrupt}
            onError={session.handleError}
            onTtsEngineChange={session.setTtsEngine}
            isMobile={isMobile}
          />
        )}

        <div
          role="group"
          aria-label="Demo mode"
          className="mode-switch"
          style={{
            position: 'absolute', top: '14px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '2px', padding: '3px', borderRadius: '999px',
            background: 'rgba(15, 17, 22, 0.8)', border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', zIndex: 5,
          }}
        >
          <button aria-pressed={mode === 'avatar'} onClick={() => switchMode('avatar')}>3D avatar</button>
          <button aria-pressed={mode === 'voice'} onClick={() => switchMode('voice')}>Voice only</button>
        </div>

        {/* Voice mode has no mesh to wait for, so no overlay at all: fading
            one out left it visible over the orb for the length of the fade. */}
        {mode === 'avatar' && (
          <div
            aria-hidden={meshReady}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              opacity: meshReady ? 0 : 1,
              transition: 'opacity 0.6s ease',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              <div className="hero-pulse" style={{ width: '56px', height: '56px', borderRadius: '50%', border: `2px solid ${ACCENT}55`, borderTopColor: ACCENT }} />
              <span style={{ fontSize: '13px', color: '#64748B' }}>Loading avatar…</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

/**
 * Aim the camera at a point.
 *
 * R3F points its default camera at the world origin when it creates it, so
 * moving the camera up only tilts it down at the same spot and the frame stays
 * centred on the avatar's waist. Framing a face needs the aim set explicitly.
 */
const AimCamera: React.FC<{ at: [number, number, number] }> = ({ at }) => {
  const camera = useThree(state => state.camera);
  useLayoutEffect(() => {
    camera.lookAt(...at);
    camera.updateProjectionMatrix();
  }, [camera, at[0], at[1], at[2]]);
  return null;
};

const primaryButton: React.CSSProperties = {
  background: ACCENT,
  color: '#0B1220',
  border: 'none',
  borderRadius: '14px',
  padding: '14px 28px',
  fontSize: '16px',
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: `0 10px 30px ${ACCENT}40`,
};

const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  background: 'rgba(255,255,255,0.08)',
  color: '#F8FAFC',
  boxShadow: 'none',
  border: '1px solid rgba(255,255,255,0.12)',
};

const noteStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: 1.6,
  color: '#94A3B8',
  margin: '14px 0 0',
  maxWidth: '440px',
};

const codeChip: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  fontSize: '13px',
  color: '#E2E8F0',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  padding: '8px 12px',
};

const textButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
  color: '#E2E8F0',
  fontSize: '15px',
  fontWeight: 600,
};
