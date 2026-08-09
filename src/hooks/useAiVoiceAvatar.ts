import { useEffect, useRef, useState, useCallback } from 'react';
import { useMLWorker } from './useMLWorker';
import { useKokoroWorker } from './useKokoroWorker';
import { AiVoiceAvatarCapabilities } from '../components/AiVoiceAvatar';

export interface UseAiVoiceAvatarConfig {
  llmModel?: string;
  asrModel?: string;
  ttsLanguage?: string;
  ttsEngine?: 'kokoro' | 'mms';
  ttsVoice?: string;
  fallbackMode?: 'wasm' | 'disable' | 'error';
  lowMemoryMode?: boolean;
  systemPrompt?: string;
  asrLanguage?: string;
  onTranscriptUpdate?: (text: string, speaker: 'user' | 'avatar') => void;
  onSubmit?: (transcript: string) => Promise<string | AsyncIterable<string> | ReadableStream<any> | any> | string | AsyncIterable<string> | ReadableStream<any> | any;
  onCapabilityDetected?: (caps: AiVoiceAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  vadAssetPath?: string;
  onnxWasmPath?: string;
  workerBaseUrl?: string;
  listenMode?: 'vad' | 'push-to-talk';
  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onSpeechStart?: (text: string) => void;
}

export interface UseAiVoiceAvatarReturn {
  status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
  isLoading: boolean;
  isIdle: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  micError: string | null;
  analyser: AnalyserNode | undefined;
  isReady: boolean;
  startListening: () => void;
  stopListening: () => void;
  interrupt: () => void;
  clearHistory: () => void;
  speak: (text: string) => void;
  currentSpeechTextRef: React.RefObject<string>;
  currentSpeechPhonemesRef: React.RefObject<string>;
  currentAudioDurationRef: React.RefObject<number>;
  playbackStartTimeRef: React.RefObject<number>;
  audioContextRef: React.RefObject<AudioContext | null>;
}

export function useAiVoiceAvatar(config: UseAiVoiceAvatarConfig): UseAiVoiceAvatarReturn {
  const [status, setStatus] = useState<'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'>('loading');
  const [analyser, setAnalyser] = useState<AnalyserNode | undefined>(undefined);
  const [micError, setMicError] = useState<string | null>(null);
  
  const vadRef = useRef<any | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<Array<{ audioData: Float32Array; sampleRate: number; text: string; phonemes: string; isLast: boolean }>>([]);
  const isPlayingRef = useRef<boolean>(false);
  const isWaitingForMoreRef = useRef<boolean>(false);
  const currentSpeechTextRef = useRef<string>('');
  const currentSpeechPhonemesRef = useRef<string>('');
  const currentAudioDurationRef = useRef<number>(0);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackWatchdogRef = useRef<any>(null);

  // Keep latest config in ref for callbacks
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current || !audioContextRef.current) return;
    
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (audioQueueRef.current.length === 0) {
      if (!isWaitingForMoreRef.current) {
        if (playbackWatchdogRef.current) {
          clearTimeout(playbackWatchdogRef.current);
          playbackWatchdogRef.current = null;
        }
        setStatus('idle');
        configRef.current.onInferenceEnd?.();
        if (configRef.current.listenMode !== 'push-to-talk') {
          vadRef.current?.start();
        }
      } else if (!playbackWatchdogRef.current) {
        // Watchdog recovery: If nothing is playing and queue stays empty for ~10s while waiting for more chunks, recover pipeline
        playbackWatchdogRef.current = setTimeout(() => {
          console.warn('[Watchdog] Audio queue timed out waiting for further chunks (10s elapsed). Resetting to idle and restarting VAD.');
          playbackWatchdogRef.current = null;
          isWaitingForMoreRef.current = false;
          isPlayingRef.current = false;
          setStatus('idle');
          configRef.current.onInferenceEnd?.();
          if (configRef.current.listenMode !== 'push-to-talk') {
            vadRef.current?.start();
          }
        }, 10000);
      }
      return;
    }

    // We have audio to process; clear any active watchdog timer
    if (playbackWatchdogRef.current) {
      clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }

    const item = audioQueueRef.current.shift()!;

    // Guard against "poison pill" zero-length or invalid sampleRate chunks (e.g. MMS->Kokoro text forwarding or stripped emojis)
    if (!item.audioData || item.audioData.length === 0 || !item.sampleRate || item.sampleRate <= 0) {
      if (item.isLast) {
        isWaitingForMoreRef.current = false;
      }
      // Recurse directly to next chunk or trigger idle completion without locking playback state
      playNextInQueue();
      return;
    }

    isPlayingRef.current = true;
    const ctx = audioContextRef.current;

    try {
      const buffer = ctx.createBuffer(1, item.audioData.length, item.sampleRate);
      buffer.copyToChannel(item.audioData as unknown as Float32Array<ArrayBuffer>, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      if (analyser) {
        source.connect(analyser);
        analyser.connect(ctx.destination);
      } else {
        source.connect(ctx.destination);
      }

      source.onended = () => {
        isPlayingRef.current = false;
        currentSpeechTextRef.current = '';
        currentSpeechPhonemesRef.current = '';
        currentAudioDurationRef.current = 0;
        if (item.isLast) {
          isWaitingForMoreRef.current = false;
        }
        playNextInQueue();
      };

      // Expose text + timing for the lip sync engine
      currentSpeechTextRef.current = item.text;
      currentSpeechPhonemesRef.current = item.phonemes;
      currentAudioDurationRef.current = buffer.duration;
      playbackStartTimeRef.current = ctx.currentTime;

      setStatus('speaking');
      configRef.current.onSpeechStart?.(item.text);
      source.start(0);
      currentAudioSourceRef.current = source;
    } catch (playbackErr) {
      console.error('[AiVoiceAvatar] Audio buffer creation/playback error, skipping chunk to recover pipeline:', playbackErr);
      isPlayingRef.current = false;
      if (item.isLast) {
        isWaitingForMoreRef.current = false;
      }
      playNextInQueue();
    }
  }, [analyser]);

  const handleSpeechOutput = useCallback((audioData: Float32Array, sampleRate: number, text: string, phonemes: string = '', isLast: boolean = true) => {
    if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
      isWaitingForMoreRef.current = !isLast;
    } else if (!isLast) {
      isWaitingForMoreRef.current = true;
    } else {
      isWaitingForMoreRef.current = false;
    }
    audioQueueRef.current.push({ audioData, sampleRate, text, phonemes, isLast });
    playNextInQueue();
  }, [playNextInQueue]);

  const handleSpeechEnd = useCallback(() => {
    if (playbackWatchdogRef.current) {
      clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }
    isWaitingForMoreRef.current = false;
    if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
      setStatus('idle');
      configRef.current.onInferenceEnd?.();
      if (configRef.current.listenMode !== 'push-to-talk') {
        vadRef.current?.start();
      }
    }
  }, []);

  // ─── Kokoro TTS Worker (loaded lazily, only when engine === 'kokoro') ───
  const { isReady: isKokoroReady, synthesize: kokoroSynthesize, speechEnd: kokoroSpeechEnd } = useKokoroWorker({
    enabled: config.ttsEngine === 'kokoro',
    voice: config.ttsVoice,
    onSpeechOutput: config.ttsEngine === 'kokoro' ? handleSpeechOutput : undefined,
    onSpeechEnd: config.ttsEngine === 'kokoro' ? handleSpeechEnd : undefined,
    loadingProgress: config.loadingProgress,
    workerBaseUrl: config.workerBaseUrl,
    onError: (_stage, _msg) => {
      console.error('[AiVoiceAvatar] Kokoro error, audio may be unavailable');
    },
  });

  // ─── ML Pipeline Worker (ASR + LLM + MMS-TTS) ───
  const { isReady: isMLReady, processAudio, synthesizeText: mmsSynthesize, clearHistory } = useMLWorker({
    llmModel: config.llmModel,
    asrModel: config.asrModel,
    asrLanguage: config.asrLanguage,
    onnxWasmPath: config.onnxWasmPath,
    workerBaseUrl: config.workerBaseUrl,
    ttsLanguage: config.ttsLanguage,
    ttsEngine: config.ttsEngine,
    ttsVoice: config.ttsVoice,
    fallbackMode: config.fallbackMode,
    lowMemoryMode: config.lowMemoryMode,
    systemPrompt: config.systemPrompt,
    loadLlm: !config.onSubmit, // Don't load local LLM if onSubmit is provided
    onCapabilityDetected: config.onCapabilityDetected,
    loadingProgress: config.loadingProgress,
    // Route text to Kokoro if Kokoro is active, otherwise play MMS audio
    onSpeechOutput: (audio, sampleRate, text, isLast) => {
      if (config.ttsEngine === 'kokoro') {
        kokoroSynthesize(text, isLast);
      } else if (audio && sampleRate) {
        handleSpeechOutput(audio, sampleRate, text, '', isLast);
      }
    },
    onStreamWord: (word) => {
      console.log('[AiVoiceAvatar] Streaming token:', word);
    },
    onSpeechEnd: () => {
      if (config.ttsEngine === 'kokoro') {
        kokoroSpeechEnd();
      } else {
        handleSpeechEnd();
      }
    },
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') {
        console.log('[AiVoiceAvatar] User spoke:', text);
      } else {
        console.log('[AiVoiceAvatar] Avatar spoke:', text);
      }
      configRef.current.onTranscriptUpdate?.(text, speaker);
      if (speaker === 'user' && configRef.current.onSubmit) {
        // We have a transcript and an onSubmit override.
        // We skip local LLM inside worker, and process either a string or a real-time stream here.
        Promise.resolve(configRef.current.onSubmit(text))
          .then(async (result: any) => {
            if (!result) return;
            
            // Check if result is an AsyncIterable or ReadableStream (e.g. OpenAI SDK / LangChain / Vercel AI)
            const isAsyncIterable = typeof result[Symbol.asyncIterator] === 'function';
            const isReadableStream = typeof result.getReader === 'function';
            
            if (isAsyncIterable || isReadableStream) {
              let sentenceBuffer = '';
              const iterator = isAsyncIterable ? result[Symbol.asyncIterator]() : null;
              const reader = isReadableStream ? result.getReader() : null;
              
              while (true) {
                const step = iterator ? await iterator.next() : await reader!.read();
                if (step.done) break;
                
                let chunk = step.value || '';
                if (chunk instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(chunk))) {
                  chunk = new TextDecoder().decode(chunk);
                } else if (typeof chunk !== 'string') {
                  chunk = String(chunk);
                }
                
                sentenceBuffer += chunk;
                const sentenceMatch = sentenceBuffer.match(/([.!?\u0964]|\n\n+)/);
                const minLen = configRef.current.ttsEngine === 'kokoro' ? 5 : 35;
                if ((sentenceMatch && sentenceBuffer.trim().length > minLen) || sentenceBuffer.trim().length > 150) {
                  const splitIdx = sentenceMatch 
                    ? sentenceBuffer.lastIndexOf(sentenceMatch[0]) + sentenceMatch[0].length 
                    : sentenceBuffer.lastIndexOf(' ') + 1;

                  if (splitIdx > 0) {
                    const phrase = sentenceBuffer.substring(0, splitIdx).trim();
                    sentenceBuffer = sentenceBuffer.substring(splitIdx);
                    if (phrase.length > 0) {
                      synthesizeText(phrase, false);
                    }
                  }
                }
              }
              
              if (sentenceBuffer.trim().length > 0) {
                synthesizeText(sentenceBuffer.trim(), true);
              }
            } else {
              // Standard string resolution
              synthesizeText(typeof result === 'string' ? result : String(result), true);
            }
          })
          .catch((err) => {
            console.error('onSubmit streaming error:', err);
            setStatus('idle');
            configRef.current.onInferenceEnd?.();
            vadRef.current?.start();
          });
      }
    },
    onError: (_stage, _msg) => {
      setStatus('idle');
      configRef.current.onInferenceEnd?.();
      vadRef.current?.start();
    }
  });


  // ─── Unified synthesizeText: routes to the correct TTS engine ───
  const synthesizeText = useCallback((text: string, isLast: boolean = true) => {
    configRef.current.onTranscriptUpdate?.(text, 'avatar');
    if (config.ttsEngine === 'kokoro' && isKokoroReady) {
      kokoroSynthesize(text, isLast);
    } else {
      mmsSynthesize(text, isLast);
    }
  }, [config.ttsEngine, isKokoroReady, kokoroSynthesize, mmsSynthesize]);

  // Imperative speech triggering for external alerts or scripted turns
  const speak = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    setStatus('speaking');
    synthesizeText(text.trim(), true);
  }, [synthesizeText]);

  // Combined readiness
  const isReady = isMLReady && (config.ttsEngine !== 'kokoro' || isKokoroReady);

  useEffect(() => {
    if (isReady && status === 'loading') {
      setStatus('idle');
    } else if (!isReady && status === 'idle') {
      setStatus('loading');
    }
  }, [isReady, status]);

  // Init VAD and AudioContext
  useEffect(() => {
    let mounted = true;

    async function initVad() {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return; // P4: Next.js SSR Guard
      if (!navigator?.mediaDevices?.getUserMedia) {
        const errMsg = 'Microphone API not available (secure HTTPS context or localhost required).';
        console.warn(`[AiVoiceAvatar] ${errMsg}`);
        if (mounted) setMicError(errMsg);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          },
        });
        if (mounted) setMicError(null);
        mediaStreamRef.current = stream;

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtxClass) {
          console.warn('[AiVoiceAvatar] AudioContext not supported in this browser environment.');
          return;
        }
        const audioCtx = new AudioCtxClass();
        audioContextRef.current = audioCtx;

        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        if (mounted) {
          setAnalyser(analyserNode);
        }

        const vad = await import('@ricky0123/vad-web');
        const myvad = await vad.MicVAD.new({
          getStream: () => Promise.resolve(stream),
          baseAssetPath: configRef.current.vadAssetPath || "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
          onnxWASMBasePath: configRef.current.onnxWasmPath || "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
          onSpeechStart: () => {
            if (!mounted) return;
            if (configRef.current.listenMode === 'push-to-talk') return; // Should be paused anyway
            
            setStatus('listening');
            
            // Interrupt logic:
            if (playbackWatchdogRef.current) {
              clearTimeout(playbackWatchdogRef.current);
              playbackWatchdogRef.current = null;
            }
            audioQueueRef.current = [];
            isPlayingRef.current = false;
            isWaitingForMoreRef.current = false;
            if (currentAudioSourceRef.current) {
              currentAudioSourceRef.current.stop();
              currentAudioSourceRef.current = null;
              configRef.current.onUserInterrupt?.();
            }
          },
          onSpeechEnd: (audio: Float32Array) => {
            if (!mounted) return;
            if (configRef.current.listenMode === 'push-to-talk') return;

            setStatus('thinking');
            configRef.current.onInferenceStart?.();
            myvad.pause();
            
            const langCode = configRef.current.asrLanguage === 'hi-IN' ? 'hi' : 
                             configRef.current.asrLanguage?.split('-')[0] || 'en';

            processAudio(audio, langCode, !!configRef.current.onSubmit);
          },
          startOnLoad: false
        });

        if (mounted) {
          vadRef.current = myvad;
        }
      } catch (err) {
        console.error('Failed to init VAD', err);
        if (mounted) {
          setMicError('Microphone access denied or unavailable. Please enable permissions in browser settings.');
        }
      }
    }

    initVad();

    return () => {
      mounted = false;
      if (playbackWatchdogRef.current) {
        clearTimeout(playbackWatchdogRef.current);
        playbackWatchdogRef.current = null;
      }
      try {
        const destroyPromise = vadRef.current?.destroy();
        if (destroyPromise && typeof destroyPromise.catch === 'function') {
          destroyPromise.catch(() => { /* ignore VAD destroy rejection on unmount */ });
        }
      } catch (err) {
        console.warn('VAD destroy ignored on cleanup:', err);
      }
      try {
        currentAudioSourceRef.current?.stop();
      } catch (e) {}
      try {
        audioContextRef.current?.close();
      } catch (e) {}
      try {
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      } catch (e) {}
    };
  }, [processAudio]);

  const startListening = useCallback(() => {
    if (!vadRef.current || !isReady) return;
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
    vadRef.current.start();
    setStatus('listening');
  }, [isReady]);

  const stopListening = useCallback(() => {
    vadRef.current?.pause();
    setStatus('idle');
  }, []);

  const interrupt = useCallback(() => {
    if (playbackWatchdogRef.current) {
      clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isWaitingForMoreRef.current = false;
    if (currentAudioSourceRef.current) {
      currentAudioSourceRef.current.stop();
      currentAudioSourceRef.current = null;
    }
    configRef.current.onUserInterrupt?.();
    setStatus('idle');
  }, []);

  return {
    status,
    isLoading: status === 'loading',
    isIdle: status === 'idle',
    isListening: status === 'listening',
    isThinking: status === 'thinking',
    isSpeaking: status === 'speaking',
    micError,
    analyser,
    isReady,
    startListening,
    stopListening,
    interrupt,
    clearHistory,
    speak,
    currentSpeechTextRef,
    currentSpeechPhonemesRef,
    currentAudioDurationRef,
    playbackStartTimeRef,
    audioContextRef,
  };
}
