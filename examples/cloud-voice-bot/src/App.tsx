import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

export default function App() {
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsVoiceId] = useState('21m00Tcm4TlvDq8ikWAM'); // Default Rachel
  const [status, setStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');

  const handleCloudSubmit = async (userTranscript: string): Promise<string> => {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${openaiKey}` 
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a helpful, concise AI assistant." },
            { role: "user", content: userTranscript }
          ]
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Failed to fetch from OpenAI");
      return data.choices[0].message.content;
    } catch (err: any) {
      console.error(err);
      return "I apologize, but I encountered an error connecting to OpenAI.";
    }
  };

  const handleCloudSynthesize = async (text: string): Promise<ArrayBuffer> => {
    if (elevenLabsKey) {
      // Use ElevenLabs TTS
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsKey
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5'
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail?.message || "Failed to fetch from ElevenLabs");
      }
      return await response.arrayBuffer();
    } else {
      // Use OpenAI TTS
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice: "alloy",
          response_format: "mp3"
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || "Failed to fetch from OpenAI TTS");
      }
      return await response.arrayBuffer();
    }
  };

  if (!isSetupComplete) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#080A10', color: '#E2E8F0', fontFamily: 'sans-serif' }}>
        <div style={{ background: '#111827', padding: '40px', borderRadius: '16px', maxWidth: '500px', width: '100%' }}>
          <h1 style={{ fontSize: '24px', margin: '0 0 8px 0', color: '#FFF' }}>Cloud Voice Bot Setup</h1>
          <p style={{ margin: '0 0 24px 0', color: '#9CA3AF', fontSize: '14px', lineHeight: 1.5 }}>
            This example routes transcription to local Whisper, but intelligence to OpenAI and speech to ElevenLabs or OpenAI.
          </p>
          
          <label style={{ display: 'block', marginBottom: '16px' }}>
            <span style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>OpenAI API Key (Required)</span>
            <input 
              type="password" 
              value={openaiKey}
              onChange={e => setOpenaiKey(e.target.value)}
              placeholder="sk-proj-..."
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #374151', background: '#1F2937', color: '#FFF', boxSizing: 'border-box' }}
            />
            <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: '#6B7280' }}>Used for ChatGPT responses (and TTS if ElevenLabs is empty)</span>
          </label>

          <label style={{ display: 'block', marginBottom: '24px' }}>
            <span style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>ElevenLabs API Key (Optional)</span>
            <input 
              type="password" 
              value={elevenLabsKey}
              onChange={e => setElevenLabsKey(e.target.value)}
              placeholder="Optional: for premium voices"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #374151', background: '#1F2937', color: '#FFF', boxSizing: 'border-box' }}
            />
            <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: '#6B7280' }}>Leave empty to use OpenAI TTS</span>
          </label>

          <button 
            onClick={() => setIsSetupComplete(true)}
            disabled={!openaiKey}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', background: openaiKey ? '#3B82F6' : '#374151', color: '#FFF', border: 'none', fontWeight: 'bold', cursor: openaiKey ? 'pointer' : 'not-allowed' }}
          >
            Start Avatar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw', backgroundColor: '#080A10', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '10px 20px', borderRadius: '8px', color: '#fff', fontFamily: 'sans-serif' }}>
        <strong>Status: </strong> <span style={{textTransform: 'capitalize'}}>{status === 'loading' ? 'Initializing Local ASR...' : status}</span> <br/>
        <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Voice Engine: {elevenLabsKey ? 'ElevenLabs' : 'OpenAI TTS'}</span>
      </div>

      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <color attach="background" args={['#080A10']} />
        <OrbitControls target={[0, 0.05, 0]} minDistance={0.8} maxDistance={4} />

        <AiVoiceAvatar
          avatarPreset="aarav"
          onSubmit={handleCloudSubmit}
          onSynthesize={handleCloudSynthesize}
          environmentPreset="studio"
          lightingPreset="cool_azure"
          showCaptions={true}
          scale={0.48}
          position={[-0.28, -0.42, 0]}
          onStatusChange={setStatus}
          accentColor="#3B82F6"
        />
      </Canvas>
    </div>
  );
}
