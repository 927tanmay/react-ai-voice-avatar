# Contributing to React AI Voice Avatar 🤝🌟

We welcome contributions from web frontend developers, 3D character animators, machine learning engineers, and voice technology enthusiasts! Whether you are bug hunting, refining lip-sync phoneme algorithms, adding support for new regional dialects, or sharing new architectural examples, your input is deeply appreciated.

---

## 🧭 Core Philosophy

1. **Client-Side First**: Keep neural model execution in the browser. Zero reliance on proprietary paid APIs or server-side GPU cloud dependencies in core code.
2. **Aesthetic Excellence**: Every component, demo, and interface should look and feel state-of-the-art and premium.
3. **Accessibility & Privacy**: Microphone raw audio must remain strictly local within browser client memory and Web Workers.

---

## 🛠️ Local Development Setup

### 1. Clone & Install Dependencies
Clone the repository and install root workspace dependencies:
```bash
git clone https://github.com/927tanmay/react-ai-voice-avatar.git
cd react-ai-voice-avatar
npm install
```

### 2. Run the Interactive Sandbox
For active core component developer iteration, use the experimental sandbox application:
```bash
cd sandbox
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) to verify changes against live 3D models and Web Workers.

---

## 📦 Building the Library

When modifying source files in `src/`, compile the distributable ES modules and TypeScript type definitions:

```bash
# From the root directory
npm run build
```
This builds standard CommonJS, ESM, and Web Worker bundle chunks inside `dist/`.

---

## 🎨 Testing the Examples Suite

Our project houses four canonical integration examples under `examples/`:
- `examples/quickstart`
- `examples/local-kiosk`
- `examples/hybrid-cloud`
- `examples/headless-custom-ui`

To test any example against your local changes:
1. Ensure you ran `npm run build` in the root repository.
2. Navigate into the desired example folder:
   ```bash
   cd examples/headless-custom-ui
   npm install
   npm run dev
   ```

---

## 🎭 Adding Custom Avatar 3D Models & Visemes

If you wish to introduce new GLTF character busts or refine ARKit blendshape mappings:
1. Place 3D GLTF asset exports in `sandbox/public/` with standard ARKit 52 facial blendshapes (e.g., `jawOpen`, `mouthFunnel`, `mouthPucker`, `mouthSmile_L`, `mouthSmile_R`).
2. Update our mapping tables in `src/lib/visemeTable.ts` or `src/lib/avatarDynamics.ts` to tune emotional micro-expressions and speech lip synchronization.
3. Expose new model identifiers in `src/lib/avatarAssets.ts`.

---

## 🎯 Open Issues & Contributor Roadmap

Looking for impactful features to take up? We welcome pull requests for the following high-priority open issues in our engineering roadmap:

### 👑 Premier 3D Model & Animation Bounty
1. **🎭 Expanding Regional 3D Avatar Personas & Blendshape Tuning**
   - **Goal**: While we provide both Ananya (female) and Aarav (male) voice concierge meshes out of the box, we welcome community contributors to expand our gallery! Submit high-fidelity, royalty-free humanoid `.glb` models (~2MB to 4MB) equipped with standard 52 Apple ARKit blendshape morph targets. Uploading new armatures to our GitHub repository via our JsDelivr GitHub Edge CDN pipeline will introduce richer regional diversity without increasing our lightweight **~3.3 MB NPM package footprint** (across 25 files, shipping self-contained pre-bundled esbuild workers) by even a single byte!

### 🚀 Developer Experience & Enterprise UI Features
2. **🎙️ VAD Ambient Noise & Sensitivity Tuning (`vadSensitivity`)**
   - **Goal**: Expose an intuitive prop `vadSensitivity?: 'high' | 'balanced' | 'noisy_room'`. In loud environments (hospital kiosks, expo floors), raising Voice Activity Detection energy thresholds will prevent ambient conversation from accidentally triggering AI prompts.
3. **🌊 Real-time Acoustic Waveform Output (`onAudioLevelChange`)**
   - **Goal**: Expose a lightweight callback prop `onAudioLevelChange?: (energy: number) => void` that streams real-time microphone input volume directly to parent components, empowering developers to build dynamic ChatGPT-style voice visualizers and glowing HUD microphone rings.
4. **✨ React Suspense & Skeleton Fallbacks (`<AiVoiceAvatar.Lazy />`)**
   - **Goal**: Build a built-in fallback skeleton or React Suspense wrapper (`<AiVoiceAvatar.Lazy />`) that displays an animated glowing 3D placeholder sphere or studio light silhouette while the `.glb` character mesh hydrates over slow mobile networks.

### ⚡ Core Architectural & Memory Optimizations
5. **♻️ Aggressive Audio Buffer Reclamation**
   - **Goal**: During extended 30-to-60 minute conversation sessions, systematically null out and dereference old `Float32Array` acoustic phoneme FFT buffers immediately after an utterance completes speaking, ensuring JavaScript heap consumption remains completely flat over hours of usage.
6. **💾 Offline Instant-Boot Verification & Local Caching Diagnostics**
   - **Goal**: Create a rapid zero-latency bootstrapper that verifies if neural net model weights (Whisper ASR and Kokoro TTS) are fully settled inside browser IndexedDB / Cache API. On repeat visits, this will allow the avatar to bypass discovery checks and initialize directly from local disk in **under 1.5 seconds offline**.

---

## 📥 Submitting a Pull Request

1. Create a feature branch named after your objective (e.g., `feature/marathi-tts-optimization` or `fix/canvas-resize`).
2. Ensure TypeScript types build without warnings (`npm run build`).
3. Maintain descriptive commit messages explaining design decisions.
4. Submit your PR with before/after screenshots or screen video recordings demonstrating visual impact!

Thank you for building a more accessible and intelligent decentralized web! 🚀🇮🇳
