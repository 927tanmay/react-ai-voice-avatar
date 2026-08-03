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

## 📥 Submitting a Pull Request

1. Create a feature branch named after your objective (e.g., `feature/marathi-tts-optimization` or `fix/canvas-resize`).
2. Ensure TypeScript types build without warnings (`npm run build`).
3. Maintain descriptive commit messages explaining design decisions.
4. Submit your PR with before/after screenshots or screen video recordings demonstrating visual impact!

Thank you for building a more accessible and intelligent decentralized web! 🚀🇮🇳
