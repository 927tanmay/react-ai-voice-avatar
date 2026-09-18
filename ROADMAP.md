# Roadmap

What is worth doing next, why, and what is already known about each. Ordered by
what would most change someone's experience of the package, not by effort.

Every claim here was measured rather than assumed; where something is unverified
it says so.

---

## Now — before the launch posts

### 1. Make the models actually cache

**The problem.** The demo says the models are kept for next time. In Chromium
they are not: `Cache.put` failed with `UnknownError: Unexpected internal error`
for the Kokoro voice (310 MB) and the language model (750 MB), while a 199 MB
Whisper file stored fine. transformers.js logs the refusal as a warning and
carries on, so nothing appears broken — the visitor simply downloads a gigabyte
again on their next visit.

**Unverified.** Whether stock Chrome on a normal profile behaves the same way.
Everything above was seen in one Chromium environment. **Establishing this comes
first**, because if real Chrome caches fine, the rest of this item disappears.

**If it is real, the options are:**

- Store weights ourselves in OPFS (Origin Private File System), which has no
  per-entry limit of this kind, and serve them to ONNX Runtime from there.
- Split large files into chunks small enough for the Cache API, and reassemble.
- Avoid the limit entirely by shipping smaller models (see item 2).

**Also worth fixing regardless:** the engine cannot currently tell a host that
caching failed. `onError` should report it as `degraded`, so an app can say
"this will download again next time" instead of quietly repeating it.

### 2. Shrink the first visit

**The problem.** English costs about 1.3 GB before anyone can speak: Whisper
base 278 MB, Qwen2.5-0.5B at q4 750 MB, Kokoro at fp32 310 MB. Hindi is about
2.1 GB. Most people will not wait.

**What is available:**

| Model | Now | Smaller option | Saving |
| :--- | :--- | :--- | :--- |
| Kokoro voice | fp32, 310 MB | `q8f16` 82 MB, `quantized` 88 MB, `fp16` 156 MB | up to 228 MB |
| Whisper base | fp32, 278 MB | q4 variants | ~150 MB |
| Qwen 0.5B | q4, 750 MB | none usable — see below | — |

**Already ruled out.** `q4f16` for the language model is 461 MB and is what
transformers.js recommends for WebGPU. It is broken for Qwen: measured on
WebGPU with `shader-f16`, greedy decoding, it repeated prompts back verbatim
instead of answering them, where q4 answered all five correctly. Activations
overflow half precision. It loads and generates without error, so only reading
the output reveals it. Recorded in a comment in `mlPipeline.worker.ts`.

**Needs a human ear.** Quantising the voice changes how it sounds. Nobody should
merge that without listening to the same sentence through both.

**Cheaper win, no quality cost:** do not download the language model until the
visitor actually speaks. Hearing and voice are enough to greet someone; the
language model is only needed for the first reply.

### 3. Give the demo a real brain

The local 0.5B model is the weakest part of the first impression: it answers
"what drinks do you have?" with a question. A small rate-limited serverless
route calling a cheap hosted model would make the demo conversation good, and
would demonstrate the bring-your-own-model architecture the README sells.

Blocked on an API key, which goes in the deployment's environment variables
rather than the repo. Cost is a small per-conversation API spend, so the route
needs a rate limit per visitor.

---

## Next — quality and reach

### 4. Harden turn-taking against real rooms

Turns are decided on sustained speech rather than loudness, which is what stops
a cough taking the floor. Two known costs, both currently unmeasured outside a
quiet room:

- A speaker below `positiveSpeechThreshold` (0.5) produces no events at all.
- A sound must sustain ~480 ms, so a short "yes" or "haan" may be dropped.

Worth building a small corpus — quiet speaker, noisy room, single-word answers,
filler sounds — and tuning the defaults against it rather than against one
person in one room. `speechDetection` already exposes every threshold.

### 5. Gestures

The avatar stands still while speaking. Hand and arm movement tied to speech
would do more for a demo video than anything else on this list. The rig has the
bones; `avatarDynamics.ts` is where the idle motion already lives.

Purely visual. No effect on reliability.

### 6. A mobile answer

A 1.3 GB download is not viable on a phone, and the demo currently just warns
about it. The honest options are to route phones to a hosted model (item 3), or
to offer text input with local voice only, which needs no language model at all.

### 7. Mixed-language conversations

A session is one language at a time. Someone who switches mid-conversation is
mistranscribed, because the recognition model is told which language to expect
and browser Whisper cannot detect it. Cloud recognition can. Previously planned
and deliberately deferred.

---

## Later

- **React Native / Expo.** Long-standing request in the README. Needs ONNX
  inference and Three.js working on mobile runtimes; large piece of work.
- **More avatar personas.** Royalty-free GLBs rigged with the 52 ARKit
  blendshapes. Served from a CDN, so each one adds nothing to the npm install.
- **Voice quality for Hindi.** The phonemiser and voices work end to end, but
  local Hindi remains demo-quality and the README says so. Improving it is about
  TTS tuning, not engine architecture.

---

## Known gaps in the project itself

- **CI needs Node 22.6+** for the test suites, which import TypeScript directly.
  Contributors on Node 20 cannot run them. Worth stating in CONTRIBUTING.md.
- **No test covers the React layer.** The suites cover pure logic — turn-taking
  rules, the speech gate, phonemisation, download progress — plus a packaging
  test that drives a real browser. The hooks themselves are verified by hand.
- **The packaging test depends on the live npm registry**, so an upstream
  hiccup can fail a build. Installs retry three times, which covers the
  transient case but not a sustained outage.

---

## Recently done

Shipped in 0.3.0 and 0.4.0, and no longer open questions:

- Interruption: the user can talk over the avatar, and turns are decided on
  sustained speech, so a cough ducks the voice and the reply resumes.
- `onError`, with a stage and a `degraded`/`fatal` severity.
- Hindi speech, transcription and replies.
- `speechDetection` — the VAD sensitivity tuning the README used to list as
  an open issue.
- `loadModels` and `onModelLoaded`, so an avatar can render before anyone
  downloads a model.
- A download progress figure that never runs backwards.
- The demo opens on the avatar rather than on a menu of scenarios.
