import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface AudioVisualizerProps {
  level: number;
  color?: string;
  position?: [number, number, number];
}

export function AudioVisualizer({ level, color = '#00ffcc', position = [0, 0.05, 0] }: AudioVisualizerProps) {
  const rootGroupRef = useRef<THREE.Group>(null);
  
  const innerRingRef = useRef<THREE.Mesh>(null);
  const middleRingRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  
  const innerMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const middleMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const outerMatRef = useRef<THREE.MeshBasicMaterial>(null);
  
  // Smooth out the raw volume level
  const smoothedLevel = useRef(0);

  useFrame((_, delta) => {
    if (!rootGroupRef.current) return;

    // Fast attack, smooth decay
    const lerpSpeed = level > smoothedLevel.current ? 25 : 8;
    smoothedLevel.current = THREE.MathUtils.lerp(smoothedLevel.current, level, delta * lerpSpeed);
    const vol = smoothedLevel.current;

    // Scale the ENTIRE group together so the rings NEVER intersect or coincide
    const globalScale = 1 + vol * 0.4;
    rootGroupRef.current.scale.set(globalScale, globalScale, 1);

    // --- Inner Ring: Solid, spins fast ---
    if (innerRingRef.current && innerMatRef.current) {
      innerRingRef.current.rotation.z += delta * 2.0;
      innerMatRef.current.opacity = 0.4 + vol * 0.6; // High base opacity, gets very bright
    }

    // --- Middle Ring: Segmented/dashed effect (we simulate this by counter-rotating and pulsing) ---
    if (middleRingRef.current && middleMatRef.current) {
      middleRingRef.current.rotation.z -= delta * 1.0;
      middleMatRef.current.opacity = 0.1 + vol * 0.9;
    }

    // --- Outer Ring: Very thin, spins slowly, fades completely when silent ---
    if (outerRingRef.current && outerMatRef.current) {
      outerRingRef.current.rotation.z += delta * 0.3;
      outerMatRef.current.opacity = vol * 0.6; 
    }
  });

  return (
    <group ref={rootGroupRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Inner Ring */}
      <mesh ref={innerRingRef}>
        <ringGeometry args={[0.30, 0.33, 64]} />
        <meshBasicMaterial
          ref={innerMatRef}
          color={color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Middle Ring */}
      <mesh ref={middleRingRef}>
        <ringGeometry args={[0.38, 0.39, 64]} />
        <meshBasicMaterial
          ref={middleMatRef}
          color={color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer Ring (Farthest out, very faint) */}
      <mesh ref={outerRingRef}>
        <ringGeometry args={[0.44, 0.445, 64]} />
        <meshBasicMaterial
          ref={outerMatRef}
          color={color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Center ambient glow (fills the inside slightly) */}
      <mesh>
        <circleGeometry args={[0.29, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.03}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
