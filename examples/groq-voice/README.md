# Groq Voice

Voice mode on [Groq](https://groq.com)'s free tier: hearing, replies and the voice
all start on Groq, so the first turn needs no download at all. Behind the
conversation, the in-browser hearing (Whisper base) and voice (Kokoro) download,
and once they are ready the page asks whether to switch to them: no daily limit,
and what you say no longer leaves the device.

| Part | Starts on | Can switch to |
| :--- | :--- | :--- |
| Hearing | Groq, Whisper large v3 turbo (`onTranscribe`) | Whisper base in the browser |
| Replies | Groq, GPT-OSS 20B (`onSubmit`) | stays on Groq |
| Voice | Groq, Orpheus (`onSynthesize`) | Kokoro in the browser (MMS on iPhone) |

## Run it

You need your own free Groq key from [console.groq.com/keys](https://console.groq.com/keys).

```bash
cp .env.example .env.local     # then paste your key into it
npm install
npm run dev
```

The key is read by the dev server in [`server/groq.ts`](server/groq.ts) and never
reaches the browser. Those three routes are plain `fetch` calls; in production,
move them to wherever your API lives.

If the voice fails with a message about terms, accept the Orpheus model's terms in
the Groq console once.

## How the switch works

```tsx
const [speech, setSpeech] = useState<'groq' | 'browser'>('groq');

useAiVoiceAvatar({
  onSubmit: askGroq,
  // Supplying an adapter replaces the local model. Removing it is all
  // switching is: the hook uses its own from then on.
  onTranscribe: speech === 'groq' ? transcribeWithGroq : undefined,
  onSynthesize: speech === 'groq' ? speakWithGroq : undefined,

  // Download the local hearing and voice behind the conversation anyway...
  preloadLocalSpeech: true,
  // ...and say when they could take over.
  onLocalSpeechReady: () => askTheUserToSwitch(),
});
```

The page asks rather than switching on its own because the voice changes. On
iPhones and iPads the in-browser voice is MMS, a plainer one, since Kokoro needs
more memory than Safari allows.

## Limits

Groq's free tier for these three models, from the console in October 2026:

| Part | Per minute | Per day |
| :--- | :--- | :--- |
| Hearing | 20 requests | 2,000 requests, 28,800 audio seconds |
| Replies | 30 requests, 8,000 tokens | 1,000 requests, 200,000 tokens |
| Voice | 10 requests, 1,200 tokens | 100 requests, 3,600 tokens |

- The voice is the tight one. It is fetched a sentence at a time, so 100 requests
  a day is a few conversations. That is why the in-browser voice is offered.
- Every transcription counts as at least 10 seconds of audio, however short.
- Your account's limits may differ. The page shows what Groq reports on each
  response ("Left today: 99 of 100 requests"), and when a limit runs out it says
  so and offers the in-browser models again.

The in-browser models are about 590 MB the first time and kept for later visits.
