import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function AiVoiceAvatarSkeleton() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const time = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    time.current += delta;
    
    // Slow futuristic rotation
    meshRef.current.rotation.y = time.current * 0.5;
    
    // Pulsing opacity
    const pulse = 0.3 + Math.sin(time.current * 3) * 0.2;
    materialRef.current.opacity = pulse;
  });

  return (
    <group position={[0, -0.34, 0]}>
      {/* A simple geometric representation of the avatar space */}
      <mesh ref={meshRef}>
        <cylinderGeometry args={[0.2, 0.25, 0.8, 16, 1, true]} />
        <meshBasicMaterial 
          ref={materialRef}
          color="#38BDF8" 
          wireframe={true} 
          transparent={true} 
          opacity={0.5} 
          side={THREE.DoubleSide} 
        />
      </mesh>
      
      {/* Core glowing center */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial 
          color="#38BDF8" 
          transparent={true} 
          opacity={0.8} 
        />
      </mesh>
    </group>
  );
}
