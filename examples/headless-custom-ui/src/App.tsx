import React, { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';

interface ChatMessage {
  id: string;
  speaker: 'user' | 'avatar' | 'system';
  text: string;
  time: string;
}

const QUICK_SCRIPTS = [
  {
    label: "👋 Speak Greeting",
    color: "#8B5CF6",
    text: "Hello and welcome! I am your enterprise autonomous digital avatar running completely headless inside your custom application design."
  },
  {
    label: "💡 Q3 Performance Pitch",
    color: "#06B6D4",
    text: "Our third quarter quarterly returns exceeded projections by fourteen percent, driven by widespread adoption of local WebGPU inference engines!"
  },
  {
    label: "🚨 Security Protocol Notice",
    color: "#F43F5E",
    text: "Attention: Acoustic privacy protocols are active. Microphone audio frames are transcribed entirely inside client memory without leaving this terminal."
  }
];

export default function App() {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const [status, setStatus] = useState<string>('loading');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [customText, setCustomText] = useState<string>('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Helper to append messages to our custom UI transcript feed
  const addMessage = (speaker: 'user' | 'avatar' | 'system', text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessages(prev => [...prev, { id: Math.random().toString(36).substring(2, 9), speaker, text, time }]);
  };

  // Auto-scroll custom chat feed to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle conversational turns (skipping local LLM via onSubmit)
  const handleCloudSubmit = async (userText: string): Promise<string> => {
    // Here you can connect your private API, Next.js action, or GraphQL endpoint!
    // We demonstrate instantaneous contextual routing:
    let response = "I received your command. As a headless custom avatar, my DOM controls and subtitle feeds are entirely driven by your custom React interface!";
    const lower = userText.toLowerCase();

    if (lower.includes("hello") || lower.includes("hi")) {
      response = "Hello there! Try clicking one of the programmatic action scripts on the left dashboard to command my speech directly!";
    } else if (lower.includes("headless") || lower.includes("ui") || lower.includes("custom")) {
      response = "By hiding the default overlays and binding to my TypeScript Ref methods, you gain total aesthetic and behavioral control over the entire user experience.";
    } else if (lower.includes("price") || lower.includes("cost")) {
      response = "Our client-side WebGPU runtime saves enterprise server infrastructure costs by eliminating centralized GPU hosting fees.";
    }

    return response;
  };

  // Trigger imperative speech directly on the 3D avatar
  const handleSpeakScript = (text: string) => {
    if (avatarRef.current && status !== 'loading') {
      avatarRef.current.speak(text);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customText.trim() || status === 'loading') return;
    handleSpeakScript(customText.trim());
    setCustomText('');
  };

  const handleToggleListen = () => {
    if (status === 'loading' || !avatarRef.current) return;
    if (status === 'listening' || status === 'speaking') {
      avatarRef.current.stopListening();
      addMessage('system', '⏸️ Voice session paused by user.');
    } else {
      avatarRef.current.startListening();
      addMessage('system', '🎙️ Listening for microphone input...');
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', display: 'flex', background: '#07090E' }}>
      
      {/* ─── LEFT PANEL: EXECUTIVE COMMAND & CONTROLS DASHBOARD ─── */}
      <div style={{
        width: '400px', height: '100%', zIndex: 20, padding: '32px 28px',
        background: 'rgba(15, 23, 42, 0.85)', borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(24px)', display: 'flex', flexDirection: 'column', gap: '26px',
        boxShadow: '10px 0 35px rgba(0,0,0,0.6)'
      }}>
        {/* Title & Badge */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)', padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: '#FFF' }}>
              Headless Demo
            </span>
            <span style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>v1.0 Architecture</span>
          </div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px', color: '#FFF' }}>
            Bespoke Custom UI
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
            Demonstrating total interface freedom. Built-in DOM overlays are disabled, yielding control to your custom components and TypeScript Ref methods.
          </p>
        </div>

        {/* Custom Status Indicator Card */}
        <div style={{
          padding: '16px 20px', borderRadius: '16px', background: 'rgba(30, 41, 59, 0.6)',
          border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B', letterSpacing: '0.8px' }}>
              Avatar Engine State
            </div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: status === 'loading' ? '#F59E0B' : status === 'listening' ? '#10B981' : status === 'speaking' ? '#8B5CF6' : '#FFF', marginTop: '3px', textTransform: 'capitalize' }}>
              {status === 'loading' ? 'Initializing WebGPU...' : status === 'idle' ? 'Ready (Standby)' : status}
            </div>
          </div>
          <div style={{
            width: '14px', height: '14px', borderRadius: '50%',
            background: status === 'loading' ? '#F59E0B' : status === 'listening' ? '#10B981' : status === 'speaking' ? '#8B5CF6' : '#64748B',
            boxShadow: status === 'listening' ? '0 0 14px #10B981' : status === 'speaking' ? '0 0 14px #8B5CF6' : 'none'
          }} />
        </div>

        {/* Primary Voice Master Control Button */}
        <button
          onClick={handleToggleListen}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: '16px 0', borderRadius: '16px', border: 'none',
            background: status === 'loading' ? '#334155' : status === 'listening' ? '#EF4444' : 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
            color: '#FFF', fontSize: '16px', fontWeight: 700, cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            boxShadow: status === 'loading' ? 'none' : '0 8px 25px rgba(139, 92, 246, 0.35)',
            transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
          }}
        >
          <span>{status === 'listening' ? '🛑 Stop Microphone Session' : '🎙️ Start Voice Conversation'}</span>
        </button>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0' }} />

        {/* Section 2: Programmatic Quick Scripts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#E2E8F0', letterSpacing: '1px' }}>
            ⚡ Programmatic Script Triggers
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>
            Click to invoke <code style={{ color: '#06B6D4', background: 'rgba(6, 182, 212, 0.1)', padding: '2px 5px', borderRadius: '4px' }}>avatarRef.current.speak(text)</code>:
          </div>
          {QUICK_SCRIPTS.map((script, idx) => (
            <button
              key={idx}
              onClick={() => handleSpeakScript(script.text)}
              disabled={status === 'loading'}
              style={{
                padding: '13px 18px', borderRadius: '12px', border: `1px solid ${script.color}44`,
                background: 'rgba(30, 41, 59, 0.5)', color: '#F8FAFC', fontSize: '14px', fontWeight: 600,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer', textAlign: 'left',
                transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}
            >
              <span>{script.label}</span>
              <span style={{ fontSize: '16px' }}>▶</span>
            </button>
          ))}
        </div>

        {/* Section 3: Custom Text-to-Speech Synthesizer */}
        <form onSubmit={handleCustomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#E2E8F0', letterSpacing: '1px' }}>
            🗣️ Live Speech Broadcast
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Type any custom broadcast..."
              disabled={status === 'loading'}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(15, 23, 42, 0.9)', color: '#FFF', fontSize: '13px', outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={status === 'loading' || !customText.trim()}
              style={{
                padding: '0 18px', borderRadius: '12px', border: 'none', background: '#8B5CF6',
                color: '#FFF', fontWeight: 700, cursor: !customText.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              Speak
            </button>
          </div>
        </form>
      </div>

      {/* ─── CENTER: PURE 3D AVATAR VIEWPORT (ALL DOM OVERLAYS HIDDEN) ─── */}
      <div style={{ flex: 1, height: '100%', position: 'relative', background: 'radial-gradient(circle at 50% 45%, #151A2C 0%, #07090E 75%)' }}>
        <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
          {/* Cool modern violet & turquoise ambient studio lighting */}
          <pointLight position={[-3, 2, -2]} intensity={25} color="#8B5CF6" distance={6} />
          <pointLight position={[3, 1, -2]} intensity={18} color="#06B6D4" distance={6} />
          
          <OrbitControls target={[0, 0.05, 0]} minDistance={0.8} maxDistance={4} />

          <AiVoiceAvatar
            ref={avatarRef}
            avatarPreset="ananya"
            
            /**
             * HEADLESS ENTERPRISE CONFIGURATION:
             * Hiding both the default StatusPill and captions overlay ensures zero visual interference
             * inside your professional application styling.
             */
            hideStatusPill={true}
            showCaptions={false}
            debug={false}

            onSubmit={handleCloudSubmit}
            onTranscriptUpdate={(text, speaker) => {
              addMessage(speaker, text);
            }}

            ttsEngine="kokoro"
            ttsVoice="af_heart"
            environmentPreset="studio"

            scale={0.48}
            position={[-0.05, -0.42, 0]} // Center balanced between left and right sidebars
            onStatusChange={(newStatus) => setStatus(newStatus)}
          />
        </Canvas>
      </div>

      {/* ─── RIGHT PANEL: CUSTOM INTERACTIVE CONVERSATION FEED ─── */}
      <div style={{
        width: '380px', height: '100%', zIndex: 20, background: 'rgba(15, 23, 42, 0.85)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)', backdropFilter: 'blur(24px)',
        display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 35px rgba(0,0,0,0.6)'
      }}>
        <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(30, 41, 59, 0.4)' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, letterSpacing: '0.5px', color: '#FFF' }}>
            💬 Live Conversation Stream
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
            Powered via <code style={{ color: '#34D399' }}>onTranscriptUpdate()</code> hook subscriptions.
          </p>
        </div>

        {/* Message Logs */}
        <div ref={chatScrollRef} style={{ flex: 1, padding: '24px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', padding: '0 20px', color: '#64748B', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>✨</div>
              No speech messages recorded yet. Click a quick script on the left or start a voice conversation!
            </div>
          ) : (
            messages.map((m) => {
              if (m.speaker === 'system') {
                return (
                  <div key={m.id} style={{ alignSelf: 'center', fontSize: '12px', color: '#94A3B8', background: 'rgba(255,255,255,0.05)', padding: '6px 14px', borderRadius: '20px', fontWeight: 500 }}>
                    {m.text}
                  </div>
                );
              }

              const isUser = m.speaker === 'user';
              return (
                <div key={m.id} style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '88%',
                  background: isUser ? 'rgba(59, 130, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                  border: `1px solid ${isUser ? 'rgba(59, 130, 246, 0.4)' : 'rgba(139, 92, 246, 0.4)'}`,
                  padding: '14px 18px', borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '6px', fontSize: '11px', fontWeight: 700, color: isUser ? '#60A5FA' : '#C4B5FD', textTransform: 'uppercase' }}>
                    <span>{isUser ? '🎙️ You' : '🤖 Ananya AI'}</span>
                    <span style={{ fontSize: '10px', color: '#64748B', fontWeight: 500, textTransform: 'none' }}>{m.time}</span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#F8FAFC', lineHeight: 1.5 }}>
                    {m.text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '11px', color: '#64748B', textAlign: 'center', background: 'rgba(15, 23, 42, 0.95)' }}>
          🔒 Zero Raw Audio Transport • 100% Client-Side Voice Processing
        </div>
      </div>
    </div>
  );
}
