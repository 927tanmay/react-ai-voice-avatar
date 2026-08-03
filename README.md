# React Indic Avatar 🚀🇮🇳

**Autonomous, real-time conversational 3D digital avatars running entirely inside the browser using WebGPU and React Three Fiber.**

Zero backend GPU inference costs. Total microphone acoustics privacy. Lightning-fast neural speech synthesis with real-time 3D facial blendshape lip synchronization.

---

## 💡 Why React Indic Avatar?

Traditional conversational avatars rely on expensive server-side GPU cloud infrastructure, high-latency websocket video streaming, and require transmitting unencrypted microphone audio recordings over the internet. 

`react-indic-avatar` introduces a paradigm shift by executing the entire multi-modal conversational AI pipeline directly inside client memory:
- **Stage 1 (ASR)**: On-device **WebGPU Whisper** acoustic transcribing & Voice Activity Detection (VAD).
- **Stage 2 (LLM)**: Client-side **Llama 3 / SmolLM2** neural reasoning (or effortless routing to cloud LLMs via escape hatches).
- **Stage 3 (TTS)**: Native **Kokoro-JS** (82M) & Meta **MMS** multilingual neural vocal synthesis.
- **Stage 4 (Lip Sync)**: Real-time audio FFT spectral phoneme timing & micro-expression engine driving 3D GLTF blendshapes at 60 FPS.

---

## 📦 Installation

```bash
npm install react-indic-avatar three @react-three/fiber @react-three/drei
```

### Vite Configuration (Required for Web Workers & SharedArrayBuffer)
Add the following headers and exclusions to your `vite.config.ts`:

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

```tsx
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IndicAvatar } from 'react-indic-avatar';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#090C15' }}>
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <ambientLight intensity={1.5} />
        <pointLight position={[3, 2, 4]} intensity={25} />
        <OrbitControls target={[0, 0.05, 0]} />
        
        <IndicAvatar
          avatarPreset="ananya"
          systemPrompt="You are a warm, multilingual digital receptionist. Keep answers concise."
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

---

## 🏗️ Architecture & Deployment Modes

Explore our comprehensive examples directory (`examples/`) demonstrating the four essential architecture patterns:

| Example | Folder | Highlights & Architecture |
| :--- | :--- | :--- |
| **Quickstart** | `examples/quickstart` | Minimal, zero-configuration 35-line plug-and-play avatar deployment. |
| **Local Kiosk** | `examples/local-kiosk` | 100% on-device retail & restaurant ordering kiosk with an embedded menu database context. Operates entirely without internet access once model weights are cached. |
| **Hybrid Cloud** | `examples/hybrid-cloud` | Illustrates the **`onSubmit`** escape hatch. Bypasses gigabyte-scale local LLM downloads by routing reasoning to OpenAI, Claude, or custom endpoints while running ASR, TTS, and 3D lip blending entirely on-device! |
| **Headless Custom UI**| `examples/headless-custom-ui`| Demonstrates hiding built-in DOM overlays (`hideStatusPill={true}`, `showCaptions={false}`), streaming transcripts into a custom enterprise chat interface, and triggering programmatic utterances via `ref.current?.speak(text)`. |

---

## 📖 Component API Reference

### `<IndicAvatar />` Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `avatarPreset` | `'ananya' \| 'aarav' \| 'default' \| 'kiosk'` | `'ananya'` | Built-in 3D character bust models with ARKit expression blendshapes. |
| `modelSrc` | `string` | `undefined` | Absolute path or URL to a custom GLTF/GLB avatar model. |
| `systemPrompt` | `string` | `"You are Ananya..."`| Persona instructions and system context injected into local or conversational LLMs. |
| `llmModel` | `string` | `"HuggingFaceTB/SmolLM2-1.7B-Instruct-WebGPU"` | Model identifier for in-browser client-side WebGPU Transformer weights. |
| `ttsEngine` | `'kokoro' \| 'mms'` | `'kokoro'` | Neural synthesis speech engine to execute in background audio Web Workers. |
| `ttsVoice` | `string` | `'af_heart'` | Selected neural voice timbre (e.g., `af_heart`, `af_sky`, `hi_female`, `bn_male`). |
| `ttsLanguage`| `'en-US' \| 'hi-IN' \| 'bn-IN' \| 'ta-IN' \| 'te-IN' \| 'mr-IN'` | `'en-US'` | Primary synthesis language and dialect routing. |
| `showCaptions` | `boolean` | `true` | When true, renders a glassmorphic top-left subtitle overlay showing spoken dialog. |
| `hideStatusPill`| `boolean` | `false` | When true, suppresses the default bottom-left microphone interactive control pill. |
| `onSubmit` | `(text: string) => Promise<string \| AsyncIterable<string>>` | `undefined` | **Escape Hatch**: Bypasses local LLM loading; routes recognized speech string to your external cloud or corporate API. |
| `onTranscriptUpdate` | `(text: string, speaker: 'user' \| 'avatar') => void` | `undefined` | Callback delivering real-time microphone transcriptions and assistant utterance strings. |
| `onStatusChange`| `(status: string) => void` | `undefined` | Emits lifecycle transitions (`loading`, `idle`, `listening`, `thinking`, `speaking`). |
| `debug` | `boolean` | `false` | When true, exposes a floating Leva debugging GUI to manipulate individual morph target blendshapes. |

---

### Imperative Ref API (`IndicAvatarHandle`)

Bind a React ref (`useRef<IndicAvatarHandle>(null)`) to programmatic control methods:

```tsx
interface IndicAvatarHandle {
  /** Immediately command the digital avatar to vocalize a text string with synchronized 3D animations */
  speak: (text: string) => void;
  /** Manually initiate microphone Voice Activity Detection (VAD) recording */
  startListening: () => void;
  /** Pause active microphone capturing */
  stopListening: () => void;
  /** Instantly interrupt and halt active speech audio playback and clearing queue */
  interrupt: () => void;
  /** Erase conversation history memory and caption overlays */
  clearHistory: () => void;
  /** Retrieve live Web Audio API AnalyserNode driving facial FFT lip sync */
  getAnalyser: () => AnalyserNode | undefined;
}
```

---

## 🌐 Performance & Deployment Notes

1. **WebGPU Hardware Acceleration**:
   - Modern Chromium browsers (Chrome, Edge, Opera, Arc) on macOS, Windows, Linux, and Android provide first-class WebGPU acceleration.
   - If WebGPU is unavailable, the pipeline smoothly degrades to multi-threaded WebAssembly (WASM) execution with quantization.
2. **Intelligent Asset Caching**:
   - Neural network weights (Whisper ASR, Kokoro TTS, SmolLM2) are downloaded once on initial load and cached persistently in the browser's **CacheStorage / IndexedDB**. Subsequent loads occur offline instantaneously without network requests.

---

## 📜 License

MIT © React Indic Avatar Contributors.
