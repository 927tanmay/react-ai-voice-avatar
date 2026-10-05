# Changelog

## Unreleased

### Fixed

- **Push-to-talk never sent anything.** Releasing the button only paused the
  microphone, so the turn was dropped and the status stayed on `listening`.
  `stopListening()` now hands over what was said while it was held, as one turn
  however long the pauses in it, trimmed to the speech. A hold with no speech
  sends nothing. Pressing during a reply now stops the reply and takes the
  floor, and `interrupt()` abandons a hold. The component's Stop button
  abandons rather than sends.

## 0.7.0

Fixes and additions from the first app built on the package by someone else:
an interview practice app, where answers run long and one answer can span
several pauses.

No breaking changes. New: `onSubmit`'s second argument `{ speechMs }`, the
`react-ai-voice-avatar/model-cache` entry point, and the
`AiVoiceAvatarSubmitDetails` type.

- **Speech over 30 seconds is no longer cut off.** Whisper hears 30 seconds at
  a time, and without chunking transformers.js keeps only the first 30 of a
  longer recording. A 48-second answer is now transcribed whole, all 160 words,
  in 3.4 s on an Apple M4. Shorter speech is one chunk, exactly as before.
- **An empty reply from `onSubmit` ends the turn.** Returning `''`, or a stream
  that closes without text, left the status on 'thinking' for good, and
  `onInferenceEnd` never fired. It now means "say nothing and keep listening",
  so an app can collect one answer across pauses. If the user is already
  talking again when the empty reply lands, they keep the floor.
- **`onSubmit(text, { speechMs })`** says how long the user spoke, from the
  first frame the voice detector called speech to the last. The padding before
  speech and the silence after it are not counted, so it can be used for a
  speaking rate: a 48.6-second answer reported 48,672 ms. Undefined for
  `sendText`.
- **`react-ai-voice-avatar/model-cache`** exports `createModelCache` and
  `isModelCacheSupported`, the OPFS store the engine keeps its models in, for
  models of your own over Chrome's 256 MiB Cache API limit. It imports nothing
  else, so it can be used inside a worker.

## 0.6.0

Voice mode on its own becomes a first-class way to use the package: the
`/headless` hook, a page and an example for it, and an engine that no longer
charges a download for the setups production apps actually choose. Models are
kept between visits, so a returning visitor starts in seconds. The avatar
gestures while it talks and stands straight, `speak()` starts on its first
sentence, and an interruption, spoken or typed, now stops the voice cleanly.

No breaking changes. New: `preloadLocalSpeech`, `onLocalSpeechReady`,
`isLocalSpeechReady`, `activeTtsEngine` and `onTtsEngineChange`. One
behaviour change worth knowing: supplying `onTranscribe` or `onSynthesize` now
skips the local model it replaces instead of downloading it anyway.

### Typing works on every page, and cuts the avatar off cleanly

- **The homepage and `/voice` have a type box**, as the scenario pages
  already did. People who will not open a microphone for a page they just
  found could watch the demo but never hear it answer. The reply is spoken
  either way, and typing during a reply stops it first, like talking over it.
- **A sentence already being synthesised no longer plays after an
  interrupt.** Clearing a worker's queue does not stop the sentence it is
  working on, and its audio arrived a second later. Talking over the avatar
  hid this, because the late audio landed while the user was still speaking;
  typed input starts the next turn at once, and the greeting's next sentence
  played over the answer. Requests now carry a turn number that the workers
  echo with their audio, `interrupt()` advances it, and audio from an older
  turn is dropped. Both voices are covered: Kokoro, and MMS with the
  in-browser model's replies.

### Start on a provider, hand over to the browser

- **`preloadLocalSpeech`** downloads the in-browser hearing and voice behind
  `onTranscribe` and `onSynthesize` without holding anything up, and
  **`onLocalSpeechReady`** fires when they could take over. Drop the adapters
  then and the conversation carries on locally. `isLocalSpeechReady` is on the
  hook's return value. Measured with stored models: ready on the adapters in
  0.2 s, local speech ready at 6 s, and the next reply spoken by Kokoro with no
  call to the host's voice.
- **`examples/groq-voice`** does this on Groq's free tier with the developer's
  own key, kept in a dev-server route: Whisper, GPT-OSS 20B and Orpheus to
  start, then an offer to switch hearing and voice to the browser once they
  have downloaded. It shows Groq's limits and what is left of them, and when
  one runs out it says so and offers the in-browser models again.

### The voice a phone gets is named, and kept for the right reasons

- **Kokoro's download progress was wrong.** It read 99% within two seconds
  and stayed there for the whole 325 MB download: its three config files
  finish before the model file starts, and the per-file estimate took those
  3.6 KB for all of it. Only weight files count towards that estimate now.
- **Leaving during the download no longer counts as a crash.** The
  breadcrumb that switches a browser to the MMS voice after two failed Kokoro
  loads was set as soon as loading began, so two abandoned downloads — easy on
  a phone — downgraded the voice for good. It is now set once the download is
  complete and the model is being built, which is where memory runs out.
- **`activeTtsEngine` and `onTtsEngineChange`** say which voice is speaking:
  `'kokoro'`, `'mms'` (every iPhone and iPad, and wherever Kokoro fails), or
  `'custom'` for `onSynthesize`. MMS is a single plainer voice that ignores
  `ttsVoice`, which is why a phone can sound like someone else. The demo now
  names the voice under the button.

### Cloud speech adapters no longer download the local models

`onTranscribe` and `onSynthesize` replaced Whisper and Kokoro at runtime, but
both were still downloaded — some 590 MB — and the engine stayed `'loading'`
until they arrived, for models it never called. That is the configuration most
production apps choose.

- **A model the host replaces is not loaded.** With `onTranscribe`,
  `onSubmit` and `onSynthesize` all supplied, the engine is ready in about two
  seconds having requested no model at all. Each adapter skips only its own
  model, so `onSynthesize` alone still loads Whisper.
- **Dropping an adapter later loads what it stood in for**, so a host can fall
  back from a cloud provider to the local model mid-session.
- **Kokoro's crash detector ignores hosts that synthesise.** It counts loads
  that started Kokoro and never finished it, and with Kokoro skipped, two
  visits would have been read as two crashes and switched that browser to the
  MMS voice for good.
- `tests/cloud-adapters.spec.ts` runs a whole turn through all three adapters
  and fails on any model request. It fails against the previous engine.

### Voice only, on the demo and as an example

Most apps want voice mode, not a character: talk to the app the way you talk to
ChatGPT or Gemini. The package has supported that since the
`react-ai-voice-avatar/headless` entry point, but nothing showed it. The one
example named "headless" still rendered the 3D avatar.

- **The demo has a "3D avatar | Voice only" switch.** Voice only is an orb that
  moves with whoever is speaking, with live captions, running on
  `useAiVoiceAvatar` from `/headless` and nothing else. It never requests the
  avatar file. Switching reloads the engine from the models the browser already
  keeps, so nothing downloads twice, and the hosted conversation carries across.
- **It has a page of its own, at `/voice`**, linked from the demo's header: a
  link to share for anyone who only wants voice mode. It is a separate entry
  rather than a route, so it loads React and the hook and nothing else — 0.23
  MB against the homepage's 10.3 MB with its two avatars. On a 10 Mbit/s line
  it is usable in 0.2 s, where the homepage takes 8–9 s to show its avatar,
  and with the models already stored it speaks 2–3 s sooner after the click.
- **`examples/voice-only`** is the same thing as an app to copy, with no
  backend: the in-browser language model answers unless you pass `onSubmit`.
  Its production build contains no WebGL code.

### The avatars stand symmetrically

Both bundled avatars stood with the right hand about 8 cm further from the body
than the left, and the right fingertips about 13 cm off where the left ones
were. `scripts/convert-rocketbox.py` bent every elbow and knuckle 10° about the
bone's own X axis on both sides. On a mirrored skeleton that axis is reflected,
so the same angle bent the two sides opposite ways: the left elbow in toward
the body, the right one out. Measured on the files, every right bone from the
forearm down sat exactly 20° off its mirror.

- **Published avatars corrected in place.** `scripts/mirror-arm-rest-pose.mjs`
  rewrites the 16 right-arm rotations (forearm and finger joints) as the mirror
  of the left. Nothing else in either file changed: mesh, skin, morph targets
  and textures are byte-identical.
- **Why the left arm is the one kept:** a relaxed arm with the palm facing the
  thigh brings the hand forward and slightly in, which is what the left does.
- **Served from a new tag.** The avatars are served from a new tag,
  `avatars-v2`. Installs pinned to `avatars-v1` keep the avatar they were built
  against.
- **The converter is fixed too.** It now turns the right side the opposite way.
  That change was worked out from the measurements, not run: the Rocketbox
  source files were not at hand.
- **`scripts/test-avatar-symmetry.mjs` guards it.** It compares every left
  bone with its right twin, checks both elbows bend in rather than out, and
  refuses a rig whose upper arms are not mirrored rather than "fixing" it. It
  fails on the old files, including when they are mirrored the wrong way round.

### `speak()` starts talking on its first sentence

`speak()`, and a reply an `onSubmit` handler returns as a single string, went to
the voice whole, and the voice produces audio for everything it is given before
handing any back. So nothing was audible until the last sentence existed. On a
machine without WebGPU, that was the demo's greeting: 30 to 33 seconds of
silence straight after a long download, measured over four loads, while the
status read `speaking` from the first millisecond.

Text is now cut into sentences (`src/lib/speechChunks.ts`) and the voice returns
each as it is ready, so the first plays while the rest are being made. Same
greeting, same machine: audible after about 2 seconds, and finished after about
24 rather than 46, because the voice works on the next sentence while the
current one plays.

What that machine still costs: its voice runs about 2.5× slower than real
time, so on it the sentences have pauses between them, the longest about 5 s
after the opening "Hi!". A pause appears only where the next sentence takes
longer to make than the current one takes to say. With WebGPU, on a Mac, none
did: the greeting was audible after 0.75 s and each sentence started within
2 ms of the previous one ending.

- **`speak()` now reports `thinking` until its audio starts**, then `speaking`,
  like every other reply. A host showing `isSpeaking` no longer shows it over
  silence. Calling `speak()` while the avatar is already talking still stays
  `speaking`.
- **Transcripts are unchanged:** `onTranscriptUpdate` still receives the text
  once, whole.
- **An `onSynthesize` adapter now receives sentences** rather than the whole
  text, as it already did for streamed replies. They are requested one after
  another, so they cannot finish out of order, and each is fetched while the one
  before it plays. MMS and cloud voices keep the 35-character minimum piece they
  have always had on the streaming path.
- **Splitting avoids the obvious traps:** it doesn't cut inside "0.5B",
  "3.5 GB", "Dr." or a domain name, and it splits Hindi at the danda. A sentence
  over 200 characters is cut at a clause break, since Kokoro silently drops
  input past its limit. `scripts/test-speech-chunks.mjs` covers these cases;
  breaking any of those rules on purpose fails it.

### The avatar gestures while it talks

It used to stand with its arms still for the whole of every reply. Now each
phrase gets a position — one hand brought up in front of the chest, both hands,
or now and then neither, because constant motion reads as nervous — and the
raised hand strokes down on stressed syllables, landing 17 ms after the
syllable, in step with the mouth. When the voice stops the arms go back to the
model's own rest pose, but not during a short pause between words.

```tsx
<AiVoiceAvatar gestures />         // the default
<AiVoiceAvatar gestures={0.6} />   // smaller
<AiVoiceAvatar gestures={false} /> // arms still
```

**Built for any skeleton, which is where it went wrong before.** Arm bones'
local axes differ between rigs and are mirrored between the sides; an earlier
attempt to pose them with fixed angles sent one arm forward and the other behind
the back. `armRig.ts` never reads a bone's own axes: it works out where the body
faces from where its shoulders are, and moves each arm against that. Tested on
rigs built to break it — mirrored, turned, Z-up, all three at once — and the old
approach, swapped back in, fails those tests the way it failed in practice.

**Hand height was decided by looking.** The first version kept the elbow near
45°, on the theory that big gestures read as flailing. On the homepage's
framing that left the hands below the frame, visible only as fingertips
flickering in at the corners. They now come up in front of the chest, where
conversational gesture happens and where a head-and-torso shot can see it.

**Motion limits taken from how people move:** no joint above 300°/s, and none
gaining more than 60°/s of speed in a single frame, which is what a visible
snap is. Springs are integrated exactly rather than stepped, after a stepped one
flung an arm 26 radians on a long frame.

- Added: `gestures` (`boolean | number`, default `true`).

**Found along the way — the shipped avatars' rest pose is lopsided.** The
converter bends each elbow about the bone's own axis, which on a mirrored rig
bends the two differently: the right hand hangs about 10 cm further out than the
left. Gestures no longer amplify it — the first version did, folding one hand
onto the stomach while the other stuck out sideways — but the rest pose itself
needs the converter fixed and the avatars republished under a new tag.

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

**Observed end to end** on the real homepage in Chrome, with a fresh profile: the
first visit downloaded the models and was ready in 585 s on a slow connection;
the next visit was ready in 15 s and requested no weights for the voice or for
speech recognition. The 310 MB voice — the file the Cache API always refused —
was among the files kept.

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
