import React from 'react';
import ReactDOM from 'react-dom/client';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';

/**
 * Which voice the hook picks for this browser, for tests/voice-engine.spec.ts.
 * Nothing is loaded, so the choice is all there is to see.
 *
 *   ?lowMemory=1|0  lowMemoryMode true or false; unset, left to the device
 *   ?tts=kokoro     an explicit ttsEngine
 */
const params = new URLSearchParams(location.search);
const lowMemory = params.get('lowMemory');

const App: React.FC = () => {
  const voice = useAiVoiceAvatar({
    loadModels: false,
    lowMemoryMode: lowMemory === null ? undefined : lowMemory === '1',
    ttsEngine: params.get('tts') === 'kokoro' ? 'kokoro' : undefined,
  });
  return <p id="engine">{voice.activeTtsEngine}</p>;
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
