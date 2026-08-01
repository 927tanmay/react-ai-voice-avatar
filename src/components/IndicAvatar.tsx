import { forwardRef, useEffect, useState, useRef, useImperativeHandle } from 'react';
import { ThreeElements, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three';
import { resolveAvatarUrl } from '../lib/avatarAssets';
import { StatusPill } from './StatusPill';
import { useIndicAvatar } from '../hooks/useIndicAvatar';
import { AudioLipSync } from '../lib/audioLipSync';
import { PhonemeTimingEngine, blendAudioAndText } from '../lib/phonemeTiming';
import { AvatarDynamicsEngine } from '../lib/avatarDynamics';
import type { VisemeWeights } from '../lib/visemeTable';

export interface IndicAvatarCapabilities {
  webgpu: boolean;
  estimatedVram: number | null;
}

export interface IndicAvatarHandle {
  clearHistory: () => void;
  interrupt: () => void;
  startListening: () => void;
  stopListening: () => void;
}

export interface IndicAvatarProps extends Omit<ThreeElements['group'], 'children'> {
  modelSrc?: string;
  avatarPreset?: 'ananya' | 'aarav' | 'default' | 'kiosk';
  visemeMap?: Record<string, string>;
  environmentPreset?: 'studio' | 'none';

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
  onCapabilityDetected?: (caps: IndicAvatarCapabilities) => void;
  loadingProgress?: (pct: number, label: string) => void;
  lowMemoryMode?: boolean;

  showCaptions?: boolean;
  listenMode?: 'vad' | 'push-to-talk';
  accentColor?: string;

  // Debug flag to show Leva panel
  debug?: boolean;
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
    { collapsed: true }
  );

  // Apply debug controls to ALL morph target meshes if in debug mode
  useFrame(() => {
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

export const IndicAvatar = forwardRef<IndicAvatarHandle, IndicAvatarProps>((props, _ref) => {
  const {
    modelSrc,
    avatarPreset = 'ananya',
    environmentPreset = 'studio',
    loadingProgress,
    fallbackMode = 'wasm',
    asrLanguage = 'en-US',
    ttsLanguage = 'en-US',
    onSubmit,
    onTranscriptUpdate,
    debug,
    ...groupProps
  } = props;

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(modelSrc || null);

  const {
    status, analyser, startListening, stopListening, interrupt,
    currentSpeechTextRef, currentAudioDurationRef, playbackStartTimeRef, audioContextRef,
  } = useIndicAvatar({
    llmModel: props.llmModel,
    asrModel: props.asrModel,
    ttsLanguage,
    ttsEngine: props.ttsEngine,
    ttsVoice: props.ttsVoice,
    systemPrompt: props.systemPrompt,
    fallbackMode,
    asrLanguage,
    onSubmit,
    onTranscriptUpdate,
    onCapabilityDetected: props.onCapabilityDetected,
    loadingProgress: props.loadingProgress,
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

  // Expose methods to parent
  useImperativeHandle(_ref, () => ({
    clearHistory: () => { },
    interrupt,
    startListening,
    stopListening
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
    <group {...groupProps}>
      {environmentPreset === 'studio' && <Environment preset="studio" />}

      <AvatarModel
        url={resolvedUrl}
        debug={debug}
        analyser={analyser}
        currentSpeechTextRef={currentSpeechTextRef}
        currentAudioDurationRef={currentAudioDurationRef}
        playbackStartTimeRef={playbackStartTimeRef}
        audioContextRef={audioContextRef}
      />

      <Html fullscreen zIndexRange={[100, 0]}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <StatusPill
            status={status}
            analyser={analyser}
            onPillClick={startListening}
            onStopClick={handleStopOrPause}
          />
        </div>
      </Html>
    </group>
  );
});

IndicAvatar.displayName = 'IndicAvatar';

