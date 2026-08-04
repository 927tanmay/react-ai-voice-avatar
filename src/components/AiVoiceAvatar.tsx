import { forwardRef, useEffect, useState, useRef, useImperativeHandle } from 'react';
import { ThreeElements, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import { useControls, Leva } from 'leva';
import * as THREE from 'three';
import { resolveAvatarUrl } from '../lib/avatarAssets';
import { StatusPill } from './StatusPill';
import { useAiVoiceAvatar } from '../hooks/useAiVoiceAvatar';
import { AudioLipSync } from '../lib/audioLipSync';
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
  debug?: boolean;
  analyser?: AnalyserNode;
  currentSpeechTextRef: React.RefObject<string>;
  currentAudioDurationRef: React.RefObject<number>;
  playbackStartTimeRef: React.RefObject<number>;
  audioContextRef: React.RefObject<AudioContext | null>;
}

function AvatarModel({
  url, debug, analyser,
  currentSpeechTextRef, currentAudioDurationRef,
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

  // Skeletal armature tracking refs for interactive head posture
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const initialHeadRotRef = useRef<THREE.Euler | null>(null);

  // Find all meshes with morph targets and locate head armature bones
  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary) {
        meshes.push(child as THREE.Mesh);
      }
    });
    morphMeshesRef.current = meshes;

    // Locate standard humanoid neck/head armature joints for smooth pointer tracking
    const foundHeadBone = (
      scene.getObjectByName('Head') ||
      scene.getObjectByName('Neck') ||
      scene.getObjectByName('head') ||
      scene.getObjectByName('neck') ||
      scene.getObjectByName('Head_01') ||
      null
    );

    if (foundHeadBone) {
      headBoneRef.current = foundHeadBone;
      initialHeadRotRef.current = foundHeadBone.rotation.clone();
    }

    return () => {
      // P2 Optimization: Systematic WebGL resource disposal to prevent VRAM memory leaks on unmount
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat) => mat.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });
      morphMeshesRef.current = [];
      headBoneRef.current = null;
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

  // Dev-only debug panel (Statically mapped so Leva doesn't break on lazy-load)
  const controls = useControls(
    'Morph Targets',
    ARKIT_BLENDSHAPES.reduce((acc, key) => {
      acc[key] = { value: 0, min: 0, max: 1 };
      return acc;
    }, {} as Record<string, any>),
    { collapsed: true, render: () => Boolean(debug) }
  );

  // Apply debug controls to ALL morph target meshes if in debug mode
  useFrame(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (debug && morphMeshesRef.current.length > 0) {
      for (const mesh of morphMeshesRef.current) {
        if (mesh.morphTargetInfluences && mesh.morphTargetDictionary) {
          for (const key of Object.keys(controls)) {
            const idx = mesh.morphTargetDictionary[key];
            if (idx !== undefined) {
              mesh.morphTargetInfluences[idx] = controls[key];
            }
          }
        }
      }
    }
  });

  // ─── PHASE 5 & AVATAR DYNAMICS: Hybrid Lip Sync + Autonomous Micro-Expressions ───
  // Runs every frame. Reads FFT audio, text timing, and pointer coords → mutates meshes & bones directly at 60 FPS.
  useFrame((state, delta) => {
    if (typeof document !== 'undefined' && document.hidden) return; // P2: Halt rendering computations when tab is inactive
    if (debug) return; // Don't override manual Leva debug controls
    if (morphMeshesRef.current.length === 0) return;

    // Step 1: Read real-time audio energy if active
    const audioState = lipSyncRef.current?.update() ?? null;

    // Step 2: Update phoneme timeline if spoken text changed
    if (lipSyncRef.current) {
      const currentText = currentSpeechTextRef.current ?? '';
      if (currentText !== lastTextRef.current) {
        lastTextRef.current = currentText;
        if (currentText.length > 0) {
          phonemeEngineRef.current.setUtterance(
            currentText,
            currentAudioDurationRef.current ?? undefined
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
    });

    // Apply autonomous micro-expression blendshapes (blinking, saccades, eyebrows, cheek accentuation)
    for (const mesh of morphMeshesRef.current) {
      if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) continue;
      for (const [key, value] of Object.entries(dynamics.blendshapes)) {
        const idx = mesh.morphTargetDictionary[key];
        if (idx !== undefined) {
          mesh.morphTargetInfluences[idx] = value;
        }
      }
    }

    // Step 6: Apply interactive cursor head & neck rotation toward user mouse pointer
    if (headBoneRef.current && initialHeadRotRef.current) {
      headBoneRef.current.rotation.x = initialHeadRotRef.current.x + dynamics.headRotation.x;
      headBoneRef.current.rotation.y = initialHeadRotRef.current.y + dynamics.headRotation.y;
      headBoneRef.current.rotation.z = initialHeadRotRef.current.z + dynamics.headRotation.z;
    } else if (scene) {
      // Gentle scene fallback tilt if model has no exposed Neck/Head armature joint
      scene.rotation.y = dynamics.sceneOffset.rotationY + dynamics.headRotation.y * 0.45;
      scene.rotation.x = dynamics.headRotation.x * 0.25;
    }

    // Step 7: Root scene respiration and idle presence
    if (scene) {
      scene.position.y = dynamics.sceneOffset.positionY;
      if (headBoneRef.current) {
        scene.rotation.y = dynamics.sceneOffset.rotationY;
        scene.rotation.z = dynamics.sceneOffset.rotationZ;
      }
    }
  });

  return <primitive object={scene} />;
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

  const {
    status, isLoading, isIdle, isListening, isThinking, isSpeaking, micError,
    analyser, startListening, stopListening, interrupt, speak,
    currentSpeechTextRef, currentAudioDurationRef, playbackStartTimeRef, audioContextRef,
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
    onCapabilityDetected: props.onCapabilityDetected,
    loadingProgress: (pct, label) => {
      setLoadingInfo({ pct, label });
      props.loadingProgress?.(pct, label);
    },
    lowMemoryMode: props.lowMemoryMode,
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
    clearHistory: () => { setCaption(null); },
    interrupt,
    startListening,
    stopListening,
    speak,
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
    resolveAvatarUrl(avatarPreset, loadingProgress).then(url => {
      if (isMounted) setResolvedUrl(url);
    });
    return () => { isMounted = false; };
  }, [modelSrc, avatarPreset, loadingProgress]);

  if (!resolvedUrl) return null;

  return (
    <>
      <group {...groupProps} scale={computedScale}>
        {environmentPreset === 'studio' && <Environment preset="studio" />}
        <StudioLighting preset={lightingPreset} />

        <AvatarModel
          url={resolvedUrl}
          debug={debug}
          analyser={analyser}
          currentSpeechTextRef={currentSpeechTextRef}
          currentAudioDurationRef={currentAudioDurationRef}
          playbackStartTimeRef={playbackStartTimeRef}
          audioContextRef={audioContextRef}
        />
      </group>

      {(props.showCaptions || !props.hideStatusPill || !debug) && (
        <Html fullscreen zIndexRange={[100, 0]}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <Leva hidden={!debug} />

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

