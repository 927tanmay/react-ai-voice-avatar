# Avatar asset licensing

## Status: the bundled meshes are being replaced

`ananya.glb`, `aarav.glb` and `default.glb` in this directory were exported from
**Ready Player Me**. Each file carries `"copyright": "Ready Player Me"` in its
glTF asset header, and they contain Ready Player Me's own outfit, hair and skin
art (the `Wolf3D_*` meshes and materials).

They are **not** covered by this project's MIT licence, and this file previously
described them incorrectly as procedurally generated geometry released under
MIT/CC0. That was wrong. It described an earlier placeholder mesh produced by
`scripts/generate_avatar.py`, and was never updated when the Ready Player Me
exports replaced it.

Avatars created through the Ready Player Me website were licensed
CC BY-NC-SA 4.0, which is non-commercial and share-alike. Ready Player Me shut
down on 31 January 2026 following its acquisition, so its developer programme
and commercial licensing route no longer exist.

**Do not treat these three files as reusable under this repository's MIT
licence.** They are scheduled for removal and replacement with permissively
licensed models. Track that work in the repository issues.

## What replaces them

Replacement meshes will come from
[Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), which is
released under the MIT licence and ships avatars carrying the full 52 ARKit
blendshapes plus 15 Oculus visemes on a fully rigged body. Those are compatible
with this project's licence and redistributable without restriction.

## Bringing your own avatar

You are not required to use the bundled models at all. Pass any GLB humanoid to
the `modelSrc` prop:

```tsx
<AiVoiceAvatar modelSrc="/models/my-avatar.glb" />
```

For lip sync and facial animation to work, the model needs:

1. **Format** — `.glb` (binary glTF).
2. **Facial morph targets** — the standard 52 Apple ARKit blendshapes
   (`jawOpen`, `eyeBlinkLeft`, `mouthSmileRight`, and so on) on the head mesh.
   The 15 Oculus viseme targets (`viseme_aa`, `viseme_PP`, …) are used in
   preference when present, since they are purpose-built for speech.
3. **Skeleton** — standard humanoid bone names for head tracking and body
   motion: `Head`, `Neck`, `Spine`, `Spine1`, `Spine2`, `LeftArm`, `LeftForeArm`,
   `LeftHand`, and their right-side equivalents.

A model missing any of these still renders. It simply loses the corresponding
animation rather than failing.
