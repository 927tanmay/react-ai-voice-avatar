# Changelog

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
