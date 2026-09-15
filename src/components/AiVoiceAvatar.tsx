import React, { forwardRef, useEffect, useState, useRef, useImperativeHandle, Suspense } from 'react';
import { ThreeElements, useFrame } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { resolveAvatarUrl } from '../lib/avatarAssets';
import { StatusPill } from './StatusPill';
import { useAiVoiceAvatar } from '../hooks/useAiVoiceAvatar';
import { AudioLipSync } from '../lib/audioLipSync';

const LazyLevaDebugPanel = React.lazy(() => import('./LevaDebugPanel'));
import { PhonemeTimingEngine, blendAudioAndText } from '../lib/phonemeTiming';
import { AvatarDynamicsEngine } from '../lib/avatarDynamics';
import type { VisemeWeights } from '../lib/visemeTable';

// Re-exported from ../types so the headless entry never pulls in this module.
export type { AiVoiceAvatarCapabilities, AiVoiceAvatarError, AiVoiceAvatarErrorStage } from '../types';
import type { AiVoiceAvatarCapabilities, AiVoiceAvatarError } from '../types';

export interface AiVoiceAvatarHandle {
  clearHistory: () => void;
  interrupt: () => void;
  /** Begin listening. Resolves once the microphone is live, or has failed. */
  startListening: () => Promise<void>;
  stopListening: () => void;
  speak: (text: string) => void;
  sendText: (text: string, options?: { hidden?: boolean }) => void;
  getAnalyser: () => AnalyserNode | undefined;
  status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
  isLoading: boolean;
  isIdle: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  micError: string | null;
}

export interface AiVoiceAvatarProps extends Omit<ThreeElements['group'], 'children'> {
  modelSrc?: string;
  avatarPreset?: 'ananya' | 'aarav' | 'default' | 'kiosk';
  visemeMap?: Record<string, string>;
  /**
   * @deprecated No longer has any effect. It used to control a second ambient
   * light that sat outside the preset system and double-lit every scene. Use
   * `lightingPreset` instead, which owns all of the lighting.
   */
  environmentPreset?: 'studio' | 'none';
  /** Pre-built cinematic studio lighting presets for zero-config visual atmospheres */
  lightingPreset?: 'studio' | 'cyberpunk_violet' | 'cool_azure' | 'warm_amber' | 'clean_white' | 'none';
  /** Intuitive size preset or custom numerical scale multiplier ('sm' | 'md' | 'lg' | number) */
  avatarSize?: 'sm' | 'md' | 'lg' | number;

  systemPrompt?: string;
  /**
   * Local text generation model, used only when `onSubmit` is absent. Defaults
   * by language: Qwen2.5-0.5B for English, Gemma 3 1B for Hindi, which needs
   * the larger model to produce correct Hindi at all.
   */
  llmModel?: string;
  /**
   * Language for the built-in speech engines.
   *
   * With `ttsEngine: 'kokoro'` these all use Kokoro's own voices, including
   * Hindi. With `'mms'` only English and Hindi have local models. For anything
   * else, supply `onSynthesize` and use a cloud voice provider.
   */
  ttsLanguage?: 'en-US' | 'en-GB' | 'hi-IN';
  ttsEngine?: 'kokoro' | 'mms';
  /**
   * Kokoro voice id. Defaults to a voice matching `ttsLanguage`, so this is
   * only needed to pick a specific one: `af_heart` and `am_michael` for
   * American English, `bf_emma` for British, `hf_alpha` and `hm_omega` for
   * Hindi. A voice whose language disagrees with `ttsLanguage` is corrected,
   * with a warning, since an English voice reading Hindi is never intended.
   */
  ttsVoice?: string;
  /**
   * Speech recognition model. Defaults by language: Whisper base for English,
   * Whisper small for Hindi, which needs the larger model to be usable and is
   * about three times the download. Set this to pin one model for every
   * language, or to use a fine-tuned one.
   */
  asrModel?: string;
  /**
   * Language to transcribe. Defaults to `ttsLanguage`, since a conversation is
   * almost always held in one language.
   */
  asrLanguage?: string;

  onSubmit?: (transcript: string) => Promise<string | AsyncIterable<string> | ReadableStream<any> | any> | string | AsyncIterable<string> | ReadableStream<any> | any;
  /** Cloud Adapter: Intercept the raw microphone Float32Array to use an external STT service (e.g. Sarvam, Whisper API) instead of the local ONNX model */
  onTranscribe?: (audio: Float32Array) => Promise<string>;
  /** Cloud Adapter: Intercept the text before synthesis to use an external TTS service (e.g. ElevenLabs, OpenAI) instead of the local Kokoro/MMS model. Supports Float32Array PCM or ArrayBuffer (MP3/WAV) */
  onSynthesize?: (text: string) => Promise<Float32Array | ArrayBuffer>;

  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onTranscriptUpdate?: (text: string, speaker: 'user' | 'avatar') => void;

  fallbackMode?: 'wasm' | 'disable' | 'error';
  /**
   * Called when something in the pipeline fails.
   *
   * Check `severity` first. A `degraded` report means the engine recovered on a
   * worse path and the avatar still works, so it deserves a quiet notice rather
   * than an error screen. Use this to log to your own monitoring, or to offer
   * typed input when the microphone is refused.
   */
  onError?: (error: AiVoiceAvatarError) => void;
  onCapabilityDetected?: (caps: AiVoiceAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  lowMemoryMode?: boolean;

  /** Optional overrides for self-hosting VAD and ONNX runtime WASM assets */
  vadAssetPath?: string;
  onnxWasmPath?: string;
  /** CSP Escape Hatch: if blob workers are blocked, fetch pre-compiled workers from this URL base */
  workerBaseUrl?: string;
  /** Set to true to enable HTTP HEAD probe for local GLB files in / (disabled by default to prevent console 404s in SPAs) */
  enableLocalAssetProbe?: boolean;

  showCaptions?: boolean;
  captionStyle?: React.CSSProperties;
  /**
   * `continuous` keeps the microphone hot between turns and lets the user barge in.
   * `push-to-talk` requires an explicit start before every turn.
   * @param listenMode - `'vad'` is the former name for `'continuous'` and still works.
   */
  listenMode?: 'continuous' | 'push-to-talk' | 'vad';
  /**
   * Let the user talk over the avatar and cut it off mid-sentence. Defaults to
   * true, because having to wait for a reply to finish is what makes a voice
   * agent feel like a walkie-talkie rather than a conversation.
   *
   * Set false for a kiosk or a noisy room. With the microphone live during
   * playback, an avatar on loud speakers can hear itself through weak echo
   * cancellation and stop mid-sentence, which is worse than waiting. Ignored in
   * push-to-talk, where the user takes the floor explicitly.
   */
  allowInterruption?: boolean;
  accentColor?: string;

  // Debug flag to show Leva panel
  debug?: boolean;

  /** Optional custom CSS styling & positioning for the Status/Tap-to-start Pill overlay */
  statusPillStyle?: React.CSSProperties;
  /** Set to true to disable internal rendering of StatusPill if placing it independently in DOM */
  hideStatusPill?: boolean;
  /** Callback fired whenever the avatar conversation state changes */
  onStatusChange?: (status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking') => void;

  /**
   * Called with audio volume level (0.0 to 1.0) and the active audio source.
   * Useful for building audio-reactive 3D visualizers or HUDs outside the package.
   */
  onAudioLevelChange?: (level: number, source: 'mic' | 'tts') => void;
}

/**
 * Speech recognition model per language.
 *
 * Whisper base is the smallest multilingual Whisper, and its accuracy outside
 * English drops sharply: on Hindi it returns fluent, confident, wrong text
 * rather than failing visibly. Whisper small is roughly three times the
 * download and transcribes Hindi well enough to hold a conversation.
 *
 * The larger model is selected only for the languages that need it, so nobody
 * pays for a language they never use. Pass `asrModel` to override either way.
 */
const ASR_MODEL_BY_LANGUAGE: Record<string, string> = {
  'hi-IN': 'onnx-community/whisper-small',
};
const DEFAULT_ASR_MODEL = 'onnx-community/whisper-base';

/**
 * Local language model per language.
 *
 * Qwen2.5-0.5B has almost no Hindi in it and answers in English or in broken
 * Devanagari. Model size turned out to matter more than any multilingual claim:
 * Qwen3-0.6B advertises 119 languages and still produced Hindi-shaped nonsense,
 * while Gemma 3 1B answers correctly. It is roughly 270MB more than the default
 * and is used only when Hindi is selected.
 *
 * Pass `llmModel` to pin one model, or `onSubmit` to skip local generation and
 * use your own backend, which is what most production apps will do.
 */
const LLM_MODEL_BY_LANGUAGE: Record<string, string> = {
  'hi-IN': 'onnx-community/gemma-3-1b-it-ONNX',
};
const DEFAULT_LLM_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

const ARKIT_BLENDSHAPES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthDimpleLeft", "mouthDimpleRight",
  "mouthStretchLeft", "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft",
  "cheekSquintRight", "noseSneerLeft", "noseSneerRight", "tongueOut"
];

// Morph target keys that the lip sync engine writes to
const LIP_SYNC_TARGETS = [
  'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'tongueOut',
] as const;

interface AvatarModelProps {
  url: string;
  status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
  debug?: boolean;
  analyser?: AnalyserNode;
  currentSpeechTextRef: React.RefObject<string>;
  currentSpeechPhonemesRef: React.RefObject<string>;
  currentAudioDurationRef: React.RefObject<number>;
  playbackStartTimeRef: React.RefObject<number>;
  audioContextRef: React.RefObject<AudioContext | null>;
}

function AvatarModel({
  url, status, debug, analyser,
  currentSpeechTextRef, currentSpeechPhonemesRef, currentAudioDurationRef,
  playbackStartTimeRef, audioContextRef,
}: AvatarModelProps) {
  const { scene } = useGLTF(url);
  const morphMeshesRef = useRef<THREE.Mesh[]>([]);

  // Lip sync & facial dynamics engine instances (created once, zero React rerenders)
  const lipSyncRef = useRef<AudioLipSync | null>(null);
  const phonemeEngineRef = useRef(new PhonemeTimingEngine());
  const dynamicsEngineRef = useRef(new AvatarDynamicsEngine());
  const prevWeightsRef = useRef<VisemeWeights | null>(null);
  const lastTextRef = useRef<string>('');

  // Skeletal armature tracking refs for interactive head posture and body IK
  const bonesRef = useRef<Record<string, THREE.Object3D>>({});

  // Find all meshes with morph targets and locate head armature bones
  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary) {
        meshes.push(child as THREE.Mesh);
      }
    });
    morphMeshesRef.current = meshes;

    // Cache standard humanoid armature joints for procedural posing
    const boneNames = [
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
      'Spine', 'Spine1', 'Spine2', 'Hips',
      'Neck', 'Head'
    ];

    for (const name of boneNames) {
      const b = scene.getObjectByName(name) || scene.getObjectByName(name.toLowerCase());
      if (b) {
        if (!b.userData.initialRotation) {
          b.userData.initialRotation = b.rotation.clone();
        }
        bonesRef.current[name] = b;
      }
    }

    return () => {
      // On unmount, restore the bones to their true initial rotation
      // so if this cached scene is rendered again, it's back to neutral
      for (const bone of Object.values(bonesRef.current)) {
        if (bone && bone.userData.initialRotation) {
          bone.rotation.copy(bone.userData.initialRotation);
        }
      }

      morphMeshesRef.current = [];
      bonesRef.current = {};
    };
  }, [scene]);

  // Create AudioLipSync when analyser becomes available
  useEffect(() => {
    if (analyser) {
      lipSyncRef.current = new AudioLipSync(analyser);
    }
    return () => {
      lipSyncRef.current?.reset();
      lipSyncRef.current = null;
    };
  }, [analyser]);

  // Debug controls have been moved to LazyLevaDebugPanel (loaded dynamically only when debug={true})

  // ─── PHASE 5 & AVATAR DYNAMICS: Hybrid Lip Sync + Autonomous Micro-Expressions ───
  // Runs every frame. Reads FFT audio, text timing, and pointer coords → mutates meshes & bones directly at 60 FPS.
  useFrame((state, delta) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (debug) return;
    if (morphMeshesRef.current.length === 0) return;

    // Step 1: Read real-time audio energy if active
    const audioState = lipSyncRef.current?.update() ?? null;

    // Step 2: Update phoneme timeline if spoken text changed
    if (lipSyncRef.current) {
      const currentText = currentSpeechTextRef.current ?? '';
      if (currentText !== lastTextRef.current) {
        lastTextRef.current = currentText;
        const phonemes = currentSpeechPhonemesRef.current ?? '';
        if (currentText.length > 0) {
          phonemeEngineRef.current.setUtterance(
            currentText,
            currentAudioDurationRef.current ?? undefined,
            phonemes
          );
        } else {
          phonemeEngineRef.current.clear();
        }
      }

      // Step 3: Determine playback position and active viseme
      let timedViseme = null;
      const ctx = audioContextRef.current;
      if (ctx && currentText.length > 0 && playbackStartTimeRef.current > 0) {
        const playbackTime = ctx.currentTime - playbackStartTimeRef.current;
        timedViseme = phonemeEngineRef.current.getActiveViseme(playbackTime);
      }

      // Step 4: Blend audio energy + text viseme into speech morph weights
      if (audioState) {
        const weights = blendAudioAndText(
          audioState,
          timedViseme,
          prevWeightsRef.current,
          0.35,
        );
        prevWeightsRef.current = weights;

        // Apply speech viseme targets directly to mesh influences
        for (const mesh of morphMeshesRef.current) {
          if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) continue;
          for (const key of LIP_SYNC_TARGETS) {
            const idx = mesh.morphTargetDictionary[key];
            if (idx !== undefined) {
              mesh.morphTargetInfluences[idx] = weights[key];
            }
          }
        }
      }
    }

    // Step 5: Compute autonomous facial vitality (blinks, eye darting, acoustic brows) & interactive pointer physics
    const dynamics = dynamicsEngineRef.current.update({
      elapsedTime: state.clock.getElapsedTime(),
      delta,
      pointerX: state.pointer.x,
      pointerY: state.pointer.y,
      audioState,
      conversationState: status,
    });

    // Apply autonomous micro-expression blendshapes (blinking, saccades, eyebrows, cheek accentuation)
    for (const mesh of morphMeshesRef.current) {
      if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) continue;
      for (const key in dynamics.blendshapes) {
        const idx = mesh.morphTargetDictionary[key];
        if (idx !== undefined) {
          mesh.morphTargetInfluences[idx] = dynamics.blendshapes[key as keyof typeof dynamics.blendshapes];
        }
      }
    }

    // Step 6: Apply all calculated procedural IK/FK rotations to the cached bones
    if (dynamics.boneRotations) {
      for (const [boneName, rot] of Object.entries(dynamics.boneRotations)) {
        const bone = bonesRef.current[boneName];
        if (bone && bone.userData.initialRotation) {
          const initial = bone.userData.initialRotation as THREE.Euler;
          bone.rotation.x = initial.x + rot.x;
          bone.rotation.y = initial.y + rot.y;
          bone.rotation.z = initial.z + rot.z;
        }
      }
    }

    // Step 7: Root scene fallback presentation (for models without proper bones)
    if (scene) {
      scene.position.y = dynamics.sceneOffset.positionY;
      if (!bonesRef.current['Head'] && !bonesRef.current['Spine2']) {
        // Fallback gentle scene rotations if no bones are available
        scene.rotation.y = dynamics.sceneOffset.rotationY;
        scene.rotation.z = dynamics.sceneOffset.rotationZ;
        scene.rotation.x = dynamics.sceneOffset.rotationX ?? 0;
      }
    }
  });

  return (
    <>
      <primitive object={scene} />
      {debug && (
        <Suspense fallback={null}>
          <LazyLevaDebugPanel blendshapes={ARKIT_BLENDSHAPES} morphMeshesRef={morphMeshesRef} />
        </Suspense>
      )}
    </>
  );
}

function StudioLighting({ preset = 'studio' }: { preset?: string }) {
  if (preset === 'none') return null;

  if (preset === 'cyberpunk_violet') {
    return (
      <>
        <ambientLight intensity={1.2} color="#A78BFA" />
        <pointLight position={[-3, 2, 2]} intensity={25} color="#8B5CF6" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={20} color="#06B6D4" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.2} color="#D8B4FE" />
      </>
    );
  }

  if (preset === 'cool_azure') {
    return (
      <>
        <ambientLight intensity={1.3} color="#93C5FD" />
        <pointLight position={[-3, 2, 2]} intensity={22} color="#3B82F6" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={16} color="#10B981" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.4} color="#E0F2FE" />
      </>
    );
  }

  if (preset === 'warm_amber') {
    return (
      <>
        <ambientLight intensity={1.4} color="#FDE68A" />
        <pointLight position={[-3, 2, 2]} intensity={24} color="#F59E0B" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={15} color="#EC4899" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.3} color="#FFFBEB" />
      </>
    );
  }

  if (preset === 'clean_white') {
    return (
      <>
        <ambientLight intensity={1.7} color="#FFFFFF" />
        <directionalLight position={[2, 4, 5]} intensity={1.8} color="#FFFFFF" />
        <directionalLight position={[-2, -2, -2]} intensity={0.5} color="#F1F5F9" />
      </>
    );
  }

  // Default balanced 'studio' lighting.
  //
  // Tuned for avatars whose textures are photographic. Heavily saturated key
  // lights read as deliberate style on a flat-shaded stylised mesh, but on baked
  // photographic skin they read as a colour cast, and dark clothing absorbs them
  // instead of reflecting them, so the figure sinks into the background wherever
  // the colour does not happen to land. Directional lights also matter more than
  // point lights here: a point light with a distance falloff lights a head-and-
  // shoulders framing evenly but leaves a full-body framing dark below the waist.
  return (
    <>
      <ambientLight intensity={1.3} color="#F1F5F9" />
      {/* Key: slightly warm, high and to the front-right, as in a portrait setup. */}
      <directionalLight position={[2.5, 3.5, 4]} intensity={2.8} color="#FFF4E8" />
      {/* Fill: cool and soft from the opposite side, to open up the shadow half. */}
      <directionalLight position={[-3, 1.5, 2.5]} intensity={1.2} color="#DCE8FF" />
      {/*
        Rim pair, one behind each shoulder. These carry more weight than they
        would in a brighter scene: avatars are usually posed against a near-black
        stage, and a figure in dark clothing has nothing else separating it from
        that background, so without a rim it reads as a silhouette.
      */}
      <directionalLight position={[-2.5, 2, -3]} intensity={1.8} color="#A5C8FF" />
      <directionalLight position={[2.5, 2, -3]} intensity={1.5} color="#BBD4FF" />
    </>
  );
}

export const AiVoiceAvatar = forwardRef<AiVoiceAvatarHandle, AiVoiceAvatarProps>((props, _ref) => {
  const {
    modelSrc,
    avatarPreset = 'ananya',
    avatarSize,
    // Destructured only so a deprecated prop is not spread onto the <group>.
    environmentPreset: _environmentPreset,
    lightingPreset = 'studio',
    loadingProgress,
    fallbackMode = 'wasm',
    asrLanguage,
    ttsLanguage = 'en-US',
    ttsEngine = 'kokoro',
    ttsVoice = 'af_heart',
    asrModel,
    onSubmit,
    onTranscriptUpdate,
    onTranscribe,
    onSynthesize,
    debug,
    statusPillStyle,
    ...groupProps
  } = props;

  let computedScale = groupProps.scale;
  if (avatarSize !== undefined) {
    if (avatarSize === 'sm') computedScale = 0.38;
    else if (avatarSize === 'md') computedScale = 0.48;
    else if (avatarSize === 'lg') computedScale = 0.62;
    else if (typeof avatarSize === 'number') computedScale = avatarSize;
  }

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(modelSrc || null);
  const [caption, setCaption] = useState<{ text: string; speaker: 'user' | 'avatar' } | null>(null);
  const hiddenTranscriptRef = useRef<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState<{ pct?: number; label?: string }>({});
  const [engineWarning, setEngineWarning] = useState<string | null>(null);
  const loadingProgressRef = useRef(loadingProgress);
  useEffect(() => { loadingProgressRef.current = loadingProgress; }, [loadingProgress]);

  const {
    status, isLoading, isIdle, isListening, isThinking, isSpeaking, micError,
    analyser, startListening, stopListening, interrupt, speak, sendText, clearHistory,
    currentSpeechTextRef,
    currentSpeechPhonemesRef,
    currentAudioDurationRef, playbackStartTimeRef, audioContextRef,
  } = useAiVoiceAvatar({
    // Only matters when no onSubmit is supplied, since that skips local
    // generation entirely.
    llmModel: props.llmModel ?? LLM_MODEL_BY_LANGUAGE[ttsLanguage] ?? DEFAULT_LLM_MODEL,
    asrModel: asrModel ?? ASR_MODEL_BY_LANGUAGE[asrLanguage ?? ttsLanguage] ?? DEFAULT_ASR_MODEL,
    ttsLanguage,
    ttsEngine: props.ttsEngine,
    ttsVoice: props.ttsVoice,
    systemPrompt: props.systemPrompt,
    fallbackMode,
    // People answer in the language they were addressed in, so listening
    // follows speaking unless told otherwise. Defaulting this to English on its
    // own meant choosing Hindi gave Hindi speech but English transcripts, and
    // nothing revealed the mismatch until you actually said something.
    asrLanguage: asrLanguage ?? ttsLanguage,
    onSubmit,
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') {
        if (hiddenTranscriptRef.current === text) {
          hiddenTranscriptRef.current = null; // Consume it, don't show caption
        } else {
          setCaption({ text, speaker });
        }
      }
      onTranscriptUpdate?.(text, speaker);
    },
    onSpeechStart: (text) => {
      setCaption({ text, speaker: 'avatar' });
    },
    onError: props.onError,
    onCapabilityDetected: (caps) => {
      if (!caps.webgpu) {
        setEngineWarning('WebGPU unavailable — using WASM (slower)');
        // Reported as an error so a host can log it, but degraded rather than
        // fatal: everything still works, several times slower. On weak hardware
        // this is the difference between a demo that feels broken and one that
        // feels slow, and only the host knows which it would rather show.
        props.onError?.({
          stage: 'worker',
          severity: 'degraded',
          message: 'WebGPU is unavailable, so inference is running on WASM and will be noticeably slower.',
          detail: 'webgpu-unavailable',
        });
      } else {
        setEngineWarning(null);
      }
      props.onCapabilityDetected?.(caps);
    },
    loadingProgress: (pct, label) => {
      setLoadingInfo({ pct, label });
      props.loadingProgress?.(pct, label);
    },
    lowMemoryMode: props.lowMemoryMode,
    vadAssetPath: props.vadAssetPath,
    onnxWasmPath: props.onnxWasmPath,
    workerBaseUrl: props.workerBaseUrl,
    listenMode: props.listenMode,
    allowInterruption: props.allowInterruption,
    onInferenceStart: props.onInferenceStart,
    onInferenceEnd: props.onInferenceEnd,
    onUserInterrupt: props.onUserInterrupt,
    onAudioLevelChange: props.onAudioLevelChange
  });

  const handleStopOrPause = () => {
    stopListening();
    interrupt();
  };

  useEffect(() => {
    props.onStatusChange?.(status);
  }, [status, props.onStatusChange]);

  // Expose methods and explicit state booleans to parent component handle
  useImperativeHandle(_ref, () => ({
    clearHistory: () => {
      clearHistory();
      setCaption(null);
    },
    interrupt,
    startListening,
    stopListening,
    speak,
    sendText: (text: string, options?: { hidden?: boolean }) => {
      if (options?.hidden) {
        hiddenTranscriptRef.current = text.trim();
      }
      sendText(text);
    },
    getAnalyser: () => analyser,
    status,
    isLoading,
    isIdle,
    isListening,
    isThinking,
    isSpeaking,
    micError,
  }));

  useEffect(() => {
    if (modelSrc) {
      setResolvedUrl(modelSrc);
      return;
    }
    let isMounted = true;
    resolveAvatarUrl(avatarPreset, (pct, label) => loadingProgressRef.current?.(pct, label), props.enableLocalAssetProbe).then(url => {
      if (isMounted) setResolvedUrl(url);
    });
    return () => { isMounted = false; };
  }, [modelSrc, avatarPreset, props.enableLocalAssetProbe]);

  if (!resolvedUrl) return null;

  return (
    <>
      <group {...groupProps} scale={computedScale}>
        {/*
          Each lighting preset owns its own ambient term. There used to be a
          second one here as well, which meant every preset was quietly lit
          brighter and flatter than its own numbers said, and `lightingPreset`
          of "none" still could not give you an unlit scene to bring your own
          lights to.
        */}
        <StudioLighting preset={lightingPreset} />

        <AvatarModel
          url={resolvedUrl}
          status={status}
          debug={debug}
          analyser={analyser}
          currentSpeechTextRef={currentSpeechTextRef}
          currentSpeechPhonemesRef={currentSpeechPhonemesRef}
          currentAudioDurationRef={currentAudioDurationRef}
          playbackStartTimeRef={playbackStartTimeRef}
          audioContextRef={audioContextRef}
        />
      </group>

      {(props.showCaptions || !props.hideStatusPill) && (
        <Html fullscreen zIndexRange={[100, 0]}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {props.showCaptions && caption && (
              <div style={{
                position: 'absolute', bottom: '110px', top: 'auto', left: '48px', transform: 'none',
                background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${caption.speaker === 'user' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(16, 185, 129, 0.5)'}`,
                borderRadius: '16px', padding: '14px 22px', maxWidth: '380px', width: 'auto', minWidth: '260px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.75)', transition: 'all 0.3s ease',
                pointerEvents: 'auto', textAlign: 'left', zIndex: 110,
                ...props.captionStyle
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: caption.speaker === 'user' ? '#60A5FA' : '#34D399', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{caption.speaker === 'user' ? '🎙️' : '💬'}</span>
                  <span>{caption.speaker === 'user' ? 'You spoke' : 'Assistant'}</span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#F8FAFC', lineHeight: 1.5 }}>
                  {caption.text}
                </div>
              </div>
            )}

            {!props.hideStatusPill && (
              <StatusPill
                status={status}
                analyser={analyser}
                onPillClick={startListening}
                onStopClick={handleStopOrPause}
                micError={micError}
                engineWarning={engineWarning}
                loadingLabel={loadingInfo.label}
                loadingPct={loadingInfo.pct}
                style={statusPillStyle}
              />
            )}
          </div>
        </Html>
      )}
    </>
  );
});

AiVoiceAvatar.displayName = 'AiVoiceAvatar';

