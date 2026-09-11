/**
 * Headless entry point: `react-ai-voice-avatar/headless`
 *
 * The full conversational loop — microphone, voice activity detection, turn
 * taking, streaming speech synthesis, barge-in — with no 3D rendering and no
 * three.js, @react-three/fiber or @react-three/drei in the module graph.
 *
 * Use this when you want voice mode in an app that draws its own UI.
 * Import from the package root instead if you want the 3D avatar.
 */

export { useAiVoiceAvatar, useAiVoiceAvatar as useAiVoiceAvatarState } from './hooks/useAiVoiceAvatar';
export type {
  UseAiVoiceAvatarConfig,
  UseAiVoiceAvatarReturn,
  UseAiVoiceAvatarReturn as UseAiVoiceAvatarStateReturn,
} from './hooks/useAiVoiceAvatar';

/** Plain DOM status control. Renders no 3D and is safe to use headlessly. */
export { StatusPill } from './components/StatusPill';
export type { StatusPillProps } from './components/StatusPill';

export type { AiVoiceAvatarCapabilities } from './types';
