import React, { useEffect, useRef, useState } from 'react';
import { VoiceOnlyDemo, type VoiceOnlyHandle } from '../VoiceOnlyDemo';
import { hasWebGpu, useHostedBrain } from '../hostedBrain';
import { DOWNLOAD_SIZE, ModelProgress, useDemoSession } from '../demoSession';
import { TypeBox } from '../TypeBox';

const ACCENT = '#38BDF8';
const REPO = 'https://github.com/927tanmay/react-ai-voice-avatar';

const GREETING =
  "Hi! This is voice mode, with no avatar. My hearing and my voice run in your browser, " +
  "and my answers come from a hosted model. Tap the button and ask me something. If I ramble, just start talking.";

/** What a developer writes to get this page, give or take the styling. */
const SNIPPET = `import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

function VoiceMode() {
  const orb = useRef<HTMLDivElement>(null);
  const { status, startListening } = useAiVoiceAvatar({
    // Your model. Leave it out to answer in the browser.
    onSubmit: text => askYourModel(text),
    onAudioLevelChange: level => {
      orb.current!.style.scale = String(1 + level / 3);
    },
  });

  return (
    <>
      <div ref={orb} className="orb" data-status={status} />
      <button onClick={startListening}>Talk</button>
    </>
  );
}`;

const useMedia = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
};

/**
 * Voice mode on a page of its own, for a link people can open and try.
 *
 * The homepage offers the same thing behind a switch, but it leads with the
 * avatar, and its bundle carries three.js for it. This page imports only the
 * headless hook, so it is interactive as soon as React is, and the only thing
 * a visitor waits for is the speech models.
 */
export const VoicePage: React.FC = () => {
  const isMobile = useMedia('(max-width: 767px)');
  // Height decides as much as width here: the button has to be on screen
  // without scrolling, on a small phone and on a phone turned sideways.
  const short = useMedia('(max-height: 740px)');
  const tiny = useMedia('(max-height: 480px)');
  // A 768 px laptop: room for the introduction, not for the full-size orb.
  const medium = useMedia('(max-height: 860px)');
  const orbSize = tiny ? 90 : short ? 120 : isMobile ? 150 : medium ? 160 : 200;
  const voiceRef = useRef<VoiceOnlyHandle>(null);
  const [engaged, setEngaged] = useState(false);
  const greetedRef = useRef(false);
  const session = useDemoSession(() => voiceRef.current, 'voice');
  const { status, progress } = session;

  /** Only a desktop with WebGPU is asked to fetch 750 MB in the background. */
  const canRunLocalLlm = !isMobile && hasWebGpu;
  const hosted = useHostedBrain(canRunLocalLlm);

  const ready = engaged && status !== 'loading';
  const localLlmProgress = progress['llm'] ?? 0;

  // The click that set `engaged` was the user gesture, so the browser lets the
  // greeting play without another tap.
  useEffect(() => {
    if (!ready || greetedRef.current) return;
    greetedRef.current = true;
    voiceRef.current?.speak(GREETING);
  }, [ready]);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', color: '#E2E8F0' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: isMobile ? '6px 16px' : '10px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <a href="/" style={{ ...navLink, color: '#F8FAFC', fontWeight: 700, fontSize: '15px' }}>
          react-ai-voice-avatar
        </a>
        <nav style={{ display: 'flex', gap: isMobile ? '14px' : '24px', fontSize: '14px' }}>
          <a href="/" style={navLink}>{isMobile ? 'Avatar' : 'With an avatar'}</a>
          <a href={REPO} target="_blank" rel="noreferrer" style={navLink}>GitHub</a>
        </nav>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: short ? '16px 16px 32px' : isMobile ? '28px 16px 40px' : medium ? '32px 24px 48px' : '48px 24px 64px', textAlign: 'center' }}>
        {!short && <p style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: ACCENT, margin: '0 0 14px' }}>
          Open source · MIT · React
        </p>}
        <h1 style={{ fontSize: tiny ? '24px' : isMobile ? '28px' : '44px', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-1px', color: '#FFF', margin: short ? '0 0 4px' : '0 0 16px', maxWidth: '720px' }}>
          Voice mode for your app, running on your visitor's GPU.
        </h1>
        {/* Dropped where height is short; the heading says enough, and the
            section below the fold says the rest. */}
        {!short && (
          <p style={{ fontSize: isMobile ? '16px' : '18px', lineHeight: 1.6, color: '#94A3B8', margin: 0, maxWidth: '600px' }}>
            Talk to it the way you talk to ChatGPT or Gemini, and interrupt it mid-sentence.
            Speech recognition and the voice run in the browser. One React hook, your own UI.
          </p>
        )}

        <div style={{ width: '100%', maxWidth: '640px', padding: tiny ? 0 : short || medium ? '8px 0' : isMobile ? '12px 0' : '32px 0' }}>
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
            orbSize={orbSize}
            inFlow
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '460px' }}>
          {!engaged && (
            <>
              <button onClick={() => setEngaged(true)} style={primaryButton}>Talk to it</button>
              <p style={noteStyle}>
                Hearing and voice download to your browser — {DOWNLOAD_SIZE} the first time, kept for next time.
                Replies come from a hosted model{canRunLocalLlm ? ', until the in-browser one finishes downloading behind the conversation.' : '.'}
                {!hasWebGpu && (
                  <span style={warning}>Your browser doesn't expose WebGPU, so the voice will be slow. Chrome or Edge on a desktop is best.</span>
                )}
                {hasWebGpu && isMobile && (
                  <span style={warning}>That's a sizeable download for a phone — best on wifi.</span>
                )}
              </p>
            </>
          )}

          {engaged && !ready && (
            <>
              <ModelProgress progress={progress} accent={ACCENT} />
              <p style={noteStyle}>Your browser keeps these, so your next visit skips the download.</p>
            </>
          )}

          {ready && (
            <div aria-live="polite">
              {session.micOpen ? (
                <button onClick={session.stop} style={secondaryButton}>Stop</button>
              ) : (
                <button onClick={session.talk} style={primaryButton}>Tap to talk</button>
              )}
              <p style={noteStyle}>{session.hint}</p>
              <TypeBox onSend={session.type} accent={ACCENT} style={{ margin: '18px auto 0' }} />
              <p style={{ ...noteStyle, marginTop: '10px', fontSize: '13px', color: '#64748B' }}>
                Hearing and voice: your browser. Replies: <span style={{ color: '#94A3B8' }}>{hosted.answeredBy}</span>
                <span style={{ display: 'block', marginTop: '4px' }}>
                  Voice: <span style={{ color: '#94A3B8' }}>{session.voiceLabel}</span>
                </span>
                {hosted.brain === 'hosted' && canRunLocalLlm && (
                  <span style={{ display: 'block', marginTop: '4px' }}>
                    {localLlmProgress > 0
                      ? `Fetching the in-browser model too — ${Math.round(localLlmProgress)}%. It takes over when it lands.`
                      : 'Fetching the in-browser model too. It takes over when it lands.'}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </main>

      <section style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: isMobile ? '40px 16px 56px' : '64px 24px 80px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <h2 style={{ fontSize: isMobile ? '22px' : '26px', fontWeight: 700, color: '#F8FAFC', margin: '0 0 12px' }}>
            The whole page is one hook
          </h2>
          <p style={{ fontSize: '16px', lineHeight: 1.6, color: '#94A3B8', margin: '0 0 24px' }}>
            The headless entry runs listening, turn-taking, interruption and the voice, and hands you a
            level for the animation. It brings no three.js with it.
          </p>
          <pre style={codeBlock}><code>{SNIPPET}</code></pre>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '24px' }}>
            <code style={codeChip}>npm install react-ai-voice-avatar</code>
            <a href={`${REPO}/tree/main/examples/voice-only`} target="_blank" rel="noreferrer" style={{ ...navLink, color: ACCENT, fontWeight: 600 }}>
              The example app →
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};

/** 44 px tall, the smallest target a thumb hits reliably. */
const navLink: React.CSSProperties = {
  color: '#94A3B8',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '44px',
};

const primaryButton: React.CSSProperties = {
  background: ACCENT,
  color: '#0B1220',
  border: 'none',
  borderRadius: '14px',
  padding: '14px 32px',
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
};

const warning: React.CSSProperties = {
  display: 'block',
  marginTop: '8px',
  color: '#F59E0B',
};

const codeBlock: React.CSSProperties = {
  margin: 0,
  padding: '20px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#E2E8F0',
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  fontSize: '13px',
  lineHeight: 1.6,
  overflowX: 'auto',
  textAlign: 'left',
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
