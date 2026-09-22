# Roadmap

What is worth doing next, why, and what is already known about each. Ordered by
what would most change someone's experience of the package, not by effort.

Every claim here was measured rather than assumed; where something is unverified
it says so.

---

## Now — before the launch posts

### 1. Make the models actually cache

**Measured, not suspected.** The Cache API in Chrome 152 refuses any single
entry of 256 MiB or more. Bisected with synthetic responses on a real origin:
255 MiB stores, 256 MiB fails with `UnknownError: Unexpected internal error`.
It is not a quota problem — that origin had 3.4 GB of quota and was using 543 MB.
transformers.js logs the refusal as a warning and carries on, so nothing looks
broken.

What that means per model, confirmed by listing the caches after a full load:

| File | Size | Cached |
| :--- | :--- | :--- |
| Whisper encoder | 78.6 MB | yes |
| Whisper decoder | 198.9 MB | yes |
| Kokoro voice weights | ~310 MB | **no** |
| Qwen2.5-0.5B q4 | ~750 MB | **no** |

So speech recognition is kept and the voice is not: a returning visitor
re-downloads ~310 MB of the ~590 MB first visit, and on a desktop the local
language model is fetched again every time, which undercuts the hand-over in
item 3.

**The obvious fix is ruled out.** Anything under 256 MiB caches, so a quantised
voice — Kokoro at `fp16` is 156 MB, at `q8f16` 82 MB — would store and never be
fetched twice. It is not being taken: quantising changes how the voice sounds,
and the voice is the part of this package that is genuinely good. Decided
deliberately, quality over bandwidth, rather than left open.

That leaves the same two options for the voice as for the language model, and
neither is a quick change:

- Store weights in OPFS (Origin Private File System), which has no per-entry
  limit of this kind, and serve them to ONNX Runtime from there.
- Split the file into sub-256 MiB chunks and reassemble on load.

**Also worth fixing regardless:** the demo page says the browser keeps these
models. It keeps one of the three.

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

**The voice stays at fp32.** Quantising it would save up to 228 MB and would
also make it cacheable (item 1), and it is still not being done: it changes how
the voice sounds, and the voice is the part of this package that is genuinely
good. A decision, not an open question — do not reopen it on size grounds
alone. Whisper is a different matter, since q4 there costs accuracy rather than
character, and it is worth measuring on real speech.

**Done for the demo:** the 750 MB language model is no longer part of the first
visit at all. Replies come from the hosted route (item 3), so a visitor
downloads ~590 MB — Whisper and the voice — before speaking, and on a capable
desktop the local model arrives later, behind the conversation. The remaining
saving is the voice and recognition models themselves, which is the table above.

### ~~3. Give the demo a real brain~~ — done

Replies now come from Llama 3.3 70B on Groq's free tier through `api/chat.ts`,
and the local model downloads behind the conversation on a desktop that can run
it, taking over when it lands. The page names whichever one is answering.

The endpoint is public, so it is built to be worth nothing to a stranger: the
system prompt is fixed server-side, replies are capped at 80 tokens, a visitor
gets 12 an hour and the whole site 800 a day, and any refusal falls back to the
local model rather than erroring. `scripts/test-chat-route.mjs` covers those
guards. Counters are per serverless instance, so the caps are approximate; the
account has no payment method, so the worst case is a 429 rather than a bill.

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

### 6. A mobile answer — half done

Phones now get hosted replies and never download the language model, so the
demo is ~590 MB rather than 1.3 GB and actually holds a conversation. That is
still a large download on a phone, and untested on real hardware: whether
Whisper and Kokoro run at a usable speed on a mid-range Android, and whether
iOS Safari survives the memory, are open questions. Measuring that comes before
any further work here. Text input with local voice remains the fallback if the
answer is no.

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
