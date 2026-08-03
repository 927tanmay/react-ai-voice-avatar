# Local Kiosk — React Indic Avatar

An interactive restaurant self-service voice concierge (**Roll Farm Interactive Menu**) running entirely offline on a local machine via WebGPU, with zero external cloud dependencies or API servers.

This example highlights **explicit LLM configuration**—utilizing the lightweight `onnx-community/Qwen2.5-0.5B-Instruct` model for rapid startup times on standard kiosk hardware, while explaining how to swap in heavier models like `Llama-3.2-1B-Instruct` when high VRAM is available.

## Key Features Illustrated

- **Explicit LLM Selection**: Demonstrates utilizing the `llmModel` prop to boot a verified lightweight instruction model from Hugging Face's ONNX mirror for minimal boot lag.
- **Loading Progress Monitoring**: Connects to `loadingProgress` to present an elegant progress toast in the upper left during initial weight caching before models are saved to local browser storage.
- **Live Captions Synchronization**: Enables `showCaptions={true}` to render real-time text transcription subtitles directly below the 3D studio viewport—essential for accessible or high-noise public kiosk environments.
- **Zero Authentication Verification**: Confirmed that open community ONNX instruction models operate without requiring Hugging Face developer tokens in clean browser sessions.
- **Kokoro Natural Voice Engine**: Configured with `ttsEngine="kokoro"` (`af_heart` voice) for conversational clarity and warmth.

## Run It Locally

```bash
cd examples/local-kiosk
npm install
npm run dev
```

Open **http://localhost:5173** in a WebGPU-capable browser (Chrome / Edge). Once the AI model pipelines confirm readiness, click **"Tap to start"** and ask the assistant for restaurant recommendations or menu prices!

## Code Highlight: Swapping AI Models

In [`src/App.tsx`](src/App.tsx), customizing the AI model engine is accomplished simply by supplying a Hugging Face repository identifier:

```tsx
<IndicAvatar
  avatarPreset="kiosk"
  
  // EXPLICIT LLM OVERRIDE SELECTION:
  // Points directly to any confirmed ONNX text-generation model repository
  llmModel="onnx-community/Qwen2.5-0.5B-Instruct"
  
  // Configure speech synthesis engine and studio features
  ttsEngine="kokoro"
  ttsVoice="af_heart"
  showCaptions={true}
  environmentPreset="studio"
  
  systemPrompt="You are Tara, an energetic voice concierge for Roll Farm restaurant..."
/>
```

## Extending this Example

Swapping `llmModel` to any fine-tuned or customized ONNX-converted text-generation repository on Hugging Face (such as specialized domain instruction models or quantizations like `int8` / `q4`) is an intentional extension point for advanced developer workflows!
