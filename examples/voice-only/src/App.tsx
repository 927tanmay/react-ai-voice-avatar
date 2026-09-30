import { useEffect, useRef, useState, type CSSProperties } from 'react';
// The headless entry point: microphone, turn-taking, interruption, speech
// recognition and the voice, with no three.js anywhere in your bundle.
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

type Status = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';

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
  llm: 'Language model',
};

const LABELS: Record<Status, string> = {
  loading: 'Loading…',
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking — talk over it to interrupt',
};

export default function App() {
  const [started, setStarted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  // One figure per model. They download in parallel at very different sizes,
  // so a single number either sits at 99% while the largest is still going or
  // jumps between them.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [caption, setCaption] = useState<{ who: 'you' | 'assistant'; text: string } | null>(null);
  const levelRef = useRef(0);
  const orbRef = useRef<HTMLDivElement>(null);

  const voice = useAiVoiceAvatar({
    // Nothing downloads until the visitor asks for it.
    loadModels: started,
    ttsVoice: 'af_heart',
    systemPrompt: 'You are a helpful voice assistant. Answer in one or two short spoken sentences.',

    // With no onSubmit, a small language model runs in the browser too, so this
    // example needs no backend at all. To use your own model instead, return
    // its reply (a string, or a stream of text) from onSubmit:
    //
    // onSubmit: async (text) => {
    //   const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    //   return (await res.json()).reply;
    // },

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
  // second through React state would re-render the app every frame.
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
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 48, padding: 24 }}>
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
          <p style={{ color: '#94A3B8', marginTop: 14, fontSize: 14 }}>
            {voice.micError ? 'Microphone blocked. Allow it in the address bar.' : micOn ? LABELS[status] : 'Tap Talk and speak.'}
          </p>
        </div>
      )}
    </main>
  );
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
