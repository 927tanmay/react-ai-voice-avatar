/**
 * React AI Voice Avatar — Hybrid Cloud Example
 *
 * Demonstrates utilizing the `onSubmit` prop to bypass local on-device LLM inference entirely,
 * forwarding transcribed user speech to an external cloud API (e.g. Anthropic, OpenAI, or a custom backend server)
 * while retaining 100% local on-device Whisper ASR transcription and Kokoro speech synthesis / lip sync!
 *
 * Key Architectural Advantages:
 *   • Zero Local LLM Download: Passing `onSubmit` instructs our WebGPU worker to skip loading local LLMs,
 *     slashing memory footprint and saving ~300MB–1GB of initial weight downloading!
 *   • Enterprise Privacy & Low Latency: Raw microphone audio never leaves the client device.
 *   • Unlimited Intelligence: Leverage state-of-the-art cloud models (Claude 3.5, GPT-4o) for reasoning.
 *
 * Run locally: npm install && npm run dev
 */
import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

interface TelemetryEvent {
  id: string;
  timestamp: string;
  type: 'asr_local' | 'cloud_request' | 'cloud_response' | 'tts_local';
  label: string;
  detail: string;
  durationMs?: number;
}

export default function App() {
  const [status, setStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryEvent[]>([]);
  const [activeStage, setActiveStage] = useState<1 | 2 | 3 | null>(null);

  const addTelemetry = useCallback((type: TelemetryEvent['type'], label: string, detail: string, durationMs?: number) => {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTelemetryLogs(prev => [{ id: Math.random().toString(), timestamp: timeStr, type, label, detail, durationMs }, ...prev.slice(0, 14)]);
  }, []);

  /**
   * CLOUD API ESCAPE HATCH (onSubmit prop)
   * 
   * When the user stops speaking, our local on-device Whisper ASR model converts voice to text
   * and invokes this function. We can return either a Promise<string> or an AsyncIterable<string> stream!
   */
  const handleCloudSubmit = async (userTranscript: string): Promise<string> => {
    const startTime = performance.now();
    
    // Stage 1 complete: Speech transcribed on-device
    setActiveStage(2);
    addTelemetry('asr_local', 'Stage 1: Local Whisper ASR', `Captured speech: "${userTranscript}"`);
    addTelemetry('cloud_request', 'Stage 2: Outbound API Dispatch', 'Forwarding transcript to Cloud Intelligence Engine...');

    try {
      /*
       * INSTRUCTIONS FOR EXTERNAL DEVELOPERS:
       * Replace this simulation block with your real fetch() call to OpenAI, Anthropic, or your Node backend:
       * 
       * const response = await fetch('https://api.yourdomain.com/v1/chat/completions', {
       *   method: 'POST',
       *   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MY_API_KEY}` },
       *   body: JSON.stringify({
       *     model: "claude-3-5-sonnet",
       *     messages: [{ role: "user", content: userTranscript }]
       *   })
       * });
       * const data = await response.json();
       * return data.choices[0].message.content;
       */

      // Simulated Cloud API response generator with realistic network delay
      await new Promise(resolve => setTimeout(resolve, 600));

      let aiReply = "I received your message through our hybrid cloud bridge! How can I assist with your financial portfolio today?";
      const lower = userTranscript.toLowerCase();
      
      if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
        aiReply = "Hello there! Welcome to our financial wealth desk. I'm operating on our hybrid cloud architecture, combining local WebGPU voice rendering with enterprise cloud reasoning.";
      } else if (lower.includes('invest') || lower.includes('stock') || lower.includes('portfolio') || lower.includes('return')) {
        aiReply = "For long term growth, our cloud advisory engine recommends diversifying across sovereign green bonds and high-yield Indian market indices. Would you like me to project a 5-year compounding simulation?";
      } else if (lower.includes('how') && lower.includes('work')) {
        aiReply = "It's simple and secure! Your voice is transcribed locally in your browser by WebGPU Whisper without uploading raw audio. Then, only the text string is routed to our secure cloud API via the onSubmit handler!";
      } else if (lower.includes('fast') || lower.includes('speed') || lower.includes('latency')) {
        aiReply = "Because we skip loading massive LLM neural network weights onto your device, startup is almost instant and cloud token inference happens in mere milliseconds!";
      }

      const latency = Math.round(performance.now() - startTime);
      addTelemetry('cloud_response', 'Stage 2: Cloud API Response', `Received reply (${aiReply.length} chars)`, latency);
      
      setActiveStage(3);
      addTelemetry('tts_local', 'Stage 3: Local Kokoro Speech Synthesis', 'Streaming audio buffer & blending 3D phoneme lip movements...');
      
      return aiReply;
    } catch (err: any) {
      addTelemetry('cloud_response', 'Cloud API Error', err.message || 'Network failure');
      return "I apologize, but I encountered a network connectivity disruption while attempting to contact our cloud server.";
    }
  };

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw', backgroundColor: '#080A10', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif", color: '#E2E8F0' }}>
      
      {/* Top Header Branding */}
      <div style={{ position: 'absolute', zIndex: 20, top: '24px', left: '32px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.35)' }}>
          ☁️
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#FFF' }}>Hybrid Cloud Architecture</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', fontWeight: 500 }}>On-Device Voice & Lip Sync • Cloud AI Reasoning via <code style={{ color: '#60A5FA', background: 'rgba(59, 130, 246, 0.15)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>onSubmit</code></p>
        </div>
      </div>

      {/* Interactive Telemetry & Architecture Dashboard on the Right */}
      <div style={{
        position: 'absolute', right: '32px', top: '32px', zIndex: 15, width: '420px',
        maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column',
        background: 'rgba(15, 20, 32, 0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '24px', padding: '24px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7)'
      }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#60A5FA', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚡ Live Pipeline Telemetry</span>
          {activeStage && <span style={{ fontSize: '11px', background: '#3B82F6', color: '#FFF', padding: '2px 8px', borderRadius: '12px', textTransform: 'none', letterSpacing: 0 }}>Stage {activeStage} Active</span>}
        </h2>

        {/* 3-Stage Architecture Roadmap Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '20px' }}>
          <div style={{ padding: '10px', borderRadius: '12px', background: activeStage === 1 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.03)', border: activeStage === 1 ? '1px solid #3B82F6' : '1px solid rgba(255,255,255,0.08)', transition: 'all 0.3s ease' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: activeStage === 1 ? '#60A5FA' : '#94A3B8' }}>STAGE 1</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFF', marginTop: '2px' }}>Local ASR</div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>WebGPU Whisper</div>
          </div>
          <div style={{ padding: '10px', borderRadius: '12px', background: activeStage === 2 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.03)', border: activeStage === 2 ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.08)', transition: 'all 0.3s ease' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: activeStage === 2 ? '#34D399' : '#94A3B8' }}>STAGE 2</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFF', marginTop: '2px' }}>Cloud LLM</div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>onSubmit() API</div>
          </div>
          <div style={{ padding: '10px', borderRadius: '12px', background: activeStage === 3 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.03)', border: activeStage === 3 ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.08)', transition: 'all 0.3s ease' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: activeStage === 3 ? '#FBBF24' : '#94A3B8' }}>STAGE 3</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFF', marginTop: '2px' }}>Local TTS</div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>Kokoro + LipSync</div>
          </div>
        </div>

        {/* Live Network & Execution Log List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '300px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
          {telemetryLogs.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748B', textAlign: 'center', padding: '20px' }}>
              <span style={{ fontSize: '28px', marginBottom: '8px' }}>🎙️</span>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>No audio telemetry captured yet.</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#475569' }}>Click "Tap to start" and speak to trace live network routing and latency!</p>
            </div>
          ) : (
            telemetryLogs.map((log) => {
              let tagColor = '#60A5FA';
              if (log.type === 'cloud_request' || log.type === 'cloud_response') tagColor = '#10B981';
              if (log.type === 'tts_local') tagColor = '#F59E0B';

              return (
                <div key={log.id} style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.04)', borderLeft: `3px solid ${tagColor}`, fontSize: '13px', animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, color: '#FFF', fontSize: '13px' }}>{log.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {log.durationMs && <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', padding: '2px 6px', borderRadius: '6px' }}>{log.durationMs}ms</span>}
                      <span style={{ fontSize: '11px', color: '#64748B' }}>{log.timestamp}</span>
                    </div>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: '12px', lineHeight: 1.4, wordBreak: 'break-word' }}>{log.detail}</div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', color: '#64748B', textAlign: 'center' }}>
          💡 Tip: Notice how fast the app initializes because local LLM downloads are bypassed!
        </div>
      </div>

      {/* 3D Studio Canvas Viewport */}
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <color attach="background" args={['#080A10']} />
        
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.8} maxDistance={4} />

        <AiVoiceAvatar
          avatarPreset="ananya"
          
          /**
           * THE ON_SUBMIT CLOUD ESCAPE HATCH:
           * Passing this prop automatically instructs useAiVoiceAvatar to set `loadLlm: false`,
           * skipping on-device LLM model downloading/initialization completely.
           */
          onSubmit={handleCloudSubmit}

          // Configure ultra-natural Kokoro voice engine with built-in cool azure cloud lighting preset!
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          environmentPreset="studio"
          lightingPreset="cool_azure"
          showCaptions={true}
          
          scale={0.48} // Demonstrating full compatibility with native React-Three-Fiber group scale prop!
          position={[-0.28, -0.42, 0]} // Compact avatar scale positioned cleanly to stay clear of overlays
          
          onStatusChange={(newStatus) => {
            setStatus(newStatus);
            if (newStatus === 'listening') {
              setActiveStage(1);
            } else if (newStatus === 'idle') {
              setActiveStage(null);
            }
          }}
          accentColor="#3B82F6"
        />
      </Canvas>
    </div>
  );
}
