import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar, StatusPill, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';
import { AudioVisualizer } from './components/AudioVisualizer';
import './style.css';

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);
  return matches;
};

interface Persona {
  id: 'retail' | 'support' | 'tutor' | 'dev' | 'debate';
  name: string;
  role: string;
  avatarIcon: string;
  preset: 'ananya' | 'aarav';
  accentColor: string;
  borderColor: string;
  systemPrompt: string;
  description: string;
  defaultVoice: string;
  defaultLlmMode: 'cloud' | 'local';
}

const PERSONAS: Persona[] = [
  {
    id: 'dev',
    name: 'Dev Sandbox',
    role: 'Full Customization',
    avatarIcon: '⚙️',
    preset: 'aarav',
    accentColor: '#8B5CF6', // Purple
    borderColor: 'rgba(139, 92, 246, 0.6)',
    systemPrompt: "You are a sharp, confident technical guide. Explain things concisely as if speaking to a software engineer. Do not use markdown (no asterisks or hashtags). Speak in plain conversational text.",
    description: 'Test all engineering settings: models, lighting, and engines.',
    defaultVoice: 'am_fenrir',
    defaultLlmMode: 'cloud',
  },
  {
    id: 'retail',
    name: 'Retail Kiosk',
    role: 'Offline Ordering',
    avatarIcon: '🛍️',
    preset: 'aarav',
    accentColor: '#10B981', // Emerald
    borderColor: 'rgba(16, 185, 129, 0.6)',
    systemPrompt: "You are an automated retail ordering kiosk for a fast-casual cafe. Keep your replies strictly under 1 sentence. Do not use markdown (no asterisks or hashtags). Speak naturally in plain conversational text.",
    description: 'On-device brain. 100% offline data privacy at the counter.',
    defaultVoice: 'am_michael',
    defaultLlmMode: 'local',
  },
  {
    id: 'support',
    name: 'Support Concierge',
    role: 'Customer Service',
    avatarIcon: '🏢',
    preset: 'ananya',
    accentColor: '#38BDF8', // Sky Blue
    borderColor: 'rgba(56, 189, 248, 0.6)',
    systemPrompt: "You are a professional, highly empathetic customer support agent. Keep your replies concise and conversational. Do not use markdown (no asterisks or hashtags). Speak in plain conversational text.",
    description: 'Connected brain. Streams from your cloud backend for enterprise knowledge.',
    defaultVoice: 'af_heart',
    defaultLlmMode: 'cloud',
  },
  {
    id: 'tutor',
    name: 'Language Tutor',
    role: 'Education',
    avatarIcon: '📚',
    preset: 'ananya',
    accentColor: '#E67E22', // Saffron
    borderColor: 'rgba(230, 126, 34, 0.6)',
    systemPrompt: "You are a patient, encouraging language tutor. You speak clearly and warmly. Always praise the user's progress. Do not use markdown (no asterisks or hashtags). Speak in plain conversational text.",
    description: 'Patient persona, optimized for educational engagement.',
    defaultVoice: 'af_bella',
    defaultLlmMode: 'cloud',
  },
  {
    id: 'debate',
    name: 'Agent Debate',
    role: 'Two Avatars Talking',
    avatarIcon: '🎭',
    preset: 'aarav',
    accentColor: '#F43F5E',
    borderColor: 'rgba(244, 63, 94, 0.6)',
    systemPrompt: '',
    description: 'Watch two AI avatars debate any topic live. Local or cloud-powered.',
    defaultVoice: 'am_fenrir',
    defaultLlmMode: 'local',
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

// --- Landing Page Component ---
const LandingPage: React.FC<{ onSelect: (id: Persona['id']) => void }> = ({ onSelect }) => {
  return (
    <div style={{ 
      width: '100vw', 
      height: '100dvh', 
      backgroundColor: '#0C0D10', 
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '0',
      boxSizing: 'border-box'
    }}>
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto',
        padding: '56px 24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh'
      }}>
        
        {/* Header / About */}
        <div style={{ textAlign: 'left', marginBottom: '56px' }}>
          <h1 style={{ fontSize: '48px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-1px', margin: '0 0 20px 0' }}>
            React <span style={{ color: '#38BDF8' }}>AI Voice Avatar</span>
          </h1>
          <p style={{ fontSize: '18px', color: '#94A3B8', lineHeight: '1.6', maxWidth: '600px', margin: '0' }}>
            Real-time Edge WebGPU conversational voice AI. 
            Drop a fully-rigged, lip-syncing 3D avatar into your React app with sub-second latency and zero cloud dependencies.
          </p>
        </div>

        {/* Scenarios Grid */}
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '2px', textAlign: 'left', marginBottom: '28px' }}>
          Select a Scenario to Begin
        </h2>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', 
          gap: '24px' 
        }}>
          {PERSONAS.map((persona) => (
            <div
              key={persona.id}
              onClick={() => onSelect(persona.id)}
              style={{
                background: 'rgba(20, 22, 28, 0.6)',
                backdropFilter: 'blur(20px)',
                border: `1px solid rgba(255, 255, 255, 0.05)`,
                borderRadius: '24px',
                padding: '32px 24px',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-6px)';
                e.currentTarget.style.borderColor = persona.borderColor;
                e.currentTarget.style.boxShadow = `0 16px 40px ${persona.accentColor}33`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.2)';
              }}
            >
              {/* Accent Gradient Top */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: persona.accentColor }} />
              
              <div style={{
                fontSize: '40px',
                background: `${persona.accentColor}15`,
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                border: `1px solid ${persona.accentColor}40`
              }}>
                {persona.avatarIcon}
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#FFF', margin: '0 0 8px 0' }}>{persona.name}</h3>
              <p style={{ fontSize: '13px', color: persona.accentColor, fontWeight: 600, margin: '0 0 16px 0' }}>{persona.role}</p>
              <p style={{ fontSize: '14px', color: '#94A3B8', lineHeight: '1.5', margin: 0 }}>
                {persona.description}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ 
          marginTop: 'auto', 
          paddingTop: '24px', 
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px'
        }}>
          <div style={{ fontSize: '14px', color: '#94A3B8' }}>
            Released under the <strong>MIT License</strong>.
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            <a href="https://github.com/927tanmay/react-ai-voice-avatar" target="_blank" rel="noreferrer" style={{ color: '#E2E8F0', textDecoration: 'none', fontSize: '14px', fontWeight: 600, transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#38BDF8'} onMouseLeave={e => e.currentTarget.style.color = '#E2E8F0'}>
              GitHub Source
            </a>
            <a href="https://www.npmjs.com/package/react-ai-voice-avatar" target="_blank" rel="noreferrer" style={{ color: '#E2E8F0', textDecoration: 'none', fontSize: '14px', fontWeight: 600, transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#38BDF8'} onMouseLeave={e => e.currentTarget.style.color = '#E2E8F0'}>
              NPM Package
            </a>
            <a href="https://github.com/927tanmay/react-ai-voice-avatar#quickstart" target="_blank" rel="noreferrer" style={{ color: '#E2E8F0', textDecoration: 'none', fontSize: '14px', fontWeight: 600, transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#38BDF8'} onMouseLeave={e => e.currentTarget.style.color = '#E2E8F0'}>
              Documentation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Demo Page Component ---
const DemoPage: React.FC<{ personaId: Persona['id'], onBack: () => void }> = ({ personaId, onBack }) => {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const currentPersona = PERSONAS.find(p => p.id === personaId)!;
  
  const [_avatarStatus, setAvatarStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [loadingPct, setLoadingPct] = useState<number>(0);
  const [loadingLabel, setLoadingLabel] = useState<string>('asr');
  const [textInput, setTextInput] = useState('');
  const [copied, setCopied] = useState(false);
  const isMobile = useMediaQuery('(max-width: 900px)');

  const [llmMode, setLlmMode] = useState<'cloud' | 'local'>(currentPersona.defaultLlmMode);
  
  // Safe state transition helper to prevent race conditions during rapid remounts
  const switchLlmMode = (mode: 'cloud' | 'local') => {
    if (mode === llmMode) return;
    setAvatarStatus('loading');
    setLoadingPct(0);
    setLlmMode(mode);
  };

  const isLowEndDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (
    (navigator.hardwareConcurrency < 4 || (navigator as any).deviceMemory < 6)
  );

  const [ttsEngine, setTtsEngine] = useState<'kokoro' | 'mms'>(isLowEndDevice ? 'mms' : 'kokoro');
  
  const [volumeA, setVolumeA] = useState(0);
  const [volumeB, setVolumeB] = useState(0);
  const [volumeSingle, setVolumeSingle] = useState(0);

  const [lightingPreset, setLightingPreset] = useState<'studio' | 'cyberpunk_violet' | 'cool_azure' | 'warm_amber' | 'clean_white' | 'none'>('studio');
  const [ttsVoice, setTtsVoice] = useState<string>(currentPersona.defaultVoice);
  const [devAvatarPreset, setDevAvatarPreset] = useState<'aarav' | 'ananya'>(currentPersona.preset as 'aarav' | 'ananya');

  // When persona prop changes, update internal dev state so it stays synced
  useEffect(() => {
    setLlmMode(currentPersona.defaultLlmMode);
    setTtsVoice(currentPersona.defaultVoice);
  }, [currentPersona]);



  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !avatarRef.current) return;
    avatarRef.current.sendText(textInput);
    setTextInput('');
  };

  const handleCloudSubmit = async (text: string): Promise<string> => {
    await new Promise(r => setTimeout(r, 600));
    const lower = text.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      return `Hello there! I heard you say "${text}". Notice how my speech recognition and 3D lip-sync run entirely in your browser with zero local LLM downloads!`;
    }
    return `I heard you say: "${text}". In production, your cloud backend or OpenAI endpoint supplies this response via our onSubmit prop, skipping heavy local model downloads completely while keeping facial animation 100% client-side!`;
  };

  // ─── Debate Mode State ───
  const avatarBRef = useRef<AiVoiceAvatarHandle>(null);
  const [debateTopic, setDebateTopic] = useState('');
  const [debateStarted, setDebateStarted] = useState(false);
  const [debateTurn, setDebateTurn] = useState<'A' | 'B' | null>(null);
  const debateActiveRef = useRef(false);
  const lastSpokenRef = useRef('');
  const debateTurnRef = useRef<'A' | 'B' | null>(null);
  const [debateTurnCount, setDebateTurnCount] = useState(0);
  const [_avatarBStatus, setAvatarBStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const pendingDebateTopicRef = useRef<string | null>(null);

  // Track previous status to detect true "speaking -> idle" transitions
  const prevStatusARef = useRef<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const prevStatusBRef = useRef<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const MAX_TURNS = 6;

  // BYOK state
  const [apiKey, setApiKey] = useState('');
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini' | 'groq'>('openai');
  const [showByok, setShowByok] = useState(false);
  const useCloudForDebate = apiKey.trim().length > 0;

  const debateForPrompt = `You are debating a topic. Argue FOR the given position. Keep responses strictly under 2 sentences. Be conversational and opinionated. Do not use markdown formatting. Speak in plain text.`;
  const debateAgainstPrompt = `You are debating a topic. Argue AGAINST the given position. Keep responses strictly under 2 sentences. Be conversational and opinionated. Do not use markdown formatting. Speak in plain text.`;

  // Keep turn ref in sync
  useEffect(() => { debateTurnRef.current = debateTurn; }, [debateTurn]);

  // Cloud API handler for BYOK
  const handleCloudDebateSubmit = useCallback(async (text: string, systemPrompt: string): Promise<string> => {
    try {
      if (apiProvider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text }] }],
          }),
        });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'I need a moment to think about that.';
      } else {
        // OpenAI / Groq (compatible API)
        const endpoint = apiProvider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const model = apiProvider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: text },
            ],
            max_tokens: 120,
          }),
        });
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || 'I need a moment to think about that.';
      }
    } catch (err) {
      console.error('[Debate BYOK] Cloud API error:', err);
      return 'Sorry, I had trouble connecting to the cloud API. Check your key and try again.';
    }
  }, [apiKey, apiProvider]);

  // Debate transcript handler — captures last spoken text
  const handleDebateTranscript = useCallback((_avatar: 'A' | 'B', text: string, speaker: 'user' | 'avatar') => {
    if (speaker !== 'avatar' || !debateActiveRef.current) return;
    lastSpokenRef.current = text;
  }, []);

  // Stop debate helper (used by button and max turn limit)
  const stopDebate = useCallback(() => {
    debateActiveRef.current = false;
    setDebateStarted(false);
    setDebateTurn(null);
    setDebateTurnCount(0);
    lastSpokenRef.current = '';
    avatarRef.current?.interrupt();
    avatarBRef.current?.interrupt();
  }, []);

  // Debate status handler — orchestrates turn-taking robustly
  const handleDebateStatusChange = useCallback((avatar: 'A' | 'B', status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking') => {
    // Record current status for UI
    if (avatar === 'A') setAvatarStatus(status);
    if (avatar === 'B') setAvatarBStatus(status);
    
    if (!debateActiveRef.current) return; // Ignore if debate stopped

    // Determine if this is a genuine transition from speaking/thinking to idle
    const prevStatus = avatar === 'A' ? prevStatusARef.current : prevStatusBRef.current;
    const justFinishedSpeaking = (prevStatus === 'speaking' || prevStatus === 'thinking') && status === 'idle';
    
    // Update previous status ref
    if (avatar === 'A') prevStatusARef.current = status;
    if (avatar === 'B') prevStatusBRef.current = status;

    // Only trigger turn logic if they just finished speaking and it was their turn
    if (justFinishedSpeaking && debateTurnRef.current === avatar) {
      const otherRef = avatar === 'A' ? avatarBRef : avatarRef;
      const lastText = lastSpokenRef.current;

      setDebateTurnCount((prevCount) => {
        const nextCount = prevCount + 1;
        
        // Auto-stop if we hit the turn limit
        if (nextCount > MAX_TURNS) {
          setTimeout(() => stopDebate(), 1000);
          return prevCount;
        }

        // Pass to the other avatar
        if (lastText && otherRef.current) {
          setTimeout(() => {
            if (!debateActiveRef.current) return; // Double check we didn't stop during timeout
            const nextTurn = avatar === 'A' ? 'B' : 'A';
            setDebateTurn(nextTurn);
            
            // Enforce stance context to prevent them from agreeing with each other
            const side = avatar === 'A' ? 'FOR' : 'AGAINST';
            const contextText = `Your opponent (arguing ${side} the topic) just said: "${lastText}". Remember your stance. Give a short counter-argument.`;
            
            otherRef.current?.sendText(contextText, { hidden: true });
          }, 1500);
        }
        return nextCount;
      });
    }
  }, [stopDebate]);

  // Start debate
  const startDebate = useCallback((topic: string) => {
    if (!topic.trim()) return;
    setDebateStarted(true);
    debateActiveRef.current = true;
    setDebateTurn('A');
    setDebateTurnCount(1);
    lastSpokenRef.current = '';
    
    // Reset status trackers for new debate
    prevStatusARef.current = 'loading'; // Start at loading so we don't accidentally trigger a turn
    prevStatusBRef.current = 'loading';

    // Queue the topic. The useEffect below will fire it once both avatars are 'idle'.
    pendingDebateTopicRef.current = topic;
  }, []);

  // Robust Kickoff: Wait for both models to finish downloading before sending the first prompt
  useEffect(() => {
    if (
      debateStarted &&
      debateActiveRef.current &&
      pendingDebateTopicRef.current &&
      _avatarStatus === 'idle' &&
      _avatarBStatus === 'idle'
    ) {
      const topic = pendingDebateTopicRef.current;
      pendingDebateTopicRef.current = null;
      
      // Kick off Avatar A now that both engines are fully loaded
      setTimeout(() => {
        if (debateActiveRef.current && avatarRef.current) {
          avatarRef.current.sendText(`The debate topic is: "${topic}". You are arguing FOR this topic. State your opening argument.`, { hidden: true });
        }
      }, 500);
    }
  }, [_avatarStatus, _avatarBStatus, debateStarted]);


  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', backgroundColor: '#0C0D10', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      
      {/* Top Accent Bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '4px',
        background: `linear-gradient(90deg, ${currentPersona.accentColor} 0%, #FFFFFF 100%)`,
        zIndex: 1000
      }} />

      {/* Back Button */}
      <button 
        onClick={onBack}
        style={{
          position: 'absolute', top: '24px', left: '24px', zIndex: 1000,
          background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)', color: '#FFF',
          padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        <span>←</span> Scenarios
      </button>

      {/* Premium Loading Overlay (Floating Widget) */}
      {_avatarStatus === 'loading' && (
        <div style={{
          position: 'absolute', bottom: isMobile ? '80px' : '40px', left: isMobile ? '20px' : '24px', right: isMobile ? '20px' : 'auto', zIndex: 2000,
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', gap: '20px',
          animation: 'fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)', padding: '16px 24px', borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          pointerEvents: 'none' // Let user click through to rotate the avatar
        }}>
          <div style={{
            fontSize: '28px',
            background: `${currentPersona.accentColor}22`,
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${currentPersona.accentColor}40`,
            boxShadow: `0 0 30px ${currentPersona.accentColor}33`,
            animation: 'pulse 2s infinite ease-in-out',
            flexShrink: 0
          }}>
            {currentPersona.avatarIcon}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h2 style={{ color: '#F8FAFC', fontSize: '15px', fontWeight: 700, margin: 0, letterSpacing: '0px' }}>
              {loadingLabel === 'asr' ? 'Loading Speech Recognition...' : 
               loadingLabel === 'llm' ? 'Downloading Qwen-0.5B into WebGPU...' : 
               loadingLabel === 'tts' ? 'Booting Neural Voice Synthesis...' : 
               'Initializing AI Engine...'}
            </h2>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '200px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  background: currentPersona.accentColor, 
                  width: `${Math.max(5, loadingPct)}%`, 
                  borderRadius: '99px',
                  transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: `0 0 10px ${currentPersona.accentColor}`
                }} />
              </div>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 600, width: '40px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Number.isNaN(loadingPct) || loadingPct === undefined ? '' : `${Math.round(loadingPct)}%`}
              </span>
            </div>
          </div>

          <style>{`
            @keyframes pulse {
              0% { transform: scale(0.95); box-shadow: 0 0 0 0 ${currentPersona.accentColor}40; }
              70% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(0, 0, 0, 0); }
              100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
            }
            @keyframes fadeInUp {
              from { opacity: 0; transform: translateY(20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* Dev Sandbox Sidebars */}
      {personaId !== 'dev' && personaId !== 'debate' && !isMobile && (
        <div style={{
          position: 'absolute', top: '70px', left: '24px', zIndex: 500, display: 'flex', flexDirection: 'column',
          gap: '20px', width: '340px', maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', paddingRight: '8px',
        }}>
          <div style={{ background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 800, color: currentPersona.accentColor, letterSpacing: '0.5px' }}>{currentPersona.name}</h3>
            
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                System Prompt {llmMode === 'cloud' && <span style={{ color: '#F59E0B' }}>(Bypassed)</span>}
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: llmMode === 'cloud' ? '#64748B' : '#E2E8F0', 
                textDecoration: llmMode === 'cloud' ? 'line-through' : 'none',
                lineHeight: '1.5', background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' 
              }}>
                "{currentPersona.systemPrompt || 'No system prompt provided.'}"
              </div>
              {llmMode === 'cloud' && (
                <div style={{ marginTop: '6px', fontSize: '10px', color: '#38BDF8', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span>ℹ️</span> Provide this prompt directly on your secure backend.
                </div>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Intelligence Routing</div>
              <div style={{ fontSize: '12px', color: '#E2E8F0', lineHeight: '1.5', background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {llmMode === 'cloud' ? (
                  <>☁️ <strong>Cloud API</strong>. Responses are currently mocked for this demo to show latency. In production, this connects to your backend.</>
                ) : (
                  <>🔒 <strong>Local Edge LLM</strong>. Running Qwen2.5-0.5B locally via WebGPU inside your browser.</>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Integration</div>
              <button
                onClick={() => {
                  const code = `<AiVoiceAvatar
  avatarPreset="${currentPersona.preset}"
  lightingPreset="${lightingPreset}"
  ttsEngine="${ttsEngine}"
  ttsVoice="${ttsVoice}"
${llmMode === 'cloud' 
  ? '  onSubmit={async (text) => {\n    // Note: Supply your system prompt directly to your backend API here\n    return "Mock Response";\n  }}' 
  : `  systemPrompt="${currentPersona.systemPrompt}"\n  llmModel="onnx-community/Qwen2.5-0.5B-Instruct"`}
/>`;
                  navigator.clipboard.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{
                  width: '100%',
                  background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  color: copied ? '#10B981' : '#E2E8F0',
                  border: `1px solid ${copied ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.1)'}`,
                  padding: '10px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease'
                }}
              >
                {copied ? '✓ Copied to Clipboard' : '📋 Copy React Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {personaId === 'dev' && (
        <>
          {/* Left Column Controls */}
          {!isMobile && (
            <div style={{
            position: 'absolute', top: '70px', left: '24px', zIndex: 500, display: 'flex', flexDirection: 'column',
            gap: '20px', width: '320px', maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', paddingRight: '8px',
          }}>
            <div style={{
              background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '20px', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            }}>
              <h1 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
                React <span style={{ color: currentPersona.accentColor, transition: 'color 0.5s ease' }}>AI Voice Avatar</span>
              </h1>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#94A3B8', lineHeight: '1.5' }}>
                Real-time Edge WebGPU conversational voice AI featuring human-like prosody & 3D virtual presence.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: '11px', color: '#38BDF8', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)', padding: '4px 8px', borderRadius: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '0.5px', boxShadow: '0 0 10px rgba(56, 189, 248, 0.2)' }}>
                  ⚡ 100% LOCAL INFERENCE
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <span style={{ fontSize: '12px', color: '#10B981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', backgroundColor: '#10B981', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px #10B981' }}></span>
                  {ttsEngine === 'kokoro' ? 'Kokoro-82M Natural Voice' : 'Meta MMS-TTS Engine Ready'}
                </span>
              </div>
            </div>
          </div>
          )}

          {/* Right Column Controls (Hidden on mobile to keep avatar + StatusPill visible) */}
          {!isMobile && (
          <div style={{
            position: 'absolute', top: '70px', right: '24px', zIndex: 500, display: 'flex', flexDirection: 'column',
            gap: '12px', width: '330px', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', paddingLeft: '8px',
          }}>
            <div style={{ background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>🎭 3D Model</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={() => setDevAvatarPreset('aarav')} style={{ background: devAvatarPreset === 'aarav' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.05)', color: '#FFF', border: 'none', padding: '10px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Aarav</button>
                <button onClick={() => setDevAvatarPreset('ananya')} style={{ background: devAvatarPreset === 'ananya' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.05)', color: '#FFF', border: 'none', padding: '10px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Ananya</button>
              </div>
            </div>

            <div style={{ background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>🔊 Voice & Prosody</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <button onClick={() => setTtsEngine('kokoro')} style={{ background: ttsEngine === 'kokoro' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.05)', color: '#FFF', border: 'none', padding: '10px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Kokoro (Human)</button>
                <button onClick={() => setTtsEngine('mms')} style={{ background: ttsEngine === 'mms' ? '#475569' : 'rgba(255, 255, 255, 0.05)', color: '#FFF', border: 'none', padding: '10px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>MMS (Basic)</button>
              </div>
              {ttsEngine === 'kokoro' && (
                <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} style={{ width: '100%', background: 'rgba(15, 17, 23, 0.9)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF', padding: '8px 12px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer' }}>
                  {KOKORO_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              )}
            </div>

            <div style={{ background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>🧠 Intelligence</h3>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <button
                  onClick={() => switchLlmMode('cloud')}
                  style={{
                    flex: 1, padding: '8px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                    background: llmMode === 'cloud' ? '#0284C7' : 'rgba(255, 255, 255, 0.05)',
                    color: llmMode === 'cloud' ? '#FFFFFF' : '#94A3B8',
                    border: 'none', cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                >
                  Cloud API
                </button>
                <button
                  onClick={() => switchLlmMode('local')}
                  style={{
                    flex: 1, padding: '8px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                    background: llmMode === 'local' ? '#0284C7' : 'rgba(255, 255, 255, 0.05)',
                    color: llmMode === 'local' ? '#FFFFFF' : '#94A3B8',
                    border: 'none', cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                >
                  Edge Qwen
                </button>
              </div>
              <div style={{ margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {llmMode === 'cloud' ? (
                  <>
                    <span style={{ color: '#38BDF8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>☁️ Zero-Download API Routing</span>
                    By providing an <code style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: '4px', color: '#E2E8F0', margin: '0 2px' }}>onSubmit</code> prop, the engine <strong>skips local LLM downloads entirely</strong>. Voice (Whisper) and Lip-Sync execute on-device instantly, while conversational text is routed to your custom cloud backend.
                  </>
                ) : (
                  <>
                    <span style={{ color: '#10B981', fontWeight: 600, display: 'block', marginBottom: '4px' }}>🔒 100% Airgapped Local Execution</span>
                    Triggers a one-time download of <strong>Qwen2.5-0.5B (~350MB)</strong> into WebGPU cache. All speech recognition, LLM reasoning, and vocal synthesis execute offline with zero server data sharing.
                  </>
                )}
              </div>
            </div>

            <div style={{ background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '1px' }}>💡 Lighting Atmosphere</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {LIGHTING_PRESETS.map((preset) => (
                  <button key={preset.id} onClick={() => setLightingPreset(preset.id)} style={{ display: 'flex', gap: '6px', background: lightingPreset === preset.id ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.04)', color: '#FFF', border: 'none', padding: '8px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: lightingPreset === preset.id ? 700 : 500, cursor: 'pointer' }}>
                    <span>{preset.icon}</span> <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}
        </>
      )}

      {/* ─── Debate Mode: Topic Input Overlay ─── */}
      {personaId === 'debate' && !debateStarted && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2000,
          background: 'rgba(12, 13, 16, 0.92)', backdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            maxWidth: '520px', width: '90%', display: 'flex', flexDirection: 'column', gap: '24px',
            animation: 'fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎭</div>
              <h2 style={{ color: '#FFFFFF', fontSize: '28px', fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>Agent Debate</h2>
              <p style={{ color: '#94A3B8', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>
                Two AI avatars will debate any topic you choose. Aarav argues FOR, Ananya argues AGAINST.
              </p>
            </div>

            {/* Topic Input */}
            <form onSubmit={(e) => { e.preventDefault(); startDebate(debateTopic); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                value={debateTopic}
                onChange={(e) => setDebateTopic(e.target.value)}
                placeholder="Enter a debate topic..."
                autoFocus
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '14px', padding: '14px 18px', color: '#FFFFFF', fontSize: '16px',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              {/* Quick-pick chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                {['AI will replace most jobs', 'Tabs vs Spaces', 'Remote work is better than office', 'Social media does more harm than good'].map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => setDebateTopic(topic)}
                    style={{
                      background: debateTopic === topic ? '#F43F5E' : 'rgba(255,255,255,0.06)',
                      color: debateTopic === topic ? '#FFF' : '#94A3B8',
                      border: `1px solid ${debateTopic === topic ? '#F43F5E' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '99px', padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s ease', fontFamily: 'inherit',
                    }}
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={!debateTopic.trim()}
                style={{
                  background: debateTopic.trim() ? '#F43F5E' : 'rgba(255,255,255,0.1)',
                  color: debateTopic.trim() ? '#FFF' : '#64748B',
                  border: 'none', borderRadius: '14px', padding: '14px', fontSize: '16px',
                  fontWeight: 700, cursor: debateTopic.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease', fontFamily: 'inherit',
                }}
              >
                🎙️ Start Debate
              </button>
            </form>

            {/* BYOK Section */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
              <button
                onClick={() => setShowByok(!showByok)}
                style={{
                  background: 'none', border: 'none', color: '#64748B', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  width: '100%', justifyContent: 'center', fontFamily: 'inherit',
                }}
              >
                {showByok ? '▼' : '▶'} {useCloudForDebate ? `☁️ Powered by ${apiProvider === 'openai' ? 'OpenAI' : apiProvider === 'gemini' ? 'Gemini' : 'Groq'}` : '🔒 Powered by Local Qwen 0.5B'} — {showByok ? 'Hide' : 'Bring Your Own API Key'}
              </button>

              {showByok && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['openai', 'gemini', 'groq'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setApiProvider(p)}
                        style={{
                          flex: 1, background: apiProvider === p ? '#F43F5E' : 'rgba(255,255,255,0.06)',
                          color: apiProvider === p ? '#FFF' : '#94A3B8',
                          border: `1px solid ${apiProvider === p ? '#F43F5E' : 'rgba(255,255,255,0.1)'}`,
                          borderRadius: '10px', padding: '8px', fontSize: '12px', fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                        }}
                      >
                        {p === 'openai' ? 'OpenAI' : p === 'gemini' ? 'Gemini' : 'Groq'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`Paste your ${apiProvider === 'openai' ? 'OpenAI' : apiProvider === 'gemini' ? 'Gemini' : 'Groq'} API key...`}
                    style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '10px', padding: '10px 14px', color: '#FFFFFF', fontSize: '13px',
                      outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <p style={{ color: '#F59E0B', fontSize: '11px', margin: 0, textAlign: 'center' }}>
                    ⚠️ Key is sent directly to the API from your browser. Only use your own key.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3D Studio Viewport */}
      <Canvas camera={{ position: personaId === 'debate' ? [0, 0.15, 2.8] : [0, 0.15, 2.2], fov: 32 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={['#101116']} />
        
        {/* Subtle accent rim lights */}
        <pointLight position={[-3, 2, -2]} intensity={2} color={currentPersona.accentColor} distance={10} />
        <pointLight position={[3, 1, -2]} intensity={2} color={currentPersona.accentColor} distance={10} />
        
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.5} maxDistance={4} />
        
        {personaId === 'debate' ? (
          <>
            {/* Avatar A (Aarav) — Left */}
            <AiVoiceAvatar
              key="avatar-debate-aarav"
              ref={avatarRef}
              avatarPreset="aarav"
              lightingPreset={lightingPreset}
              llmModel={useCloudForDebate ? undefined : 'onnx-community/Qwen2.5-0.5B-Instruct'}
              onSubmit={useCloudForDebate ? (text) => handleCloudDebateSubmit(text, debateForPrompt) : undefined}
              systemPrompt={debateForPrompt}
              ttsEngine={ttsEngine}
              ttsVoice="af_alloy"
              listenMode="push-to-talk"
              debug={false}
              showCaptions={true}
              captionStyle={{ left: '48px', right: 'auto' }}
              scale={0.38}
              position={[-0.5, -0.34, 0]}
              rotation={[0, Math.PI / 8, 0]}
              hideStatusPill={true}
              loadingProgress={(pct, label) => { setLoadingPct(pct); setLoadingLabel(label); }}
              onStatusChange={(s) => handleDebateStatusChange('A', s)}
              onTranscriptUpdate={(text, speaker) => handleDebateTranscript('A', text, speaker)}
              onAudioLevelChange={(level) => setVolumeA(level)}
            />
            <AudioVisualizer level={volumeA} color="#F43F5E" position={[-0.5, -0.33, 0]} />
            
            {/* Avatar B (Ananya) — Right */}
            <AiVoiceAvatar
              key="avatar-debate-ananya"
              ref={avatarBRef}
              avatarPreset="ananya"
              lightingPreset={lightingPreset}
              llmModel={useCloudForDebate ? undefined : 'onnx-community/Qwen2.5-0.5B-Instruct'}
              onSubmit={useCloudForDebate ? (text) => handleCloudDebateSubmit(text, debateAgainstPrompt) : undefined}
              systemPrompt={debateAgainstPrompt}
              ttsEngine={ttsEngine}
              ttsVoice="af_bella"
              listenMode="push-to-talk"
              debug={false}
              showCaptions={true}
              captionStyle={{ right: '48px', left: 'auto' }}
              scale={0.38}
              position={[0.5, -0.34, 0]}
              rotation={[0, -Math.PI / 8, 0]}
              hideStatusPill={true}
              loadingProgress={(pct, label) => { setLoadingPct(pct); setLoadingLabel(label); }}
              onStatusChange={(s) => handleDebateStatusChange('B', s)}
              onTranscriptUpdate={(text, speaker) => handleDebateTranscript('B', text, speaker)}
              onAudioLevelChange={(level) => setVolumeB(level)}
            />
            <AudioVisualizer level={volumeB} color="#38BDF8" position={[0.5, -0.33, 0]} />
          </>
        ) : (
          <AiVoiceAvatar
            key={`avatar-${personaId}-${llmMode}-${devAvatarPreset}`}
            ref={avatarRef}
            avatarPreset={personaId === 'dev' ? devAvatarPreset : currentPersona.preset}
            lightingPreset={lightingPreset}
            llmModel={llmMode === 'local' ? 'onnx-community/Qwen2.5-0.5B-Instruct' : undefined}
            onSubmit={llmMode === 'cloud' ? handleCloudSubmit : undefined}
            systemPrompt={currentPersona.systemPrompt}
            ttsEngine={ttsEngine}
            ttsVoice={ttsVoice}
            debug={false}
            showCaptions={true}
            scale={isMobile ? 0.38 : 0.48}
            position={isMobile ? [0, -0.22, 0] : [-0.15, -0.34, 0]}
            hideStatusPill={isMobile || _avatarStatus === 'loading'}
            loadingProgress={(pct, label) => { setLoadingPct(pct); setLoadingLabel(label); }}
            onStatusChange={setAvatarStatus}
          />
        )}
      </Canvas>

      {/* ─── Debate Mode: Speaker Labels + Stop Button ─── */}
      {personaId === 'debate' && debateStarted && (
        <>
          {/* Speaker Labels */}
          <div style={{
            position: 'absolute', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1001, display: 'flex', gap: '40px', alignItems: 'center',
          }}>
            <div style={{
              background: 'rgba(20, 22, 28, 0.85)', backdropFilter: 'blur(10px)',
              padding: '8px 16px', borderRadius: '12px',
              border: `1px solid ${debateTurn === 'A' ? '#F43F5E' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: debateTurn === 'A' ? '0 0 20px rgba(244, 63, 94, 0.3)' : 'none',
              transition: 'all 0.3s ease',
            }}>
              <span style={{ fontSize: '13px', color: debateTurn === 'A' ? '#F43F5E' : '#64748B', fontWeight: 600 }}>
                {debateTurn === 'A' ? '🟢' : '⚪'} Aarav (FOR)
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>
              Turn {debateTurnCount}
            </div>
            <div style={{
              background: 'rgba(20, 22, 28, 0.85)', backdropFilter: 'blur(10px)',
              padding: '8px 16px', borderRadius: '12px',
              border: `1px solid ${debateTurn === 'B' ? '#38BDF8' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: debateTurn === 'B' ? '0 0 20px rgba(56, 189, 248, 0.3)' : 'none',
              transition: 'all 0.3s ease',
            }}>
              <span style={{ fontSize: '13px', color: debateTurn === 'B' ? '#38BDF8' : '#64748B', fontWeight: 600 }}>
                {debateTurn === 'B' ? '🟢' : '⚪'} Ananya (AGAINST)
              </span>
            </div>
          </div>

          {/* Topic Banner + Stop Button */}
          <div style={{
            position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1001, display: 'flex', alignItems: 'center', gap: '16px',
          }}>
            <div style={{
              background: 'rgba(20, 22, 28, 0.85)', backdropFilter: 'blur(10px)',
              padding: '10px 20px', borderRadius: '99px', border: '1px solid rgba(255,255,255,0.1)',
              fontSize: '13px', color: '#94A3B8', fontWeight: 500, maxWidth: '300px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              📌 {debateTopic}
            </div>
            <button
              onClick={stopDebate}
              style={{
                background: '#EF4444', color: '#FFF', border: 'none', borderRadius: '99px',
                padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)', fontFamily: 'inherit',
              }}
            >
              ■ Stop Debate
            </button>
          </div>

          {/* Power Source Badge */}
          <div style={{
            position: 'absolute', top: '24px', right: '24px', zIndex: 1001,
            background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(10px)',
            padding: '8px 16px', borderRadius: '99px', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: '12px', color: '#E2E8F0', fontWeight: 600 }}>
              {useCloudForDebate ? `☁️ ${apiProvider === 'openai' ? 'OpenAI' : apiProvider === 'gemini' ? 'Gemini' : 'Groq'}` : '🔒 Local Qwen 0.5B'}
            </span>
          </div>
        </>
      )}

      {/* Mobile-only Top Badge (non-debate) */}
      {personaId !== 'debate' && isMobile && _avatarStatus !== 'loading' && (
        <div style={{
          position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1001, display: 'flex', gap: '8px',
          background: 'rgba(20, 22, 28, 0.75)', backdropFilter: 'blur(10px)',
          padding: '8px 16px', borderRadius: '99px', border: '1px solid rgba(255,255,255,0.1)',
          alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          <span style={{ fontSize: '13px', color: '#E2E8F0', fontWeight: 600 }}>
            {llmMode === 'cloud' ? '☁️ Cloud API' : '🔒 Local Edge AI'}
          </span>
        </div>
      )}

      {/* Mobile-only external StatusPill (non-debate) */}
      {personaId !== 'debate' && isMobile && _avatarStatus !== 'loading' && (
        <div style={{
          position: 'absolute', bottom: '110px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1001, width: 'max-content',
        }}>
          <StatusPill
            status={_avatarStatus}
            onPillClick={() => avatarRef.current?.startListening()}
            onStopClick={() => avatarRef.current?.interrupt()}
            accentColor={currentPersona.accentColor}
            style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none' }}
          />
        </div>
      )}

      {/* Text Input Overlay (non-debate) */}
      {personaId !== 'debate' && (
        <div style={{
          position: 'absolute', bottom: isMobile ? '35px' : '40px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, width: isMobile ? 'calc(100% - 40px)' : '100%', maxWidth: '400px',
        }}>
          <form 
            onSubmit={handleTextSubmit}
            style={{
              display: 'flex', background: 'rgba(20, 22, 28, 0.85)', backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '9999px',
              padding: '6px 6px 6px 20px', boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)'
            }}
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={_avatarStatus === 'loading'}
              placeholder={_avatarStatus === 'loading' ? 'Warming up AI engine...' : 'Type a message (skips mic)...'}
              style={{ flex: 1, background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '14px', outline: 'none', opacity: _avatarStatus === 'loading' ? 0.5 : 1 }}
            />
            <button
              type="submit"
              disabled={!textInput.trim() || _avatarStatus === 'loading'}
              style={{
                background: textInput.trim() && _avatarStatus !== 'loading' ? currentPersona.accentColor : 'rgba(255, 255, 255, 0.1)',
                color: textInput.trim() && _avatarStatus !== 'loading' ? '#FFFFFF' : '#64748B',
                border: 'none', borderRadius: '9999px', padding: '8px 16px', fontSize: '13px',
                fontWeight: 600, cursor: textInput.trim() && _avatarStatus !== 'loading' ? 'pointer' : 'not-allowed', transition: 'all 0.2s ease'
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

// --- Main App Root ---
export const App: React.FC = () => {
  const [activePersonaId, setActivePersonaId] = useState<Persona['id'] | null>(null);

  if (!activePersonaId) {
    return <LandingPage onSelect={setActivePersonaId} />;
  }

  return <DemoPage personaId={activePersonaId} onBack={() => setActivePersonaId(null)} />;
};

export default App;
