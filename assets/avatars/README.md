# 🇮🇳 React AI Voice Avatar — 3D Character Asset Guide

This directory houses the default 3D `.glb` avatar characters used by the `react-ai-voice-avatar` engine and the sandbox test studio.

## Built-In AI Voice Personas
1. **`ananya.glb` (Female AI Voice Companion)**:
   - Default warm, intuitive conversational companion with high-fidelity ARKit facial blendshapes and expressive lip syncing.
2. **`aarav.glb` (Male AI Voice Companion)**:
   - Confident, dynamic technical assistant representing articulate, natural spoken human dialogue.
3. **`default.glb`**:
   - Fallback reference target for backward compatibility.

## How to Customize or Replace Avatar Models (Zero Code Changes Required!)
During initial prototyping and development, `aarav.glb` and `ananya.glb` are seeded with our verified ARKit facial blendshape character mesh so the application builds cleanly out-of-the-box without missing file errors.

To deploy your own custom character model:
1. **Export/Obtain Your Model**:
   - Use compatible 3D character generator pipelines (e.g., **Avatar SDK**, **Blender / MPFB (MakeHuman Plugin for Blender)** with TalkingHead rigs, **Tripo3D**, or existing **Ready Player Me** archives).
   - Ensure the `.glb` mesh includes standard ARKit or Oculus viseme blendshapes for facial animation and speech sync.
2. **Drop-in File Replacement**:
   - Rename your custom male model file to **`aarav.glb`**.
   - Copy and overwrite the file in two locations:
     - `assets/avatars/aarav.glb` (for distribution & archiving)
     - `sandbox/public/aarav.glb` (for immediate studio test viewing)
3. **Instant Activation**:
   - Reload your studio app (`npm run dev` in `/sandbox`). When you select **"👨🏽 Aarav"**, your realistic custom character will instantly load with all voice prompts and theme styling applied automatically!

## NPM Package Consumer Usage
When developers install `react-ai-voice-avatar`, they select their preferred persona via standard props:
```tsx
import { AiVoiceAvatar } from 'react-ai-voice-avatar';

// Render Female Voice Companion (Ananya)
<AiVoiceAvatar avatarPreset="ananya" systemPrompt="..." />

// Render Male Voice Companion (Aarav)
<AiVoiceAvatar avatarPreset="aarav" systemPrompt="..." />

// Or provide a custom remote CDN endpoint directly:
<AiVoiceAvatar modelSrc="https://cdn.example.com/custom-avatar.glb" />
```
