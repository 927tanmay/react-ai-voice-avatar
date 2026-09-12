import { useEffect, useRef, useState, useCallback } from 'react';
import { useMLWorker } from './useMLWorker';
import { useKokoroWorker } from './useKokoroWorker';
import type { AiVoiceAvatarCapabilities } from '../types';
import { isIOS } from '../lib/device';

const CRUMB = 'rava:kokoro-init-crashed';

/**
 * How far ahead of "now" a chunk is scheduled when starting a fresh utterance,
 * or recovering after generation fell behind playback. Long enough to survive a
 * busy main thread, short enough not to be heard as latency.
 */
const SCHEDULE_LEAD_SECONDS = 0.06;

/** How long to wait for promised audio that never arrives before recovering. */
const RESPONSE_STALL_TIMEOUT_MS = 10000;

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
  onTranscribe?: (audio: Float32Array) => Promise<string>;
  onSynthesize?: (text: string) => Promise<Float32Array | ArrayBuffer>;
  onCapabilityDetected?: (caps: AiVoiceAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  vadAssetPath?: string;
  onnxWasmPath?: string;
  workerBaseUrl?: string;
  /** `'vad'` is the former name for `'continuous'` and still works. */
  listenMode?: 'continuous' | 'push-to-talk' | 'vad';
  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onSpeechStart?: (text: string) => void;
  onAudioLevelChange?: (level: number, source: 'mic' | 'tts') => void;
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
  /**
   * Begin listening. Call this from a user gesture.
   *
   * Asynchronous because the first call is what opens the microphone, which is
   * where the browser's permission prompt appears. Awaiting it is optional; the
   * status transitions to 'listening' once the device is live, and `micError`
   * is set if it never does.
   */
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  clearHistory: () => void;
  speak: (text: string) => void;
  sendText: (text: string) => void;
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
  
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const vadRef = useRef<any | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  /** Set once the hook unmounts, so in-flight async setup can bail out. */
  const isUnmountedRef = useRef(false);
  /**
   * The in-flight or completed microphone setup, cached so that concurrent
   * callers share one permission prompt rather than racing to open the device.
   */
  const micSetupRef = useRef<Promise<boolean> | null>(null);
  // Every source currently scheduled on the audio thread, including ones that
  // have not started yet. Barge-in has to stop all of them, not just the audible
  // one, or interrupted speech keeps arriving after the user starts talking.
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  /** AudioContext time at which the next chunk should begin. */
  const nextStartTimeRef = useRef<number>(0);
  /** Pending timers that hand each chunk's text to the lip sync engine on cue. */
  const visemeTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const audioQueueRef = useRef<Array<{ audioData: Float32Array; sampleRate: number; text: string; phonemes: string; isLast: boolean }>>([]);
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

  const isInterruptedRef = useRef(false);

  const resumeVadIfAllowed = useCallback(() => {
    if (configRef.current.listenMode !== 'push-to-talk' && !isInterruptedRef.current) {
      vadRef.current?.start();
    }
  }, []);

  const clearWatchdog = useCallback(() => {
    if (playbackWatchdogRef.current) {
      clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }
  }, []);

  /** Drop the lip sync engine back to a closed mouth and forget the schedule. */
  const resetPlaybackState = useCallback(() => {
    currentSpeechTextRef.current = '';
    currentSpeechPhonemesRef.current = '';
    currentAudioDurationRef.current = 0;
    nextStartTimeRef.current = 0;
  }, []);

  /**
   * Get the AudioContext, creating it on first use.
   *
   * Deliberately synchronous, and deliberately called from inside the handlers
   * for whatever the user just did. Browsers start a context in the `suspended`
   * state unless it is constructed while a user gesture is being handled, so
   * building it during the click that starts a conversation is what lets the
   * first reply play without an extra tap. It also means a page that embeds an
   * avatar nobody talks to never opens an audio device at all.
   */
  const ensureAudioContext = useCallback((): AudioContext | null => {
    const existing = audioContextRef.current;
    if (existing) {
      if (existing.state === 'suspended') existing.resume();
      return existing;
    }

    if (typeof window === 'undefined') return null;
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) {
      console.warn('[AiVoiceAvatar] AudioContext is not supported in this browser, so speech cannot be played.');
      return null;
    }

    const ctx: AudioContext = new AudioCtxClass();
    audioContextRef.current = ctx;

    const outputAnalyser = ctx.createAnalyser();
    outputAnalyser.fftSize = 256;
    // Kept in a ref as well as state because the scheduler reads it in the same
    // tick it is created, and a state update has not landed by then.
    outputAnalyserRef.current = outputAnalyser;
    setAnalyser(outputAnalyser);

    return ctx;
  }, []);

  /**
   * Silence everything, immediately.
   *
   * Look-ahead scheduling means several sources can be queued on the audio
   * thread at once, so stopping only the audible one would let the rest play
   * over the user. Detach the ended handlers first, otherwise each stop() fires
   * onended and races the teardown.
   */
  const stopAllScheduledAudio = useCallback(() => {
    for (const source of scheduledSourcesRef.current) {
      source.onended = null;
      try { source.stop(); } catch (e) { /* never started, or already stopped */ }
      try { source.disconnect(); } catch (e) { /* already detached */ }
    }
    scheduledSourcesRef.current = [];

    for (const timer of visemeTimersRef.current) clearTimeout(timer);
    visemeTimersRef.current = [];

    audioQueueRef.current = [];
    isWaitingForMoreRef.current = false;
  }, []);

  /**
   * Settle back to idle once the whole schedule has drained.
   *
   * Called from every source's onended and after each scheduling pass. Event
   * latency is harmless here: arriving a few milliseconds late to the idle
   * transition costs nothing, unlike arriving late to start the next chunk.
   */
  const finishIfDrained = useCallback(() => {
    if (scheduledSourcesRef.current.length > 0) return;
    if (audioQueueRef.current.length > 0) return;

    if (isWaitingForMoreRef.current) {
      // More chunks are promised. Arm the watchdog so a stalled generator cannot
      // strand the pipeline in 'speaking' forever.
      if (!playbackWatchdogRef.current) {
        playbackWatchdogRef.current = setTimeout(() => {
          console.warn(
            `[AiVoiceAvatar] No further audio arrived within ${RESPONSE_STALL_TIMEOUT_MS}ms. ` +
            'Returning to idle and resuming listening.'
          );
          playbackWatchdogRef.current = null;
          isWaitingForMoreRef.current = false;
          resetPlaybackState();
          setStatus('idle');
          configRef.current.onInferenceEnd?.();
          resumeVadIfAllowed();
        }, RESPONSE_STALL_TIMEOUT_MS);
      }
      return;
    }

    clearWatchdog();
    resetPlaybackState();
    setStatus('idle');
    configRef.current.onInferenceEnd?.();
    resumeVadIfAllowed();
  }, [clearWatchdog, resetPlaybackState, resumeVadIfAllowed]);

  /**
   * Schedule every queued chunk against the audio clock.
   *
   * The previous implementation played one chunk and waited for its `onended`
   * event before creating the next and calling `start(0)`. That event is
   * dispatched on the main thread, which here is also running React and a 60fps
   * render loop, so the next chunk began some unpredictable number of
   * milliseconds after the previous one ended. With the sentence splitter firing
   * at five characters, one reply becomes many chunks and every boundary is an
   * audible seam.
   *
   * Instead, keep a running timestamp of when the next chunk should begin and
   * hand it to `start(when)`. The audio thread then stitches the buffers
   * sample-contiguously, and main thread jitter stops mattering. Chunks are
   * scheduled as soon as they arrive rather than when the previous one ends, so
   * several may be queued on the audio thread at once.
   */
  const scheduleQueuedAudio = useCallback(() => {
    // Creates the context if this is the first thing to make a sound. Audio can
    // arrive from a scripted `speak()` that no click preceded, and silently
    // dropping it would be worse than a context that starts suspended.
    const ctx = ensureAudioContext();
    if (!ctx) return;

    while (audioQueueRef.current.length > 0) {
      const item = audioQueueRef.current.shift()!;

      // Guard against zero-length or invalid chunks (e.g. text forwarded to the
      // other engine, or a phrase that sanitised down to nothing).
      if (!item.audioData || item.audioData.length === 0 || !item.sampleRate || item.sampleRate <= 0) {
        if (item.isLast) isWaitingForMoreRef.current = false;
        continue;
      }

      try {
        const buffer = ctx.createBuffer(1, item.audioData.length, item.sampleRate);
        buffer.copyToChannel(item.audioData as unknown as Float32Array<ArrayBuffer>, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const outputAnalyser = outputAnalyserRef.current;
        if (outputAnalyser) {
          source.connect(outputAnalyser);
          outputAnalyser.connect(ctx.destination);
        } else {
          source.connect(ctx.destination);
        }

        // Continue the existing schedule, unless generation fell behind playback,
        // in which case start just ahead of now rather than in the past. That gap
        // is real silence we had no audio for, not an artefact of our scheduling.
        const startAt = Math.max(ctx.currentTime + SCHEDULE_LEAD_SECONDS, nextStartTimeRef.current);
        source.start(startAt);
        nextStartTimeRef.current = startAt + buffer.duration;

        scheduledSourcesRef.current.push(source);
        clearWatchdog();

        // The lip sync engine reads these refs directly, so they must flip when
        // the chunk actually begins rather than when it is scheduled. A timer is
        // accurate to within a few milliseconds, which is imperceptible on a face.
        const startsInMs = Math.max(0, (startAt - ctx.currentTime) * 1000);
        const swapTimer = setTimeout(() => {
          visemeTimersRef.current = visemeTimersRef.current.filter(t => t !== swapTimer);
          currentSpeechTextRef.current = item.text;
          currentSpeechPhonemesRef.current = item.phonemes;
          currentAudioDurationRef.current = buffer.duration;
          playbackStartTimeRef.current = startAt;
          configRef.current.onSpeechStart?.(item.text);
        }, startsInMs);
        visemeTimersRef.current.push(swapTimer);

        source.onended = () => {
          try { source.disconnect(); } catch (e) { /* already torn down */ }
          scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
          if (item.isLast) isWaitingForMoreRef.current = false;
          finishIfDrained();
        };

        setStatus('speaking');
      } catch (playbackErr) {
        console.error('[AiVoiceAvatar] Could not schedule an audio chunk, skipping it:', playbackErr);
        if (item.isLast) isWaitingForMoreRef.current = false;
      }
    }

    finishIfDrained();
  }, [ensureAudioContext, clearWatchdog, finishIfDrained]);

  const handleSpeechOutput = useCallback((audioData: Float32Array, sampleRate: number, text: string, phonemes: string = '', isLast: boolean = true) => {
    if (isInterruptedRef.current) return;
    isWaitingForMoreRef.current = !isLast;
    audioQueueRef.current.push({ audioData, sampleRate, text, phonemes, isLast });
    scheduleQueuedAudio();
  }, [scheduleQueuedAudio]);

  const handleSpeechEnd = useCallback(() => {
    clearWatchdog();
    isWaitingForMoreRef.current = false;
    finishIfDrained();
  }, [clearWatchdog, finishIfDrained]);

  // Internal state to track active TTS engine, allowing graceful fallback if Kokoro OOMs on Safari
  const [activeTtsEngine, setActiveTtsEngine] = useState<'kokoro' | 'mms'>(() => {
    if (config.ttsEngine) return config.ttsEngine;

    if (isIOS()) return 'mms';

    if (typeof window !== 'undefined') {
      const priorCrashes = Number(localStorage.getItem(CRUMB) || 0);
      if (priorCrashes >= 2) {
        console.warn(`[AiVoiceAvatar] Detected ${priorCrashes} previous Kokoro init crashes. Downgrading to MMS.`);
        return 'mms';
      }
    }
    return 'kokoro';
  });
  const [hasFallenBack, setHasFallenBack] = useState(false);

  // Sync if parent explicitly changes it, but don't revert a fallback automatically unless it's a new instance
  useEffect(() => {
    if (!hasFallenBack && config.ttsEngine) {
      setActiveTtsEngine(config.ttsEngine);
    }
  }, [config.ttsEngine, hasFallenBack]);

  // ─── Kokoro TTS Worker (loaded lazily, only when engine === 'kokoro') ───
  const { isReady: isKokoroReady, synthesize: kokoroSynthesize, speechEnd: kokoroSpeechEnd, interrupt: kokoroInterrupt } = useKokoroWorker({
    enabled: activeTtsEngine === 'kokoro',
    voice: config.ttsVoice,
    onSpeechOutput: activeTtsEngine === 'kokoro' ? handleSpeechOutput : undefined,
    onSpeechEnd: activeTtsEngine === 'kokoro' ? handleSpeechEnd : undefined,
    loadingProgress: config.loadingProgress,
    workerBaseUrl: config.workerBaseUrl,
    onError: (_stage, msg) => {
      console.warn(`[AiVoiceAvatar] Kokoro engine failed (${msg}). Automatically falling back to MMS TTS for audio...`);
      setHasFallenBack(true);
      setActiveTtsEngine('mms');
    },
  });

  const crumbSetRef = useRef(false);
  useEffect(() => {
    if (activeTtsEngine !== 'kokoro' || typeof window === 'undefined') return;
    
    if (isKokoroReady) {
      localStorage.removeItem(CRUMB);
      crumbSetRef.current = false;
    } else if (!hasFallenBack && !crumbSetRef.current) {
      const priorCrashes = Number(localStorage.getItem(CRUMB) || 0);
      localStorage.setItem(CRUMB, String(priorCrashes + 1));
      crumbSetRef.current = true;
    }
  }, [activeTtsEngine, isKokoroReady, hasFallenBack]);

  // ─── ML Pipeline Worker (ASR + LLM + MMS-TTS) ───
  const { isReady: isMLReady, processAudio, processText, synthesizeText: mmsSynthesize, clearHistory, interrupt: mlInterrupt } = useMLWorker({
    llmModel: config.llmModel,
    asrModel: config.asrModel,
    asrLanguage: config.asrLanguage,
    onnxWasmPath: config.onnxWasmPath,
    workerBaseUrl: config.workerBaseUrl,
    ttsLanguage: config.ttsLanguage,
    ttsEngine: activeTtsEngine,
    ttsVoice: config.ttsVoice,
    fallbackMode: config.fallbackMode,
    lowMemoryMode: config.lowMemoryMode,
    systemPrompt: config.systemPrompt,
    loadLlm: !config.onSubmit, // Don't load local LLM if onSubmit is provided
    onCapabilityDetected: config.onCapabilityDetected,
    loadingProgress: config.loadingProgress,
    // Route text to Kokoro if Kokoro is active, otherwise play MMS audio
    onSpeechOutput: (audio, sampleRate, text, isLast) => {
      if (activeTtsEngine === 'kokoro') {
        kokoroSynthesize(text, isLast);
      } else if (audio && sampleRate) {
        handleSpeechOutput(audio, sampleRate, text, '', isLast);
      }
    },
    // Tokens arrive many times per second. Logging each one floods the console,
    // so this stays a no-op; consumers who want the stream use onTranscriptUpdate.
    onStreamWord: undefined,
    onSpeechEnd: () => {
      if (activeTtsEngine === 'kokoro') {
        kokoroSpeechEnd();
      } else {
        handleSpeechEnd();
      }
    },
    onTranscriptUpdate: (text, speaker) => {
      // Deliberately not logged: this is the content of the conversation, and it
      // used to be printed to the console on every turn. Consumers who want it
      // receive it through their own onTranscriptUpdate below.
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
            resumeVadIfAllowed();
          });
      }
    },
    onError: (_stage, _msg) => {
      setStatus('idle');
      configRef.current.onInferenceEnd?.();
      resumeVadIfAllowed();
    }
  });

  /**
   * Stop both synthesis workers.
   *
   * Held in a ref because the voice detection effect needs to call this on
   * barge-in, and adding the worker callbacks to that effect's dependencies
   * would tear down and re-request the microphone whenever they changed.
   */
  const stopWorkerGenerationRef = useRef<() => void>(() => {});
  useEffect(() => {
    stopWorkerGenerationRef.current = () => {
      try { mlInterrupt(); } catch (e) { /* worker already gone */ }
      try { kokoroInterrupt(); } catch (e) { /* worker already gone */ }
    };
  }, [mlInterrupt, kokoroInterrupt]);

  // Combined readiness
  const isReady = isMLReady && (activeTtsEngine !== 'kokoro' || isKokoroReady);

  // ─── Unified synthesizeText: routes to the correct TTS engine or cloud adapter ───
  const synthesizeText = useCallback(async (text: string, isLast: boolean = true) => {
    configRef.current.onTranscriptUpdate?.(text, 'avatar');
    
    // Cloud Adapter: Override local TTS
    if (configRef.current.onSynthesize) {
      try {
        const audioResult = await configRef.current.onSynthesize(text);
        let pcmData: Float32Array;
        let sampleRate = 24000; // Default assuming 24kHz for cloud standard, but decoded overrides this

        if (audioResult instanceof ArrayBuffer) {
          // Decode MP3/WAV from ArrayBuffer
          const ctx = ensureAudioContext();
          if (!ctx) throw new Error("AudioContext not ready");
          const decoded = await ctx.decodeAudioData(audioResult.slice(0)); // slice to prevent detaching original buffer if reused
          pcmData = decoded.getChannelData(0);
          sampleRate = decoded.sampleRate;
        } else {
          // Raw Float32Array PCM passed in
          pcmData = audioResult;
        }

        handleSpeechOutput(pcmData, sampleRate, text, '', isLast);
      } catch (err) {
        console.error('[AiVoiceAvatar] Cloud onSynthesize adapter failed:', err);
        setStatus('idle');
        configRef.current.onInferenceEnd?.();
        resumeVadIfAllowed();
      }
      return;
    }

    // Local fallback
    if (activeTtsEngine === 'kokoro' && isKokoroReady) {
      kokoroSynthesize(text, isLast);
    } else {
      mmsSynthesize(text, isLast);
    }
  }, [activeTtsEngine, isKokoroReady, kokoroSynthesize, mmsSynthesize, handleSpeechOutput, resumeVadIfAllowed, ensureAudioContext]);

  // Imperative speech triggering for external alerts or scripted turns
  const speak = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    if (!isReady) {
      console.warn('[AiVoiceAvatar] Cannot speak yet, AI models are still initializing. Ignored:', text);
      return;
    }
    isInterruptedRef.current = false;
    ensureAudioContext();
    setStatus('speaking');
    synthesizeText(text.trim(), true);
  }, [synthesizeText, isReady, ensureAudioContext]);

  // Imperative text submission skipping ASR, triggering normal pipeline/LLM
  const sendText = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    isInterruptedRef.current = false;
    // Typed input is a user gesture too, and the reply to it needs to be
    // audible without a second interaction to unlock the speakers.
    ensureAudioContext();
    setStatus('thinking');
    configRef.current.onInferenceStart?.();
    processText(text.trim(), !!configRef.current.onSubmit);
  }, [processText, ensureAudioContext]);

  useEffect(() => {
    if (isReady && status === 'loading') {
      setStatus('idle');
    } else if (!isReady && status === 'idle') {
      setStatus('loading');
    }
  }, [isReady, status]);

  /**
   * The voice detector's speech-end handler, held in a ref.
   *
   * The worker callbacks it needs change identity as the workers initialise.
   * Closing over them directly would give the microphone setup a changing
   * identity too, and re-running that would tear down the audio device and ask
   * the user for permission a second time in the middle of a conversation.
   */
  const handleVadSpeechEndRef = useRef<(audio: Float32Array) => void>(() => {});
  useEffect(() => {
    handleVadSpeechEndRef.current = async (audio: Float32Array) => {
      setStatus('thinking');
      configRef.current.onInferenceStart?.();
      vadRef.current?.pause();

      // Cloud adapter: override local ASR.
      if (configRef.current.onTranscribe) {
        try {
          const text = await configRef.current.onTranscribe(audio);
          if (text && text.trim()) {
            // Pipe the text into the standard LLM / onSubmit flow
            configRef.current.onTranscriptUpdate?.(text, 'user');
            processText(text, !!configRef.current.onSubmit);
          } else {
            setStatus('idle');
            configRef.current.onInferenceEnd?.();
            resumeVadIfAllowed();
          }
        } catch (err) {
          console.error('[AiVoiceAvatar] Cloud onTranscribe adapter failed:', err);
          setStatus('idle');
          configRef.current.onInferenceEnd?.();
          resumeVadIfAllowed();
        }
        return;
      }

      const langCode = configRef.current.asrLanguage === 'hi-IN' ? 'hi' :
                       configRef.current.asrLanguage?.split('-')[0] || 'en';

      processAudio(audio, langCode, !!configRef.current.onSubmit);
    };
  }, [processAudio, processText, resumeVadIfAllowed]);

  /**
   * Open the microphone and start voice activity detection, once.
   *
   * This used to run in a mount effect, so a visitor was asked for microphone
   * permission before they had clicked anything or read a word about what the
   * page does. Browsers raise that prompt the moment it is requested, and a
   * prompt nobody asked for is the quickest way to lose someone on a page they
   * are still deciding about. It now happens on the first deliberate attempt to
   * speak.
   *
   * Resolves true once the microphone is live. A successful setup is cached so
   * concurrent callers share one prompt; a failed one is discarded so that
   * someone who fixes their permissions in browser settings can recover by
   * clicking again rather than by reloading the page. Retrying costs nothing,
   * because a browser that has recorded a denial declines without re-prompting.
   */
  const ensureMicrophone = useCallback((): Promise<boolean> => {
    if (micSetupRef.current) return micSetupRef.current;

    const setup = (async (): Promise<boolean> => {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return false; // Next.js SSR guard
      if (!navigator?.mediaDevices?.getUserMedia) {
        const errMsg = 'Microphone API not available (secure HTTPS context or localhost required).';
        console.warn(`[AiVoiceAvatar] ${errMsg}`);
        if (!isUnmountedRef.current) setMicError(errMsg);
        return false;
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

        // The hook went away while the permission dialog was open.
        if (isUnmountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return false;
        }

        setMicError(null);
        mediaStreamRef.current = stream;

        const audioCtx = ensureAudioContext();
        if (!audioCtx) {
          // Nothing can be done with a live microphone and no audio graph, and
          // leaving it open would keep the browser's recording indicator lit.
          stream.getTracks().forEach(t => t.stop());
          mediaStreamRef.current = null;
          return false;
        }

        const mAnalyser = audioCtx.createAnalyser();
        mAnalyser.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(mAnalyser);
        // Deliberately not connected to the destination, which would feed the
        // microphone back out through the speakers.
        micAnalyserRef.current = mAnalyser;

        // @ricky0123/vad-web is CJS, so the shape of the namespace depends on whether
        // the consumer's bundler pre-bundled it: named exports may sit directly on the
        // namespace or be nested under `default`. Accept both.
        const vadModule: any = await import('@ricky0123/vad-web');
        const vad = vadModule?.MicVAD ? vadModule : (vadModule?.default ?? vadModule);
        const myvad = await vad.MicVAD.new({
          getStream: () => Promise.resolve(stream),
          audioContext: audioCtx,
          baseAssetPath: configRef.current.vadAssetPath || "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
          onnxWASMBasePath: configRef.current.onnxWasmPath || "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/",
          onSpeechStart: () => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return; // Should be paused anyway

            setStatus('listening');

            // Barge-in: the user started talking, so drop whatever the avatar
            // was about to say. Stopping playback alone is not enough, because
            // the workers keep generating and the next chunk would arrive and
            // play straight over the user.
            const wasSpeaking = scheduledSourcesRef.current.length > 0;
            clearWatchdog();
            stopAllScheduledAudio();
            resetPlaybackState();
            stopWorkerGenerationRef.current();
            if (wasSpeaking) {
              configRef.current.onUserInterrupt?.();
            }
          },
          onSpeechEnd: (audio: Float32Array) => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return;
            handleVadSpeechEndRef.current(audio);
          },
          startOnLoad: false
        });

        if (isUnmountedRef.current) {
          try { myvad.destroy(); } catch (e) { /* nothing to tear down */ }
          return false;
        }

        vadRef.current = myvad;
        return true;
      } catch (err) {
        console.error('[AiVoiceAvatar] Could not start the microphone:', err);
        if (!isUnmountedRef.current) {
          setMicError('Microphone access denied or unavailable. Please enable permissions in browser settings.');
        }
        return false;
      }
    })();

    micSetupRef.current = setup;
    // Forget a failed attempt so the next deliberate click can try again.
    setup.then(ok => {
      if (!ok && micSetupRef.current === setup) micSetupRef.current = null;
    });
    return setup;
  }, [ensureAudioContext, clearWatchdog, stopAllScheduledAudio, resetPlaybackState]);

  // Release audio devices when the hook goes away. Deliberately dependency-free:
  // this must run on unmount and at no other time, because anything that makes
  // it re-run closes a live microphone mid-conversation.
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
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
      stopAllScheduledAudio();
      try {
        audioContextRef.current?.close();
      } catch (e) {}
      try {
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      } catch (e) {}
    };
  }, [stopAllScheduledAudio]);


  const startListening = useCallback(async () => {
    isInterruptedRef.current = false;
    if (!isReady) return;

    // Synchronous, and first, so the context is constructed while the browser
    // still considers itself inside the user gesture that led here.
    ensureAudioContext();

    // Opening the microphone is what actually asks for permission, so the first
    // call here is where the prompt appears. Everything after it waits.
    const micReady = await ensureMicrophone();
    if (!micReady || !vadRef.current || isUnmountedRef.current) return;

    vadRef.current.start();
    setStatus('listening');
  }, [isReady, ensureAudioContext, ensureMicrophone]);

  const stopListening = useCallback(() => {
    isInterruptedRef.current = true;
    vadRef.current?.pause();
    setStatus('idle');
  }, []);

  const interrupt = useCallback(() => {
    isInterruptedRef.current = true;
    clearWatchdog();
    stopAllScheduledAudio();
    resetPlaybackState();
    configRef.current.onUserInterrupt?.();
    setStatus('idle');
    vadRef.current?.pause(); // ensure VAD is stopped

    // Immediately stop worker synthesis
    try { mlInterrupt(); } catch(e) {}
    try { kokoroInterrupt(); } catch(e) {}
  }, [mlInterrupt, kokoroInterrupt, clearWatchdog, stopAllScheduledAudio, resetPlaybackState]);

  // Audio polling loop for onAudioLevelChange callback
  useEffect(() => {
    const loop = () => {
      animationFrameRef.current = requestAnimationFrame(loop);
      
      const onLevelChange = configRef.current.onAudioLevelChange;
      if (!onLevelChange) return;

      const currentStatus = statusRef.current;
      let activeAnalyser: AnalyserNode | null | undefined = null;
      let sourceContext: 'mic' | 'tts' | 'idle' = 'idle';

      if (currentStatus === 'speaking' && analyser) {
        activeAnalyser = analyser;
        sourceContext = 'tts';
      } else if (currentStatus === 'listening' && micAnalyserRef.current) {
        activeAnalyser = micAnalyserRef.current;
        sourceContext = 'mic';
      }

      if (activeAnalyser) {
        const dataArray = new Uint8Array(activeAnalyser.frequencyBinCount);
        activeAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const normalized = Math.min(1, average / 128); // Normalize 0-1
        
        onLevelChange(normalized, sourceContext as 'mic' | 'tts');
      } else {
        // Broadcast 0 when idle so HUD can collapse smoothly
        onLevelChange(0, 'idle' as 'tts');
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [analyser]);

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
    sendText,
    currentSpeechTextRef,
    currentSpeechPhonemesRef,
    currentAudioDurationRef,
    playbackStartTimeRef,
    audioContextRef,
  };
}
