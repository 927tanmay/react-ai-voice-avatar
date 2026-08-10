import React, { forwardRef, useEffect, useState, useRef, useImperativeHandle, Suspense } from 'react';
import { ThreeElements, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import { resolveAvatarUrl } from '../lib/avatarAssets';
import { StatusPill } from './StatusPill';
import { useAiVoiceAvatar } from '../hooks/useAiVoiceAvatar';
import { AudioLipSync } from '../lib/audioLipSync';

const LazyLevaDebugPanel = React.lazy(() => import('./LevaDebugPanel'));
import { PhonemeTimingEngine, blendAudioAndText } from '../lib/phonemeTiming';
import { AvatarDynamicsEngine } from '../lib/avatarDynamics';
import type { VisemeWeights } from '../lib/visemeTable';

export interface AiVoiceAvatarCapabilities {
  webgpu: boolean;
  estimatedVram: number | null;
}

export interface AiVoiceAvatarHandle {
  clearHistory: () => void;
  interrupt: () => void;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  sendText: (text: string) => void;
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
  environmentPreset?: 'studio' | 'none';
  /** Pre-built cinematic studio lighting presets for zero-config visual atmospheres */
  lightingPreset?: 'studio' | 'cyberpunk_violet' | 'cool_azure' | 'warm_amber' | 'clean_white' | 'none';
  /** Intuitive size preset or custom numerical scale multiplier ('sm' | 'md' | 'lg' | number) */
  avatarSize?: 'sm' | 'md' | 'lg' | number;

  systemPrompt?: string;
  llmModel?: string;
  ttsLanguage?: 'en-US' | 'hi-IN' | 'bn-IN' | 'ta-IN' | 'te-IN' | 'mr-IN';
  ttsEngine?: 'kokoro' | 'mms';
  ttsVoice?: string;
  asrModel?: string;
  asrLanguage?: string;

  onSubmit?: (transcript: string) => Promise<string | AsyncIterable<string> | ReadableStream<any> | any> | string | AsyncIterable<string> | ReadableStream<any> | any;

  onInferenceStart?: () => void;
  onInferenceEnd?: () => void;
  onUserInterrupt?: () => void;
  onTranscriptUpdate?: (text: string, speaker: 'user' | 'avatar') => void;

  fallbackMode?: 'wasm' | 'disable' | 'error';
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
  listenMode?: 'vad' | 'push-to-talk';
  accentColor?: string;

  // Debug flag to show Leva panel
  debug?: boolean;

  /** Optional custom CSS styling & positioning for the Status/Tap-to-start Pill overlay */
  statusPillStyle?: React.CSSProperties;
  /** Set to true to disable internal rendering of StatusPill if placing it independently in DOM */
  hideStatusPill?: boolean;
  /** Callback fired whenever the avatar conversation state changes */
  onStatusChange?: (status: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking') => void;
}

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
        <ambientLight intensity={0.6} color="#A78BFA" />
        <pointLight position={[-3, 2, 2]} intensity={25} color="#8B5CF6" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={20} color="#06B6D4" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.2} color="#D8B4FE" />
      </>
    );
  }

  if (preset === 'cool_azure') {
    return (
      <>
        <ambientLight intensity={0.7} color="#93C5FD" />
        <pointLight position={[-3, 2, 2]} intensity={22} color="#3B82F6" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={16} color="#10B981" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.4} color="#E0F2FE" />
      </>
    );
  }

  if (preset === 'warm_amber') {
    return (
      <>
        <ambientLight intensity={0.8} color="#FDE68A" />
        <pointLight position={[-3, 2, 2]} intensity={24} color="#F59E0B" distance={8} />
        <pointLight position={[3, 1, -2]} intensity={15} color="#EC4899" distance={8} />
        <directionalLight position={[0, 4, 3]} intensity={1.3} color="#FFFBEB" />
      </>
    );
  }

  if (preset === 'clean_white') {
    return (
      <>
        <ambientLight intensity={1.1} color="#FFFFFF" />
        <directionalLight position={[2, 4, 5]} intensity={1.8} color="#FFFFFF" />
        <directionalLight position={[-2, -2, -2]} intensity={0.5} color="#F1F5F9" />
      </>
    );
  }

  // Default balanced 'studio' lighting
  return (
    <>
      <ambientLight intensity={0.75} color="#E2E8F0" />
      <pointLight position={[-3, 2, 2]} intensity={20} color="#60A5FA" distance={8} />
      <pointLight position={[3, 1, -2]} intensity={16} color="#34D399" distance={8} />
      <directionalLight position={[0, 4, 4]} intensity={1.5} color="#FFFFFF" />
    </>
  );
}

export const AiVoiceAvatar = forwardRef<AiVoiceAvatarHandle, AiVoiceAvatarProps>((props, _ref) => {
  const {
    modelSrc,
    avatarPreset = 'ananya',
    avatarSize,
    environmentPreset = 'studio',
    lightingPreset = 'studio',
    loadingProgress,
    fallbackMode = 'wasm',
    asrLanguage = 'en-US',
    ttsLanguage = 'en-US',
    ttsEngine = 'kokoro',
    ttsVoice = 'af_heart',
    asrModel = 'onnx-community/whisper-base',
    onSubmit,
    onTranscriptUpdate,
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
    llmModel: props.llmModel,
    asrModel: props.asrModel,
    ttsLanguage,
    ttsEngine: props.ttsEngine,
    ttsVoice: props.ttsVoice,
    systemPrompt: props.systemPrompt,
    fallbackMode,
    asrLanguage,
    onSubmit,
    onTranscriptUpdate: (text, speaker) => {
      if (speaker === 'user') {
        setCaption({ text, speaker });
      }
      onTranscriptUpdate?.(text, speaker);
    },
    onSpeechStart: (text) => {
      setCaption({ text, speaker: 'avatar' });
    },
    onCapabilityDetected: (caps) => {
      if (!caps.webgpu) {
        setEngineWarning('WebGPU unavailable — using WASM (slower)');
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
    onInferenceStart: props.onInferenceStart,
    onInferenceEnd: props.onInferenceEnd,
    onUserInterrupt: props.onUserInterrupt
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
    sendText,
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
        {environmentPreset === 'studio' && <Environment preset="studio" />}
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
                borderRadius: '16px', padding: '14px 22px', maxWidth: '480px', width: 'auto', minWidth: '260px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.75)', transition: 'all 0.3s ease',
                pointerEvents: 'auto', textAlign: 'left', zIndex: 110
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

