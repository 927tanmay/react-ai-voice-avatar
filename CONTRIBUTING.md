# Contributing

Thanks for looking. This is a React package that holds a spoken conversation in
the browser: the microphone, turn-taking, interruption, speech recognition, a
voice, and optionally a lip-synced 3D avatar. Contributions of every size are
welcome, from a typo to a new avatar.

**Where to start:** issues labelled
[`good first issue`](https://github.com/927tanmay/react-ai-voice-avatar/labels/good%20first%20issue),
and [ROADMAP.md](ROADMAP.md) for the larger pieces, with what is already known
about each. Questions and ideas are welcome in
[Discussions](https://github.com/927tanmay/react-ai-voice-avatar/discussions).

## Setup

You need **Node 24** (22.6 at the least: several test suites import TypeScript
directly with `--experimental-strip-types`). The published package itself runs
on Node 18 and up; this is only for working on it.

```bash
git clone https://github.com/927tanmay/react-ai-voice-avatar.git
cd react-ai-voice-avatar
npm install
node scripts/build-workers.mjs   # generates the worker code the hooks import

cd sandbox
npm install
npm run dev                      # http://localhost:5173
```

The sandbox is the live demo. In development it imports the package straight
from `src/`, so edits reload as you save, with one exception: **after changing
anything in `src/workers/`, run `node scripts/build-workers.mjs` again**. The
workers are bundled into generated modules, and the dev server serves the last
ones built.

Pages worth knowing in the sandbox:

| Page | What it is |
| :--- | :--- |
| `/` | The homepage: the avatar, the voice-only switch, and every scenario |
| `/voice` | Voice mode on its own, built on the headless hook alone |
| `/e2e/adapters.html` | A test page for the cloud adapters, used by the e2e suite |
| `/e2e/latency.html` | Times each stage of a turn, for `node scripts/measure-latency.mjs` |

The first time you talk to it, the browser downloads about 590 MB of models and
keeps them, so later runs start in seconds. Chrome or Edge on a desktop is the
fastest place to work; without WebGPU the voice is slow.

Replies on the homepage come from `api/chat.ts`, a Vercel function that needs a
Groq key. Locally it is absent by design, and the demo says the hosted model is
not answering. Nothing else depends on it.

## Where things live

| Path | What |
| :--- | :--- |
| `src/hooks/useAiVoiceAvatar.ts` | The engine: microphone, turns, interruption, playback |
| `src/workers/` | Speech recognition, the language model and the voices, off the main thread |
| `src/lib/` | Pure logic — turn rules, sentence splitting, phonemes, download progress, the arm rig — and where most tests point |
| `src/components/` | The 3D avatar and the status pill |
| `src/headless.ts` | The `/headless` entry, which must never import three.js |
| `sandbox/` | The live demo |
| `examples/` | Small apps people copy; they install the published package |
| `scripts/` | The test suites, the worker build, and avatar tools |
| `tests/` | Playwright end-to-end tests |
| `assets/avatars/` | The built-in avatars, served from a CDN rather than npm |

## Checks

CI runs all of these on every pull request into `main`. Run what touches your
change before pushing:

```bash
npm run lint                     # type-check
npm run test:turn-state          # and the other test:* suites, each a few seconds:
                                 # speech-gate, hindi, download-progress, chat-route,
                                 # worker-contract, model-cache, arm-rig, gestures,
                                 # speech-chunks, avatar-symmetry
npm run build
npm run test:smoke               # the built bundle loads in several bundlers

npx playwright install chromium  # once
npm run test:e2e                 # starts the sandbox if it is not running

node scripts/verify-pack.mjs     # packs, installs and speaks in a real browser; slow
```

The `test:*` suites cover the logic in `src/lib/` and the message contract
between the hooks and the workers. The React layer itself has no unit tests, so
a change to the hooks should say in the pull request how you checked it in a
browser.

## Trying an example against your changes

The examples install the published package, so they will not see your edits by
default. Build and pack instead:

```bash
npm run build && npm pack        # writes react-ai-voice-avatar-x.y.z.tgz
cd examples/voice-only
npm install ../../react-ai-voice-avatar-*.tgz
npm run dev
```

Do not commit the changed `package.json` or lock file that this leaves behind.

## Avatars

The built-in avatars are GLB files in `assets/avatars/`, served from jsDelivr at
a git tag rather than shipped in the npm package. The tag is `ASSET_TAG` in
`src/lib/avatarAssets.ts`. **Changing a GLB needs a new tag**: bump `ASSET_TAG`,
and push the tag before the change merges, or the live demo requests a file that
is not there.

A new avatar needs the 52 ARKit blendshapes for the face, and bones named
`LeftArm`, `LeftForeArm`, `LeftHand` and their right-hand equivalents for
gestures. `scripts/mirror-arm-rest-pose.mjs` makes the arms symmetric, and
`npm run test:avatar-symmetry` checks them. The avatars must be royalty-free.

## Pull requests

- One change per pull request, on a branch of its own.
- Say why, not only what, in the description and the commit message. The code
  says what it does; the reason is what a reviewer cannot recover later.
- A claim about speed or size needs the measurement behind it, and how it was
  taken.
- New logic in `src/lib/` gets a check in the matching `scripts/test-*.mjs`.
  A bug fix is best proved by a check that fails without it.
- For anything you can see or hear, attach a screenshot or a short recording.

A few things are settled, so please open a discussion before changing them:

- **The voice stays at fp32.** Quantising Kokoro would save about 228 MB and
  changes how it sounds; the voice is the best part of this package.
- **Nothing downloads before someone engages.** Pages gate the models behind
  `loadModels`, because they are hundreds of megabytes.
- **Keys stay on a server.** A new example that calls a provider does it
  through a route, as `examples/groq-voice` does. `examples/cloud-voice-bot`
  predates this and takes keys in the page for a quick try; that is not a
  pattern to copy.

## Licence

By contributing you agree that your work is released under the
[MIT licence](LICENSE), like the rest of the project.
