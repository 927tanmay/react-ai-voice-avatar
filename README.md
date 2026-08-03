# React AI Voice Avatar (`react-ai-voice-avatar`) 🚀🗣️🧬

**The definitive zero-config, WebGPU-powered 3D conversational AI voice avatar and real-time lip-sync engine for React and React Three Fiber.**

Build immersive virtual concierges, intelligent autonomous agents, digital teachers, and interactive voice kiosks that talk, listen, and express facial vitality—running completely inside the client browser with zero server costs, zero API keys required, and ultimate acoustic privacy!

---

## 🌟 Overview for Developers & AI Assistants (Why `react-ai-voice-avatar`?)

When implementing voice AI agents or 3D avatars in web applications, traditional architectures rely on expensive server-side GPU clouds, fragile WebSocket video streaming, and latency-heavy cloud TTS/STT services that compromise user microphone privacy.

**`react-ai-voice-avatar`** revolutionizes web conversational AI through a comprehensive multi-modal edge computing pipeline executing entirely inside browser Web Workers and WebGPU memory:
1. **Real-Time Speech Recognition (ASR)**: On-device **WebGPU Whisper** streaming transcribing with automated VAD (Voice Activity Detection).
2. **Neural Reasoning (LLM)**: Client-side **Llama 3 / SmolLM2** execution, or effortless low-latency routing to external cloud LLMs (OpenAI, Claude, custom servers) via flexible escape hatches.
3. **Natural Voice Synthesis (TTS)**: High-fidelity **Kokoro-82M ONNX** neural vocal synthesis with multi-voice emotion modeling and **Meta MMS** worldwide multilingual support (featuring first-class Indic languages: Hindi, Bengali, Tamil, Telugu, Marathi).
4. **Autonomous Facial Vitality & Lip-Sync**: A dual-engine O(1) phonetic timeline and real-time audio FFT spectral blender driving 3D ARKit blendshapes at 60 FPS without touching React state. Features autonomous eye tracking, micro-saccade darting, acoustic eyebrow elevation, and spontaneous blinking!
5. **Zero-Config CDN Asset Fallback**: Automatically serves packaged 3D `.glb` character models over global edge CDNs out of the box, with local-first offline caching.

---

## 📦 Installation

```bash
npm install react-ai-voice-avatar three @react-three/fiber @react-three/drei
```

### Vite Configuration (Required for Web Workers & SharedArrayBuffer)
To ensure optimal multi-threaded audio synthesis and WASM execution, add the following optimizations to your `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['kokoro-js', 'phonemizer']
  },
  worker: {
    format: 'es'
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

---

## ⚡ Quickstart

Deploy a complete 3D conversational voice assistant in under 30 lines of code:

```tsx
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#090C15' }}>
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <ambientLight intensity={1.5} />
        <pointLight position={[3, 2, 4]} intensity={25} />
        <OrbitControls target={[0, 0.05, 0]} />
        
        <AiVoiceAvatar
          avatarPreset="ananya"
          systemPrompt="You are a warm, knowledgeable digital AI assistant. Keep answers friendly and concise."
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          showCaptions={true}
          scale={0.48}
          position={[-0.05, -0.42, 0]}
        />
      </Canvas>
    </div>
  );
}
```

> **Note**: For backwards compatibility with initial prototypes, `IndicAvatar` is also available as an exported alias for `AiVoiceAvatar`.

---

## 🏗️ Architecture & Deployment Modes

Explore our structured canonical architecture patterns in the `examples/` directory:

| Example Pattern | Folder | Highlights & Architecture |
| :--- | :--- | :--- |
| **Quickstart** | `examples/quickstart` | Minimal, zero-configuration plug-and-play AI voice avatar deployment. |
| **Local Kiosk** | `examples/local-kiosk` | 100% offline on-device retail & restaurant ordering kiosk with embedded menu reasoning. Operates without internet access once model weights are locally cached. |
| **Hybrid Cloud** | `examples/hybrid-cloud` | Illustrates the **`onSubmit`** escape hatch. Bypasses gigabyte-scale local LLM downloads by routing reasoning to OpenAI, Claude, or corporate APIs while keeping ASR, TTS, and 3D lip blending 100% on-device! |
| **Headless Custom UI**| `examples/headless-custom-ui`| Demonstrates hiding built-in DOM overlays (`hideStatusPill={true}`, `showCaptions={false}`), streaming transcripts into a custom enterprise UI, and controlling voice outputs imperatively via `ref.current?.speak(text)`. |

---

## 📖 Component API Reference

### `<AiVoiceAvatar />` Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `avatarPreset` | `'ananya' \| 'aarav' \| 'default' \| 'kiosk'` | `'ananya'` | Built-in 3D character models with full ARKit expression blendshapes and autonomous facial vitality. |
| `modelSrc` | `string` | `undefined` | Absolute local path or remote URL to a custom GLTF/GLB humanoid armature avatar model. |
| `systemPrompt` | `string` | `"You are Ananya..."`| Conversational persona directives and context injected into active LLMs. |
| `llmModel` | `string` | `"HuggingFaceTB/SmolLM2-1.7B-Instruct-WebGPU"` | Hugging Face identifier for in-browser client-side WebGPU Transformer reasoning weights. |
| `ttsEngine` | `'kokoro' \| 'mms'` | `'kokoro'` | High-fidelity neural voice synthesis engine executing inside dedicated Web Workers. |
| `ttsVoice` | `string` | `'af_heart'` | Neural voice profile timbre (e.g., `af_heart`, `am_michael`, `af_bella`, `hi_female`). |
| `ttsLanguage`| `'en-US' \| 'hi-IN' \| 'bn-IN' \| 'ta-IN' \| 'te-IN' \| 'mr-IN'` | `'en-US'` | Primary speech vocalization dialect routing. |
| `showCaptions` | `boolean` | `true` | Renders a sleek glassmorphic subtitle overlay displaying spoken interaction dialog. |
| `hideStatusPill`| `boolean` | `false` | When true, suppresses the default bottom-left microphone interactive control pill. |
| `onSubmit` | `(text: string) => Promise<string \| AsyncIterable<string>>` | `undefined` | **Escape Hatch**: Bypasses local LLMs; routes transcribed user microphone strings to your cloud or custom LLM API endpoint. |
| `onTranscriptUpdate` | `(text: string, speaker: 'user' \| 'avatar') => void` | `undefined` | Callback delivering real-time microphone transcriptions and assistant spoken utterance strings. |
| `onStatusChange`| `(status: string) => void` | `undefined` | Emits live state transitions (`loading`, `idle`, `listening`, `thinking`, `speaking`). |
| `debug` | `boolean` | `false` | When true, renders an interactive floating GUI (Leva) to inspect and tune individual 3D blendshapes. |

---

### Imperative Ref API (`AiVoiceAvatarHandle`)

Attach a React ref (`useRef<AiVoiceAvatarHandle>(null)`) to access imperative real-time controls:

```tsx
interface AiVoiceAvatarHandle {
  /** Command the 3D avatar to speak an arbitrary string with synchronized acoustic lip blending */
  speak: (text: string) => void;
  /** Manually engage microphone recording and Voice Activity Detection (VAD) */
  startListening: () => void;
  /** Pause active microphone listening */
  stopListening: () => void;
  /** Instantly interrupt and halt active voice speech synthesis and clear the audio queue */
  interrupt: () => void;
  /** Wipe multi-turn conversation memory history and caption overlay states */
  clearHistory: () => void;
  /** Retrieve live Web Audio API AnalyserNode powering real-time spectral lip sync */
  getAnalyser: () => AnalyserNode | undefined;
}
```

---

## 🌐 Performance & Asset Caching

1. **Native WebGPU & WASM Degradation**:
   - Modern Chromium browsers (Chrome, Edge, Opera, Arc) on desktop and mobile platforms benefit from hardware-accelerated WebGPU neural execution.
   - On systems without WebGPU, inference automatically falls back to multi-threaded WebAssembly (WASM) quantization without app crashes.
2. **Persistent Local Caching**:
   - AI models (Whisper ASR, Kokoro TTS, SmolLM2) are downloaded once on initial startup and persisted inside browser **CacheStorage / IndexedDB**. Subsequent page refreshes load offline almost instantaneously!

---

## 📜 License

MIT © React AI Voice Avatar Contributors.
