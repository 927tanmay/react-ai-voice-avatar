/**
 * React AI Voice Avatar — Quickstart Example
 *
 * This is the simplest possible setup: a single <AiVoiceAvatar> component
 * inside a Three.js Canvas. No custom models, no backend, no API keys.
 *
 * Everything runs locally in your browser via WebGPU:
 *   • Speech-to-Text  → Whisper (via @huggingface/transformers)
 *   • LLM             → Qwen2.5-0.5B-Instruct (local, on-device)
 *   • Text-to-Speech  → Meta MMS-TTS or Kokoro-82M
 *   • Lip-sync        → Real-time audio-driven + phoneme blending
 *
 * Run:  npm install && npm run dev
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f0f13' }}>
      <Canvas camera={{ position: [0, 0.1, 1.85], fov: 38 }}>
        <color attach="background" args={['#fff']} />

        {/* Simple two-point studio lighting */}
        <pointLight position={[-3, 2, -2]} intensity={20} color="#FF9933" distance={6} />
        <pointLight position={[3, 1, -2]} intensity={15} color="#1A73E8" distance={6} />

        <OrbitControls target={[0, 0.1, 0]} />

        {/* That's it — one component, zero config. */}
        <AiVoiceAvatar
          avatarPreset="ananya"
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          position={[0, -0.72, 0]}
        />
      </Canvas>
    </div>
  );
}
