export { AiVoiceAvatar } from './components/AiVoiceAvatar';
export { AiVoiceAvatarLazy } from './components/AiVoiceAvatarLazy';

export type { AiVoiceAvatarProps, AiVoiceAvatarCapabilities, AiVoiceAvatarHandle } from './components/AiVoiceAvatar';
export type { AiVoiceAvatarError, AiVoiceAvatarErrorStage, AiVoiceAvatarSubmitDetails, AiVoiceAvatarSynthesizeDetails } from './types';
export type { SynthesizedAudio, SynthesisResult, AudioChunk, PcmStreamOptions } from './lib/synthesizedAudio';
export { pcmStream } from './lib/synthesizedAudio';
export { StatusPill } from './components/StatusPill';
export type { StatusPillProps } from './components/StatusPill';
export { useAiVoiceAvatar, useAiVoiceAvatar as useAiVoiceAvatarState } from './hooks/useAiVoiceAvatar';
export type { UseAiVoiceAvatarConfig, UseAiVoiceAvatarReturn, UseAiVoiceAvatarReturn as UseAiVoiceAvatarStateReturn, TtsEngineInUse } from './hooks/useAiVoiceAvatar';
