'use client';
// The hook needs the browser (microphone, audio, workers), so this component is
// a client component. The page that renders it can stay a server component.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
// Import from /headless. The package root also exports the hook, but pulls
// three.js and the 3D avatar into this route's bundle with it.
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

type Status = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
type Turn = { role: 'user' | 'assistant'; content: string };

/** Orb colours per state, so it says what is happening without any text. */
const COLOURS: Record<Status, [string, string]> = {
  loading: ['#334155', '#1E293B'],
  idle: ['#38BDF8', '#6366F1'],
  listening: ['#22D3EE', '#38BDF8'],
  thinking: ['#818CF8', '#C084FC'],
  speaking: ['#38BDF8', '#A78BFA'],
};

/** The engine's model keys, named for a person. */
const MODEL_NAMES: Record<string, string> = {
  asr: 'Speech recognition',
  tts: 'Voice',
  kokoro: 'Voice',
};

const LABELS: Record<Status, string> = {
  loading: 'Loading…',
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking — talk over it to interrupt',
};

export default function VoiceMode() {
  const [started, setStarted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [caption, setCaption] = useState<{ who: 'you' | 'assistant'; text: string } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const history = useRef<Turn[]>([]);
  const levelRef = useRef(0);
  const orbRef = useRef<HTMLDivElement>(null);

  const voice = useAiVoiceAvatar({
    // Nothing downloads until the visitor asks for it.
    loadModels: started,
    ttsVoice: 'af_heart',

    // Replies come from app/api/chat/route.ts, which holds the key. Because
    // onSubmit is set, the in-browser language model is never downloaded.
    onSubmit: async text => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: history.current }),
      });
      if (!res.ok || !res.body) {
        const { message } = await res.json().catch(() => ({ message: `The route answered ${res.status}.` }));
        setRouteError(message);
        return '';
      }
      setRouteError(null);
      // `return res.body` works on its own: the hook reads a text stream and
      // starts speaking at the first sentence. Wrapping it is only so the
      // finished reply can be remembered for the next turn.
      return remember(res.body, text, history);
    },

    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') setCaption({ who: 'you', text });
    },
    // One sentence at a time, as it starts to play.
    onSpeechStart: text => setCaption({ who: 'assistant', text }),
    // 0 to 1, every frame: the microphone while listening, the voice while speaking.
    onAudioLevelChange: level => {
      levelRef.current = level;
    },
    loadingProgress: (pct, label) => {
      const name = MODEL_NAMES[label] ?? label;
      setProgress(p => (pct > (p[name] ?? 0) ? { ...p, [name]: pct } : p));
    },
    onError: e => console.warn(`[voice] ${e.severity} in ${e.stage}: ${e.message}`),
  });

  // Written straight to the DOM: routing a level that changes sixty times a
  // second through React state would re-render the page every frame.
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = (t: number) => {
      frame = requestAnimationFrame(tick);
      shown += (levelRef.current - shown) * 0.25;
      const scale = 1 + Math.sin(t / 900) * 0.02 + shown * 0.32;
      if (orbRef.current) orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const status = voice.status as Status;
  const ready = started && status !== 'loading';

  const toggleMic = () => {
    if (micOn) {
      voice.stopListening();
      voice.interrupt();
      setMicOn(false);
    } else {
      voice.startListening(); // Call from a click: this is where the mic prompt appears.
      setMicOn(true);
    }
  };

  const [from, to] = COLOURS[status === 'loading' && !started ? 'idle' : status];

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 48, padding: 24, boxSizing: 'border-box' }}>
      <div
        ref={orbRef}
        className={status === 'thinking' ? 'orb-thinking' : undefined}
        style={{
          width: 200, height: 200, borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, #FFFFFF55 0%, transparent 35%), linear-gradient(135deg, ${from}, ${to})`,
          boxShadow: `0 0 80px ${from}66, inset 0 -12px 30px ${to}88`,
          transition: 'background 0.6s ease, box-shadow 0.6s ease',
          willChange: 'transform',
        }}
      />

      <div aria-live="polite" style={{ minHeight: 84, maxWidth: 480, textAlign: 'center' }}>
        {caption && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: caption.who === 'you' ? '#60A5FA' : '#A78BFA', marginBottom: 8 }}>
              {caption.who === 'you' ? 'You' : 'Assistant'}
            </div>
            <div style={{ fontSize: 18, lineHeight: 1.5 }}>{caption.text}</div>
          </>
        )}
      </div>

      {!started ? (
        <button onClick={() => setStarted(true)} style={buttonStyle}>Start</button>
      ) : !ready ? (
        <p style={{ color: '#94A3B8', textAlign: 'center', lineHeight: 1.8 }}>
          {Object.entries(progress).map(([name, pct]) => `${name} ${Math.round(pct)}%`).join(' · ') || 'Starting…'}
          <br />
          <span style={{ fontSize: 13, color: '#64748B' }}>Your browser keeps these, so next time is quick.</span>
        </p>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <button onClick={toggleMic} style={{ ...buttonStyle, background: micOn ? '#EF4444' : buttonStyle.background }}>
            {micOn ? 'Stop' : 'Talk'}
          </button>
          <p style={{ color: routeError ? '#FCA5A5' : '#94A3B8', marginTop: 14, fontSize: 14, maxWidth: 480 }}>
            {voice.micError
              ? 'Microphone blocked. Allow it in the address bar.'
              : routeError ?? (micOn ? LABELS[status] : 'Tap Talk and speak.')}
          </p>
        </div>
      )}
    </main>
  );
}

/**
 * Pass the reply on as it streams, and add the whole of it to the history once
 * it has finished, or once the visitor has interrupted it.
 */
async function* remember(body: ReadableStream<Uint8Array>, question: string, history: { current: Turn[] }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let reply = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      reply += text;
      yield text;
    }
  } finally {
    reader.cancel().catch(() => {});
    history.current = [...history.current, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: reply }].slice(-6);
  }
}

const buttonStyle: CSSProperties = {
  background: '#38BDF8',
  color: '#0B1220',
  border: 'none',
  borderRadius: 999,
  padding: '14px 36px',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
};
