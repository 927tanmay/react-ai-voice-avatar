# Avatar asset licensing

## What is here

| File | Source | Licence |
| :--- | :--- | :--- |
| `ananya.glb` | Microsoft Rocketbox, `Female_Adult_07` | MIT |
| `aarav.glb` | Microsoft Rocketbox, `Male_Adult_04` | MIT |

Both were converted from the original FBX by
[`scripts/convert-rocketbox.py`](../../scripts/convert-rocketbox.py). The
conversion renames the skeleton and blendshapes, drops the morph targets this
engine never drives, and repacks the textures for the web. It changes no
geometry.

The [Microsoft Rocketbox avatar library](https://github.com/microsoft/Microsoft-Rocketbox)
is released under the MIT licence, the same licence as this project, so these
files are redistributable without restriction. Attribution is appreciated but
not required.

There is no separate `default.glb`. The `default` and `kiosk` presets resolve to
`ananya.glb`, because the file they used to point at was byte-identical to it.

## Previous assets

Earlier releases bundled Ready Player Me exports, and the licence file at the
time described them incorrectly as procedurally generated MIT/CC0 geometry.
Ready Player Me avatars created through its website were licensed
CC BY-NC-SA 4.0, which is non-commercial and share-alike and therefore
incompatible with this project's MIT licence. Ready Player Me shut down on
31 January 2026, so no commercial licensing route remained.

Those files were removed and replaced with the Rocketbox conversions above. If
you pinned an older version of this package and rely on the bundled meshes,
review that licence position yourself.

## Bringing your own avatar

You are not required to use the bundled models. Pass any GLB humanoid:

```tsx
<AiVoiceAvatar modelSrc="/models/my-avatar.glb" />
```

For the full feature set, the model needs:

1. **Format** — `.glb` (binary glTF).
2. **Facial morph targets** — the standard 52 Apple ARKit blendshapes
   (`jawOpen`, `eyeBlinkLeft`, `mouthSmileRight`, and so on) on the head mesh.
   The 15 Oculus viseme targets (`viseme_aa`, `viseme_PP`, …) are preferred when
   present, since they are purpose-built for speech.
3. **Skeleton** — standard humanoid bone names for head tracking and body
   motion: `Head`, `Neck`, `Spine`, `Spine1`, `Spine2`, `LeftArm`,
   `LeftForeArm`, `LeftHand`, and their right-side equivalents.

A model missing any of these still renders. It loses the corresponding animation
rather than failing.

### Converting another Rocketbox avatar

The library has 115 avatars. Any of them can be converted with the same script:

```bash
blender --background --python scripts/convert-rocketbox.py -- \
  --input  path/to/Male_Adult_12_facial.fbx \
  --output my-avatar.glb \
  --texture-size 512
```

Use the `_facial.fbx` variant, not the plain body FBX, and keep the avatar's
sibling `Textures/` folder in place. The FBX files embed the absolute paths of
the machine they were authored on, so the script relinks textures by filename
and will report any it cannot find.
