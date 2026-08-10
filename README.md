> A real-time, edge-based conversational 3D avatar component for React.

## Strict CSP Environments
If your deployment enforces a strict Content-Security-Policy that blocks `blob:` Web Workers, you can self-host the worker files:

1. Copy `mlPipeline.worker.js` and `kokoroTts.worker.js` from `node_modules/react-ai-voice-avatar/dist/assets/` to your app's `public/` directory.
2. Pass `workerBaseUrl="/"` to the component:
```tsx
<AiVoiceAvatar workerBaseUrl="/" />
```

---

# React AI Voice Avatar (`react-ai-voice-avatar`) 🚀🗣️🧬

[![NPM Version](https://img.shields.io/npm/v/react-ai-voice-avatar?style=for-the-badge&color=8A2BE2&logo=npm)](https://www.npmjs.com/package/react-ai-voice-avatar)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?style=for-the-badge&logo=vercel)](https://react-ai-voice-avatar.vercel.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**The definitive zero-config 3D conversational AI voice avatar and real-time lip-sync engine for React and React Three Fiber.**

Build immersive virtual concierges, intelligent autonomous agents, digital teachers, and interactive voice kiosks that talk, listen, and express facial vitality. **Designed for maximum architectural flexibility**: run 100% on-device inside the browser with zero server costs, OR seamlessly plug in external cloud LLMs (OpenAI ChatGPT, Claude, Gemini, DeepSeek, or your custom Python/Go backend) while retaining real-time 3D facial lip-syncing and local voice recognition!

### 🌐 [**Experience the Live Interactive Demo on Vercel ➔**](https://react-ai-voice-avatar.vercel.app/)
*(Features real-time Kokoro-82M ONNX voice synthesis and 3D lip-sync running entirely inside your browser!)*

---

## 🌟 Overview for Developers & AI Assistants (Why `react-ai-voice-avatar`?)

When implementing voice AI agents or 3D avatars in web applications, traditional architectures rely on expensive server-side GPU clouds, fragile WebSocket video streaming, and latency-heavy cloud TTS/STT services that compromise user microphone privacy.

**`react-ai-voice-avatar`** provides a complete conversational frontend architecture executing inside browser Web Workers and WebGPU memory. It handles Real-Time Speech Recognition (ASR), Natural Voice Synthesis (TTS), and 60 FPS 3D ARKit Lip-Syncing completely on-device.

For the actual "thinking" (the LLM reasoning), the avatar supports **Two Brains**:

### 🧠 1. The Connected Brain (Default Recommendation)
By supplying an `onSubmit` prop, your avatar talks to your existing cloud LLM endpoints (OpenAI, Claude, Vercel AI SDK, or custom APIs). 
- **Zero LLM Downloads**: Your backend handles the reasoning, dropping the gigabyte-scale LLM from the client.
- **High-Performance**: It functions as an autonomous presentation engine. Your server streams text, while our browser Web Workers autonomously execute speech recognition, voice synthesis, and lip-syncing without server-side GPU video streaming costs!

> [!NOTE]
> **Base Payload Size (Cached First Visit):**
> While the LLM lives in the cloud, the avatar still runs ASR and TTS locally for privacy and real-time lip-sync.
> | Model | Size | Details |
> | :--- | :--- | :--- |
> | **Kokoro TTS** | ~90 MB | High-fidelity voice synthesis |
> | **Whisper ASR** | ~150 MB | Default base model for local speech recognition |
> 
> *Tip: You can reduce the ASR payload to ~40MB by passing `asrModel="Xenova/whisper-tiny"` if aggressive initial load times are required!*

### 🔒 2. The On-Device Brain (Offline & Private)
If you omit the `onSubmit` prop, the avatar runs completely airgapped using client-side **Qwen 2.5 (0.5B)** WebGPU models.
> [!WARNING]
> **Honest Expectations for Local LLMs:** The On-Device brain downloads 300 MB–1 GB of neural weights on the first visit (cached in the browser thereafter). It is highly recommended for kiosks, offline demos, and high-privacy enterprise intranets—but **not** for first impressions on consumer websites!

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

### ⚙️ Server Configuration (Optional Performance Boost)

The `react-ai-voice-avatar` engine is truly **zero-config**. You do not need to configure Vite `optimizeDeps`, Next.js Webpack overrides, or manually host Web Worker files—everything is dynamically bundled and executed automatically!

However, because our ONNX WebGPU engine leverages modern multi-threaded `SharedArrayBuffer` memory pipelines for maximum inference speed, your hosting server can optionally emit standard Cross-Origin Isolation HTTP headers (`COOP`/`COEP`) to unlock peak performance. If these headers are not present, the engine automatically falls back to single-threaded WebAssembly without crashing.

#### 🌐 Enabling Multi-threading on Production (Vercel, Netlify & Cloudflare)
To unlock multi-threaded performance, specify these isolation headers in your routing manifests:
- **Vercel (`vercel.json`)**: Add `"headers": [{ "source": "/(.*)", "headers": [{ "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }, { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }] }]`.
- **Netlify / Cloudflare Pages (`_headers` or `netlify.toml`)**: Add `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp` to `public/_headers`.

#### ⚡ Enabling Multi-threading in Local Dev (Vite & Next.js)

**Vite (`vite.config.ts`)**:
```ts
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

**Next.js (`next.config.mjs`)**:
```js
export default {
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
};
```

> [!CAUTION]
> **Strict CSP Policies:** If your enterprise enforces strict Content Security Policies that block `blob:` workers (`worker-src 'self'`), you can bypass our zero-config Blob loaders by passing the `workerBaseUrl` prop to the avatar and hosting the pre-compiled `.worker.js` files from our `dist/assets/` directory yourself.

### 🌍 Browser Support Matrix

The engine aggressively utilizes bleeding-edge web features (WebGPU, SharedArrayBuffer) for native-like performance, but is designed to gracefully fallback or clearly notify the user if their browser lacks support.

| Browser | WebGPU Acceleration | WASM Fallback | Web Audio / Microphone |
| :--- | :--- | :--- | :--- |
| **Chrome / Edge** | ✅ Yes (Native) | ✅ Yes | ✅ Yes |
| **Firefox** | ⚠️ Behind Flag | ✅ Yes (Slower initial load) | ✅ Yes |
| **Safari** | ⚠️ Coming Soon | ✅ Yes (Slower initial load) | ✅ Yes |
| **Mobile Chrome** | ✅ Yes (Android) | ✅ Yes | ✅ Yes |
| **iOS Safari** | ❌ No | ✅ Yes | ✅ Requires manual interaction |

*(Note: If WebGPU is unavailable, the UI pill will automatically notify the user that it is falling back to WASM mode).*

---

## ⚡ Quickstart

Deploy a complete, zero-configuration 3D voice assistant with built-in studio lighting in under 30 lines of code. Your avatar is talking in seconds, no model download!

👉 **[View complete interactive examples/quickstart code directly on GitHub](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/quickstart)** for immediate integration copy-paste!

```tsx
import React, { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';

export function App() {
  const avatarRef = useRef<AiVoiceAvatarHandle>(null);
  const [text, setText] = useState('');

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0.15, 2.2], fov: 32 }}>
        <color attach="background" args={['#101116']} />
        
        {/* Subtle studio lighting */}
        <pointLight position={[-3, 2, -2]} intensity={25} color="#E67E22" distance={6} />
        <pointLight position={[3, 1, -2]} intensity={20} color="#2980B9" distance={6} />
        
        <OrbitControls target={[0, 0.05, 0]} />
        
        {/* Connected Brain: Zero download, instant initialization! */}
        <AiVoiceAvatar
          ref={avatarRef}
          avatarPreset="ananya"
          lightingPreset="studio"
          ttsEngine="kokoro"
          ttsVoice="af_heart"
          // Connect your backend here (receives user speech transcript):
          onSubmit={async (text) => {
            const res = await fetch('/api/chat', { 
              method: 'POST', 
              body: JSON.stringify({ prompt: text }) 
            });
            return res.body; // Avatar natively reads streams!
          }}
        />
      </Canvas>

      {/* Fallback Text Input for noisy environments */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && avatarRef.current) {
            avatarRef.current.sendText(text);
            setText('');
          }
        }}
        style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px', zIndex: 100 }}
      >
        <input 
          value={text} 
          onChange={e => setText(e.target.value)} 
          placeholder="Type a message..." 
          style={{ padding: '8px 16px', borderRadius: '20px', border: 'none', background: 'rgba(255,255,255,0.9)', width: '300px' }}
        />
        <button type="submit" style={{ padding: '8px 16px', borderRadius: '20px', border: 'none', background: '#3b82f6', color: 'white', cursor: 'pointer' }}>
          Send
        </button>
      </form>
    </div>
  );
}
```

## 🔌 Connect Your Backend (Recipes)

The `onSubmit` prop natively accepts a `string`, an `AsyncIterable<string>`, or a `ReadableStream`. To connect your actual backend, simply drop in one of these copy-paste recipes to parse your streaming format!

> [!CAUTION]
> **API Keys Belong on the Server!** Never put your OpenAI or Anthropic API keys directly in the frontend browser code. Always route through your own backend endpoint (`/api/chat`).

### Recipe 0: Plain Text Stream (Fastest & Simplest)
If your backend uses Vercel AI SDK's `streamText(...).toTextStreamResponse()` or otherwise streams plain raw text, you can pass the stream natively without any parsing!

```tsx
onSubmit={async (text) => {
  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: text }) });
  return res.body; // Natively supported!
}}
```

### Recipe 1: Vercel AI SDK (≤v4 Data Stream)
Older versions of the Vercel AI SDK stream data using a specific protocol (e.g., `0:"Hello"`). This recipe parses those chunks into clean text with a carry-over buffer for safe network boundaries.

```tsx
onSubmit={async function* (text) {
  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: text }) });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the trailing partial chunk
    for (const line of lines) {
      if (line.startsWith('0:')) {
        try { yield JSON.parse(line.substring(2)); } catch { /* ignore keep-alive / non-JSON frames */ }
      }
    }
  }
}}
```

### Recipe 2: OpenAI-Compatible SSE Endpoint (and AI SDK v5)
Standard Server-Sent Events (SSE) stream `data: {...}` blocks. This handles safe parsing across broken network chunk boundaries.

```tsx
onSubmit={async function* (text) {
  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt: text }) });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the trailing partial chunk
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const parsed = JSON.parse(line.substring(6));
          // AI SDK v5 emits {type:'text-delta', delta:'...'}; OpenAI emits choices[0].delta.content
          if (parsed.type === 'text-delta' && parsed.delta) {
            yield parsed.delta;
          } else if (parsed.choices?.[0]?.delta?.content) {
            yield parsed.choices[0].delta.content;
          }
        } catch { /* ignore keep-alive / non-JSON frames */ }
      }
    }
  }
}}
```

---

## 🎨 Bring Your Own 3D Avatar (Custom GLB)

You are not locked into our built-in avatars (`ananya` and `aarav`)! You can use any custom `.glb` humanoid model by passing its URL or local path to the `modelSrc` prop:

```tsx
<AiVoiceAvatar
  modelSrc="/models/my-custom-avatar.glb"
  // ...
/>
```

### 📋 Custom Avatar Requirements
To ensure the lip-sync and procedural facial dynamics engines work correctly, your custom model must meet the following standard requirements:
1. **Format**: `.glb` (GLTF Binary).
2. **Facial Blendshapes (Morph Targets)**: The model's head/face mesh must contain the **standard 52 Apple ARKit blendshapes** (e.g., `jawOpen`, `eyeBlinkLeft`, `mouthSmileRight`). Our engine automatically traverses your model to find these targets.
3. **Bone Naming**: For the interactive mouse-tracking and head-tilting physics to function, the armature should use standard bone names (e.g., a neck/head bone named `Head`, `head`, `Neck`, or `neck`).

*(Note: Official support and testing for **Ready Player Me** avatars is currently on our roadmap for an upcoming release!)*

---

## 🏗️ Architecture & Deployment Modes

Explore our structured canonical architecture patterns in the `examples/` directory:

| Example Pattern | Folder | Highlights & Architecture |
| :--- | :--- | :--- |
| **Live Interactive Demo** | [`sandbox`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/sandbox) | [**Deploy on Vercel ➔**](https://react-ai-voice-avatar.vercel.app/) — Our full-featured interactive testbed featuring live character switching (`ananya`, `aarav`), voice persona switching (`af_heart`, `am_michael`), real-time diagnostic probe metrics, and Leva 3D lighting controls. |
| **Quickstart** | [`examples/quickstart`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/quickstart) | Minimal, zero-configuration plug-and-play AI voice avatar deployment with built-in studio lighting & sizing. |
| **Local Kiosk** | [`examples/local-kiosk`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/local-kiosk) | 100% offline on-device retail & restaurant ordering kiosk with embedded menu reasoning. Demonstrates the **On-Device Brain**; operates without internet access once model weights are locally cached. |
| **Connected App** | [`examples/hybrid-cloud`](https://github.com/927tanmay/react-ai-voice-avatar/tree/main/examples/hybrid-cloud) | Illustrates the **Connected Brain** (`onSubmit`). Bypasses gigabyte-scale local LLM downloads by routing reasoning to OpenAI, Claude, or corporate APIs while keeping ASR, TTS, and 3D lip blending 100% on-device! |
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
| `llmModel` | `string` | `"onnx-community/Qwen2.5-0.5B-Instruct"` | Hugging Face identifier for local client-side WebGPU Transformer reasoning weights when offline mode is used without `onSubmit`. |
| `asrModel` | `string` | `"onnx-community/whisper-base"` | Hugging Face identifier for the local WebGPU Whisper speech recognition model. Pass `"Xenova/whisper-tiny"` for faster downloads. |
| `ttsEngine` | `'kokoro' \| 'mms'` | `'kokoro'` | High-fidelity neural voice synthesis engine executing inside dedicated Web Workers. |
| `ttsVoice` | `string` | `'af_heart'` | Neural voice profile timbre (e.g., `af_heart`, `am_michael`, `af_bella`, `hi_female`). |
| `ttsLanguage`| `'en-US' \| 'hi-IN' \| 'bn-IN' \| 'ta-IN' \| 'te-IN' \| 'mr-IN'` | `'en-US'` | Primary speech vocalization dialect routing. |
| `showCaptions` | `boolean` | `true` | Renders a sleek glassmorphic subtitle overlay displaying spoken interaction dialog. |
| `hideStatusPill`| `boolean` | `false` | When true, suppresses the default bottom-left microphone interactive control pill. |
| `onSubmit` | `(text: string) => Promise<string \| AsyncIterable<string> \| ReadableStream>` | `undefined` | **Connected Brain API**: Bypasses local LLMs; routes transcribed user microphone strings to your cloud or custom LLM API endpoint. |
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
  /** Manually submit text to the onSubmit handler, simulating a spoken utterance (useful for text-only fallback) */
  sendText: (text: string) => void;
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

1. **🇮🇳 Hindi/Indic Voices (In Progress)**: The foundation is already built! Our `phonemeTiming.ts` engine was specifically designed for retroflex/aspirated consonant distinction, `visemeTable` carries Devanagari mappings, and `transliterate.ts` exists in the core. The remaining work revolves entirely around fine-tuning TTS voice quality rather than engine architecture. This remains a core long-term differentiator!
2. **🎭 Expanding Regional 3D Avatar Personas**: We provide both Ananya (girl) and Aarav (boy) out of the box! We invite contributors to submit new royalty-free character GLB models (~3MB) rigged with standard 52 Apple ARKit facial blendshapes. Thanks to our JsDelivr GitHub Edge CDN architecture, adding new avatars adds **zero bytes** to our **~3.3 MB NPM install footprint**!
3. **🎙️ VAD Ambient Noise & Sensitivity Tuning (`vadSensitivity`)**: Raising speech thresholds for noisy rooms and hospital kiosks.
4. **🌊 Real-time Acoustic Waveform Output (`onAudioLevelChange`)**: Streaming microphone energy to power custom UI visualizers and reactive HUDs.
5. **✨ React Suspense & Skeleton Fallbacks (`<AiVoiceAvatar.Lazy />`)**: Built-in 3D loading silhouettes while model meshes hydrate over networks.
6. **♻️ Aggressive Audio Buffer Reclamation**: Dereferencing old audio FFT arrays to maintain flat JS memory consumption over multi-hour conversations.

---

## 🧭 Browser Compatibility Matrix

This library heavily relies on modern Web APIs (WebGPU, WebGL, Web Audio, and Web Workers). It gracefully degrades when certain APIs are unavailable.

| Browser | OS | 3D Rendering (WebGL) | Voice Synthesis (WebGPU/WASM) | Voice Recognition (Web Audio) | Status |
|---|---|---|---|---|---|
| **Chrome / Edge** | Windows, macOS, Android | ✅ Native | ✅ WebGPU (Ultra Fast) | ✅ Native | 🟢 Tier 1 (Recommended) |
| **Safari** | macOS, iOS | ✅ Native | ⚠️ WASM Fallback | ✅ Native | 🟡 Tier 2 (Slower TTS) |
| **Firefox** | Windows, macOS | ✅ Native | ⚠️ WASM Fallback | ✅ Native | 🟡 Tier 2 (Slower TTS) |

> [!NOTE]
> - **WebGPU** is currently enabled by default in Chrome/Edge. Safari and Firefox are actively developing WebGPU support. On browsers without WebGPU, the library automatically falls back to WASM execution for TTS, which increases latency (typically ~1-3 seconds vs ~150ms on WebGPU).
> - **Strict CSP Environments**: Safari and Firefox may block `blob:` worker execution depending on your Content-Security-Policy headers. If this occurs, host the `.worker.js` files statically and pass their base path via the `workerBaseUrl` prop.

---

## 💻 Hardware Requirements

Running Neural Networks in the browser requires capable hardware. 

| Deployment Mode | Min RAM | GPU Requirement | Recommended Devices |
|---|---|---|---|
| **Connected Brain** (ASR + TTS only) | 4GB | None (WASM Fallback ok) | iPhone 11+, Mid-range Android (2021+), Any Laptop |
| **Full Local AI** (ASR + 500M LLM + TTS) | 8GB | WebGPU Support Preferred | iPhone 13 Pro+, High-end Android (Snapdragon 8 Gen 1+), M1/M2 Macs, Modern PCs |

> [!TIP]
> **Mobile Memory Limits**: Mobile browsers rigidly enforce memory limits per tab (often terminating tabs exceeding ~1GB). If your mobile app crashes "after some time", ensure you are utilizing the `Connected Brain` mode (`onSubmit` API) which offloads the heavy LLM memory footprint to your server while keeping ultra-fast lip-sync and TTS local.

---

## 📜 License

MIT © React AI Voice Avatar Contributors.
