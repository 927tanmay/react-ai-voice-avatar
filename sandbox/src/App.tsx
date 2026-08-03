import React, { useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';
import './style.css';

interface Persona {
  id: 'ananya' | 'aarav';
  name: string;
  hindiName: string;
  role: string;
  avatarIcon: string;
  preset: 'ananya' | 'aarav';
  accentColor: string;
  borderColor: string;
  systemPrompt: string;
  description: string;
  defaultVoice: string;
}

const PERSONAS: Persona[] = [
  {
    id: 'ananya',
    name: 'Ananya',
    hindiName: 'अनन्या',
    role: 'Female Voice Companion',
    avatarIcon: '👩🏽',
    preset: 'ananya',
    accentColor: '#E67E22', // Warm Saffron Gold / Peach
    borderColor: 'rgba(230, 126, 34, 0.6)',
    systemPrompt: "You are Ananya, an empathetic, warm, and lively conversational companion. You speak the way a person actually talks out loud, never like a written assistant or textbook. Keep your replies to 1-3 short, naturally spoken sentences unless explicitly asked for more detail. Never use lists, bullet points, markdown, or section headers—all of those sound absurd out loud. Always use contractions like I'm, that's, let's, and don't. To keep our chat feeling alive and flowing, occasionally end your answer by asking a short, friendly follow-up question.",
    description: 'Empathetic, warm, and highly expressive conversationalist.',
    defaultVoice: 'af_heart',
  },
  {
    id: 'aarav',
    name: 'Aarav',
    hindiName: 'आरव',
    role: 'Male Voice Companion',
    avatarIcon: '👨🏽',
    preset: 'aarav',
    accentColor: '#1A73E8', // Royal Peacock Indigo / Blue
    borderColor: 'rgba(26, 115, 232, 0.6)',
    systemPrompt: "You are Aarav, a charismatic, sharp, and confident technical guide and voice companion. You communicate like a real human conversing out loud, never defaulting to formal written essays or chatbot jargon. Always keep your replies to 1-3 concise, spoken sentences unless explicitly prompted for depth. Absolutely avoid lists, numbered steps, markdown, and headers—just speak naturally. Use common contractions like I'm, that's, can't, and don't. To maintain an authentic conversational dialogue rather than a Q&A terminal, occasionally weave in a brief, engaging follow-up question.",
    description: 'Confident, articulate, and dynamic technical assistant.',
    defaultVoice: 'am_michael',
  },
];

const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Ananya (af_heart - Warm Female A-Grade)' },
  { id: 'af_bella', label: 'Bella (af_bella - Expressive Female)' },
  { id: 'am_michael', label: 'Aarav (am_michael - Engaging Male)' },
  { id: 'am_fenrir', label: 'Fenrir (am_fenrir - Authoritative Male)' },
  { id: 'bf_emma', label: 'Emma (bf_emma - British Female)' },
  { id: 'bm_george', label: 'George (bm_george - British Male)' },
];

export const App: React.FC = () => {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const [_avatarStatus, setAvatarStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [activePersonaId, setActivePersonaId] = useState<'ananya' | 'aarav'>('ananya');
  
  // Dynamic TTS Engine Configuration & Seamless Switching
  const [ttsEngine, setTtsEngine] = useState<'kokoro' | 'mms'>('mms');
  const [ttsVoice, setTtsVoice] = useState<string>('af_heart');

  const currentPersona = PERSONAS.find(p => p.id === activePersonaId) || PERSONAS[0];

  const handlePersonaSelect = (persona: Persona) => {
    setActivePersonaId(persona.id);
    setTtsVoice(persona.defaultVoice);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#0C0D10', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Top Tricolor Accent Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '4px',
        background: 'linear-gradient(90deg, #FF9933 0%, #FFFFFF 50%, #138808 100%)',
        zIndex: 1000,
      }} />

      {/* Header Branding - Top Left */}
      <div style={{
        position: 'absolute',
        top: '24px',
        left: '24px',
        zIndex: 500,
        background: 'rgba(20, 22, 28, 0.75)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '16px 22px',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        maxWidth: '320px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '24px' }}>🇮🇳</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
            Indic<span style={{ color: currentPersona.accentColor }}>Avatar</span>
          </h1>
          <span style={{
            fontSize: '11px',
            backgroundColor: 'rgba(255, 153, 51, 0.2)',
            color: '#FF9933',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 600,
            border: '1px solid rgba(255, 153, 51, 0.4)',
          }}>v0.2.0</span>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: '#A0A6B2', lineHeight: '1.4' }}>
          Real-time Edge WebGPU conversational voice AI featuring human-like prosody & 3D virtual presence.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <span style={{ fontSize: '12px', color: '#138808', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#138808', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px #138808' }}></span>
            {ttsEngine === 'kokoro' ? 'Kokoro-82M Natural Voice' : 'Meta MMS-TTS Engine Ready'}
          </span>
        </div>
      </div>

      {/* Avatar Persona & TTS Engine Selector - Top Right */}
      <div style={{
        position: 'absolute',
        top: '24px',
        right: '24px',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '330px',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
      }}>
        {/* Persona Selector Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          padding: '14px 16px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
        }}>
          <h2 style={{ margin: '0 0 14px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            ✨ Select Persona
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {PERSONAS.map((persona) => {
              const isSelected = activePersonaId === persona.id;
              return (
                <div
                  key={persona.id}
                  onClick={() => handlePersonaSelect(persona)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: '1.5px solid',
                    borderColor: isSelected ? persona.borderColor : 'rgba(255, 255, 255, 0.08)',
                    boxShadow: isSelected ? `0 4px 20px ${persona.accentColor}33` : 'none',
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{
                    fontSize: '24px',
                    background: isSelected ? `${persona.accentColor}22` : 'rgba(255,255,255,0.05)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isSelected ? `1px solid ${persona.accentColor}` : '1px solid transparent',
                  }}>
                    {persona.avatarIcon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: '#FFFFFF' }}>{persona.name}</span>
                      <span style={{ fontWeight: 500, fontSize: '12px', color: persona.accentColor }}>({persona.hindiName})</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 500 }}>{persona.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dynamic TTS Engine Switcher Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          padding: '14px 16px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
        }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🔊 Voice & Prosody Engine
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <button
              onClick={() => setTtsEngine('kokoro')}
              style={{
                background: ttsEngine === 'kokoro' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.05)',
                color: ttsEngine === 'kokoro' ? '#FFFFFF' : '#94A3B8',
                border: ttsEngine === 'kokoro' ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '10px 8px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              ⚡ Kokoro-82M (Human)
            </button>
            <button
              onClick={() => setTtsEngine('mms')}
              style={{
                background: ttsEngine === 'mms' ? '#475569' : 'rgba(255, 255, 255, 0.05)',
                color: ttsEngine === 'mms' ? '#FFFFFF' : '#94A3B8',
                border: ttsEngine === 'mms' ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '10px 8px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              🤖 Meta MMS (Basic)
            </button>
          </div>

          {ttsEngine === 'kokoro' ? (
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94A3B8', marginBottom: '6px' }}>
                Active Kokoro Neural Voice Profile:
              </label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(15, 17, 23, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#FFFFFF',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {KOKORO_VOICES.map(v => (
                  <option key={v.id} value={v.id} style={{ background: '#161822', color: '#FFF' }}>
                    {v.label}
                  </option>
                ))}
              </select>
              <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: '#64748B', lineHeight: '1.3' }}>
                ✨ Natural human-like intonation via a dedicated worker thread — zero VRAM conflicts.
              </p>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '11px', color: '#64748B', lineHeight: '1.3' }}>
              ℹ️ Standard flat single-voice synthesis. Ideal for basic lightweight offline fallback mode.
            </p>
          )}
        </div>
      </div>

      {/* 3D Studio Viewport - Delicate Wide Studio Framing */}
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#101116']} />
        
        {/* Subtle studio back-lighting accents representing saffron / peacock teal */}
        <pointLight position={[-3, 2, -2]} intensity={25} color={activePersonaId === 'ananya' ? '#FF9933' : '#1A73E8'} distance={6} />
        <pointLight position={[3, 1, -2]} intensity={20} color={activePersonaId === 'ananya' ? '#138808' : '#FF9933'} distance={6} />
        
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.5} maxDistance={4} />
        
        {/* React AI Voice Avatar component with dual-worker TTS architecture */}
        <AiVoiceAvatar
          ref={avatarRef}
          key={currentPersona.id}
          avatarPreset={currentPersona.preset}
          systemPrompt={currentPersona.systemPrompt}
          ttsEngine={ttsEngine}
          ttsVoice={ttsVoice}
          debug={false}
          showCaptions={true}
          scale={0.48}
          position={[-0.15, -0.42, 0]}
          hideStatusPill={false}
          onStatusChange={(newStatus: any) => setAvatarStatus(newStatus)}
        />
      </Canvas>
    </div>
  );
};
export default App;
