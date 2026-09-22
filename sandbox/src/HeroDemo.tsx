import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';

type Status = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';

const ACCENT = '#38BDF8';

/**
 * What the avatar says first.
 *
 * It exists to teach the one thing a visitor would not think to try: talking
 * over it. Everything else about a voice avatar is obvious from looking at one.
 */
const GREETING =
  "Hi! My voice, my face and my hearing all run in your browser. My answers come from a hosted model. " +
  "Tap the button and ask me something. And if I ramble, just start talking. I'll stop and listen.";

const SYSTEM_PROMPT =
  'You are Ananya, the demo avatar for react-ai-voice-avatar, an open-source React component. ' +
  'Facts you may use: it renders a lip-synced 3D avatar on the user\'s own GPU; speech recognition, ' +
  'the voice and facial animation run in the browser; developers can connect their own language model ' +
  'such as OpenAI or Claude through an onSubmit prop, which is how this demo gets its replies; ' +
  'it is MIT licensed and installs from npm. ' +
  'If you do not know something, say so. Answer in one or two short spoken sentences. ' +
  'Never use markdown, lists or emoji.';

/**
 * The download a visitor commits to, stated before they commit to it.
 *
 * Summed from the files the engine actually requests, not the model cards:
 * Whisper base 278 MB and Kokoro at fp32 310 MB. The 750 MB language model is
 * no longer part of it, because replies come from the hosted route below —
 * which is what makes this demo usable on a phone at all.
 */
const DOWNLOAD_SIZE = '~590 MB';

/**
 * Named in the label, so a visitor knows whose model answered them.
 *
 * Which one it is cannot be hardcoded here: the route tries several candidates
 * and uses the first the account can reach, and the one it reached last week
 * can return `model_not_found` today. So the reply carries its own model id and
 * this only makes it readable.
 */
const HOSTED_MODEL_NAMES: Record<string, string> = {
  'llama-3.3-70b-versatile': 'Llama 3.3 70B on Groq',
  'openai/gpt-oss-20b': 'GPT-OSS 20B on Groq',
  'llama-3.1-8b-instant': 'Llama 3.1 8B on Groq',
};
const hostedModelName = (id: string | null) =>
  id ? HOSTED_MODEL_NAMES[id] || `${id} on Groq` : 'a hosted model on Groq';

const LOCAL_MODEL = 'Qwen2.5-0.5B, in your browser';

/**
 * What the avatar says when the hosted route will not answer.
 *
 * It is a rate limit or a missing key, never a model reply, so it says so
 * plainly rather than inventing an apology in the avatar's voice.
 */
const HOSTED_UNAVAILABLE_LOCAL_COMING =
  "The hosted model isn't answering right now, and I'm still downloading the one that runs in your browser. Give me a minute and ask again.";
const HOSTED_UNAVAILABLE =
  "The hosted model isn't answering right now. On a desktop this runs a model in your browser instead, with no limit at all.";

const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

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

  // Nothing downloads until this is true. The avatar still renders and idles,
  // which is the point: a visitor sees the product before deciding to spend
  // half a gigabyte on it.
  const [engaged, setEngaged] = useState(false);
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
  // The mesh takes several seconds to parse, and an empty dark panel in that
  // time reads as a broken page rather than a loading one.
  const [meshReady, setMeshReady] = useState(false);
  const greetedRef = useRef(false);

  /**
   * Which model is answering.
   *
   * Starts hosted, because a 0.5B model in a browser answers "what drinks do
   * you have?" with a question and that is the first thing a visitor sees. On a
   * machine that can run one, the local model downloads during the conversation
   * and takes over — which is the package's actual claim, demonstrated rather
   * than asserted.
   */
  const [brain, setBrain] = useState<'hosted' | 'local'>('hosted');
  /** Which hosted model replied, as the route reported it. Null until it does. */
  const [hostedModel, setHostedModel] = useState<string | null>(null);

  /** Only a desktop with WebGPU is asked to fetch 750 MB in the background. */
  const canRunLocalLlm = !isMobile && hasWebGpu;

  /**
   * The conversation so far, sent back to the hosted route so it can follow up.
   *
   * Kept here rather than read from the engine because the hosted route is the
   * thing that needs it, and the engine deliberately does not record turns it
   * did not answer itself.
   */
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const askHosted = async (text: string): Promise<string> => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: historyRef.current }),
      });

      if (res.ok) {
        const data = await res.json();
        const reply: string = data.reply;
        if (data.model) setHostedModel(data.model);
        historyRef.current = [
          ...historyRef.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: reply },
        ].slice(-4);
        return reply;
      }

      // Every refusal — no key in local development, a rate limit, an outage —
      // lands here, and the visitor gets the same honest sentence.
      console.warn('[hero] hosted reply unavailable:', res.status);
    } catch (err) {
      console.warn('[hero] hosted reply failed:', err);
    }

    return canRunLocalLlm ? HOSTED_UNAVAILABLE_LOCAL_COMING : HOSTED_UNAVAILABLE;
  };

  const ready = engaged && status !== 'loading';
  /** The background download of the local model, once it has started. */
  const localLlmProgress = progress['llm'] ?? 0;

  // Greet once, the moment the models are up. The click that set `engaged` was
  // the user gesture, so the browser lets this play without another tap.
  useEffect(() => {
    if (!ready || greetedRef.current) return;
    greetedRef.current = true;
    avatarRef.current?.speak(GREETING);
  }, [ready]);

  const talk = () => {
    setInterrupted(false);
    setMicBlocked(false);
    setMicOpen(true);
    avatarRef.current?.startListening();
  };

  const stop = () => {
    setMicOpen(false);
    avatarRef.current?.stopListening();
    avatarRef.current?.interrupt();
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
          A talking avatar that runs on your visitor's GPU.
        </h1>
        <p style={{ fontSize: isMobile ? '16px' : '18px', lineHeight: 1.6, color: '#94A3B8', margin: '0 0 32px', maxWidth: '520px' }}>
          The open-source alternative to real-time avatar APIs. No video stream, no per-minute billing.
          Bring your own model, or run one in the browser. This demo does both.
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
              Hearing, voice and lip-sync run in your browser — {DOWNLOAD_SIZE} the first time, about half of which your browser keeps for next time.
              Replies come from a hosted model{canRunLocalLlm ? ', until the in-browser one finishes downloading behind the conversation.' : '.'}
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
          <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' }}>
            {MODEL_ROWS.map(({ key, label }) => {
              const pct = progress[key] ?? 0;
              return (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#CBD5E1', marginBottom: '6px' }}>
                    <span>{label}</span>
                    <span style={{ color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
                  </div>
                  <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: ACCENT, transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              );
            })}
            {/* Measured rather than hoped: Chrome's Cache API refuses any single
                entry of 256 MiB or more (255 MiB stores, 256 MiB fails), and it
                is not a quota problem. Whisper arrives as a 78.6 MB encoder and a
                198.9 MB decoder, so both are kept; the Kokoro voice is one ~310 MB
                file, so it is refused and fetched again every visit.
                transformers.js logs that as a warning and carries on. Shrinking
                the voice is what fixes it — see ROADMAP item 1. */}
            <p style={{ ...noteStyle, marginTop: '4px' }}>
              Your browser keeps the speech model for next time. The voice is too large for it to store, so that part downloads again.
            </p>
          </div>
        )}

        {ready && (
          <div aria-live="polite">
            {micOpen ? (
              <button onClick={stop} style={secondaryButton}>Stop</button>
            ) : (
              <button onClick={talk} style={primaryButton}>Tap to talk</button>
            )}
            <p style={noteStyle}>{hint}</p>

            {/* Which half runs where, stated plainly and kept accurate as it
                changes. The page claims the browser does the work, so the one
                part that does not has to be named rather than glossed over. */}
            <p style={{ ...noteStyle, marginTop: '10px', fontSize: '13px', color: '#64748B' }}>
              Hearing, voice and lip-sync: your browser. Replies:{' '}
              <span style={{ color: '#94A3B8' }}>
                {brain === 'hosted' ? hostedModelName(hostedModel) : LOCAL_MODEL}
              </span>
              {brain === 'hosted' && canRunLocalLlm && (
                <span style={{ display: 'block', marginTop: '4px' }}>
                  {localLlmProgress > 0
                    ? `Fetching the in-browser model too — ${Math.round(localLlmProgress)}%. It takes over when it lands.`
                    : 'Fetching the in-browser model too. It takes over when it lands.'}
                </span>
              )}
            </p>
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
        {/* Framed on the face rather than the whole figure: lip sync is the part
            worth watching, and at full-body distance the mouth is a few pixels. */}
        <Canvas camera={{ position: [0, 0.37, 0.93], fov: 30 }} style={{ width: '100%', height: '100%' }}>
          <color attach="background" args={['#101116']} />
          <AimCamera at={[0, 0.37, 0]} />
          <AiVoiceAvatar
            ref={avatarRef}
            loadModels={engaged}
            avatarPreset="ananya"
            ttsVoice="af_heart"
            systemPrompt={SYSTEM_PROMPT}
            // Hosted until the in-browser model is warm, then dropped, which is
            // what hands the conversation over. The engine carries the turns
            // across, so the local model knows what was already said.
            onSubmit={brain === 'hosted' ? askHosted : undefined}
            preloadLocalLlm={canRunLocalLlm}
            onLocalLlmReady={() => setBrain('local')}
            showCaptions={true}
            // This page owns the call to action until the visitor engages; the
            // pill would otherwise announce a download that has not started.
            hideStatusPill={true}
            scale={isMobile ? 0.4 : 0.5}
            position={[0, isMobile ? -0.26 : -0.36, 0]}
            loadingProgress={(pct, label) => {
              const key = label === 'tts' ? 'kokoro' : label;
              // Hold each model at its highest, so an out-of-order message
              // can never move a row backwards.
              setProgress(prev => (pct > (prev[key] ?? 0) ? { ...prev, [key]: pct } : prev));
            }}
            onStatusChange={setStatus}
            onModelLoaded={() => setMeshReady(true)}
            onUserInterrupt={() => setInterrupted(true)}
            enableLocalAssetProbe={import.meta.env.DEV}
            onError={(e) => {
              console.warn(`[hero] ${e.severity} in ${e.stage}: ${e.message}`);
              if (e.stage === 'microphone') {
                setMicOpen(false);
                setMicBlocked(true);
              }
            }}
          />
        </Canvas>

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

/**
 * The models this demo waits for, named for a visitor rather than an engineer.
 *
 * No language model row: replies start hosted, so nobody waits for one. On a
 * capable desktop it downloads later, behind the conversation, and is reported
 * in the line under the button instead.
 */
const MODEL_ROWS: Array<{ key: string; label: string }> = [
  { key: 'asr', label: 'Speech recognition' },
  { key: 'kokoro', label: 'Voice' },
];

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
