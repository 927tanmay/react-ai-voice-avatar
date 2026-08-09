import React, { useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';
import './style.css';

interface Persona {
  id: 'nova' | 'orion';
  name: string;
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
    id: 'nova',
    name: 'Nova',
    role: 'Female Voice Companion',
    avatarIcon: '👩🏽',
    preset: 'ananya',
    accentColor: '#E67E22', // Warm Saffron Gold / Peach
    borderColor: 'rgba(230, 126, 34, 0.6)',
    systemPrompt: "You are Nova, an empathetic, warm, and lively conversational companion. You speak the way a person actually talks out loud, never like a written assistant or textbook. Keep your replies to 1-3 short, naturally spoken sentences unless explicitly asked for more detail. Never use lists, bullet points, markdown, or section headers—all of those sound absurd out loud. Always use contractions like I'm, that's, let's, and don't. To keep our chat feeling alive and flowing, occasionally end your answer by asking a short, friendly follow-up question.",
    description: 'Empathetic, warm, and highly expressive conversationalist.',
    defaultVoice: 'af_heart',
  },
  {
    id: 'orion',
    name: 'Orion',
    role: 'Male Voice Companion',
    avatarIcon: '👨🏽',
    preset: 'aarav',
    accentColor: '#1A73E8', // Royal Peacock Indigo / Blue
    borderColor: 'rgba(26, 115, 232, 0.6)',
    systemPrompt: "You are Orion, a charismatic, sharp, and confident technical guide and voice companion. You communicate like a real human conversing out loud, never defaulting to formal written essays or chatbot jargon. Always keep your replies to 1-3 concise, spoken sentences unless explicitly prompted for depth. Absolutely avoid lists, numbered steps, markdown, and headers—just speak naturally. Use common contractions like I'm, that's, can't, and don't. To maintain an authentic conversational dialogue rather than a Q&A terminal, occasionally weave in a brief, engaging follow-up question.",
    description: 'Confident, articulate, and dynamic technical assistant.',
    defaultVoice: 'am_michael',
  },
];

const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Nova (af_heart - Warm Female A-Grade)' },
  { id: 'af_bella', label: 'Bella (af_bella - Expressive Female)' },
  { id: 'am_michael', label: 'Orion (am_michael - Engaging Male)' },
  { id: 'am_fenrir', label: 'Fenrir (am_fenrir - Authoritative Male)' },
  { id: 'bf_emma', label: 'Emma (bf_emma - British Female)' },
  { id: 'bm_george', label: 'George (bm_george - British Male)' },
];

const LIGHTING_PRESETS: Array<{ id: 'studio' | 'cyberpunk_violet' | 'cool_azure' | 'warm_amber' | 'clean_white' | 'none'; label: string; icon: string }> = [
  { id: 'studio', label: 'Studio HDR', icon: '🎬' },
  { id: 'cyberpunk_violet', label: 'Cyberpunk', icon: '👾' },
  { id: 'cool_azure', label: 'Cool Azure', icon: '❄️' },
  { id: 'warm_amber', label: 'Warm Amber', icon: '🔥' },
  { id: 'clean_white', label: 'Clean White', icon: '💡' },
  { id: 'none', label: 'Ambient Only', icon: '🌑' },
];

export const App: React.FC = () => {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const [_avatarStatus, setAvatarStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [activePersonaId, setActivePersonaId] = useState<'nova' | 'orion'>('orion');
  const [lightingPreset, setLightingPreset] = useState<'studio' | 'cyberpunk_violet' | 'cool_azure' | 'warm_amber' | 'clean_white' | 'none'>('studio');
  const [llmMode, setLlmMode] = useState<'cloud' | 'local'>('cloud');
  const [textInput, setTextInput] = useState('');

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !avatarRef.current) return;
    avatarRef.current.sendText(textInput);
    setTextInput('');
  };

  const handleCloudSubmit = async (text: string): Promise<string> => {
    // Simulated cloud API response demonstrating instant conversational lip-sync without local model downloads
    await new Promise(r => setTimeout(r, 600));
    const lower = text.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      return `Hello there! I heard you say "${text}". Notice how my speech recognition and 3D lip-sync run entirely in your browser with zero local LLM downloads!`;
    }
    return `I heard you say: "${text}". In production, your cloud backend or OpenAI endpoint supplies this response via our onSubmit prop, skipping heavy local model downloads completely while keeping facial animation 100% client-side!`;
  };
  
  // Dynamic TTS Engine Configuration & Seamless Switching
  const [ttsEngine, setTtsEngine] = useState<'kokoro' | 'mms'>('kokoro');
  const [ttsVoice, setTtsVoice] = useState<string>('af_heart');

  const currentPersona = PERSONAS.find(p => p.id === activePersonaId) || PERSONAS[0];

  const handlePersonaSelect = (persona: Persona) => {
    setActivePersonaId(persona.id);
    setTtsVoice(persona.defaultVoice);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#0C0D10', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Top Accent Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '4px',
        background: `linear-gradient(90deg, ${currentPersona.accentColor} 0%, #FFFFFF 100%)`,
        zIndex: 1000,
        transition: 'background 0.5s ease',
      }} />

      {/* Left Column Controls */}
      <div style={{
        position: 'absolute',
        top: '24px',
        left: '24px',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '320px',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
        paddingRight: '8px', // Scrollbar padding
      }}>
        {/* Header Branding */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '20px',
          borderRadius: '20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <h1 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              React <span style={{ color: currentPersona.accentColor, transition: 'color 0.5s ease' }}>AI Voice Avatar</span>
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: '1.5' }}>
            Real-time Edge WebGPU conversational voice AI featuring human-like prosody & 3D virtual presence.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <span style={{ fontSize: '12px', color: '#10B981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', backgroundColor: '#10B981', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px #10B981' }}></span>
              {ttsEngine === 'kokoro' ? 'Kokoro-82M Natural Voice' : 'Meta MMS-TTS Engine Ready'}
            </span>
          </div>
        </div>

        {/* Persona Selector Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: '12px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            ✨ Select Persona
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
                    gap: '12px',
                    padding: '12px 14px',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    background: isSelected ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                    border: '1.5px solid',
                    borderColor: isSelected ? persona.borderColor : 'rgba(255, 255, 255, 0.05)',
                    boxShadow: isSelected ? `0 4px 20px ${persona.accentColor}33` : 'none',
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{
                    fontSize: '26px',
                    background: isSelected ? `${persona.accentColor}22` : 'rgba(255,255,255,0.05)',
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isSelected ? `1px solid ${persona.accentColor}` : '1px solid transparent',
                  }}>
                    {persona.avatarIcon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '15px', color: '#FFFFFF' }}>{persona.name}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 500 }}>{persona.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right Column Controls */}
      <div style={{
        position: 'absolute',
        top: '24px',
        right: '24px',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '330px',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
        paddingLeft: '8px', // Scrollbar padding
      }}>
        {/* Dynamic TTS Engine Switcher Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
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

        {/* Intelligence Architecture Switcher Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🧠 Intelligence Architecture
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <button
              onClick={() => setLlmMode('cloud')}
              style={{
                background: llmMode === 'cloud' ? '#0284C7' : 'rgba(255, 255, 255, 0.05)',
                color: llmMode === 'cloud' ? '#FFFFFF' : '#94A3B8',
                border: llmMode === 'cloud' ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '8px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              ☁️ Cloud API (0 MB)
            </button>
            <button
              onClick={() => setLlmMode('local')}
              style={{
                background: llmMode === 'local' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.05)',
                color: llmMode === 'local' ? '#FFFFFF' : '#94A3B8',
                border: llmMode === 'local' ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '8px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              🔒 Edge Qwen 0.5B
            </button>
          </div>
          <div style={{ margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
            {llmMode === 'cloud' ? (
              <>
                <span style={{ color: '#38BDF8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>☁️ Zero-Download API Routing (`onSubmit`)</span>
                Ideal for production. By providing an <code style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: '4px', color: '#E2E8F0', margin: '0 2px' }}>onSubmit</code> prop, the engine <strong>skips local LLM downloads entirely</strong>. Speech recognition (Whisper) and 60 FPS 3D lip-sync execute on-device instantly, while conversational text reasoning is seamlessly routed to your custom cloud backend (e.g., OpenAI, Claude).
              </>
            ) : (
              <>
                <span style={{ color: '#10B981', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🔒 100% Airgapped Local Execution</span>
                Ideal for privacy-strict kiosks. Triggers a one-time download of <strong>Qwen2.5-0.5B (~350MB)</strong> into your browser's WebGPU cache. Once loaded, all speech recognition, LLM reasoning, and vocal synthesis execute entirely offline with zero server data sharing.
              </>
            )}
          </div>
        </div>

        {/* Cinematic Lighting Atmosphere Card */}
        <div style={{
          background: 'rgba(20, 22, 28, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>
            💡 Studio Lighting Atmosphere
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {LIGHTING_PRESETS.map((preset) => {
              const isSelected = lightingPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => setLightingPreset(preset.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: isSelected ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? '#FFFFFF' : '#94A3B8',
                    border: isSelected ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    fontSize: '11px',
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                  }}
                >
                  <span>{preset.icon}</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3D Studio Viewport - Delicate Wide Studio Framing */}
      <Canvas camera={{ position: [0, 0.15, 1.8], fov: 32 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#101116']} />
        
        {/* Subtle studio back-lighting accents representing saffron / peacock teal */}
        <pointLight position={[-3, 2, -2]} intensity={25} color={activePersonaId === 'nova' ? '#E67E22' : '#1A73E8'} distance={6} />
        <pointLight position={[3, 1, -2]} intensity={20} color={activePersonaId === 'nova' ? '#F39C12' : '#2980B9'} distance={6} />
        
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.5} maxDistance={4} />
        
        {/* React AI Voice Avatar component with dual-worker TTS architecture */}
        <AiVoiceAvatar
          ref={avatarRef}
          key={`${currentPersona.id}-${llmMode}`}
          avatarPreset={currentPersona.preset}
          lightingPreset={lightingPreset}
          llmModel={llmMode === 'local' ? 'onnx-community/Qwen2.5-0.5B-Instruct' : undefined}
          onSubmit={llmMode === 'cloud' ? handleCloudSubmit : undefined}
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

      {/* Text Input Overlay for silent users */}
      <div style={{
        position: 'absolute',
        bottom: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: '100%',
        maxWidth: '400px',
      }}>
        <form 
          onSubmit={handleTextSubmit}
          style={{
            display: 'flex',
            background: 'rgba(20, 22, 28, 0.85)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '9999px',
            padding: '6px 6px 6px 20px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
          }}
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message (skips mic)..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!textInput.trim()}
            style={{
              background: textInput.trim() ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.1)',
              color: textInput.trim() ? '#FFFFFF' : '#64748B',
              border: 'none',
              borderRadius: '9999px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: textInput.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
export default App;
