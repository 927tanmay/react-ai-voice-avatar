# React AI Voice Avatar (`react-ai-voice-avatar`) 🚀🗣️🧬

[![NPM Version](https://img.shields.io/npm/v/react-ai-voice-avatar?style=for-the-badge&color=8A2BE2&logo=npm)](https://www.npmjs.com/package/react-ai-voice-avatar)
[![NPM Downloads](https://img.shields.io/npm/dm/react-ai-voice-avatar?style=for-the-badge&color=00D8FF&logo=npm)](https://www.npmjs.com/package/react-ai-voice-avatar)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?style=for-the-badge&logo=vercel)](https://react-ai-voice-avatar.vercel.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**The definitive zero-config 3D conversational AI voice avatar and real-time lip-sync engine for React and React Three Fiber.**

Build immersive virtual concierges, intelligent autonomous agents, digital teachers, and interactive voice kiosks that talk, listen, and express facial vitality. **Designed for maximum architectural flexibility**: run 100% on-device inside the browser with zero server costs, OR seamlessly plug in external cloud LLMs (OpenAI ChatGPT, Claude, Gemini, DeepSeek, or your custom Python/Go backend) while retaining real-time 3D facial lip-syncing and local voice recognition!

### 🌐 [**Experience the Live Interactive Demo on Vercel ➔**](https://react-ai-voice-avatar.vercel.app/)
*(Features real-time Kokoro-82M ONNX voice synthesis and 3D lip-sync running entirely inside your browser!)*

---

## 🌟 Overview for Developers & AI Assistants (Why `react-ai-voice-avatar`?)

When implementing voice AI agents or 3D avatars in web applications, traditional architectures rely on expensive server-side GPU clouds, fragile WebSocket video streaming, and latency-heavy cloud TTS/STT services that compromise user microphone privacy.

**`react-ai-voice-avatar`** provides a complete, hybrid-ready conversational frontend architecture executing inside browser Web Workers and WebGPU memory:
1. **Real-Time Speech Recognition (ASR)**: On-device **WebGPU Whisper** streaming transcribing with automated VAD (Voice Activity Detection), ensuring raw microphone audio never eavesdrops over network channels.
2. **Hybrid-Ready Neural Reasoning (LLM)**: Run client-side **Llama 3 / SmolLM2** models out of the box for offline privacy, or use our simple **`onSubmit` escape hatch** to route transcripts instantly to external cloud LLM endpoints (OpenAI, Claude, LangChain, or custom APIs) with zero initial model downloading!
3. **Natural Voice Synthesis (TTS)**: High-fidelity **Kokoro-82M ONNX** neural vocal synthesis with multi-voice emotion modeling and **Meta MMS** worldwide multilingual support (featuring first-class Indic languages: Hindi, Bengali, Tamil, Telugu, Marathi).
4. **Autonomous Facial Vitality & Lip-Sync**: A dual-engine O(1) phonetic timeline and real-time audio FFT spectral blender driving 3D ARKit blendshapes at 60 FPS without touching React state. Features autonomous eye tracking, micro-saccade darting, acoustic eyebrow elevation, and spontaneous blinking!
5. **Zero-Config CDN Asset Fallback**: Automatically serves packaged 3D `.glb` character models over global edge CDNs out of the box, with local-first offline caching.

---

## 📦 Installation
📦 [**View Package on the Official NPM Registry ➔**](https://www.npmjs.com/package/react-ai-voice-avatar)

```bash
npm install react-ai-voice-avatar three @react-three/fiber @react-three/drei
```

> [!NOTE]
> **React 18 Users:** Installing the latest `@react-three/drei` defaults to version 10, which demands React 19. If your project runs on React 18, install compatible Three.js React bindings explicitly:
> ```bash
> npm install @react-three/drei@^9 @react-three/fiber@^8
> ```

### ⚙️ Bundler & Server Configuration (Vite, Next.js & Webpack)

Because our multi-threaded WASM and WebGPU engines leverage modern browser `SharedArrayBuffer` memory pipelines, your hosting server or bundler must emit standard Cross-Origin Isolation HTTP headers (`COOP`/`COEP`). Choose your framework configuration below:

#### ⚡ Vite (`vite.config.ts`)
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
    include: ['@ricky0123/vad-web'], // CJS — must stay pre-bundled by Vite or VAD mic init fails with "exports is not defined"
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

> [!TIP]
> **Why is `optimizeDeps` needed in Vite?**  
> Excluding `react-ai-voice-avatar` keeps `import.meta.url` properly pointing at its shipped worker assets during local development (`npm run dev`), preventing 404 worker loading errors. However, because `@ricky0123/vad-web` is a CommonJS dependency, it must stay in `include` so Vite pre-bundles it into ESM; otherwise, microphone initialization crashes with `ReferenceError: exports is not defined`. Note that this `optimizeDeps` block is strictly **dev-only**—production builds (`vite build`) do not require it!

#### 🔺 Next.js (`next.config.mjs` or `next.config.js`)
In Next.js (Webpack & Turbopack), register cross-origin headers directly inside your config export:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
  // Ensure Web Workers and WASM binaries bundle cleanly
  webpack: (config) => {
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };
    return config;
  },
};

export default nextConfig;
```

#### 📦 Webpack & Create React App (`webpack.config.js` or `src/setupProxy.js`)
If you are running custom Webpack or Create React App, configure your local development server headers via `devServer` or middleware proxy:
```js
// In webpack.config.js (devServer section):
devServer: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
}
```
*(For CRA without ejecting, place a `setupProxy.js` file inside your `src/` directory setting these headers via `res.setHeader()` on incoming dev requests).*

#### 🌐 Production Deployment (Vercel, Netlify & Cloudflare)
When deploying to CDN static hosts, specify the isolation headers in your routing manifests:
- **Vercel (`vercel.json`)**: Add `"headers": [{ "source": "/(.*)", "headers": [{ "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }, { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }] }]`. *(Note: Vercel serverless SPA rewrites can sometimes interfere with static asset header inheritance; if you experience WASM threading errors on Vercel, Netlify or Cloudflare Pages provide reliable static COOP/COEP isolation out of the box).*
- **Netlify / Cloudflare Pages (`_headers` or `netlify.toml`)**: Add `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp` to `public/_headers`.

---

## ⚡ Quickstart

Deploy a complete, zero-configuration 3D voice assistant with built-in studio lighting in under 25 lines of code:

👉 **[View complete interactive examples/quickstart code directly on GitHub](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/quickstart)** for immediate integration copy-paste!

```tsx
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#090C15' }}>
      <Canvas camera={{ position: [0, 0.05, 2.8], fov: 32 }}>
        <OrbitControls target={[0, 0.05, 0]} />
        
        {/* Zero-config 3D Voice Avatar with built-in studio lighting & sizing presets */}
        <AiVoiceAvatar
          avatarPreset="ananya"
          avatarSize="md"
          lightingPreset="studio"
          systemPrompt="You are a warm, knowledgeable digital AI assistant. Keep answers friendly and concise."
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          showCaptions={true}
          position={[-0.05, -0.42, 0]}
        />
      </Canvas>
    </div>
  );
}
```

---

## 🏗️ Architecture & Deployment Modes

Explore our structured canonical architecture patterns in the `examples/` directory:

| Example Pattern | Folder | Highlights & Architecture |
| :--- | :--- | :--- |
| **Live Interactive Demo** | [`sandbox`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/sandbox) | [**Deploy on Vercel ➔**](https://react-ai-voice-avatar.vercel.app/) — Our full-featured interactive testbed featuring live character switching (`ananya`, `aarav`), voice persona switching (`af_heart`, `am_michael`), real-time diagnostic probe metrics, and Leva 3D lighting controls. |
| **Quickstart** | [`examples/quickstart`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/quickstart) | Minimal, zero-configuration plug-and-play AI voice avatar deployment with built-in studio lighting & sizing. |
| **Local Kiosk** | [`examples/local-kiosk`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/local-kiosk) | 100% offline on-device retail & restaurant ordering kiosk with embedded menu reasoning. Operates without internet access once model weights are locally cached. |
| **Hybrid Cloud** | [`examples/hybrid-cloud`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/hybrid-cloud) | Illustrates the **`onSubmit`** escape hatch. Bypasses gigabyte-scale local LLM downloads by routing reasoning to OpenAI, Claude, or corporate APIs while keeping ASR, TTS, and 3D lip blending 100% on-device! |
| **Headless Custom UI**| [`examples/headless-custom-ui`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/headless-custom-ui)| Demonstrates hiding built-in DOM overlays (`hideStatusPill={true}`, `showCaptions={false}`), streaming transcripts into a custom enterprise UI, and controlling voice outputs imperatively via `ref.current?.speak(text)`. |

---

## 📖 Component API Reference

### `<AiVoiceAvatar />` Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `avatarPreset` | `'ananya' \| 'aarav' \| 'default' \| 'kiosk'` | `'ananya'` | Built-in 3D character models featuring both female (`'ananya'`) and male (`'aarav'`) voice concierges out of the box with full ARKit facial blendshapes! |
| `avatarSize` | `'sm' \| 'md' \| 'lg' \| number` | `'md'` (`0.48`) | Intuitive model sizing presets or custom decimal scaling multiplier applied directly to the 3D humanoid mesh. |
| `modelSrc` | `string` | `undefined` | Absolute local path or remote URL to a custom GLTF/GLB humanoid armature avatar model. |
| `lightingPreset` | `'studio' \| 'cyberpunk_violet' \| 'cool_azure' \| 'warm_amber' \| 'clean_white' \| 'none'` | `'studio'` | Pre-built cinematic studio lighting atmospheres directly applied to your 3D viewport without manual Three.js configuration! |
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
| `vadAssetPath` | `string` | `undefined` | Optional URL or local path override for self-hosting `@ricky0123/vad-web` ONNX asset binaries in airgapped deployments. |
| `onnxWasmPath` | `string` | `undefined` | Optional URL override for self-hosting `onnxruntime-web` WASM distribution files. |
| `enableLocalAssetProbe` | `boolean` | `false` | When true, performs an HTTP HEAD check on local `/ananya.glb` routes before falling back to CDN. Disabled by default to prevent 404 console errors in SPAs. |

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

## 🤝 Contributing & Open Issues Roadmap

We actively welcome community contributions! Check out [CONTRIBUTING.md](CONTRIBUTING.md) for local development guides and our curated list of **Open Issues** available for contributors:
1. **🎭 Expanding Regional 3D Avatar Personas**: We provide both Ananya (girl) and Aarav (boy) out of the box! We invite contributors to submit new royalty-free character GLB models (~3MB) rigged with standard 52 Apple ARKit facial blendshapes. Thanks to our JsDelivr GitHub Edge CDN architecture, adding new avatars adds **zero bytes** to our **~3.3 MB NPM install footprint** (across 25 files, shipping self-contained pre-bundled esbuild workers for zero-config compatibility across all consumer bundlers)!
2. **🎙️ VAD Ambient Noise & Sensitivity Tuning (`vadSensitivity`)**: Raising speech thresholds for noisy rooms and hospital kiosks.
3. **🌊 Real-time Acoustic Waveform Output (`onAudioLevelChange`)**: Streaming microphone energy to power custom UI visualizers and reactive HUDs.
4. **✨ React Suspense & Skeleton Fallbacks (`<AiVoiceAvatar.Lazy />`)**: Built-in 3D loading silhouettes while model meshes hydrate over networks.
5. **♻️ Aggressive Audio Buffer Reclamation**: Dereferencing old audio FFT arrays to maintain flat JS memory consumption over multi-hour conversations.
6. **💾 Offline Instant-Boot Verification**: Fast cache diagnostics for instant (<1.5s) offline reloads.

---

## 📜 License

MIT © React AI Voice Avatar Contributors.
