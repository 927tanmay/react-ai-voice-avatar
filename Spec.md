# IndicAvatar — Full Build Specification (v2)

**Purpose of this document:** hand this directly to Claude Code as the working spec for building `react-indic-avatar`. This is a revision of the v1 plan after an end-to-end verification pass against live sources (Hugging Face, npm, GitHub). It locks in confirmed model choices, defines the npm package contract, describes both audiences of end-user (the developer integrating the package, and the person talking to the avatar), and breaks the build into concrete, sequential tasks with acceptance criteria per phase.

---

## Revision Log (v1 → v2)

Everything below was verified against live sources on 2026-07-28. Items marked **🔧 FIX** were wrong or unsafe in v1 and are corrected here. Items marked **🆕 NEW** are additions. Two decisions were open questions in v1 and are now locked with stated reasoning — re-validate both empirically in Phase 0 before building on top of them, since that's the whole point of Phase 0.

| # | Change | Where |
|---|---|---|
| 1 | 🔧 **`@huggingface/transformers` locked to v4**, not v3 — v4 shipped Feb 2026 with a rewritten C++ WebGPU runtime, which matters directly for this project's speed claims | §1.1, §1.4 |
| 2 | 🔧 **React/R3F peer dependency ranges tightened** — v1's ranges could resolve incompatible React+R3F combinations at install time | §1.4, §4.1 |
| 3 | 🔧 **VAD package name corrected** to `@ricky0123/vad-web` (the old `@ricky0123/vad` name is retired), plus a previously-missing build step for its bundled ONNX/WASM/worklet assets | §1.1, Phase 1, Phase 3 |
| 4 | 🔧 **Regional MMS-TTS repos reclassified** from "verify before use" to "likely needs conversion" — none of the four (ben/tam/tel/mar) were found to exist under the `Xenova` ONNX namespace | §1.2 |
| 5 | 🔧 **Default avatar sourcing guidance corrected** — Khronos glTF-Sample-Assets is a feature-test library, not a character library; redirected to more realistic sources | §4.5 |
| 6 | 🔧 **Gated-model check added** for the `Llama-3.2-1B-Instruct` override example — the base Meta repo is gated; the ONNX mirror needs an explicit unauthenticated-access test | §7.4 |
| 7 | 🔧 **Lip-sync approach hedged** — pure FFT-band energy is unlikely to reliably distinguish retroflex/aspirated consonants on its own; a hybrid text-timing approach is now specified | §2.1, Phase 5 |
| 8 | 🆕 **Captions**, **push-to-talk input mode**, **headless hook**, **imperative ref handle** (`clearHistory`, `interrupt`, etc.) added to the props/exports contract | §4.2, §4.3 |
| 9 | 🆕 **Visual polish pass**: studio lighting/environment preset, idle micro-movement, glass status pill + live waveform in place of plain text status | §3.2, Phase 2, §7.4/7.5 |
| 10 | 🆕 New QA checklist items for the above | §8 |

---

## 0. Project One-Liner

An open-source React component (`<IndicAvatar />`) that renders a 3D character capable of real-time, fully client-side (WebGPU/WASM), voice-to-voice conversation, with lip-sync tuned for Indic phonetics. Zero server cost by default; optional hybrid mode to route conversation logic to a developer's own backend.

---

## 1. Technology Stack & Machine Learning Pipeline

The project leverages bleeding-edge browser standards to run complex neural networks locally.

| Layer | Technology | Purpose & Capabilities |
| --- | --- | --- |
| **Frontend Framework** | React 19 (Vite / TypeScript) | Component architecture and state management. See §1.4 for why React 19 over 18. |
| **3D Rendering** | `@react-three/fiber` v9 & `three` | Declarative WebGL 3D scene management and `.glb` model loading. |
| **Machine Learning** | `@huggingface/transformers` **v4** | Runs AI models directly in the browser via WebGPU, using the v4 C++ WebGPU runtime. 🔧 v1 specified v3; see §1.4. |
| **Speech-to-Text (ASR)** | Whisper base (multilingual, ONNX) | Converts spoken user audio into text. Used in place of `IndicWhisper` — see §1.1. |
| **Local LLM (Default)** | `Qwen2.5-0.5B-Instruct` | A lightweight, quantized reasoning engine optimized for 4-bit WebGPU execution. Confirmed working, including in Hugging Face's own v3/v4 example code. |
| **Text-to-Speech (TTS)** | Meta MMS, per-language (ONNX) | Synthesizes the LLM/backend text output into an audio stream. Single voice per language, no emotion control — a real trade-off vs. Parler, documented in §1.3. |
| **Voice Activity (VAD)** | Silero VAD via **`@ricky0123/vad-web`** | 🔧 Corrected package name (was previously `@ricky0123/vad`, now retired/split by platform). `@ricky0123/vad-react` also exists and is worth evaluating in Phase 0 given this is a React library. |

### 1.1 Confirmed v1 Model Stack (verified available today)

These replace the AI4Bharat models from the original blueprint until a working ONNX conversion path is found for those. Do not attempt to load `ai4bharat/indic-parler-tts` or `IndicWhisper` directly — they are not ONNX/Transformers.js-ready today and will fail or require conversion work outside this scope.

| Role | Model | Repo ID | Notes |
|---|---|---|---|
| ASR (Speech-to-Text) | Whisper base (multilingual) | `onnx-community/whisper-base` | Already ONNX-converted. Pass `{ language: 'hi', task: 'transcribe' }` (or the relevant language code) in pipeline options. **Known issue, confirm fixed under v4:** there are documented GitHub reports of this exact model crashing Safari on iOS in an infinite-reload loop under certain quantization/backend combos on transformers.js v3 — re-test specifically on iOS Safari as part of Phase 0, not just Phase 8. |
| LLM (local reasoning) | Qwen2.5-0.5B-Instruct | `onnx-community/Qwen2.5-0.5B-Instruct` | Already ONNX-converted, confirmed working with `@huggingface/transformers` + WebGPU — this is literally Hugging Face's own canonical example for the WebGPU text-generation pipeline. |
| TTS (Text-to-Speech) | Meta MMS (per-language) | `Xenova/mms-tts-hin` (Hindi) | Confirmed live on Hugging Face with a working Transformers.js usage example. MMS is **one model per language** (VITS-style, single voice, no voice selection, no emotion control) — this is a real quality/feature step down from Parler-TTS, and is a known, accepted trade-off, not a bug. |
| VAD | Silero VAD via `@ricky0123/vad-web` | `npm i @ricky0123/vad-web` (or evaluate `@ricky0123/vad-react`) | 🔧 Confirmed current package name. **New build requirement:** this package does not bundle cleanly by default — it ships a `silero_vad.onnx` model file, a `vad.worklet.bundle.min.js` AudioWorklet file, and depends on `onnxruntime-web`'s own `.wasm` files, all of which must be explicitly copied into your build output (see Phase 1). It also means the app now carries **two independent ONNX Runtime Web instances** — one via `@huggingface/transformers`, one via the VAD package. Not a blocker, but measure the combined bundle-size cost in Phase 0 and note it in `DECISIONS.md`. |

### 1.2 Multi-language TTS repo mapping

MMS covers hundreds of languages, but each is a **separate model repo**. Only `Xenova/mms-tts-hin` has been directly confirmed. For the other languages listed in the original `ttsLanguage` prop, treat these as **likely unconverted**, not merely unverified:

| `ttsLanguage` prop value | Expected repo ID | Status |
|---|---|---|
| `hi-IN` | `Xenova/mms-tts-hin` | ✅ Confirmed live, working Transformers.js example on the model card |
| `bn-IN` | `Xenova/mms-tts-ben` | 🔧 Not found under the `Xenova` or `onnx-community` namespaces as of this writing. Only the original PyTorch checkpoint (`facebook/mms-tts-ben`) exists. Treat as **needs an Optimum ONNX conversion**, budget real time for it. |
| `ta-IN` | `Xenova/mms-tts-tam` | 🔧 Same status as above — not found, budget for conversion. |
| `te-IN` | `Xenova/mms-tts-tel` | 🔧 Same status as above — not found, budget for conversion. |
| `mr-IN` | `Xenova/mms-tts-mar` | 🔧 Same status as above — not found, budget for conversion. |

**Recommendation:** ship v1 with `hi-IN` as the only fully working language and mark the other four as `'planned'` in the README's language table, rather than letting Claude Code burn Phase 4 time hunting for repos that likely don't exist yet. If a repo genuinely doesn't exist under any known namespace, convert it yourself via HF Optimum before shipping that language as "supported" — never silently fall back without telling the developer via a console warning and the `onCapabilityDetected`/error callback.

### 1.3 Why this stack is acceptable for v1

- All three core models (Whisper-base, Qwen2.5-0.5B-Instruct, MMS Hindi) are confirmed, already-converted, and known to run in Transformers.js today.
- Whisper-base's multilingual training already includes Hindi and other major Indic languages at reasonable quality — it is a legitimate STT choice, not just a placeholder.
- Swapping in a better Indic TTS/ASR later (Parler, a converted AI4Bharat model) is intended to be a drop-in model-ID change — **but see §2.1 and Phase 5 for an important caveat**: the lip-sync engine's ability to hit the "wow moment" claimed in §3.2 depends partly on more than just which TTS voice is speaking; it depends on how much timing information the lip-sync layer has access to, which is an architecture question, not just a model-swap question.

### 1.4 Locked Decisions (resolves v1's two open questions)

These were flagged as open in the verification pass. Both are now locked so Claude Code can proceed, but **Phase 0 must still empirically confirm both before Phase 1 begins** — that's consistent with this whole plan's philosophy of proving things work before building product code on top of them.

**Decision A — `@huggingface/transformers`: target v4, not v3.**
Transformers.js v4 (shipped Feb 2026) replaced the WebGPU runtime with a new C++ implementation, tested by the HF team across ~200 model architectures. Since this project's core pitch is WebGPU-driven speed, running on a version-behind runtime undercuts the pitch. Pin an **exact** version once Phase 0 confirms all three models load and run correctly under v4 — a loose `^4.0.0` range is not acceptable for a project this dependent on runtime internals. If v4 shows any regression with any of the three chosen models, fall back to the last known-good v3.x release and record the specific reason in `DECISIONS.md`; don't silently downgrade without a note.

**Decision B — React 19 + `@react-three/fiber` v9, not React 18 + R3F v8.**
R3F is a custom React renderer, not just an API-compatible library — it's tied to a specific React major version because it bundles/relies on React's internal reconciler. R3F v8 pairs only with React 18; R3F v9 pairs only with React 19.x (specifically `>=19 <19.3` in current releases, because a React 19.2 internal change required R3F to vendor its own reconciler). Since this is a greenfield project, target the current mainline: React 19 + R3F v9. Document this clearly in the README's peer-dependency section so consumers on React 18 know upfront they need R3F v8 instead (a documented incompatibility, not a silent one).

---

## 2. System Architecture & Threading Model

This is the mental model Claude Code should build against for every phase below — heavy ML computation must never share a thread with the 60fps render loop, or the avatar will visibly stutter and the whole "feels instant" value proposition breaks.

### 2.1 — Phase A: The Main Thread (UI, Audio, WebGL)

1. **Microphone Interceptor:** the browser captures audio via `navigator.mediaDevices.getUserMedia()`, enforcing hardware-level `echoCancellation` and `noiseSuppression`.
2. **Barge-in Logic (Interruption):** in `listenMode: 'vad'` (the default), Silero VAD monitors the microphone continuously. If the user begins speaking while the avatar is talking, the VAD triggers an `onSpeechStart` event. The main thread immediately calls `.stop()` on the avatar's audio buffer, cutting it off mid-sentence to listen to the new prompt. 🆕 In `listenMode: 'push-to-talk'`, VAD-driven barge-in is disabled and listening is instead controlled explicitly via the `startListening()`/`stopListening()` methods exposed on the component's ref handle (see §4.3) — useful for noisy environments or privacy-sensitive kiosk deployments where always-on listening isn't appropriate.
3. **The 60fps Direct Mutation Loop:** an `AnalyserNode` performs Fast Fourier Transforms (FFT) on the playing audio. Inside the React Three Fiber `useFrame` hook, the computed viseme weights are applied directly to the 3D mesh (e.g., `meshRef.current.morphTargetInfluences`). **React state is intentionally bypassed here to prevent frame drops.**
   🔧 **Revised approach — see Phase 5 for full detail:** pure FFT-band energy is a reasonable heuristic for generic mouth-open/round/close shapes, but it's optimistic to expect it to reliably distinguish retroflex from dental consonants, or aspirated from unaspirated ones, on spectral energy alone — those distinctions are often carried more by timing (voice onset time, formant transitions) than by steady-state frequency content. Since the system already has the *text* being spoken before/during TTS playback, Phase 5 now specifies a **hybrid approach**: FFT-driven amplitude/openness as the primary real-time signal, blended with a coarse per-character timing estimate derived from the known text, so retroflex/aspirated visemes are informed by "we know a ठ is coming now," not purely inferred from the waveform after the fact.

### 2.2 — Phase B: The WebGPU Worker Thread (Inference)

All Hugging Face models are initialized here with `{ device: 'webgpu' }` (falling back to `{ device: 'wasm' }` per `fallbackMode`).

1. **ASR:** transcribes the audio blob sent from the main thread into text, using the Whisper ONNX pipeline confirmed in §1.1.
2. **LLM Routing:** appends the transcript to an internal `chatHistory` array for conversational context, then generates the response token-by-token — or, if `onSubmit` is provided, hands the transcript back to the main thread for the hybrid path instead. See the routing precedence in §4.4.
3. **TTS:** synthesizes the generated text into raw PCM audio data and posts the `ArrayBuffer` back to the main thread, where it's both played and fed into the FFT/lip-sync loop from §2.1.

### 2.3 The `postMessage` Contract (worker ↔ main thread)

Claude Code should implement a small, explicit message protocol between `useMLWorker.ts` and `mlPipeline.worker.ts` rather than passing ad-hoc objects — this keeps Phase 4 debuggable. At minimum:

| Direction | Message type | Payload |
|---|---|---|
| Main → Worker | `init` | `{ llmModel, asrModel, ttsLanguage, fallbackMode, lowMemoryMode }` |
| Worker → Main | `capabilities` | `{ webgpu: boolean, estimatedVram: number \| null }` |
| Worker → Main | `loadingProgress` | `{ model: 'asr' \| 'llm' \| 'tts', pct: number }` |
| Main → Worker | `audioInput` | `{ blob: ArrayBuffer }` (captured on `onSpeechEnd`, or on `stopListening()` in push-to-talk mode) |
| Worker → Main | `transcript` | `{ text: string }` (fires immediately after ASR, before LLM — this is also what drives the 🆕 captions overlay, so latency here matters for perceived responsiveness) |
| Worker → Main | `speechOutput` | `{ audio: ArrayBuffer, sampleRate: number, text: string }` — 🔧 `text` field added so the main thread can render the avatar's reply as a caption in sync with playback, not just play the audio blindly |
| Worker → Main | `error` | `{ stage: 'asr' \| 'llm' \| 'tts', message: string }` |

---

## 3. End-User Experience (two distinct audiences)

### 3.1 The Developer (npm package consumer)

This is who reads the README and writes code. Their journey:

1. `npm install react-indic-avatar`
2. Wrap their scene in `<Canvas>` from `@react-three/fiber` (a peer dependency).
3. Drop in `<IndicAvatar modelSrc="..." ttsLanguage="hi-IN" />` with sane defaults for everything else.
4. On first run in dev, see a visible console log + optional `loadingProgress` callback showing model downloads (this must be documented loudly — first load can be 200MB–600MB with this stack; MMS models run ~100–300MB, Whisper-base ~150MB (quantized), Qwen2.5-0.5B ~300–500MB depending on dtype).
5. Optionally override `llmModel` for a custom local model, or provide `onSubmit` to route to their own backend and skip the local LLM entirely.
6. 🆕 Optionally enable `showCaptions`, switch `listenMode` to `'push-to-talk'`, or drop down to the headless `useIndicAvatarState()` hook if they want a fully custom UI instead of the bundled one.
7. Ship it. The component handles mic permissions, VAD, barge-in, and lip-sync internally — the developer never touches Web Workers, WebGPU, or FFT math directly.

**Their pain points to design against:** long first-load with no feedback (must show progress), silent failure on unsupported browsers (must call `onCapabilityDetected`/throw a clear error depending on `fallbackMode`), and confusion about which prop wins when several are set (must be documented in the README with the exact precedence order). 🆕 Also design against: developers on React 18 not realizing this package requires React 19 until a confusing R3F error appears — the README's install section must state the React 19 requirement in the first paragraph, not bury it in peer dependency fine print.

### 3.2 The End User (person talking to the avatar)

This is who sees the finished product embedded in someone's app (e.g. a kiosk, a coaching-app assistant, a customer support widget). Their journey:

1. Page loads → sees the 3D avatar in an idle/breathing state with subtle micro-movement (occasional glance, slight weight shift — not just breathing in place, which reads as "frozen" rather than "present"), plus a "tap to start" or auto-listening indicator.
2. Grants mic permission (first time only) → sees a clear "Listening" state: a subtle glow/ring on the avatar **and** — 🆕 — a visible recording indicator, since a person facing a kiosk should always be able to tell at a glance whether it's actively listening. This is a trust/privacy feature as much as a UX one.
3. Speaks a sentence in Hindi (or whichever configured language) → sees a "Thinking" state while ASR → LLM (or backend) → TTS runs. 🆕 If `showCaptions` is enabled, sees their own words appear as text in real time, confirming they were heard correctly.
4. Hears the avatar respond in the target language, with its mouth shape visibly matching the Indic phonemes being spoken — this is the "wow" moment and the actual product differentiator. 🆕 If captions are on, sees the reply text appear in sync with speech.
5. Can **interrupt** the avatar mid-sentence by simply speaking (in `vad` mode) — VAD detects this, playback stops immediately, and the avatar returns to "Listening" state. Target: interruption registers within one VAD frame, well under 300ms.
6. If on an unsupported browser/device (no WebGPU, no mic, etc.), sees a clear, non-cryptic message rather than a frozen or broken UI.

**Design principle:** the end user should never need to know this is running entirely on their own device — it should just feel fast (after first load) and free of the "typical chatbot" latency, since there's no network round-trip per turn.

---

## 4. NPM Package Contract

### 4.1 Package identity

```json
{
  "name": "react-indic-avatar",
  "version": "0.1.0",
  "description": "Local-first, WebGPU-powered 3D avatar with real-time Indic voice conversation for React.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "peerDependencies": {
    "react": ">=19 <19.3",
    "react-dom": ">=19 <19.3",
    "three": ">=0.156",
    "@react-three/fiber": "^9.0.0"
  },
  "dependencies": {
    "@huggingface/transformers": "4.x — pin exact version after Phase 0 confirms compatibility",
    "@ricky0123/vad-web": "latest — pin exact version after Phase 0; evaluate @ricky0123/vad-react as an alternative"
  },
  "sideEffects": false
}
```

🔧 **Fixed from v1:** the peer dependency ranges (`react`, `three`, `@react-three/fiber`) are now tight matches to what R3F v9 itself requires, instead of the loose `>=18` / `>=8` ranges in v1 that could resolve an incompatible React+R3F pairing at install time. If you later decide to also support React 18 + R3F 8 as a second supported line, that needs to be a documented, tested, separately-versioned support path — not a wide-open peer range hoping both work.

Notes for Claude Code: keep `three` and `@react-three/fiber` as **peer** dependencies, not direct dependencies — the consuming app almost certainly already has them, and bundling a second copy causes the classic "multiple instances of three.js" runtime errors in R3F apps.

### 4.2 Public API surface

```typescript
// index.ts — the only import surface consumers touch
export { IndicAvatar } from './components/IndicAvatar';
export type { IndicAvatarProps, IndicAvatarCapabilities, IndicAvatarHandle } from './components/IndicAvatar';

// 🆕 Headless hook for developers building a fully custom UI instead of using
// the bundled component's default rendering (status pill, captions, etc.)
export { useIndicAvatarState } from './hooks/useIndicAvatarState';
export type { IndicAvatarState } from './hooks/useIndicAvatarState';
```

### 4.3 Full Props Schema

```typescript
import { ThreeElements } from '@react-three/fiber';

export interface IndicAvatarCapabilities {
  webgpu: boolean;
  estimatedVram: number | null;
}

// 🆕 Imperative handle exposed via forwardRef, for developers who need
// explicit control beyond what props alone allow.
export interface IndicAvatarHandle {
  clearHistory: () => void;
  interrupt: () => void;           // manually trigger barge-in / stop speaking
  startListening: () => void;      // only meaningful in listenMode: 'push-to-talk'
  stopListening: () => void;       // only meaningful in listenMode: 'push-to-talk'
}

export interface IndicAvatarProps extends Omit<ThreeElements['group'], 'children'> {
  // 1. Visual Configuration
  modelSrc?: string; // if omitted, loads the bundled default avatar — see §4.5
  avatarPreset?: 'default' | 'kiosk';
  visemeMap?: Record<string, string>; // overrides the default preset's viseme->morph-target mapping
  environmentPreset?: 'studio' | 'none'; // 🆕 default 'studio'; adds soft 3-point lighting + ground contact shadow + subtle environment reflection via @react-three/drei's <Environment>, instead of a flat ambient light

  // 2. Local AI Configuration
  systemPrompt?: string;
  llmModel?: string; // defaults to 'onnx-community/Qwen2.5-0.5B-Instruct'
  ttsLanguage?: 'hi-IN' | 'bn-IN' | 'ta-IN' | 'te-IN' | 'mr-IN'; // only 'hi-IN' is fully confirmed as of this spec — see §1.2
  asrModel?: string; // defaults to 'onnx-community/whisper-base'
  asrLanguage?: string; // ISO 639-1 code passed to Whisper, e.g. 'hi'

  // 3. Hybrid Cloud Escape Hatch
  onSubmit?: (transcript: string) => Promise<string>;

  // 4. UI/UX Event Callbacks
  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onTranscriptUpdate?: (text: string, speaker: 'user' | 'avatar') => void; // 🆕 fires for both the user's recognized speech and the avatar's reply text — the hook a developer needs for custom caption UIs, logging, or analytics

  // 5. Degradation & DX
  fallbackMode?: 'wasm' | 'disable' | 'error'; // default: 'wasm'
  onCapabilityDetected?: (caps: IndicAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  lowMemoryMode?: boolean; // sequential model load/unload instead of all resident in VRAM at once

  // 6. Captions & Accessibility (🆕 new in v2)
  showCaptions?: boolean; // default false; renders a live transcript + reply overlay using onTranscriptUpdate internally

  // 7. Input Mode (🆕 new in v2)
  listenMode?: 'vad' | 'push-to-talk'; // default 'vad'. In push-to-talk mode, VAD-driven barge-in is disabled; listening is controlled via the ref handle's startListening()/stopListening()

  // 8. Theming (🆕 new in v2)
  accentColor?: string; // CSS color; used by the default status pill / recording ring / captions overlay if the developer doesn't fully replace them with a custom UI via the headless hook
}
```

### 4.4 Routing precedence (must be documented in README, exactly this order)

1. `onSubmit` provided → local LLM is skipped entirely; transcript goes to the developer's function, its return value is spoken.
2. No `onSubmit`, but `llmModel` provided → that ONNX repo is loaded and used instead of the default.
3. Neither provided → falls back to `onnx-community/Qwen2.5-0.5B-Instruct`.

### 4.5 Default Bundled Avatar Asset(s)

The original blueprint's two examples both supply a custom `modelSrc`, which implicitly assumed every developer brings their own rigged 3D model. That's a real adoption barrier — sourcing and correctly rigging a `.glb` with the right morph targets is nontrivial, and most people trying the package for the first time just want it to work with zero assets of their own. v1 needs at least one bundled default.

**What "default avatar" means concretely:**

- [ ] Ship exactly **one** default avatar for v1 (named `default`), plus reserve the `avatarPreset` prop's type for future named presets without committing to building more than one now.
- [ ] The default avatar must use the ARKit 52-blendshape naming convention (`jawOpen`, `mouthFunnel`, `mouthPucker`, etc.) — the de facto industry standard, and what most rigged glTF avatars already export, so building `visemeTable.ts` against ARKit names means most third-party avatars will work with the default `visemeMap` too.
- [ ] **Licensing is a hard gate, not a nice-to-have:** the bundled avatar must be CC0, public-domain, or otherwise explicitly licensed for redistribution inside an open-source npm package. Do not use a Mixamo character (Adobe's EULA restricts redistribution) or an unverified Ready Player Me export without checking its specific license terms.
- [ ] 🔧 **Corrected sourcing guidance:** Khronos's glTF-Sample-Assets repository was checked and is **not** a good lead for this — it's a feature-testing library (PBR material demos, animation test rigs) with no evidence of humanoid, ARKit-blendshape-rigged character content; its own docs point elsewhere for character assets. Instead, evaluate these in Phase 0/2, in order of likely fit:
  1. **Ready Player Me** exports — widely used, ARKit-compatible blendshapes out of the box, but **verify their specific redistribution terms carefully before committing** (their license is not blanket CC0/public-domain; confirm it permits bundling inside a redistributable open-source package, not just personal/app use).
  2. **Commission or build an original simple rigged model** — given this is a hard blocker for Phase 2, budget real time for this path from the start rather than treating it as a fallback; a simple stylized low-poly character is enough for v1 and sidesteps licensing risk entirely.
  3. Search Sketchfab's CC-licensed category and Poly Haven for rigged humanoid content, filtering specifically for face blendshapes (most Sketchfab "CC0" characters are body-rigged only, not face-blendshaped — check carefully before committing).
- [ ] **Where it lives / how it loads:** do not bundle the `.glb` inside the npm package's `dist/` — host it (GitHub Releases, or jsDelivr against the repo) and lazy-fetch + cache it at runtime the first time `<IndicAvatar />` renders without a `modelSrc`, reporting progress through the same `loadingProgress` callback used for the ML models.
- [ ] Update the Phase 2 acceptance criteria: `<IndicAvatar ttsLanguage="hi-IN" />` (no `modelSrc` at all) must render a working avatar out of the box.
- [ ] Document in the README that supplying `modelSrc` overrides the default entirely, and that a custom avatar needs either ARKit-standard blendshape names or an explicit `visemeMap` override.

---

## 5. Repository Structure

```
react-indic-avatar/
├── package.json
├── tsconfig.json
├── vite.config.ts              # library build config; 🔧 must also configure static asset
│                                # copying for @ricky0123/vad-web's onnx/wasm/worklet files —
│                                # see Phase 1 (e.g. via vite-plugin-static-copy)
├── README.md
├── CONTRIBUTING.md
├── DECISIONS.md                # running log of model/architecture decisions (see §7)
├── .github/
│   └── workflows/ci.yml
├── src/
│   ├── index.ts                # public exports only
│   ├── components/
│   │   ├── IndicAvatar.tsx     # main component shell, forwardRef → IndicAvatarHandle
│   │   ├── CaptionsOverlay.tsx # 🆕 renders live transcript/reply text when showCaptions is set
│   │   └── StatusPill.tsx      # 🆕 glass status pill + live waveform, driven by the same AnalyserNode used for lip-sync
│   ├── hooks/
│   │   ├── useMicrophone.ts
│   │   ├── useVAD.ts            # wraps @ricky0123/vad-web; also handles push-to-talk mode
│   │   ├── useMLWorker.ts       # postMessage bridge to the worker
│   │   └── useIndicAvatarState.ts # 🆕 headless state/controls hook, exported publicly
│   ├── workers/
│   │   └── mlPipeline.worker.ts
│   ├── lib/
│   │   ├── audioLipSync.ts     # FFT -> viseme weight mapping
│   │   ├── phonemeTiming.ts    # 🆕 coarse per-character timing estimate from known TTS input text, blended into audioLipSync's output — see Phase 5
│   │   ├── visemeTable.ts      # Indic phoneme -> viseme mapping data (ARKit blendshape names)
│   │   ├── capabilities.ts     # navigator.gpu / VRAM detection
│   │   └── avatarAssets.ts     # resolves avatarPreset -> hosted .glb URL, lazy-fetch + cache
│   └── types.ts
├── assets/
│   └── avatars/
│       ├── default.glb         # NOT bundled into npm dist -- hosted via CDN/GitHub Releases;
│       │                       # this repo copy is for dev/CI/example use only
│       └── LICENSE.md          # explicit license/attribution for the bundled avatar source
├── examples/
│   ├── quickstart/              # <IndicAvatar ttsLanguage="hi-IN" /> with zero modelSrc
│   ├── local-kiosk/              # custom modelSrc + llmModel override
│   ├── hybrid-cloud/             # custom modelSrc + onSubmit
│   └── headless-custom-ui/       # 🆕 demonstrates useIndicAvatarState() with a fully custom UI
└── test/
    └── ...
```

---

## 6. Phase-by-Phase Build Tasks (for Claude Code to execute in order)

### Phase 0 — De-risking Spike (do first, no React/Three.js yet)

**Goal:** prove the confirmed model stack works end-to-end before any product code exists.

- [ ] Create a throwaway `sandbox/` Vite + vanilla TS project (not part of the published package).
- [ ] Install `@huggingface/transformers` **v4**, load `onnx-community/Qwen2.5-0.5B-Instruct`, run 3 chat turns in the browser console. Confirm WebGPU device initializes. 🔧 If any of the three models below shows a regression under v4, fall back to the last known-good v3.x and record why in `DECISIONS.md` — don't silently pick one.
- [ ] Load `onnx-community/whisper-base`, transcribe a pre-recorded Hindi audio clip with `{ language: 'hi', task: 'transcribe' }`. 🔧 Also specifically test this on iOS Safari — there's a documented community report of this exact model crashing Safari on iOS under transformers.js v3; confirm whether this reproduces under v4 before deciding on `fallbackMode` defaults.
- [ ] Load `Xenova/mms-tts-hin`, synthesize a Hindi sentence, play it back. Confirm audio quality and note the single-voice/no-emotion-control limitation for the README.
- [ ] 🔧 If planning to use the `onnx-community/Llama-3.2-1B-Instruct` override in the local-kiosk example (§7.4), test loading it with **no Hugging Face auth token** in a clean browser session. The base Meta repo is gated and requires requesting access; confirm whether the ONNX community mirror inherits that gating or not — this directly affects whether that example can honestly claim "zero-config, zero auth."
- [ ] Install `@ricky0123/vad-web`, confirm its `.onnx`/`.wasm`/worklet assets load correctly from a Vite dev server with no special config, then confirm what breaks in a production build without asset-copy configuration (so Phase 1's fix is validated against a real failure, not assumed).
- [ ] Run all three ML models loaded simultaneously (plus VAD); watch for VRAM/context errors on a mid-range or integrated-GPU machine. If it fails, confirm `lowMemoryMode` (sequential load/dispose) is a workable mitigation.
- [ ] Write findings into `DECISIONS.md`, including actual measured model download sizes and load times, the v3-vs-v4 decision outcome, and the gated-model test outcome.

**Exit criterion:** a plain browser tab, no React, can go voice-in → transcript → LLM reply → Hindi voice-out, entirely client-side, with both open decisions from §1.4 empirically confirmed.

---

### Phase 1 — Environment & Package Scaffolding

- [ ] Initialize the repo per the structure in §5, using Vite's library mode for the build (not the app mode).
- [ ] Set `package.json` per §4.1, using the peer dependency ranges as tightened there. Confirm exact versions against whatever Phase 0's sandbox actually used.
- [ ] 🆕 Configure static asset copying for `@ricky0123/vad-web`'s `.onnx`, `.wasm`, and worklet files (e.g. via `vite-plugin-static-copy` or an equivalent) — this was missing from v1 and will silently break the VAD pipeline in production builds if skipped.
- [ ] Configure COOP/COEP headers in the Vite dev server config (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) — required for `SharedArrayBuffer`/WASM threads. Document the equivalent for Vercel/Netlify/Nginx in the README. 🆕 Also note in the README: enabling COEP: require-corp can break third-party embeds, OAuth popups, and some analytics scripts on the *consuming* app's page if they don't send proper CORP/CORS headers — flag this as a known interaction for developers integrating this into an existing site, not just a one-line header snippet to copy-paste blindly.
- [ ] Set up `tsconfig.json` in strict mode, ESLint + Prettier.
- [ ] Set up `.github/workflows/ci.yml`: install, typecheck, lint, build on every PR.

**Acceptance:** `npm run build` produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` from an empty component shell, and a production build correctly serves the VAD package's static assets (verify by loading the built output, not just dev server).

---

### Phase 2 — Core React UI & R3F Scene

- [ ] **Source or create the default avatar first** (blocks everything else in this phase): follow the corrected sourcing guidance in §4.5 (Ready Player Me with verified license terms, or commission/build an original) — do not spend time searching Khronos's glTF-Sample-Assets, it's not a fit. Record the exact license and source URL in `assets/avatars/LICENSE.md` before proceeding.
- [ ] Host the sourced `default.glb` and implement `avatarAssets.ts` to lazy-fetch + cache it, reporting progress via `loadingProgress`.
- [ ] Build `IndicAvatar.tsx` accepting the full props schema from §4.3, using `forwardRef` to expose the `IndicAvatarHandle` (implementation can be stubbed for AI behavior at this point — focus on rendering). `modelSrc` is optional: when omitted, resolve `avatarPreset` (defaulting to `'default'`) via `avatarAssets.ts` instead.
- [ ] Implement `<Canvas>` + `useGLTF` to load whichever URL was resolved and render it with visible morph targets.
- [ ] 🆕 Implement the `environmentPreset: 'studio'` default — soft 3-point lighting, a ground contact shadow, and a subtle environment reflection via `@react-three/drei`'s `<Environment>` — instead of a single flat ambient light. This is a meaningful visual-quality lever for very little extra code.
- [ ] Add a dev-only debug panel (rendered only when a `debug` prop or env flag is set) with manual sliders for each morph target — this is the ground truth for validating Phase 5's lip-sync math later.
- [ ] Implement idle animation: 🆕 beyond basic breathing/blinking, add subtle micro-movement — an occasional glance, a slight weight shift or head tilt on a long randomized interval — so the avatar reads as "present," not just "not broken." A perfectly still-but-breathing avatar still looks frozen to most people.
- [ ] 🆕 Build `StatusPill.tsx`: a small glass/blur-backdrop status indicator with a live waveform driven by the same `AnalyserNode` used for lip-sync (cheap to add once that node exists), replacing a bare text label. Include a visible "recording" ring/glow state on the avatar itself while the mic is active, for the trust/privacy reasons described in §3.2.

**Acceptance:** `<IndicAvatar ttsLanguage="hi-IN" />` with **no `modelSrc` prop at all** renders the bundled default avatar at 60fps with idle micro-movement and studio lighting; debug sliders visibly move its mouth/face shapes. Separately, confirm a custom `modelSrc` still overrides it correctly.

---

### Phase 3 — Web Audio & VAD Controller

- [ ] Implement `useMicrophone.ts`: wraps `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`, exposes a permission-denied state.
- [ ] Install `@ricky0123/vad-web` (or `@ricky0123/vad-react` if Phase 0 found it to be a cleaner fit for this codebase), implement `useVAD.ts` wiring `onSpeechStart`/`onSpeechEnd`.
- [ ] Wire `onSpeechStart` → stop any currently-playing TTS audio buffer immediately + fire `onUserInterrupt`.
- [ ] Wire `onSpeechEnd` → package the captured audio blob and hand it to the worker bridge (stubbed in this phase — full wiring happens in Phase 4).
- [ ] 🆕 Implement `listenMode: 'push-to-talk'`: when set, disable VAD-driven auto-triggering entirely and instead expose `startListening()`/`stopListening()` on the `IndicAvatarHandle` ref, which manually begin/end audio capture and hand the resulting blob to the same worker bridge path.
- [ ] Implement a visible state machine (`idle | listening | thinking | speaking`) exposed via a simple internal state, and make sure `onInferenceStart`/`onInferenceEnd` fire at the right transitions. This state also drives `StatusPill.tsx` and the recording-ring indicator from Phase 2.

**Acceptance:** speaking into the mic reliably triggers a capture event in the console; interrupting a played test audio file stops it within one VAD frame; in `push-to-talk` mode, VAD-driven auto-trigger is confirmed disabled and `startListening()`/`stopListening()` correctly gate capture instead.

---

### Phase 4 — WebGPU Worker Pipeline

- [ ] Create `mlPipeline.worker.ts`. On boot, run `capabilities.ts`'s detection and `postMessage` back `{ webgpu, estimatedVram }` to satisfy `onCapabilityDetected`.
- [ ] Instantiate the ASR pipeline (`onnx-community/whisper-base` or `asrModel` override) with `{ device: 'webgpu' }`, falling back to `{ device: 'wasm' }` per `fallbackMode`.
- [ ] Instantiate the LLM pipeline per the routing precedence in §4.4.
- [ ] Instantiate the TTS pipeline, resolving the repo ID from the `ttsLanguage`-to-repo-ID table in §1.2 (throw a clear, actionable error if the language isn't mapped or isn't yet converted, rather than silently failing).
- [ ] Implement `loadingProgress` reporting per-model (Transformers.js pipelines accept a `progress_callback` — forward this to the main thread with a model label).
- [ ] Implement `lowMemoryMode`: if true, load → run → `dispose()` each model sequentially rather than holding all three resident; measure the latency cost vs. the VRAM safety it buys, and document the trade-off in the README.
- [ ] 🆕 Ensure the `speechOutput` message includes the `text` field (per the revised contract in §2.3), not just the audio buffer, so `CaptionsOverlay.tsx` can render the reply in sync with playback.
- [ ] Wire the full loop: mic blob in → ASR transcript → (LLM or `onSubmit`) → TTS audio buffer + text out → posted back to main thread for playback and captions.

**Acceptance:** full voice-in → voice-out loop works via the worker in a real React app, with both the local-LLM path and the `onSubmit` hybrid path independently verified (use a mock `fetch` endpoint for the hybrid test), and captions render correctly in sync when `showCaptions` is enabled.

---

### Phase 5 — Audio-Visual Bridge (Lip Sync)

- [ ] Build `visemeTable.ts`: an explicit mapping table covering Hindi/Indic phoneme classes, with particular care for retroflex (ट, ठ, ड, ढ, ण) and aspirated (ख, घ, छ, झ, थ, ध, फ, भ) consonants.
- [ ] Build `audioLipSync.ts`: `AnalyserNode` → FFT → frequency-band energy → normalized viseme weights, using the Phase 2 debug sliders as ground truth to validate the mapping before wiring to live audio.
- [ ] 🆕 Build `phonemeTiming.ts`: given the known TTS input text (available before/during audio playback, since the worker already has it), produce a coarse estimate of which character/phoneme is likely being spoken at a given playback timestamp — not full forced alignment, just an approximate duration-per-character model. Blend this with `audioLipSync.ts`'s FFT-driven output so viseme selection is informed by both the waveform *and* the known text, rather than the waveform alone. This directly addresses the risk flagged in §2.1: pure spectral-energy analysis is unlikely to reliably separate retroflex/aspirated distinctions on its own, since much of that distinction lives in timing, not steady-state frequency content.
- [ ] Wire the computed weights into the R3F `useFrame` hook, writing directly to `meshRef.current.morphTargetInfluences` — explicitly bypass React state here for performance.
- [ ] Test with real synthesized Hindi audio from the Phase 4 pipeline, not just test tones — the FFT bands that matter for real speech may differ from synthetic test signals. 🆕 Specifically test minimal-pair words that differ only by retroflex/aspiration (e.g. pairs distinguished only by ट vs त, or by aspiration) and visually confirm the hybrid approach actually produces distinguishable mouth shapes — this is the concrete acceptance test for the project's headline differentiator claim, not just "does the mouth move."

**Acceptance:** the avatar's mouth visibly and correctly tracks synthesized Hindi speech in real time with no frame drops (verify via browser performance profiler — should hold 60fps during simultaneous audio playback + inference-adjacent main-thread work), **and** the retroflex/aspirated minimal-pair test above shows visibly distinct mouth shapes, not just generic open/close movement.

---

### Phase 6 — Examples, Docs & Publish

- [ ] Build out `examples/quickstart`, `examples/local-kiosk`, `examples/hybrid-cloud`, and 🆕 `examples/headless-custom-ui` (demonstrating `useIndicAvatarState()` for developers who want to build their own status/captions UI from scratch instead of using `StatusPill.tsx`/`CaptionsOverlay.tsx`).
- [ ] 🔧 Update the local-kiosk and hybrid-cloud example UIs: replace the bare `<p>Status: {status}</p>` text with the `StatusPill.tsx` component (glass pill + live waveform) built in Phase 2, and enable `showCaptions` in at least one example so it's demonstrated, not just documented.
- [ ] Write `README.md`: problem statement, install instructions (🆕 state the React 19 requirement in the first paragraph, not buried in peer-dep fine print), then the **quickstart example first**, the full props table, the routing precedence order, the COOP/COEP deployment note (🆕 including the third-party-embed interaction caveat from Phase 1), and an honest "Known Limitations" section (MMS single-voice constraint, only `hi-IN` fully confirmed at launch with other Indic languages marked "planned," WebGPU browser support gaps in Firefox/Safari, first-load download size, VRAM constraints on integrated GPUs, and the AI4Bharat upgrade path).
- [ ] Write `CONTRIBUTING.md`, particularly inviting contributions to `visemeTable.ts` for additional Indic languages, to converting the remaining MMS-TTS languages to ONNX, to an eventual AI4Bharat ONNX conversion effort, and to additional named `avatarPreset` options.
- [ ] Verify `npm pack` + local install into a fresh Vite (React 19) app works end-to-end before publishing.
- [ ] Publish to npm as `react-indic-avatar` (name was unclaimed as of this verification pass — reconfirm at publish time).
- [ ] Record a short demo clip/GIF for the README and for launch posts — 🆕 make sure it shows captions and the studio-lit idle state, not just the bare functional loop, since first impressions from a GIF matter for adoption.

**Acceptance:** a stranger can `npm install react-indic-avatar`, paste the quickstart snippet with zero avatar assets of their own, and have a working Hindi-speaking avatar running locally in under 15 minutes, on a React 19 project.

---

## 7. `DECISIONS.md` — Seed This File Immediately

```markdown
# Decisions Log

## 2026-07-28 — v1 model stack locked
- STT: onnx-community/whisper-base (multilingual), not IndicWhisper.
  Reason: IndicWhisper has no official ONNX/Transformers.js export today.
- TTS: Xenova/mms-tts-{lang} (Meta MMS, per-language VITS models), not Indic-Parler-TTS.
  Reason: Indic-Parler-TTS is PyTorch-only (safetensors, custom parler_tts arch);
  no official ONNX export found. MMS trades away multi-voice/emotion control
  for "works today." Only mms-tts-hin is confirmed converted; bn/ta/te/mr need
  an Optimum conversion pass before they can ship as "supported."
- LLM: onnx-community/Qwen2.5-0.5B-Instruct. Confirmed working, matches HF's
  own canonical WebGPU text-generation example.

## 2026-07-28 — v2 corrections locked (pending Phase 0 empirical re-confirmation)
- ML runtime: target @huggingface/transformers v4 (C++ WebGPU runtime), not v3.
  Reason: v4 shipped Feb 2026 with a rewritten WebGPU backend; running a version
  behind undercuts this project's core speed claim. Re-test all three models
  under v4 in Phase 0; fall back to last known-good v3.x only if a specific
  regression is found, and record it here if so.
- Framework: React 19 + @react-three/fiber v9, not React 18 + R3F v8.
  Reason: R3F is a custom renderer tied to a specific React major version
  (v8<->React 18, v9<->React 19.0-19.2 only); the v1 peer-dependency ranges
  were wide enough to resolve an incompatible pairing. Locked to the current
  mainline since this is a greenfield project.
- VAD package: @ricky0123/vad-web (the unscoped @ricky0123/vad name is retired
  and split by platform). Requires explicit static-asset copying in the Vite
  build for its onnx/wasm/worklet files — not automatic.
- Default avatar sourcing: Khronos glTF-Sample-Assets is not a viable source
  (feature-test library, not a character library). Redirected to Ready Player
  Me (license terms must be verified before committing) or an original
  commissioned/built model.
- Lip-sync: pure FFT-band energy is insufficient on its own to reliably
  distinguish retroflex/aspirated consonants, since that distinction is
  partly timing-carried, not purely spectral. Added a phonemeTiming.ts layer
  that blends known-text timing estimates with the FFT signal.

- Upgrade path: swapping in a converted AI4Bharat model later is a model-ID
  config change only, not an architecture change, since the lip-sync engine
  is audio-driven (now audio+text-driven) and model-agnostic.
```

---

## 7.4 Reference Example: Fully Local with Custom LLM Override

This is the canonical example for `examples/local-kiosk` in Phase 6 — build this exact app as a runnable Vite example in the package repo. It demonstrates a developer running the avatar entirely offline on a local device, while overriding the default LLM with a different, still-confirmed ONNX model (`onnx-community/Llama-3.2-1B-Instruct` — Llama 3.2's 1B/3B instruct models officially support Hindi among their 8 supported languages, which is why it's a reasonable override choice for this scenario).

> 🔧 **v2 caveat, verify in Phase 0 before finalizing this example:** the base `meta-llama/Llama-3.2-1B-Instruct` repo on Hugging Face is gated and normally requires requesting access and authenticating. The `onnx-community` ONNX mirror's own usage examples show plain, unauthenticated `pipeline()` calls, which suggests the mirror itself is not gated — but this needs an explicit clean-browser-session test, since it directly affects whether this example can honestly claim "fully local, zero server, zero auth." If it turns out to require a token, add a clear README callout for this specific example rather than presenting it as equally zero-config as the quickstart.

```tsx
import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { IndicAvatar, StatusPill } from 'react-indic-avatar';

export default function LocalKiosk() {
  const [status, setStatus] = useState('Listening');

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div style={{ position: 'absolute', zIndex: 10, padding: '1.5rem' }}>
        <h2>Roll Farm Interactive Menu</h2>
        {/* 🔧 v2: replaced bare <p>Status: {status}</p> with the styled
            StatusPill component (glass pill + live waveform) built in Phase 2 */}
        <StatusPill label={status} />
      </div>

      <Canvas camera={{ position: [0, 1.5, 3] }}>
        <IndicAvatar
          modelSrc="/models/chef_avatar.glb"

          // OVERRIDING THE LLM:
          // Passing a specific, confirmed ONNX repository to run via
          // WebGPU locally, instead of the package default
          // (onnx-community/Qwen2.5-0.5B-Instruct). Per the routing
          // precedence in §4.4, this is only used because no onSubmit
          // prop is provided.
          llmModel="onnx-community/Llama-3.2-1B-Instruct"
          ttsLanguage="hi-IN"
          systemPrompt="You are a helpful digital waiter for Roll Farm. You help customers choose between rolls and momos in Hindi."

          // 🆕 v2 additions
          showCaptions
          environmentPreset="studio"

          position={[0, -1, 0]}
          onInferenceStart={() => setStatus('Chef is thinking...')}
          onInferenceEnd={() => setStatus('Speaking')}
          onUserInterrupt={() => setStatus('Listening')}
        />
      </Canvas>
    </div>
  );
}
```

**What Claude Code should verify when building this example:**

- [ ] Confirm `onnx-community/Llama-3.2-1B-Instruct` loads **without a Hugging Face auth token** in a clean browser session (see the caveat above) and generates coherent Hindi responses under the given `systemPrompt` — note the heavier download/VRAM footprint vs. the default Qwen2.5-0.5B in the README.
- [ ] Confirm this example never touches `onSubmit` — the point of this example is the second tier of the routing precedence (`llmModel` override), not the first.
- [ ] Confirm the model-download progress (`loadingProgress`) is visible before "Listening" first appears, since a 1B-parameter model is a meaningfully larger first-load than the 0.5B default.
- [ ] 🆕 Confirm captions render correctly in sync with the Hindi audio, and that the studio lighting preset visibly improves on a flat-ambient baseline in a side-by-side screenshot for the README.
- [ ] Note in the example's own README that swapping `llmModel` to any other ONNX-converted text-generation repo is the intended extension point.

---

## 7.5 Reference Example: Hybrid Cloud Mode (Own LLM API)

This is the canonical example for `examples/hybrid-cloud` in Phase 6 — build this exact app as a runnable Vite example in the package repo. It demonstrates a developer bypassing the local LLM entirely and routing conversation logic to their own backend, while still using the local ASR (Whisper) and local TTS (MMS Hindi) for speech in/out. Per the routing precedence in §4.4, providing `onSubmit` means the local LLM (`Qwen2.5-0.5B-Instruct`) is never loaded — Claude Code should verify this with a network/worker log check as part of Phase 4's acceptance criteria.

```tsx
import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { IndicAvatar, StatusPill } from 'react-indic-avatar';

export default function EnterpriseDashboard() {
  const [status, setStatus] = useState('Idle');

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <div style={{ position: 'absolute', zIndex: 10, padding: '1.5rem' }}>
        <StatusPill label={status} />
      </div>

      <Canvas>
        <IndicAvatar
          modelSrc="/models/corporate_avatar.glb"
          ttsLanguage="hi-IN"
          environmentPreset="studio"

          // HYBRID ESCAPE HATCH:
          // Local STT (Whisper) transcribes the spoken audio and passes the
          // transcript here. We send it to a secure server running the
          // developer's own LLM / RAG / business logic. The returned text
          // is immediately spoken by the local TTS engine (MMS Hindi) —
          // no local LLM is ever loaded for this flow.
          onSubmit={async (transcript) => {
            setStatus('Querying internal database...');
            try {
              const response = await fetch('https://api.internal-server.com/v1/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_input: transcript }),
                signal: AbortSignal.timeout(10_000), // 🔧 v2: explicit timeout so a
                // hung backend can't leave the UI stuck in "Querying..." forever
              });
              const data = await response.json();
              return data.agent_reply;
            } catch (err) {
              setStatus('Error — could not reach server'); // 🔧 v2: explicit failure state
              throw err;
            }
          }}

          onInferenceEnd={() => setStatus('Speaking')}
          onUserInterrupt={() => setStatus('Interrupted')}
        />
      </Canvas>
    </div>
  );
}
```

**What Claude Code should verify when building this example:**

- [ ] `onSubmit`'s returned string is passed straight to the TTS pipeline — the developer's backend is responsible for returning text already appropriate to speak, not raw JSON or markdown.
- [ ] If the `fetch` call throws or times out, the avatar surfaces a clear failure state rather than hanging silently in "Querying..." forever — the timeout + try/catch above is the concrete implementation, not just a suggestion.
- [ ] `onInferenceStart` should fire the moment the transcript is finalized (before `onSubmit` runs), so a developer can set `status` to "Querying..." from that callback instead of manually inside `onSubmit` if they prefer — document both patterns in the README.
- [ ] This example should explicitly *not* set `llmModel`, to demonstrate that `onSubmit` alone is sufficient to skip local inference entirely.
- [ ] 🆕 Note in the README that enabling COEP: require-corp (required for the WASM fallback path) can affect how the browser treats cross-origin requests to the developer's own backend — worth a one-line callout here since this is exactly the example where a developer is most likely to be hitting an external API.

---

## 8. Testing & QA Checklist (before calling v2 "done")

- [ ] Chrome/Edge desktop: full WebGPU path, all three models loaded under `@huggingface/transformers` v4, complete voice loop.
- [ ] Firefox desktop: confirm WASM fallback triggers correctly and produces usable (if slower) results.
- [ ] Safari desktop/iOS: confirm `fallbackMode` behavior is graceful, not a crash — 🔧 specifically re-test the previously-documented Whisper-on-iOS-Safari crash under v4, not just assume it's fixed.
- [ ] Mid-range laptop with integrated GPU: confirm `lowMemoryMode` prevents VRAM crashes, or document the minimum hardware requirement clearly if it doesn't.
- [ ] Barge-in latency: measure actual time from user speech onset to TTS playback stopping; target sub-300ms. Test in both `vad` and `push-to-talk` listen modes.
- [ ] First-load experience: confirm `loadingProgress` reports believable, monotonic percentages per model, not a stuck or jumpy bar.
- [ ] `onSubmit` hybrid path: confirm local LLM never loads at all when `onSubmit` is provided.
- [ ] 🆕 Peer-dependency matrix: install the published package into a clean React 19 + R3F 9 project and confirm it works; separately confirm it *fails with a clear, documented error* (not a cryptic reconciler mismatch) if installed into a React 18 project, so the failure mode itself is a good developer experience.
- [ ] 🆕 Production build check: confirm `@ricky0123/vad-web`'s onnx/wasm/worklet assets are actually served correctly from a production build output, not just the Vite dev server.
- [ ] 🆕 COEP interaction check: confirm that enabling `Cross-Origin-Embedder-Policy: require-corp` doesn't silently break model downloads from Hugging Face's CDN or the default avatar's hosting — verify actual network requests succeed under the header, don't just assume based on other projects' experience.
- [ ] 🆕 Captions: confirm `showCaptions` text stays in sync with audio playback, not just "eventually correct."
- [ ] 🆕 Retroflex/aspirated minimal-pair visual test from Phase 5: confirm the hybrid lip-sync approach produces visibly distinct mouth shapes for these pairs, not just generic mouth movement — this is the acceptance test for the project's core differentiator claim.
- [ ] 🆕 Gated-model check: confirm `onnx-community/Llama-3.2-1B-Instruct` loads with no Hugging Face token in a clean browser session, as used in the local-kiosk example.

---

## 9. Immediate Next Action

Start at Phase 0. Do not touch React, Three.js, or the package scaffolding until:
1. The three confirmed models have been proven working together in a bare sandbox under `@huggingface/transformers` v4 (with a documented fallback decision if v4 shows regressions),
2. The gated-model status of `onnx-community/Llama-3.2-1B-Instruct` has been tested in a clean session, and
3. `DECISIONS.md` has real, measured numbers (download sizes, load times, VRAM behavior) in it rather than estimates.

Only once all three are true should Phase 1 scaffolding begin.