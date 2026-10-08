# Next.js Voice

Voice mode in a Next.js App Router app: an orb that moves with the voice, a line
of captions, and a Talk button. Speech recognition and the voice run in the
browser. Replies come from your own route handler, which holds the model key,
so the key never reaches the page.

| File | What it does |
| :--- | :--- |
| [`app/VoiceMode.tsx`](app/VoiceMode.tsx) | The client component: `useAiVoiceAvatar`, the orb, the button |
| [`app/api/chat/route.ts`](app/api/chat/route.ts) | Calls any OpenAI-compatible chat API with the key from `process.env`, and streams the reply back as plain text |
| [`app/page.tsx`](app/page.tsx) | A server component that renders `VoiceMode` |

## Run it

```bash
cp .env.example .env.local     # then paste your key into it
npm install
npm run dev
```

Open http://localhost:3000, press **Start**, then **Talk**.

The first run downloads speech recognition and the voice, about 590 MB, and the
browser keeps them for next time. Because replies come from the route, the
in-browser language model is never downloaded.

## Three things to get right in Next.js

**`'use client'`.** The hook needs the microphone, audio and Web Workers, so it
lives in a client component. The page that renders it can stay a server
component.

**Import from `/headless`.**

```ts
import { useAiVoiceAvatar } from 'react-ai-voice-avatar/headless';
```

The package root exports the same hook, but importing from there pulls three.js
and the 3D avatar into the route's bundle. The build of this example contains no
three.js.

**The key stays in the route.** `OPENAI_API_KEY` has no `NEXT_PUBLIC_` prefix,
so Next.js never sends it to the browser. `onSubmit` runs in the browser and only
calls `/api/chat`. The route also sets the system prompt itself, so a caller
cannot point your key at another job.

## How the reply gets to the voice

The route unwraps the provider's server-sent events and returns bare text, so
the page can hand the stream straight to the hook. The hook starts speaking at
the first complete sentence:

```tsx
onSubmit: async text => {
  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
  return res.body;
},
```

This example wraps the stream in a small generator so it can remember the reply
and send the last few turns back with the next question.

## Another provider

Any OpenAI-compatible API works. Set these in `.env.local`:

| Provider | `OPENAI_BASE_URL` | `OPENAI_MODEL` |
| :--- | :--- | :--- |
| OpenAI (default) | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Groq, free tier | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| Ollama on this machine | `http://localhost:11434/v1` | `llama3.2` (any non-empty key) |

## Browser support

Chrome or Edge on a desktop is best, because they expose WebGPU. Other browsers
fall back to WebAssembly: the models still work there, but several times slower.
For multi-threaded inference, add the optional COOP/COEP headers to
`next.config.ts`, as described in the main README's
[Server Configuration](../../README.md#%EF%B8%8F-server-configuration-optional-performance-boost)
section.
