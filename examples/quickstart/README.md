# Quickstart — React Indic Avatar

The absolute minimum to get a talking, lip-syncing 3D avatar running in your
browser. **No backend, no API keys, no custom models required.**

Everything runs locally on the device via WebGPU (Chrome/Edge) with an
automatic WASM fallback for Firefox.

## Prerequisites

| Requirement         | Version       |
| ------------------- | ------------- |
| Node.js             | ≥ 18          |
| React               | 19.x          |
| @react-three/fiber  | 9.x           |
| three               | ≥ 0.156       |
| Browser             | Chrome or Edge (WebGPU) |

## Run it

```bash
cd examples/quickstart
npm install
npm run dev
```

Open **http://localhost:5173** — you'll see the avatar load its models
(~300 MB first download, cached after that), then you can click
**"Tap to start"** and begin speaking.

## What's happening

```
 Your mic → Whisper STT → Qwen 0.5B LLM → MMS-TTS → 3D lip-sync
```

All four stages run in Web Workers so the UI thread stays at 60 fps.

## Key code

The entire app is in [`src/App.tsx`](src/App.tsx) — roughly 35 lines:

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IndicAvatar } from 'react-indic-avatar';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f0f13' }}>
      <Canvas camera={{ position: [0, 0.1, 1.85], fov: 38 }}>
        <color attach="background" args={['#0f0f13']} />
        <pointLight position={[-3, 2, -2]} intensity={20} color="#FF9933" distance={6} />
        <pointLight position={[3, 1, -2]} intensity={15} color="#1A73E8" distance={6} />
        <OrbitControls target={[0, 0.1, 0]} />

        <IndicAvatar
          avatarPreset="ananya"
          ttsEngine="mms"
          position={[0, -0.72, 0]}
        />
      </Canvas>
    </div>
  );
}
```

## Deployment note (COOP/COEP)

The VAD (voice activity detection) worker uses `SharedArrayBuffer`, which
requires these HTTP headers on your production server:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The Vite dev server in this example already sets them (see `vite.config.ts`).
For production deployments (Vercel, Netlify, etc.), add them to your
server/edge config.

> **Caveat:** `Cross-Origin-Embedder-Policy: require-corp` can block
> cross-origin resources (images, fonts, iframes) that don't include a
> `Cross-Origin-Resource-Policy` header. If you embed this avatar inside a
> larger app with third-party assets, you may need to adjust those assets'
> CORS headers or use `credentialless` instead of `require-corp`.

## Next steps

- **Switch to Kokoro TTS** for human-quality speech: change `ttsEngine="kokoro"` and add `ttsVoice="af_heart"`
- **Use your own LLM** via the `onSubmit` prop — see the [`hybrid-cloud`](../hybrid-cloud) example
- **Swap avatars** by changing `avatarPreset` or providing a custom `.glb` via `modelSrc`
- **Add captions** with `showCaptions`

See the full props reference in the [main README](../../README.md).
