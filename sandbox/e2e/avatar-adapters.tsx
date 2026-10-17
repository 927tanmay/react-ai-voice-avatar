import React, { useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { AiVoiceAvatar, type AiVoiceAvatarHandle } from 'react-ai-voice-avatar';

/**
 * The 3D component, not the hook, with hearing, replies and the voice all
 * handed to the host. It used to accept onTranscribe and onSynthesize and
 * then drop them, so it downloaded and spoke with the local models instead.
 *
 * State is published on `window.__e2e` for tests/avatar-adapters.spec.ts.
 */
const probe = { synthesized: [] as string[], submitted: [] as string[], sendText: undefined as undefined | ((t: string) => void) };
(window as unknown as { __e2e: typeof probe }).__e2e = probe;

const App: React.FC = () => {
  const ref = useRef<AiVoiceAvatarHandle>(null);
  probe.sendText = text => ref.current?.sendText(text);
  return (
    <Canvas camera={{ position: [0, 0.37, 0.93], fov: 30 }}>
      <AiVoiceAvatar
        ref={ref}
        onStatusChange={s => { document.getElementById('status')!.textContent = s; }}
        onTranscribe={async () => 'What is the capital of France?'}
        onSubmit={async text => { probe.submitted.push(text); return 'Paris is the capital of France.'; }}
        onSynthesize={async text => {
          probe.synthesized.push(text);
          return { audio: new Float32Array(8000), sampleRate: 16000 };
        }}
      />
    </Canvas>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
