# Hybrid Cloud Voice Architecture — React Indic Avatar

An enterprise voice AI demonstration illustrating how to connect **`react-indic-avatar`** to any external Cloud LLM (such as OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet, OpenRouter, or your private Node.js/Python backend) using the built-in **`onSubmit` escape hatch**.

## Why Use Hybrid Cloud Architecture?

1. **Zero On-Device LLM Overhead**: When you supply an `onSubmit` callback function to `<IndicAvatar />`, our WebGPU model worker automatically sets `loadLlm: false`. This skips downloading or initializing local text-generation neural networks entirely—slashing boot times to just seconds and reducing client-side memory usage by 300MB to over 1GB!
2. **Client-Side Acoustic Privacy**: Raw microphone audio is never streamed to external servers. Voice capture and Speech-to-Text transcription (Whisper ASR) run 100% locally inside the browser using WebGPU.
3. **Enterprise Reasoning Power**: While voice IO remains local, the transcribed text string can be processed by state-of-the-art reasoning engines in the cloud.
4. **Synchronized On-Device Voice & Lip Blending**: When your cloud server returns a response string (or token stream), the local Kokoro speech engine instantly generates natural acoustic speech while blending 3D mouth phoneme morph targets in real time.

## Live Telemetry Dashboard

This application features a 3-Stage real-time architectural telemetry panel on the right side of the screen that visualizes:
- **Stage 1**: Local WebGPU speech capture & Whisper transcription completion.
- **Stage 2**: Outbound HTTPS cloud dispatch with precision latency tracking.
- **Stage 3**: On-device acoustic speech buffer synthesis and 3D lip synchronization.

## Run It Locally

```bash
cd examples/hybrid-cloud
npm install
npm run dev
```

Open **http://localhost:5173** in a WebGPU-capable browser. Notice how fast the avatar initializes without loading an on-device LLM! Click **"Tap to start"** and try talking about investments, stocks, or how the hybrid cloud system works!

## Code Highlight: Connecting Your Cloud API

In [`src/App.tsx`](src/App.tsx), integrating your custom cloud endpoint is simple:

```tsx
const handleCloudSubmit = async (userTranscript: string): Promise<string> => {
  // Dispatch transcribed text directly to your preferred cloud LLM provider
  const response = await fetch('https://api.yourdomain.com/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${MY_API_KEY}` 
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: userTranscript }]
    })
  });
  
  const data = await response.json();
  return data.choices[0].message.content; // Kokoro will synthesize this immediately!
};

export default function App() {
  return (
    <Canvas camera={{ position: [0, 0.1, 2.2], fov: 34 }}>
      <IndicAvatar
        avatarPreset="ananya"
        onSubmit={handleCloudSubmit} // <-- Bypasses local LLM loading automatically!
        ttsEngine="kokoro"
        ttsVoice="af_heart"
        showCaptions={true}
        environmentPreset="studio"
      />
    </Canvas>
  );
}
```
