# Avatars

The two characters that ship with `react-ai-voice-avatar`.

| File | Preset | Source | Size |
| :--- | :--- | :--- | :--- |
| `ananya.glb` | `ananya` (the default; `default` and `kiosk` are aliases) | Microsoft Rocketbox `Female_Adult_07` | ~4.7 MB |
| `aarav.glb` | `aarav` | Microsoft Rocketbox `Male_Adult_04` | ~4.5 MB |

Both are MIT licensed. See [LICENSE.md](LICENSE.md).

## How they reach the browser

They are not in the npm package. The engine loads them from jsDelivr, pinned to
a git tag of this repository:

```
https://cdn.jsdelivr.net/gh/927tanmay/react-ai-voice-avatar@avatars-v2/assets/avatars/ananya.glb
```

The tag is set by `ASSET_TAG` in [`src/lib/avatarAssets.ts`](../../src/lib/avatarAssets.ts).
A tag never changes, so a release can rely on the exact files it was tested
with. That also means **changing a GLB needs a new tag**: commit the new file,
tag the commit (`avatars-v3`, and so on), push the tag, and bump `ASSET_TAG`.

To serve them yourself, pass `enableLocalAssetProbe` and put the files in your
own `public/` directory, or point `modelSrc` at any URL.

## How they were made

[`scripts/convert-rocketbox.py`](../../scripts/convert-rocketbox.py) converts a
Rocketbox FBX in headless Blender. It renames the skeleton and blend shapes to
the ARKit names the engine drives, drops the morph targets it never uses,
relaxes the arms and fingers out of the T-pose, and shrinks the textures.
[`scripts/mirror-arm-rest-pose.mjs`](../../scripts/mirror-arm-rest-pose.mjs)
then makes the right arm an exact mirror of the left, and
`npm run test:avatar-symmetry` checks that every left and right bone pair
mirrors within 0.5 cm.

Any of the 115 Rocketbox characters can be converted the same way.

## Using your own character

```tsx
<AiVoiceAvatar modelSrc="https://cdn.example.com/my-character.glb" />
```

The model needs the 52 ARKit blend shapes on its face mesh, and standard
`Head`/`Neck` bone names for head movement. The main README's
[Custom Avatar Requirements](../../README.md#-custom-avatar-requirements) has
the details.
