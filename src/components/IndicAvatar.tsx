import { forwardRef, useEffect, useState, useRef, useImperativeHandle } from 'react';
import { ThreeElements, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three';
import { resolveAvatarUrl } from '../lib/avatarAssets';
import { StatusPill } from './StatusPill';
import { useIndicAvatar } from '../hooks/useIndicAvatar';

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

function AvatarModel({ url, debug }: { url: string; debug?: boolean }) {
  const { scene } = useGLTF(url);
  const morphMeshesRef = useRef<THREE.Mesh[]>([]);

  // Find all meshes with morph targets (e.g. Wolf3D_Head, Wolf3D_Teeth, Wolf3D_EyeLeft, etc.)
  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetDictionary) {
        meshes.push(child as THREE.Mesh);
      }
    });
    morphMeshesRef.current = meshes;
  }, [scene]);

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

  // Idle micro-movement applied to the entire root scene so head, teeth, and body stay attached
  useFrame((state) => {
    if (scene) {
      const t = state.clock.getElapsedTime();
      scene.position.y = Math.sin(t * 1.5) * 0.02;
      scene.rotation.y = Math.sin(t * 0.5) * 0.05;
      scene.rotation.z = Math.cos(t * 0.3) * 0.02;
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

  const { status, analyser, startListening, stopListening, interrupt } = useIndicAvatar({
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

      <AvatarModel url={resolvedUrl} debug={debug} />

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
