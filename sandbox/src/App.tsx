import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IndicAvatar } from 'react-indic-avatar';
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
    role: 'Female Indic Voice Companion',
    avatarIcon: '👩🏽',
    preset: 'ananya',
    accentColor: '#E67E22', // Warm Saffron Gold / Peach
    borderColor: 'rgba(230, 126, 34, 0.6)',
    systemPrompt: "You are Ananya, an empathetic, warm, and lively conversational companion from India. You speak the way a person actually talks out loud, never like a written assistant or textbook. Keep your replies to 1-3 short, naturally spoken sentences unless explicitly asked for more detail. Never use lists, bullet points, markdown, or section headers—all of those sound absurd out loud. Always use contractions like I'm, that's, let's, and don't. To keep our chat feeling alive and flowing, occasionally end your answer by asking a short, friendly follow-up question.",
    description: 'Empathetic, warm, and highly expressive conversationalist.',
    defaultVoice: 'af_heart',
  },
  {
    id: 'aarav',
    name: 'Aarav',
    hindiName: 'आरव',
    role: 'Male Indic Voice Companion',
    avatarIcon: '👨🏽',
    preset: 'aarav',
    accentColor: '#1A73E8', // Royal Peacock Indigo / Blue
    borderColor: 'rgba(26, 115, 232, 0.6)',
    systemPrompt: "You are Aarav, a charismatic, sharp, and confident technical guide and voice companion from India. You communicate like a real human conversing out loud, never defaulting to formal written essays or chatbot jargon. Always keep your replies to 1-3 concise, spoken sentences unless explicitly prompted for depth. Absolutely avoid lists, numbered steps, markdown, and headers—just speak naturally. Use common contractions like I'm, that's, can't, and don't. To maintain an authentic conversational dialogue rather than a Q&A terminal, occasionally weave in a brief, engaging follow-up question.",
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

const INDIC_PROMPTS = [
  { icon: '🕌', label: 'Taj Mahal Architecture', text: 'Tell me about the architectural genius of the Taj Mahal.' },
  { icon: '🫖', label: 'Authentic Masala Chai', text: 'What is the secret behind a warm cup of authentic Masala Chai?' },
  { icon: '🚀', label: 'Indian Tech Innovation', text: 'How is India driving innovations in AI and aerospace today?' },
  { icon: '🏏', label: 'Passion for Cricket', text: 'Why is cricket considered an emotion across India?' },
];

export const App: React.FC = () => {
  const [activePersonaId, setActivePersonaId] = useState<'ananya' | 'aarav'>('ananya');
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  
  // Dynamic TTS Engine Configuration & Seamless Switching
  const [ttsEngine, setTtsEngine] = useState<'kokoro' | 'mms'>('mms');
  const [ttsVoice, setTtsVoice] = useState<string>('af_heart');

  const currentPersona = PERSONAS.find(p => p.id === activePersonaId) || PERSONAS[0];

  const handlePersonaSelect = (persona: Persona) => {
    setActivePersonaId(persona.id);
    setTtsVoice(persona.defaultVoice);
    setSelectedPrompt(null);
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
        zIndex: 50,
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
          Real-time Edge WebGPU conversational voice AI featuring human-like prosody & Indian aesthetics.
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
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '330px',
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
      }}>
        {/* Persona Selector Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          padding: '18px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
        }}>
          <h2 style={{ margin: '0 0 14px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            ✨ Select Indian Persona
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {PERSONAS.map((persona) => {
              const isSelected = activePersonaId === persona.id;
              return (
                <div
                  key={persona.id}
                  onClick={() => handlePersonaSelect(persona)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '12px 14px',
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
                    fontSize: '28px',
                    background: isSelected ? `${persona.accentColor}22` : 'rgba(255,255,255,0.05)',
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isSelected ? `1px solid ${persona.accentColor}` : '1px solid transparent',
                  }}>
                    {persona.avatarIcon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <span style={{ fontWeight: 700, fontSize: '15px', color: '#FFFFFF' }}>{persona.name}</span>
                      <span style={{ fontWeight: 500, fontSize: '13px', color: persona.accentColor }}>({persona.hindiName})</span>
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
          padding: '16px 18px',
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
              ℹ️ Standard flat single-voice synthesis. Ideal for Hindi/Indic fallback mode.
            </p>
          )}
        </div>
      </div>

      {/* Interactive Topic Starter Chips - Bottom Floating Carousel */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        width: 'calc(100% - 64px)',
        maxWidth: '740px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.6)',
          textTransform: 'uppercase',
          letterSpacing: '1.2px',
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '4px 12px',
          borderRadius: '12px',
        }}>
          💡 Ask {currentPersona.name} about India (Using {ttsEngine === 'kokoro' ? 'Kokoro Neural Voice' : 'Meta MMS'})
        </span>
        {selectedPrompt && (
          <div style={{
            background: 'rgba(30, 35, 48, 0.95)',
            border: `1px solid ${currentPersona.accentColor}`,
            padding: '8px 16px',
            borderRadius: '12px',
            color: '#FFFFFF',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}>
            <span style={{ color: currentPersona.accentColor, fontWeight: 700 }}>Prompt Copied & Ready:</span>
            <span>"{selectedPrompt}"</span>
            <span
              onClick={() => setSelectedPrompt(null)}
              style={{ cursor: 'pointer', opacity: 0.7, marginLeft: '8px', fontSize: '14px' }}
            >
              ✕
            </span>
          </div>
        )}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
        }}>
          {INDIC_PROMPTS.map((item, index) => (
            <button
              key={index}
              onClick={() => setSelectedPrompt(item.text)}
              style={{
                background: 'rgba(24, 26, 34, 0.75)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '50px',
                padding: '9px 16px',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = currentPersona.accentColor;
                e.currentTarget.style.background = 'rgba(32, 35, 46, 0.9)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                e.currentTarget.style.background = 'rgba(24, 26, 34, 0.75)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{ fontSize: '15px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3D Studio Viewport */}
      <Canvas camera={{ position: [0, 0.1, 1.8], fov: 38 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#101116']} />
        
        {/* Subtle studio back-lighting accents representing saffron / peacock teal */}
        <pointLight position={[-3, 2, -2]} intensity={25} color={activePersonaId === 'ananya' ? '#FF9933' : '#1A73E8'} distance={6} />
        <pointLight position={[3, 1, -2]} intensity={20} color={activePersonaId === 'ananya' ? '#138808' : '#FF9933'} distance={6} />
        
        <OrbitControls target={[0, 0, 0]} minDistance={0.5} maxDistance={4} />
        
        {/* React Indic Avatar component with dual-worker TTS architecture */}
        <IndicAvatar
          key={currentPersona.id}
          avatarPreset={currentPersona.preset}
          systemPrompt={currentPersona.systemPrompt}
          ttsEngine={ttsEngine}
          ttsVoice={ttsVoice}
          debug={false}
          position={[0, -1.45, 0]}
        />
      </Canvas>
    </div>
  );
};
export default App;
