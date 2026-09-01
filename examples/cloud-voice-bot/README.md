# Cloud Voice Bot Example

This example demonstrates how to bypass the built-in local inference and route conversation intelligence and speech synthesis to external cloud providers (OpenAI and ElevenLabs), while keeping transcription (ASR) completely local for maximum privacy and zero latency.

## Architecture
- **Transcription (ASR)**: Local WebGPU Whisper (free, private, 0ms network latency).
- **Intelligence (LLM)**: Cloud-based OpenAI `gpt-4o-mini` (via the `onSubmit` adapter).
- **Speech Synthesis (TTS)**: Cloud-based ElevenLabs or OpenAI TTS (via the `onSynthesize` adapter).

By passing `onSubmit` to `<AiVoiceAvatar />`, the component automatically skips downloading and loading the heavy local LLM weights into VRAM.

By passing `onSynthesize` to `<AiVoiceAvatar />`, the component bypasses the local Kokoro/MMS engine and uses the `ArrayBuffer` you return from your API call, seamlessly pushing it into the lip-sync animation pipeline.

## Running the Example

1. From this directory (`examples/cloud-voice-bot`), install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open the provided localhost URL in your browser. You will be prompted to enter your OpenAI API Key (and optionally your ElevenLabs API Key) before the 3D scene mounts.

> **Note**: Your API keys are only kept in React state in memory. They are not saved anywhere on disk.
