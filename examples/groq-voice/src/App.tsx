import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

/**
 * Voice mode on Groq's free tier, handing over to the browser.
 *
 * Hearing, replies and the voice all start on Groq, so the first turn needs no
 * download at all. Meanwhile the in-browser hearing and voice download behind
 * the conversation (`preloadLocalSpeech`), and once they are ready the page
 * offers to switch: no daily limit, and what you say stays on the device.
 * Replies stay on Groq either way; see the README for running those in the
 * browser too.
 */

type Status = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
type Service = 'transcribe' | 'chat' | 'speak';

const COLOURS: Record<Status, [string, string]> = {
  loading: ['#334155', '#1E293B'],
  idle: ['#F97316', '#EC4899'],
  listening: ['#FB923C', '#F97316'],
  thinking: ['#A78BFA', '#EC4899'],
  speaking: ['#F97316', '#A78BFA'],
};

const LABELS: Record<Status, string> = {
  loading: 'Loading…',
  idle: 'Go ahead, it is listening.',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking. Talk over it to interrupt.',
};

/**
 * Groq's free tier for each model this uses, from the Limits page of the
 * console in October 2026. Yours may differ, which is why the page also shows
 * what Groq reports on every response.
 */
const FREE_TIER: Record<Service, { part: string; model: string; minute: string; day: string; note?: string }> = {
  transcribe: {
    part: 'Hearing',
    model: 'Whisper large v3 turbo',
    minute: '20 requests',
    day: '2,000 requests · 28,800 audio seconds',
    note: 'Every request counts as at least 10 seconds of audio, however short.',
  },
  chat: {
    part: 'Replies',
    model: 'GPT-OSS 20B',
    minute: '30 requests · 8,000 tokens',
    day: '1,000 requests · 200,000 tokens',
  },
  speak: {
    part: 'Voice',
    model: 'Orpheus',
    minute: '10 requests · 1,200 tokens',
    day: '100 requests · 3,600 tokens',
    note: 'One request per sentence, so 100 a day is only a few conversations.',
  },
};

/** What Groq's headers said on the last response for each model. */
type Live = { requestsLeft?: string; requestsLimit?: string; tokensLeft?: string; tokensLimit?: string };

export default function App() {
  const [started, setStarted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [caption, setCaption] = useState<{ who: 'you' | 'assistant'; text: string } | null>(null);
  /** Where hearing and the voice run. Replies are always Groq's. */
  const [speech, setSpeech] = useState<'groq' | 'browser'>('groq');
  const [localReady, setLocalReady] = useState(false);
  const [offerDismissed, setOfferDismissed] = useState(false);
  const [localProgress, setLocalProgress] = useState<Record<string, number>>({});
  const [live, setLive] = useState<Partial<Record<Service, Live>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const history = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const levelRef = useRef(0);
  const orbRef = useRef<HTMLDivElement>(null);

  /** POST to one of the routes in server/groq.ts, keeping the limits it reports. */
  const callGroq = async (service: Service, body: BodyInit, contentType: string) => {
    const res = await fetch(`/api/${service}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    const h = res.headers;
    if (h.has('x-ratelimit-remaining-requests') || h.has('x-ratelimit-remaining-tokens')) {
      setLive(prev => ({
        ...prev,
        [service]: {
          requestsLeft: h.get('x-ratelimit-remaining-requests') ?? undefined,
          requestsLimit: h.get('x-ratelimit-limit-requests') ?? undefined,
          tokensLeft: h.get('x-ratelimit-remaining-tokens') ?? undefined,
          tokensLimit: h.get('x-ratelimit-limit-tokens') ?? undefined,
        },
      }));
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const part = FREE_TIER[service].part.toLowerCase();
      if (err.error === 'no-key') setNotice(err.message);
      else if (res.status === 429) {
        const wait = Number(h.get('retry-after'));
        setNotice(`Groq's free limit for ${part} is used up for now${wait > 0 ? `; it resets in ${inWords(wait)}` : ''}.`);
        // The one case the in-browser models fix outright: offer them again.
        if (service !== 'chat') setOfferDismissed(false);
      } else setNotice(`Groq refused the ${part} request: ${err.message ?? res.status}.`);
      throw new Error(`${service} failed: ${res.status}`);
    }
    return res;
  };

  const voice = useAiVoiceAvatar({
    loadModels: started,

    // Replies: Groq, with the conversation so far so it can follow up.
    onSubmit: async text => {
      const res = await callGroq('chat', JSON.stringify({ text, history: history.current }), 'application/json');
      const { reply } = await res.json();
      history.current = [...history.current, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: reply }].slice(-6);
      // A string rather than a stream: the hook then speaks it a sentence at a
      // time, each under Orpheus's 200-character limit.
      return reply;
    },

    // Hearing and the voice: Groq until the visitor switches. Removing an
    // adapter is all switching is; the hook uses its own model from then on.
    onTranscribe: speech === 'groq'
      ? async samples => (await (await callGroq('transcribe', toWav(samples, 16000), 'audio/wav')).json()).text
      : undefined,
    onSynthesize: speech === 'groq'
      ? async text => (await callGroq('speak', JSON.stringify({ text }), 'application/json')).arrayBuffer()
      : undefined,

    // Fetch the in-browser hearing and voice behind the conversation.
    preloadLocalSpeech: true,
    onLocalSpeechReady: () => setLocalReady(true),
    ttsVoice: 'af_heart',
    loadingProgress: (pct, label) => {
      const name = label === 'asr' ? 'hearing' : 'voice';
      setLocalProgress(p => (pct > (p[name] ?? 0) ? { ...p, [name]: pct } : p));
    },

    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') setCaption({ who: 'you', text });
    },
    onSpeechStart: text => setCaption({ who: 'assistant', text }),
    onAudioLevelChange: level => {
      levelRef.current = level;
    },
    onError: e => console.warn(`[groq-voice] ${e.severity} in ${e.stage}: ${e.message}`),
  });

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
  const [from, to] = COLOURS[status === 'loading' && !started ? 'idle' : status];
  const offerSwitch = localReady && speech === 'groq' && !offerDismissed;
  const downloading = started && !localReady;

  const toggleMic = () => {
    if (micOn) {
      voice.stopListening();
      voice.interrupt();
    } else {
      voice.startListening();
    }
    setMicOn(!micOn);
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, padding: '48px 16px' }}>
      <div
        ref={orbRef}
        className={status === 'thinking' ? 'orb-thinking' : undefined}
        style={{
          width: 180, height: 180, borderRadius: '50%', flexShrink: 0,
          background: `radial-gradient(circle at 35% 30%, #FFFFFF55 0%, transparent 35%), linear-gradient(135deg, ${from}, ${to})`,
          boxShadow: `0 0 80px ${from}66, inset 0 -12px 30px ${to}88`,
          transition: 'background 0.6s ease, box-shadow 0.6s ease',
          willChange: 'transform',
        }}
      />

      <div aria-live="polite" style={{ minHeight: 72, maxWidth: 480, textAlign: 'center' }}>
        {caption && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: caption.who === 'you' ? '#FB923C' : '#A78BFA', marginBottom: 8 }}>
              {caption.who === 'you' ? 'You' : 'Assistant'}
            </div>
            <div style={{ fontSize: 18, lineHeight: 1.5 }}>{caption.text}</div>
          </>
        )}
      </div>

      {!started ? (
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <button onClick={() => setStarted(true)} style={button}>Start</button>
          <p style={note}>
            Starts on Groq, so there is nothing to wait for. The in-browser hearing and voice
            (about 590 MB, kept for next time) download behind the conversation, and you can
            switch to them when they are ready.
          </p>
        </div>
      ) : !ready ? (
        <p style={note}>Starting…</p>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <button onClick={toggleMic} style={{ ...button, background: micOn ? '#EF4444' : button.background }}>
            {micOn ? 'Stop' : 'Talk'}
          </button>
          <p style={note}>
            {voice.micError ? 'Microphone blocked. Allow it in the address bar.' : micOn ? LABELS[status] : 'Tap Talk and speak.'}
          </p>
        </div>
      )}

      {notice && <p role="alert" style={{ ...note, color: '#FBBF24', maxWidth: 440 }}>{notice}</p>}

      {offerSwitch && (
        <div role="dialog" aria-label="Switch to the in-browser hearing and voice" style={card}>
          <strong style={{ fontSize: 15 }}>The in-browser hearing and voice are ready.</strong>
          <p style={{ ...note, marginTop: 8 }}>
            Switch to them? They have no daily limit, and what you say no longer leaves this
            device. The voice will sound different{voice.activeTtsEngine === 'mms' || /iPhone|iPad/.test(navigator.userAgent) ? ', and plainer on this device' : ''}.
            Replies still come from Groq.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
            <button onClick={() => { setSpeech('browser'); setNotice(null); }} style={{ ...button, padding: '10px 24px', fontSize: 14 }}>Switch</button>
            <button onClick={() => setOfferDismissed(true)} style={{ ...button, padding: '10px 24px', fontSize: 14, background: 'rgba(255,255,255,0.08)', color: '#E2E8F0' }}>Keep Groq</button>
          </div>
        </div>
      )}

      {started && (
        <section style={{ ...card, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.9 }}>
            <div>Hearing: <b style={strong}>{speech === 'groq' ? 'Groq, Whisper large v3 turbo' : 'your browser, Whisper base'}</b></div>
            <div>Replies: <b style={strong}>Groq, GPT-OSS 20B</b></div>
            <div>Voice: <b style={strong}>{speech === 'groq' ? 'Groq, Orpheus' : voice.activeTtsEngine === 'mms' ? 'your browser, MMS' : 'your browser, Kokoro'}</b></div>
            {downloading && (
              <div style={{ color: '#64748B' }}>
                In-browser hearing {Math.round(localProgress.hearing ?? 0)}% · voice {Math.round(localProgress.voice ?? 0)}%
              </div>
            )}
            {speech === 'browser' && (
              <button onClick={() => { setSpeech('groq'); setOfferDismissed(true); }} style={link}>Back to Groq</button>
            )}
          </div>

          <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#E2E8F0', margin: '20px 0 10px' }}>
            Groq free-tier limits
          </h2>
          {(Object.keys(FREE_TIER) as Service[]).map(service => {
            const tier = FREE_TIER[service];
            const now = live[service];
            const idle = service !== 'chat' && speech === 'browser';
            return (
              <div key={service} style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, marginBottom: 12, opacity: idle ? 0.5 : 1 }}>
                <div><b style={strong}>{tier.part}</b> · {tier.model}{idle ? ' · not in use' : ''}</div>
                <div>Per minute: {tier.minute}</div>
                <div>Per day: {tier.day}</div>
                {now?.requestsLeft && (
                  <div style={{ color: '#FDBA74' }}>
                    Left today: {now.requestsLeft}{now.requestsLimit ? ` of ${now.requestsLimit}` : ''} requests
                    {now.tokensLeft ? ` · ${now.tokensLeft}${now.tokensLimit ? ` of ${now.tokensLimit}` : ''} tokens this minute` : ''}
                  </div>
                )}
                {tier.note && <div style={{ color: '#64748B' }}>{tier.note}</div>}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

/** A wait in seconds, the way a person would say it. */
function inWords(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/** 16-bit PCM WAV, the smallest file Groq's transcription accepts without an encoder. */
function toWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

const button: CSSProperties = {
  background: '#F97316',
  color: '#0B1220',
  border: 'none',
  borderRadius: 999,
  padding: '14px 36px',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
};

const note: CSSProperties = { color: '#94A3B8', marginTop: 14, fontSize: 14, lineHeight: 1.6, textAlign: 'center' };
const card: CSSProperties = { width: '100%', maxWidth: 440, padding: 20, borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' };
const strong: CSSProperties = { color: '#E2E8F0', fontWeight: 600 };
const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#FB923C', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' };
