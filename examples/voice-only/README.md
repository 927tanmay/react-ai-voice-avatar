# Voice only — React AI Voice Avatar

Voice mode with no avatar: talk to your app the way you talk to ChatGPT or
Gemini voice. An orb that moves with whoever is speaking, a line of captions,
and one button.

It uses `react-ai-voice-avatar/headless`, which carries the whole conversation
loop — microphone, knowing when someone has finished speaking, interrupting the
reply when they talk over it, speech recognition and the voice — with **no
three.js in your bundle**. The build of this example contains no WebGL code at
all.

Try it without installing anything: the demo at
[react-ai-voice-avatar.vercel.app](https://react-ai-voice-avatar.vercel.app/)
has a **Voice only** switch above the avatar.

## Run it

```bash
cd examples/voice-only
npm install
npm run dev
```

Open http://localhost:5173, press **Start**, then **Talk**.

The first run downloads the models, and the browser keeps them for next time:
speech recognition and the voice (about 590 MB), plus a small language model
(about 750 MB), because this example answers with no backend at all.

## Use your own model

Most apps will already have one. Pass `onSubmit` and return its reply — a
string, or a stream of text — and the in-browser language model is never
downloaded:

```tsx
const voice = useAiVoiceAvatar({
  onSubmit: async (text) => {
    const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    return (await res.json()).reply;
  },
});
```

Keep your API keys on your server; `onSubmit` runs in the browser.

## What the hook gives you

| From `useAiVoiceAvatar` | Used here for |
| --- | --- |
| `status` | The orb's colour: listening, thinking, speaking |
| `onAudioLevelChange(level)` | The orb's size, 0 to 1 every frame, from the mic or the voice |
| `onTranscriptUpdate(text, 'user')` | Showing what you said |
| `onSpeechStart(text)` | Showing each sentence of the reply as it plays |
| `startListening()` / `stopListening()` / `interrupt()` | The Talk and Stop button |
| `micError` | Telling the visitor the microphone is blocked |

The level changes sixty times a second, so the example writes it straight to
the orb's style through a ref rather than into React state. Putting it in state
would re-render the app on every frame.

## Browser support

Chrome or Edge on a desktop is best: they expose WebGPU. Elsewhere the models
fall back to WebAssembly and still work, several times slower.
