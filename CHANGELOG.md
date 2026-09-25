# Changelog

## Unreleased

### Models are kept between visits

A returning visitor downloaded the voice again every time, and on a desktop the
local language model too. The Cache API — where transformers.js stores models by
default — refuses any single file of 256 MiB or more, and both are larger: the
voice ~310 MB, the language model ~750 MB. transformers.js logs the refusal as a
warning and carries on, so nothing looked broken; the visitor just waited through
the download again.

Models now go to the Origin Private File System, which has no per-file limit,
through the custom cache hook transformers.js already provides. Nothing in the
library is patched, and the voice stays at full fp32 quality — quantising it
under the limit was considered and rejected.

Measured in Chrome with the module itself and real OPFS: a 310 MB file stores in
0.6 s and reads back in 0.2 s, a 750 MB one in 1.4 s and 0.4 s, both
byte-identical after a reload. The same 310 MB file put into the Cache API in the
same browser fails with `UnknownError`. Both workers were observed writing
through it and, on the next load, serving every stored file from it without a
download.

A file is only served once complete: it is written first and a marker recording
its size is written after, so a tab closed halfway through a 750 MB download
leaves nothing that the next visit will trust. Files the Cache API already kept,
Whisper's among them, are still read from there, so nobody downloads them twice.
Where OPFS is unavailable the Cache API applies as before.

- Added: `'model-storage'` to `AiVoiceAvatarErrorStage`. Always `degraded` — the
  model loaded and works, and will be downloaded again next time. Usually a lack
  of free space, which is the common case on a phone.

**Not yet observed end to end:** a full-size model downloaded from Hugging Face,
stored, and loaded from storage on the next visit. Every piece of that chain was
verified separately, but the network during testing ran at 77 KB/s, measured with
curl outside the browser, which put one full run hours away.

## 0.5.0

### A hosted model can answer while the local one downloads

`onSubmit` already skipped the in-browser language model, which is right for an
application that has its own: 750 MB downloaded and never used. But it made the
choice permanent, and the two halves are useful together — a kiosk that must
survive the wifi dropping, a phone that will never accept the download, a public
demo running on someone's quota.

```tsx
<AiVoiceAvatar
  onSubmit={localReady ? undefined : askMyBackend}
  preloadLocalLlm
  onLocalLlmReady={() => setLocalReady(true)}
/>
```

The local model downloads behind the conversation, `onLocalLlmReady` says when
it can take over, and dropping `onSubmit` hands it the floor. The turns the
backend answered go with it, so it does not begin by asking something that was
answered a minute ago — the worker never saw those turns, because it was told to
skip them.

- Added: `preloadLocalLlm`, `onLocalLlmReady`.

### Why a returning visitor still downloads the voice — measured

0.4.0 reported that a browser "may refuse to cache the largest model files" and
left it there. The cause is now exact: **Chrome will not store a single Cache API
entry of 256 MiB or more.** Bisected with synthetic responses on Chrome 152, 255
MiB stores and 256 MiB fails with `UnknownError: Unexpected internal error`. It
is not a quota problem — the origin tested had 3.4 GB of quota and 543 MB in use.

Listing the caches after a full load shows what that means in practice:

| File | Size | Kept |
| :--- | :--- | :--- |
| Whisper encoder | 78.6 MB | yes |
| Whisper decoder | 198.9 MB | yes |
| Kokoro voice weights | ~310 MB | no |
| Qwen2.5-0.5B q4 | ~750 MB | no |

Speech recognition survives because it arrives as two files, each under the
limit. The voice is one file above it, so it is fetched again on every visit.

Quantising the voice would fix that — `fp16` is 156 MB, `q8f16` 82 MB, both
inside the limit — and it is deliberately not being done, because it changes how
the voice sounds and the voice is the best part of this package. Storing weights
in OPFS, which has no such limit, is the fix that costs nothing in quality and is
the next piece of work.

Nothing in the engine changed here. The behaviour was always this; only the
explanation was vague.

## 0.4.0

Three changes an integrator can act on, all found while rebuilding the demo.

### An avatar can render before anyone downloads a model

Mounting the avatar used to start every model download at once — about 1.3 GB
for the English defaults. That is right for a kiosk built to be talked to, and
wrong for a landing page or a support widget, where most visitors look and move
on. Each of them paid for a download they never used.

```tsx
const [engaged, setEngaged] = useState(false);

<AiVoiceAvatar loadModels={engaged} hideStatusPill={!engaged} />
<button onClick={() => setEngaged(true)}>Talk to it</button>
```

`loadModels={false}` renders the avatar and lets it idle with nothing
downloaded. Status stays `'loading'` until it is true and the models are up, so
show your own call to action meanwhile.

### `onModelLoaded`

Parsing a multi-megabyte GLB leaves the canvas empty for several seconds, which
reads as a broken page rather than a loading one. This fires once the mesh is in
the scene, so you can hold a placeholder over it.

### `loadingProgress` no longer runs backwards

transformers.js reports download progress once per file, each with that file's
own percentage. A model is several files, and both workers forwarded each one
under the model's name, so the figure lurched between them — watching the demo
load, speech recognition read 67% and then 60%. Any progress bar built on this
callback ran backwards during the one wait every new user sits through.

The engine now reports the running total transformers.js already computes across
every file, held forward-only and capped at 99 until loading genuinely
completes. Verified across 1,344 samples of a real load, with no figure ever
decreasing.

Model downloads are also announced as complete when they finish, so a bar for a
finished model no longer sits at 99% while the others load.

### Corrections

The download sizes quoted in the README were understated by more than half.
English is about 1.3 GB, not 0.6 (the language model alone is 750 MB), and Hindi
about 2.1 GB, not 1.3. Nothing about the package changed; the numbers were
wrong.

### Known limits

- Browsers may refuse to cache the largest model files. Chromium declined the
  310 MB voice and 750 MB language model while caching a 199 MB file, and
  transformers.js logs the refusal as a warning and carries on, so a returning
  visitor downloads them again. Measured exactly in 0.5.0 — see above.
- `q4f16` is not used for the local language model despite being smaller and
  recommended for WebGPU. Measured on WebGPU with shader-f16, Qwen2.5-0.5B at
  q4f16 repeated prompts back verbatim instead of answering them; its
  activations overflow half precision. It loads and generates without error, so
  only reading the output reveals it.

## 0.3.0

The release that makes the voice loop good enough to put in front of real
users. Everything below 0.2.1 worked in a demo; this is the pass that fixed
what only shows up when someone actually talks to it.

### The user can interrupt the avatar

Talking over the avatar now cuts it off mid-sentence, on by default. Waiting
for a reply to finish is the thing that makes a voice agent feel like a
walkie-talkie.

- `allowInterruption` turns it off for a kiosk or a noisy room, where the
  avatar hearing itself through the speakers is worse than waiting.
- `onUserInterrupt` fires when the user takes the floor.
- `speechDetection` exposes every threshold the microphone uses to decide
  someone is talking, because the right values depend on the room.

**Turns are decided on sustain, not loudness.** Voice detection scores every
96ms frame; a cough clears a loudness bar as easily as a word does. A sound now
has to keep scoring as speech before it counts as a turn. Below that bar it
only ducks the avatar's voice, reversibly — cough during a reply and the reply
resumes from where it paused, at the right place in the sentence and with the
mouth still in sync.

### The conversation has one set of rules

The status used to be assigned from seventeen places. Each assignment was
locally correct and the set of them was not, because nothing said which
transitions were legal and the events do not arrive in the order the code is
written in. It is now a single transition table (`src/lib/turnState.ts`),
testable without a browser, a microphone or a model download.

### Hindi

Speech, transcription and replies, via a Devanagari phonemiser and Kokoro's
undocumented Hindi voices. Code-switching works: English words inside a Hindi
sentence are routed to the English phonemiser.

Local Hindi is a demo, not a product, and the README says so. Models small
enough to run in a browser are far weaker in Hindi than in English. For
production Hindi, route hearing and thinking to an API; the voice and lip-sync
stay local and are genuinely good.

### Failures are reportable

`onError` gives a host application a `stage`, a `message` and a `severity` of
`degraded` or `fatal`, so a survivable fallback can be told apart from a dead
microphone rather than arriving as a console message nobody can see.

### Fixes

- **Workers abandoned during startup no longer hijack the pipeline.** Spawning
  is asynchronous, so a React StrictMode double-mount left an orphan worker
  that finished loading and then claimed the reference — after which every
  reply it sent was ignored, and requests vanished into it silently.
- **The microphone no longer goes stale.** Voice detection stops the stream's
  tracks when paused and reacquires privately on resume, which left the engine
  holding a dead device: the level meter read a stopped microphone for the rest
  of the session. Hit `push-to-talk` and `allowInterruption: false` every turn.
- **Speech is scheduled against the audio clock**, removing the audible seam
  between chunks that main-thread jitter used to put in the middle of sentences.
- **The microphone opens on first use, not on mount.** A visitor is no longer
  asked for permission before clicking anything.
- Stopped probing for a local avatar file in applications that have none, which
  put a 404 in every Next.js dev console.
- Avatars are pinned to a release tag, so a merge cannot change them underneath
  a deployed site.
- Replaced the avatar meshes with MIT-licensed Microsoft Rocketbox models,
  relaxed the rest pose so the arms stop dangling, and relit for skin.

### API

- Added: `allowInterruption`, `speechDetection`, `onUserInterrupt`, `onError`,
  `AiVoiceAvatarError`, `AiVoiceAvatarErrorStage`.
- Added the `react-ai-voice-avatar/headless` entry point — the full
  conversational loop with no three.js in the module graph. 117 kB first-load
  against 389 kB for the 3D component, measured on the same Next.js build.
- Changed: `onAudioLevelChange`'s `source` is typed `'mic' | 'tts' | 'idle'`.
  It has always emitted `'idle'` between turns; the type said otherwise. No
  runtime change, but an exhaustive `switch` will now want the third case.

### Known limits

- Raising `positiveSpeechThreshold` trades quiet speakers for quiet rooms. A
  speaker below it produces no events at all.
- An "hmm" sustained past `minSpeechMs` still reaches transcription. A denylist
  catches the common ones after the fact.
- A session is one language at a time. Browser Whisper cannot detect language,
  so someone who switches mid-conversation will be mistranscribed.
- `@react-three/fiber@9.7` caps React below 19.3. Install with
  `--legacy-peer-deps`; the combination works, the peer range is over-cautious.

## 0.2.1 and earlier

See the commit history.
