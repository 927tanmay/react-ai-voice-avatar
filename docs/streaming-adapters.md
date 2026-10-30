# Design: streaming adapters

Status: built, unreleased (for 0.9.0). Proposed 29 Oct 2026. Where the build
differs from this proposal:

- The detector's segment is started over with vad-web's internal
  `frameProcessor.reset()`, not `pause()` and `start()`. The spike found
  `pause()` stops the microphone tracks and `start()` reopens the device,
  losing audio. `reset()` touches neither; pause and start remain the
  fallback should a future vad-web drop it.
- A plain `onTranscribe` function does not get a `signal` yet. Only the
  streaming transcriber has one.
- A streamed sentence's lip sync is timed from its text and not rescaled as
  chunks arrive.
- A speech reply's chunk may also be `{ text }` alone, which captions the
  next audio, since realtime models send transcript and audio separately.

## Why

Every adapter today is batch. A turn with your own providers goes:

1. The user stops talking. The detector waits `redemptionMs` (1.4 s) of
   silence to be sure.
2. The whole recording goes to `onTranscribe`, which returns the whole text.
3. `onSubmit` streams the reply, and it is cut into sentences.
4. Each sentence goes to `onSynthesize`, which returns the whole sentence's
   audio. Nothing plays until it has all arrived.

Steps 1, 2 and 4 are dead time the user hears as silence. Hosted voice
platforms answer in under a second because their providers stream: speech is
transcribed while it is spoken, the transcriber says when the turn has ended
(often well under 1.4 s), and audio plays from its first chunk.

This design adds those three things as **opt-in** shapes of the existing
adapters. Nothing a 0.8 app does changes meaning.

## Goals

- Partial transcripts while the user speaks.
- The transcriber can end the turn before the silence timer does.
- Voice audio plays from its first chunk.
- A reply can arrive as audio directly, skipping `onSynthesize`.
- Every stream is cancelled on interrupt, barge-in or a new turn, through the
  same `signal` `onSubmit` already gets.

## Not in scope

- Sending the user's raw audio to a speech-to-speech model (OpenAI Realtime,
  Gemini Live). Gap C covers their audio *out*; audio *in* is a later step
  once these shapes have been used.
- A WebSocket or WebRTC client in the package. Adapters stay plain functions;
  the host owns the connection to its provider.
- Streaming the in-browser models. Whisper and Kokoro keep working as they do.

---

## Step 0: the host's transcript goes straight to the reply

Before any streaming, one refactor, which is also issue #21.

Today a transcript from `onTranscribe` is posted to the ML worker
(`processText`), and the worker echoes it back so it reaches `onSubmit`. So
the worker has to start even when the host supplies every adapter, and every
turn takes a round trip through it.

Change: the hook calls a main-thread `submitUserText(text, speechMs)`, the
same function the worker echo calls now. The worker is only used for what
runs in it. With all three adapters supplied it is never started.

This comes first because streaming transcription would otherwise have to go
through the worker too.

Test: with all three adapters, no worker is created (count `Worker`
constructions in the e2e page), and a turn completes.

---

## A. Streaming speech-to-text

### API

A second shape for `onTranscribe`. Which one the host gave is decided by what
the function returns, so the prop and its type stay one:

```ts
onTranscribe?: (
  audio: Float32Array,
  details: { signal: AbortSignal }
) => Promise<string> | TranscriptionSession;

interface TranscriptionSession {
  /** 16 kHz mono frames, as the microphone produces them. */
  push(frame: Float32Array): void;
  /** No more audio. Resolves with the final text. */
  finish(): Promise<string>;
}
```

The streaming shape is created with a helper, so the hook can tell it apart
before any audio exists:

```ts
import { streamingTranscriber } from 'react-ai-voice-avatar/headless';

onTranscribe: streamingTranscriber(({ signal, partial, endTurn }) => {
  const ws = new WebSocket('/api/stt');           // your backend
  signal.addEventListener('abort', () => ws.close());
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.isFinal) endTurn(msg.text);            // the provider says the turn is over
    else partial(msg.text);                        // words so far
  };
  return {
    push: frame => ws.send(toInt16(frame)),
    finish: () => /* resolve with the final text */,
  };
}),
```

- `partial(text)` reaches a new callback, `onUserPartial(text)`. Not
  `onTranscriptUpdate`: apps append each call there as a message, and
  partials would flood their chat.
- `endTurn(text?)` ends the turn now, with that text as final.

### When the session starts and ends

| Moment | What happens |
| --- | --- |
| `onSpeechStart` (one loud frame) | Session opens. The last `preSpeechPadMs` of frames, kept in a ring buffer, are pushed first so the first word is not clipped. |
| Every frame after that | `push(frame)`. |
| `onVADMisfire` (it was a cough) | The session's `signal` aborts. Nothing reaches the conversation, as today. |
| `onSpeechRealStart` | Nothing new. The turn is taken exactly as today. |
| The provider calls `endTurn` | The turn ends now, without waiting for the silence timer. |
| `onSpeechEnd` (silence timer) | `finish()`, and its text is used. The backstop when the provider never calls `endTurn`. |
| Push-to-talk | Opens on button down, `finish()` on button up. |

Whichever of `endTurn` and the silence timer comes first wins; the other is
ignored for that turn.

### The hard case: the user keeps talking after `endTurn`

The detector is still inside one speech segment, so it will not report a new
`onSpeechRealStart` if the user carries on. Plan: on `endTurn`, restart the
detector's segment (`pause()` then `start()` through the existing
`setDetector` queue, which resets its frame state). Continued speech then
starts a new segment and is a normal barge-in on the reply.

To verify first, with a spike: that vad-web's `pause()` drops the segment
without calling `onSpeechEnd`, and that the restart costs no frames.

### Tests

- Partials arrive in order and reach `onUserPartial`, not `onTranscriptUpdate`.
- `endTurn` starts the reply before the silence timer would have (measure
  the `thinking` timestamp against `redemptionMs`).
- A misfire aborts the session and changes no state.
- Pre-speech frames are pushed first (the stand-in transcriber records what
  it got).
- Speaking on after `endTurn` interrupts the reply.
- Each fails on the current code, as usual.

---

## B. Streaming voice

### API

`onSynthesize` may return an async iterable of chunks as well as one result,
and gets a `signal`:

```ts
onSynthesize?: (
  text: string,
  details: { signal: AbortSignal }
) => Promise<SynthesizedAudio | AsyncIterable<AudioChunk>>;

type AudioChunk = { audio: Float32Array | Int16Array; sampleRate: number };
```

Chunks must be raw samples. Encoded MP3 or Opus cannot be decoded a piece at
a time with `decodeAudioData`, so a stream of those is rejected with a clear
`onError`. Every major voice provider offers raw PCM output (ElevenLabs
`pcm_24000`, Cartesia `pcm_f32le`, OpenAI `pcm`), and the README will say
which setting to pick.

Byte streams from `fetch` are common, so a helper turns one into chunks:

```ts
import { pcmStream } from 'react-ai-voice-avatar/headless';

onSynthesize: async (text, { signal }) => {
  const res = await fetch('/api/tts', { method: 'POST', body: text, signal });
  return pcmStream(res.body!, { sampleRate: 24000, encoding: 's16le' });
},
```

`pcmStream` carries an odd byte across chunk boundaries, the same problem the
`TextDecoder` fix solved for text.

### Playback

Each chunk goes into the existing schedule (`handleSpeechOutput`), which
already stitches buffers sample-contiguously. Only the sentence's last chunk
is marked `isLast`. Cancelled by the reply's signal, like the text stream.

The next sentence's request still starts only after this one's stream has
finished, so sentences stay in order. That is the same as now and can be
tightened later.

### Lip sync

The lip-sync timing spreads a sentence's phonemes over its audio duration,
and with a stream the duration is not known when the first chunk plays.
Plan: on the first chunk, time the sentence from the text alone (the estimate
`phonemeTiming` already makes before scaling), and rescale as chunks arrive.
The headless hook is unaffected; it only reports levels.

### Tests

- The first chunk plays before the stream ends (the stand-in voice waits
  before its second chunk; `speaking` is reached during the wait).
- Odd byte splits through `pcmStream` come out identical to the whole buffer.
- An encoded stream is reported through `onError` with `detail: 'onSynthesize'`.
- Interrupting mid-stream cancels the iterator.

---

## C. A reply that is already audio

### API

`onSubmit` may return a speech stream instead of text:

```ts
import { speechReply } from 'react-ai-voice-avatar/headless';

onSubmit: async (text, { signal }) =>
  speechReply(streamFromMyRealtimeBackend(text, signal)),
// each item: { audio, sampleRate, text? }
```

- Audio plays as in B, and `onSynthesize` is not called for this reply.
- `text` on a chunk, if the provider sends a transcript, reaches
  `onSpeechStart` and `onTranscriptUpdate(…, 'avatar')` as a sentence does now,
  and drives lip sync. Without it, captions are empty and the avatar's mouth
  follows loudness only.
- A wrapper rather than a bare iterable, because a bare async iterable already
  means a text stream.

### Tests

- A speech reply plays without `onSynthesize` being called.
- Interrupting cancels it.
- Captions arrive when chunks carry text.

---

## Compatibility

All additions are optional. Existing functions keep their meaning:

- `onTranscribe` returning a string, `onSynthesize` returning one result and
  `onSubmit` returning text work as in 0.8. The new second argument is ignored
  by functions that take one.
- `onUserPartial` is new.
- Released as 0.9.0, a minor version, with the CHANGELOG's "breaks nothing"
  note.

## Order of work

Each step is its own commit with its own failing-first tests.

1. Step 0, the direct transcript path (#21).
2. B, streaming voice. The biggest win for the least risk, and it touches only
   playback.
3. A, streaming speech-to-text, after the detector restart spike.
4. C, speech replies, which reuses B's playback.
5. Docs: a "lowest latency" recipe, and a measured before and after with
   `scripts/measure-latency.mjs` against stand-in providers with fixed delays.

## Open questions

1. `onUserPartial` as a new callback, or a third argument on
   `onTranscriptUpdate`? The proposal picks the new callback, so existing
   chat UIs are not flooded.
2. Prefetching the next sentence's voice while the current one streams:
   faster, but out-of-order risk. Proposed as a follow-up, not in 0.9.
3. Whether `endTurn` should also shorten the silence timer for the rest of the
   session (a provider that ends turns well has earned it). Proposed: no, keep
   it predictable.
