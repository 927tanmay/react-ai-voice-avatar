import React from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls, Leva } from 'leva';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

export interface LevaDebugPanelProps {
  blendshapes: string[];
  morphMeshesRef: React.RefObject<THREE.Mesh[] | null | THREE.Mesh[]>;
}

export default function LevaDebugPanel({ blendshapes, morphMeshesRef }: LevaDebugPanelProps) {
  const controls = useControls(
    'Morph Targets',
    blendshapes.reduce((acc, key) => {
      acc[key] = { value: 0, min: 0, max: 1 };
      return acc;
    }, {} as Record<string, any>),
    { collapsed: true }
  );

  useFrame(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const meshes = morphMeshesRef.current;
    if (meshes && Array.isArray(meshes) && meshes.length > 0) {
      for (const mesh of meshes) {
        if (mesh.morphTargetInfluences && mesh.morphTargetDictionary) {
          for (const key of Object.keys(controls)) {
            const idx = mesh.morphTargetDictionary[key];
            if (idx !== undefined) {
              mesh.morphTargetInfluences[idx] = (controls as any)[key];
            }
          }
        }
      }
    }
  });

  return (
    <Html>
      <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'auto' }}>
        <Leva />
      </div>
    </Html>
  );
}
