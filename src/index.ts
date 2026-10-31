export { AiVoiceAvatar } from './components/AiVoiceAvatar';
export { AiVoiceAvatarLazy } from './components/AiVoiceAvatarLazy';

export type { AiVoiceAvatarProps, AiVoiceAvatarCapabilities, AiVoiceAvatarHandle } from './components/AiVoiceAvatar';
export type { AiVoiceAvatarError, AiVoiceAvatarErrorStage, AiVoiceAvatarSubmitDetails, AiVoiceAvatarSynthesizeDetails, SynthesizeErrorAction, SynthesizeErrorPolicy } from './types';
export type { SynthesizedAudio, SynthesisResult, AudioChunk, PcmStreamOptions, SpeechChunk, SpeechReply } from './lib/synthesizedAudio';
export { pcmStream, speechReply } from './lib/synthesizedAudio';
export { streamingTranscriber } from './lib/streamingTranscription';
export type { StreamingTranscriber, TranscriberContext, TranscriptionSession } from './lib/streamingTranscription';
export { StatusPill } from './components/StatusPill';
export type { StatusPillProps } from './components/StatusPill';
export { useAiVoiceAvatar, useAiVoiceAvatar as useAiVoiceAvatarState } from './hooks/useAiVoiceAvatar';
export type { UseAiVoiceAvatarConfig, UseAiVoiceAvatarReturn, UseAiVoiceAvatarReturn as UseAiVoiceAvatarStateReturn, TtsEngineInUse } from './hooks/useAiVoiceAvatar';
