import { useEffect, useRef, useState, useCallback } from 'react';
import { useMLWorker } from './useMLWorker';
import { useKokoroWorker } from './useKokoroWorker';
import type { AiVoiceAvatarCapabilities, AiVoiceAvatarError, AiVoiceAvatarErrorStage } from '../types';
import { isIOS } from '../lib/device';
import { nextStatus, type TurnEvent, type TurnStatus } from '../lib/turnState';

const CRUMB = 'rava:kokoro-init-crashed';

/**
 * How far ahead of "now" a chunk is scheduled when starting a fresh utterance,
 * or recovering after generation fell behind playback. Long enough to survive a
 * busy main thread, short enough not to be heard as latency.
 */
const SCHEDULE_LEAD_SECONDS = 0.06;

/**
 * The engine's internal stage names, mapped to the coarser public ones.
 *
 * Internal names distinguish things a host app cannot act on, such as which of
 * several worker spawn strategies failed. Anything unlisted is reported as a
 * worker fault, which is where unrecognised failures come from in practice.
 */
const PUBLIC_ERROR_STAGE: Record<string, AiVoiceAvatarErrorStage> = {
  microphone: 'microphone',
  asr: 'speech-recognition',
  llm: 'language-model',
  pipeline: 'conversation',
  init: 'worker',
  'kokoro-init': 'speech-synthesis',
  'kokoro-message': 'speech-synthesis',
  'kokoro-worker': 'speech-synthesis',
  'kokoro-worker-construct': 'speech-synthesis',
  'ml-worker-construct': 'worker',
  'ml-worker-init': 'worker',
  'ml-worker-message': 'worker',
};

/**
 * How the voice detector decides what counts as someone talking.
 *
 * The library's own defaults are tuned to catch everything, which in a room
 * with any life in it means catching coughs, doors and chairs. Silero returns a
 * speech probability per frame, and a cough scores lower than talking does, so
 * asking for more confidence is what separates them. The shipped default of 0.3
 * is well below the 0.5 Silero itself suggests.
 *
 * `redemptionMs` is the one that decides how natural a conversation feels: it is
 * how long a silence runs before the turn is considered over. Kept generous, so
 * thinking mid-sentence, or an "erm" between two halves of a request, does not
 * hand the floor back before someone has finished.
 */
const SPEECH_DETECTION_DEFAULTS = {
  /** Confidence required to call a frame speech. Raise it in a noisy room. */
  positiveSpeechThreshold: 0.5,
  /** Confidence below which a frame is silence. Silero suggests 0.15 under the above. */
  negativeSpeechThreshold: 0.35,
  /** Silence before a turn ends. Long enough to pause for thought mid-sentence. */
  redemptionMs: 1400,
  /** Runs shorter than this are discarded as noise rather than transcribed. */
  minSpeechMs: 500,
  /** Audio kept from before the trigger, so the first syllable is not clipped. */
  preSpeechPadMs: 800,
};

/** How long to wait for promised audio that never arrives before recovering. */
const RESPONSE_STALL_TIMEOUT_MS = 10000;

/**
 * What we ask the browser for when opening the microphone.
 *
 * Named because the device may be reopened later — the detector releases it
 * while paused — and the second request has to match the first, or the meter
 * and the detector end up reading differently processed audio.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true,
  },
};

export interface UseAiVoiceAvatarConfig {
  /**
   * Whether to download and start the speech, language and voice models.
   * Defaults to true.
   *
   * Set it false to render an avatar nobody has engaged with yet — on a landing
   * page, or in a widget most visitors never open — and flip it true when they
   * do. The models are hundreds of megabytes; a page should not spend that on
   * someone who only scrolled past. Status stays `'loading'` until it is true
   * and the models are up, so show your own call to action in the meantime.
   */
  loadModels?: boolean;
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
  /**
   * Called when something in the pipeline fails.
   *
   * Check `severity` before reacting: most failures here are survivable because
   * the engine falls back, and treating a `degraded` report as fatal would hide
   * a working avatar behind an error screen.
   */
  onError?: (error: AiVoiceAvatarError) => void;
  onCapabilityDetected?: (caps: AiVoiceAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  vadAssetPath?: string;
  onnxWasmPath?: string;
  workerBaseUrl?: string;
  /** `'vad'` is the former name for `'continuous'` and still works. */
  listenMode?: 'continuous' | 'push-to-talk' | 'vad';
  /**
   * Let the user talk over the avatar and cut it off mid-sentence. On by
   * default, because waiting for a reply to finish is the thing that makes a
   * voice agent feel like a walkie-talkie.
   *
   * Turn it off for a kiosk or a noisy room, where the avatar hearing its own
   * voice through the speakers and stopping itself is worse than waiting.
   * Ignored in push-to-talk, which owns the floor explicitly.
   */
  allowInterruption?: boolean;
  /**
   * Tuning for the voice detector. Every field is optional.
   *
   * Raise `positiveSpeechThreshold` in a noisy room so passing sounds are not
   * mistaken for talking, and lower it if quiet speakers go unheard. Raise
   * `redemptionMs` if people are being cut off while they think mid-sentence,
   * lower it if replies feel slow to start. `minSpeechMs` discards runs too
   * short to be words before they reach transcription, which matters because
   * speech recognition given a noise invents words rather than returning none.
   */
  speechDetection?: {
    positiveSpeechThreshold?: number;
    negativeSpeechThreshold?: number;
    redemptionMs?: number;
    minSpeechMs?: number;
    preSpeechPadMs?: number;
  };
  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onSpeechStart?: (text: string) => void;
  /**
   * Loudness of whichever side currently holds the floor, once per frame.
   *
   * `source` says which side that is. It has always been able to be `'idle'` —
   * the callback fires with a level of 0 between turns so a meter can fall to
   * rest rather than freeze — but the type used to claim otherwise.
   */
  onAudioLevelChange?: (level: number, source: 'mic' | 'tts' | 'idle') => void;
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
  const [status, setStatus] = useState<TurnStatus>('loading');
  const [analyser, setAnalyser] = useState<AnalyserNode | undefined>(undefined);
  const [micError, setMicError] = useState<string | null>(null);
  
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  /**
   * The graph node feeding the microphone meter, kept so it can be detached
   * when the device is reopened. Without this the old node stays connected to
   * a dead stream and the meter reads a device nobody is talking into.
   */
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const vadRef = useRef<any | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  /**
   * A second context for input only.
   *
   * Pausing a reply suspends the playback context, and a suspended context
   * freezes every graph on it. With the microphone meter sharing that context it
   * went flat for the whole time a user was speaking over the avatar, which is
   * exactly when a host app most wants to draw it. Input never suspends.
   */
  const inputContextRef = useRef<AudioContext | null>(null);
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
  /**
   * Pending lip sync cues, each holding the audio-clock time it belongs to and
   * what it does, so a cue can be re-armed after playback is paused and resumed.
   */
  const visemeTimersRef = useRef<Array<{
    timer: ReturnType<typeof setTimeout>;
    startAt: number;
    apply: () => void;
  }>>([]);
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

  /**
   * Move the conversation on, if this event is legal where we are.
   *
   * Every status change goes through here. The functional form of setState
   * matters: these events arrive from timers, workers and a voice detector, so
   * the status at the moment one is applied is often not the status the caller
   * closed over. Reading it inside the updater is what makes a late event judge
   * itself against the present rather than the past.
   */
  const advance = useCallback((event: TurnEvent) => {
    setStatus(current => nextStatus(current, event) ?? current);
  }, []);


  const resumeVadIfAllowed = useCallback(() => {
    if (configRef.current.listenMode !== 'push-to-talk' && !isInterruptedRef.current) {
      vadRef.current?.start();
    }
  }, []);

  /**
   * Report a failure to the host application.
   *
   * Everything that can fail routes through here so a host has one place to
   * listen and one shape to handle, rather than a console message it cannot
   * see and a status pill it cannot style.
   */
  const reportError = useCallback((
    stage: string,
    message: string,
    severity: AiVoiceAvatarError['severity'],
  ) => {
    configRef.current.onError?.({
      stage: PUBLIC_ERROR_STAGE[stage] ?? 'worker',
      severity,
      message,
      detail: stage,
    });
  }, []);

  /**
   * True when the user may talk over the avatar.
   *
   * Push-to-talk owns the floor explicitly, so interruption means nothing there.
   * Otherwise it follows `allowInterruption`, which defaults on.
   */
  const allowsInterruption = useCallback((): boolean => {
    if (configRef.current.listenMode === 'push-to-talk') return false;
    return configRef.current.allowInterruption !== false;
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
      const errMsg = 'AudioContext is not supported in this browser, so speech cannot be played.';
      console.warn(`[AiVoiceAvatar] ${errMsg}`);
      configRef.current.onError?.({
        stage: 'audio-output', severity: 'fatal', message: errMsg, detail: 'audio-context',
      });
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
   * Pause the reply without discarding it.
   *
   * The detector announces speech the moment a sound crosses its threshold, and
   * only decides later whether that sound was really speech. Tearing the reply
   * down on the announcement meant a cough killed the answer outright.
   *
   * Suspending the audio context stops the sound instantly and keeps everything
   * recoverable: scheduled chunks hold their places, and because the lip sync
   * reads the audio clock, the mouth freezes with the voice rather than running
   * on ahead. Only the lip sync cues need handling by hand, since they are
   * wall-clock timers that would otherwise fire during the pause.
   */
  const suspendPlayback = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;
    for (const cue of visemeTimersRef.current) clearTimeout(cue.timer);
    ctx.suspend().catch(() => { /* already suspended or closed */ });
  }, []);

  /**
   * Continue a reply that a false trigger paused.
   *
   * Cues are re-armed against the audio clock rather than restored to their old
   * delays: the clock did not advance while suspended, so the remaining wait is
   * simply the distance from now to where each cue belongs.
   */
  const resumePlayback = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'suspended') return;
    ctx.resume()
      .then(() => {
        for (const cue of visemeTimersRef.current) {
          cue.timer = setTimeout(cue.apply, Math.max(0, (cue.startAt - ctx.currentTime) * 1000));
        }
      })
      .catch(() => { /* context closed under us */ });
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

    for (const cue of visemeTimersRef.current) clearTimeout(cue.timer);
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

    // An interrupted turn has already been given whatever state belongs to it:
    // 'listening' if the user spoke over the avatar, 'idle' if they stopped it
    // deliberately. Draining the leftovers of the abandoned reply must not
    // overwrite that, or a late completion event drops someone back to idle in
    // the middle of their own sentence.
    if (isInterruptedRef.current) {
      clearWatchdog();
      resetPlaybackState();
      return;
    }

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
          advance('reply-stalled');
          configRef.current.onInferenceEnd?.();
          resumeVadIfAllowed();
        }, RESPONSE_STALL_TIMEOUT_MS);
      }
      return;
    }

    clearWatchdog();
    resetPlaybackState();
    advance('reply-finished');
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
        const apply = () => {
          visemeTimersRef.current = visemeTimersRef.current.filter(c => c.apply !== apply);
          currentSpeechTextRef.current = item.text;
          currentSpeechPhonemesRef.current = item.phonemes;
          currentAudioDurationRef.current = buffer.duration;
          playbackStartTimeRef.current = startAt;
          configRef.current.onSpeechStart?.(item.text);
        };
        const startsInMs = Math.max(0, (startAt - ctx.currentTime) * 1000);
        visemeTimersRef.current.push({ timer: setTimeout(apply, startsInMs), startAt, apply });

        source.onended = () => {
          try { source.disconnect(); } catch (e) { /* already torn down */ }
          scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
          if (item.isLast) isWaitingForMoreRef.current = false;
          finishIfDrained();
        };

        advance('reply-audio-started');
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

  const loadModels = config.loadModels !== false;

  // ─── Kokoro TTS Worker (loaded lazily, only when engine === 'kokoro') ───
  const { isReady: isKokoroReady, synthesize: kokoroSynthesize, speechEnd: kokoroSpeechEnd, interrupt: kokoroInterrupt } = useKokoroWorker({
    enabled: loadModels && activeTtsEngine === 'kokoro',
    voice: config.ttsVoice,
    language: config.ttsLanguage,
    onSpeechOutput: activeTtsEngine === 'kokoro' ? handleSpeechOutput : undefined,
    onSpeechEnd: activeTtsEngine === 'kokoro' ? handleSpeechEnd : undefined,
    loadingProgress: config.loadingProgress,
    workerBaseUrl: config.workerBaseUrl,
    onError: (stage, msg) => {
      console.warn(`[AiVoiceAvatar] Kokoro engine failed (${msg}). Automatically falling back to MMS TTS for audio...`);
      setHasFallenBack(true);
      setActiveTtsEngine('mms');
      // Degraded, not fatal: the avatar still speaks, in a plainer voice.
      reportError(stage, `Kokoro voice engine failed, using the fallback voice instead: ${msg}`, 'degraded');
    },
  });

  const crumbSetRef = useRef(false);
  useEffect(() => {
    // The breadcrumb counts page loads that began loading Kokoro and never
    // finished, as evidence of a crash. A deferred avatar has not begun, so
    // counting it would read two unengaged visits as two crashes and quietly
    // downgrade the voice for good.
    if (!loadModels) return;
    if (activeTtsEngine !== 'kokoro' || typeof window === 'undefined') return;
    
    if (isKokoroReady) {
      localStorage.removeItem(CRUMB);
      crumbSetRef.current = false;
    } else if (!hasFallenBack && !crumbSetRef.current) {
      const priorCrashes = Number(localStorage.getItem(CRUMB) || 0);
      localStorage.setItem(CRUMB, String(priorCrashes + 1));
      crumbSetRef.current = true;
    }
  }, [loadModels, activeTtsEngine, isKokoroReady, hasFallenBack]);

  // ─── ML Pipeline Worker (ASR + LLM + MMS-TTS) ───
  const { isReady: isMLReady, processAudio, processText, synthesizeText: mmsSynthesize, clearHistory, interrupt: mlInterrupt } = useMLWorker({
    enabled: loadModels,
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
            advance('pipeline-failed');
            configRef.current.onInferenceEnd?.();
            resumeVadIfAllowed();
          });
      }
    },
    onError: (stage, msg) => {
      advance('pipeline-failed');
      reportError(stage, msg, 'fatal');
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
        advance('pipeline-failed');
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
    advance('speak-requested');
    synthesizeText(text.trim(), true);
  }, [synthesizeText, isReady, ensureAudioContext]);

  // Imperative text submission skipping ASR, triggering normal pipeline/LLM
  const sendText = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    isInterruptedRef.current = false;
    // Typed input is a user gesture too, and the reply to it needs to be
    // audible without a second interaction to unlock the speakers.
    ensureAudioContext();
    advance('text-submitted');
    configRef.current.onInferenceStart?.();
    processText(text.trim(), !!configRef.current.onSubmit);
  }, [processText, ensureAudioContext]);

  // Readiness announces itself and the rules decide what it means. This used to
  // read `status` and depend on it, which re-ran the effect on every turn of
  // every conversation to ask a question about model loading. The transition
  // table already refuses both events everywhere they would be wrong, so the
  // guards here were duplicating rules that now live in one place.
  useEffect(() => {
    advance(isReady ? 'models-ready' : 'models-unready');
  }, [isReady, advance]);

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
      // The user has finished speaking, so a reply is wanted again. This
      // reopens the gate that barge-in closed; leaving it shut would silence
      // the answer to the very sentence that interrupted.
      isInterruptedRef.current = false;

      // Confirmed speech, so the reply that was paused is genuinely unwanted.
      // The audio context is resumed because the next reply plays through it;
      // the chunks queued behind it are dropped first so none of the old one
      // survives into the new turn.
      stopAllScheduledAudio();
      resetPlaybackState();
      stopWorkerGenerationRef.current();
      resumePlayback();

      advance('user-stopped-speaking');
      configRef.current.onInferenceStart?.();

      // Whether the microphone keeps listening while the avatar answers is the
      // difference between a conversation and a walkie-talkie. Pausing it here
      // made interruption impossible: the detector was deaf for the whole reply,
      // so the barge-in path below could never fire during one.
      //
      // It is paused only when interruption is switched off, or in push-to-talk,
      // where the user takes the floor explicitly anyway.
      if (!allowsInterruption()) {
        vadRef.current?.pause();
      }

      // Cloud adapter: override local ASR.
      if (configRef.current.onTranscribe) {
        try {
          const text = await configRef.current.onTranscribe(audio);
          if (text && text.trim()) {
            // Pipe the text into the standard LLM / onSubmit flow
            configRef.current.onTranscriptUpdate?.(text, 'user');
            processText(text, !!configRef.current.onSubmit);
          } else {
            advance('pipeline-failed');
            configRef.current.onInferenceEnd?.();
            resumeVadIfAllowed();
          }
        } catch (err) {
          console.error('[AiVoiceAvatar] Cloud onTranscribe adapter failed:', err);
          advance('pipeline-failed');
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
        if (!isUnmountedRef.current) {
          setMicError(errMsg);
          reportError('microphone', errMsg, 'fatal');
        }
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);

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

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const inputCtx: AudioContext = inputContextRef.current ?? new AudioCtxClass();
        inputContextRef.current = inputCtx;

        const mAnalyser = inputCtx.createAnalyser();
        mAnalyser.fftSize = 256;
        micAnalyserRef.current = mAnalyser;

        /** Point the level meter at whichever stream is currently live. */
        const meterOn = (live: MediaStream) => {
          try { micSourceRef.current?.disconnect(); } catch (e) { /* already detached */ }
          const source = inputCtx.createMediaStreamSource(live);
          // Deliberately not connected to the destination, which would feed the
          // microphone back out through the speakers.
          source.connect(mAnalyser);
          micSourceRef.current = source;
        };
        meterOn(stream);

        /**
         * Hand the detector a live microphone, reopening the device if the one
         * we have has been stopped.
         *
         * The detector releases the microphone whenever it is paused, and its
         * own default for resuming is to call getUserMedia again and keep the
         * result to itself. That left this hook holding a stream whose tracks
         * had ended: the level meter read a dead device for the rest of the
         * session, and teardown stopped tracks that were already stopped while
         * the detector's replacement stayed open. Minting the replacement here
         * keeps one stream authoritative, and rewires the meter to it.
         */
        const acquireStream = async (): Promise<MediaStream> => {
          const held = mediaStreamRef.current;
          if (held?.getAudioTracks().some(t => t.readyState === 'live')) return held;

          const fresh = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
          if (isUnmountedRef.current) {
            fresh.getTracks().forEach(t => t.stop());
            return fresh;
          }
          mediaStreamRef.current = fresh;
          meterOn(fresh);
          return fresh;
        };

        // @ricky0123/vad-web is CJS, so the shape of the namespace depends on whether
        // the consumer's bundler pre-bundled it: named exports may sit directly on the
        // namespace or be nested under `default`. Accept both.
        const vadModule: any = await import('@ricky0123/vad-web');
        const vad = vadModule?.MicVAD ? vadModule : (vadModule?.default ?? vadModule);
        const myvad = await vad.MicVAD.new({
          getStream: acquireStream,
          resumeStream: acquireStream,
          // Deliberately not given our audio context, so it builds its own.
          //
          // Pausing a reply suspends the playback context, and a suspended
          // context stops every graph on it. Sharing one meant suspending
          // playback also deafened the detector: it could never report that the
          // sound had ended, so the conversation stuck on 'listening' forever.
          // Two contexts cost a little memory and keep hearing independent of
          // speaking, which is what they are.
          baseAssetPath: configRef.current.vadAssetPath || "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
          onnxWASMBasePath: configRef.current.onnxWasmPath || "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/",
          ...SPEECH_DETECTION_DEFAULTS,
          ...(configRef.current.speechDetection ?? {}),
          /**
           * A single frame crossed the threshold. That is all this means.
           *
           * One frame is 96ms, and a cough, a door or a chair clears that bar
           * as easily as a word does. So nothing here commits: the avatar's
           * voice ducks, instantly and reversibly, and the conversation is left
           * exactly where it was. Whether anyone actually spoke is decided by
           * the two handlers below, one of which always follows this one.
           */
          onSpeechStart: () => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return; // Should be paused anyway

            clearWatchdog();
            suspendPlayback();
          },

          /**
           * The sound has lasted long enough to be speech. Now it counts.
           *
           * Everything that changes the conversation waited for this, because
           * up to here a noise and a word are indistinguishable. The detector
           * only reaches this point once `minSpeechMs` of speech frames have
           * accumulated, and it is exactly the condition under which the sound
           * will later be handed over as audio rather than withdrawn — so a
           * turn taken here is always a turn that gets transcribed.
           *
           * This is what stops a cough rewriting the conversation. Tuning
           * thresholds only ever changed how loud a noise had to be; requiring
           * it to sustain is what actually separates a noise from a sentence.
           */
          onSpeechRealStart: () => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return;

            // Whether the avatar had the floor. Its audio is suspended rather
            // than stopped, so the schedule is still standing here.
            const wasSpeaking = scheduledSourcesRef.current.length > 0;

            // Mark the turn interrupted so a chunk already in flight cannot
            // schedule itself and start the avatar talking over the user.
            // Stopping the workers is a message, not an instruction that has
            // already taken effect. Cleared when the turn resolves, either way.
            isInterruptedRef.current = true;

            advance('user-started-speaking');

            if (wasSpeaking) {
              configRef.current.onUserInterrupt?.();
            }
          },
          onSpeechEnd: (audio: Float32Array) => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return;
            handleVadSpeechEndRef.current(audio);
          },
          /**
           * The sound stopped before it ever became speech. A cough, in short.
           *
           * The detector runs this *instead of* onSpeechEnd and discards the
           * audio, and it only reaches here when onSpeechRealStart never fired.
           * So nothing was committed: the status never moved, the turn was
           * never marked interrupted, and the workers were never stopped.
           * Lifting the duck is the whole of the recovery.
           *
           * This handler used to carry the burden of undoing a half-taken turn,
           * and each thing it forgot to undo was a bug that outlived the cough
           * — a status stuck on 'listening', or a reply gate left shut so every
           * later answer was silently dropped. There is nothing to forget now.
           */
          onVADMisfire: () => {
            if (isUnmountedRef.current) return;
            if (configRef.current.listenMode === 'push-to-talk') return;

            resumePlayback();
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
          const errMsg = 'Microphone access denied or unavailable. Please enable permissions in browser settings.';
          setMicError(errMsg);
          // Fatal for listening, but typed input still works, so a host may
          // prefer to offer that rather than block the whole experience.
          reportError('microphone', errMsg, 'fatal');
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
  }, [ensureAudioContext, clearWatchdog, reportError, suspendPlayback, resumePlayback, advance]);

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
        micSourceRef.current?.disconnect();
      } catch (e) {}
      try {
        audioContextRef.current?.close();
      } catch (e) {}
      try {
        inputContextRef.current?.close();
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
    advance('listen-requested');
  }, [isReady, ensureAudioContext, ensureMicrophone]);

  const stopListening = useCallback(() => {
    isInterruptedRef.current = true;
    vadRef.current?.pause();
    advance('stop-requested');
  }, [advance]);

  const interrupt = useCallback(() => {
    isInterruptedRef.current = true;
    clearWatchdog();
    stopAllScheduledAudio();
    resetPlaybackState();
    configRef.current.onUserInterrupt?.();
    advance('stop-requested');
    vadRef.current?.pause(); // ensure VAD is stopped

    // Immediately stop worker synthesis
    try { mlInterrupt(); } catch(e) {}
    try { kokoroInterrupt(); } catch(e) {}
  }, [mlInterrupt, kokoroInterrupt, clearWatchdog, stopAllScheduledAudio, resetPlaybackState]);

  // Audio polling loop for onAudioLevelChange callback
  useEffect(() => {
    // Reused across frames. Allocating this inside the loop meant a new array
    // sixty times a second for the lifetime of the page, which is a steady
    // drip of garbage for a number that fits in a register.
    let spectrum: Uint8Array<ArrayBuffer> | null = null;

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
        const bins = activeAnalyser.frequencyBinCount;
        if (!spectrum || spectrum.length !== bins) spectrum = new Uint8Array(bins);
        activeAnalyser.getByteFrequencyData(spectrum);

        let sum = 0;
        for (let i = 0; i < bins; i++) {
          sum += spectrum[i];
        }
        const average = sum / bins;
        const normalized = Math.min(1, average / 128); // Normalize 0-1

        onLevelChange(normalized, sourceContext);
      } else {
        // Broadcast 0 when idle so HUD can collapse smoothly
        onLevelChange(0, 'idle');
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
