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

## Phase 0 (Spike) — v2 corrections locked (Empirical Confirmation)
- **ML runtime (Transformers.js v4 vs v3)**: We targeted `@huggingface/transformers` v4. The models successfully downloaded and synthesized text using WASM fallbacks in our headless Chrome spike. (Note: WebGPU initialization could not be validated headlessly due to lack of GPU in the container; however, v4's API successfully loaded the models. A manual user verification is requested on a GPU-enabled device to ensure WebGPU does not crash.)
- **Whisper iOS Safari Crash**: Needs explicit user testing on a physical iOS device, as it cannot be emulated via the headless spike environment.
- **Llama Gated Check**: Confirmed that `onnx-community/Llama-3.2-1B-Instruct` is public and **NOT gated**. It loads successfully without a Hugging Face auth token, meaning the local-kiosk example can honestly claim "zero-config, zero auth."
- **VAD Initialization (`@ricky0123/vad-web`)**: Confirmed that `@ricky0123/vad-web` fails out-of-the-box in Vite dev server (and likely production) due to issues fetching `ort-wasm-simd-threaded.mjs` dynamically. This validates the Phase 1 requirement to explicitly manage Vite static asset copying and exclude it from dev optimization.
- **Model Sizes**: 
  - `Qwen2.5-0.5B-Instruct`: ~300-500MB depending on dtype.
  - `whisper-base`: ~150MB.
  - `mms-tts-hin`: ~100MB.
- **React 19 + R3F v9**: Retained as locked. We will build Phase 1 tooling specifically using React 19 and `@react-three/fiber` v9.

## Indic Avatar Personas & 3D Model Replacement Strategy
- **Dual Indic Personas**: Established `'ananya'` (Female Indic Companion) and `'aarav'` (Male Indic Assistant) as core supported `avatarPreset` options in `IndicAvatarProps`.
- **Zero-Code Asset Overriding**: Both `ananya.glb` and `aarav.glb` exist in `assets/avatars/` and `sandbox/public/`. During early testing, both endpoints mirror our validated ARKit test model to prevent runtime missing asset exceptions.
- **Developer Instructions**: When deploying custom gendered Indic character meshes (e.g., from Avatar SDK or Blender/MPFB with TalkingHead rigs), developers simply replace `assets/avatars/aarav.glb` and `sandbox/public/aarav.glb` with their updated `.glb` files—zero code changes required. See [assets/avatars/README.md](file:///Users/apple/Documents/my/react-indic-avatar/assets/avatars/README.md) for full documentation.

## Dynamic Neural TTS Engine (Kokoro-82M vs Meta MMS)
- **Problem**: Meta MMS-TTS (`Xenova/mms-tts-eng` / `hin`) provides functional localized speech synthesis, but uses a flat, monotone voice architecture with zero prosody or emotional variance—leading to a robotic conversation feel.
- **Solution**: Integrated **Kokoro-82M ONNX** (`kokoro-js`) as our high-fidelity English voice engine, capable of rich intonation, conversational breathing, and multi-voice profiles (e.g., `af_heart`, `am_michael`, `af_bella`).
- **Dynamic Switching via Props**: Added `ttsEngine?: 'kokoro' | 'mms'` and `ttsVoice?: string` to `IndicAvatarProps`. Developers using our React component can govern the active synthesis model cleanly through props and toggle between engines seamlessly during live runtime via automated worker message dispatching (`switchTts`).
- **WebGPU Acceleration with WASM Safety Net**: Kokoro is instantiated with `dtype: "q8"`, prioritizing WebGPU execution and automatically falling back to WASM when running on legacy hardware.

## Phase 4 Completion & Voice-Native Pipeline Optimizations
- **Dual-Worker Architecture (`mlPipeline.worker` & `kokoroTts.worker`)**: Separated Kokoro-82M TTS into a standalone Web Worker (`kokoroTts.worker.ts`) away from the main ASR+LLM+MMS worker. This isolates `kokoro-js`'s heavy Emscripten/WASM vocabulary tree and prevents worker bundling conflicts.
- **Vite Dependency Exclusions**: Added `optimizeDeps.exclude: ['kokoro-js', 'phonemizer']` in Vite configs to prevent Vite from pre-bundling Emscripten WASM filesystem references.
- **WebGPU FP32 Acceleration & Low-Latency Streaming**: Upgraded Kokoro execution to `device: "webgpu", dtype: "fp32"` and lowered sentence dispatch thresholds from 35 chars down to 5 chars when Kokoro is active, reducing speech kickoff latency to milliseconds.
- **Voice-Native System Prompts & Speech Sanitization**: Replaced default written-assistant style system prompts with human conversational directives (enforcing brevity, contractions, and zero markdown). Added `sanitizeForSpeech` across workers to automatically strip residual markdown symbols and convert numeric ranges (e.g., `620-800` -> `620 to 800`) into words for smooth TTS prosody.
- **Synchronized State Completion (`isEndMarker`)**: Implemented an end-to-end completion signaling mechanism between the ML and Kokoro worker queues, ensuring the avatar cleanly transitions from `speaking` back to `idle` and reactivates VAD microphone listening as soon as speech finishes.
