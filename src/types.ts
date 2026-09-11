/**
 * Shared types with no 3D dependencies.
 *
 * These live outside the component tree so the headless entry point
 * (`react-ai-voice-avatar/headless`) never has to reference a module that
 * imports three.js, @react-three/fiber, or @react-three/drei.
 */

/** Runtime inference capabilities detected on the visitor's device. */
export interface AiVoiceAvatarCapabilities {
  /** True when the ONNX runtime selected the WebGPU backend rather than falling back to WASM. */
  webgpu: boolean;
  /** Reserved for future VRAM reporting; currently always null. */
  estimatedVram: number | null;
}
