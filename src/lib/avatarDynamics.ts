/**
 * avatarDynamics.ts
 *
 * Real-time procedural facial micro-expressions and interactive pointer tracking engine.
 * Bypasses React state to compute frame-by-frame body language, eye contact,
 * blinking, saccades (eye darting), and acoustic upper-face coupling at 60 FPS.
 *
 * Part 1: Autonomous Facial Vitality
 *   - Blinking: Natural dual-lid blinking intervals (3–5s) with realistic close/open curves.
 *   - Micro-Saccades: Involuntary eye darting routines to maintain alert focus and avoid staring.
 *   - Acoustic Eyebrow Coupling: Dynamically links audio vocal RMS energy to eyebrow lift & cheek expression.
 *
 * Part 2: Interactive Pointer & Cursor Tracking
 *   - Eye Contact: Translates R3F pointer coordinates (x, y) into ARKit gaze blendshape weights.
 *   - Head & Neck Rotation: Computes fluid, physics-damped bone rotations so the avatar turns its face
 *     toward user UI interactions within natural anatomical constraints.
 */

import type { AudioLipSyncState } from './audioLipSync';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DynamicsOutputs {
  /** Map of ARKit target names to computed weights (0 to 1). */
  blendshapes: Record<string, number>;
  /** Map of Bone names to computed rotational offsets (x, y, z in radians). */
  boneRotations: Record<string, { x: number; y: number; z: number }>;
  /** Root scene fallback offsets for models lacking bones. */
  sceneOffset: { positionY: number; rotationY: number; rotationZ: number; rotationX?: number };
}

export interface DynamicsInput {
  /** Total elapsed clock time in seconds from R3F animation state. */
  elapsedTime: number;
  /** Delta time since last frame in seconds. */
  delta: number;
  /** Normalized pointer x coordinate (-1 left to +1 right). */
  pointerX: number;
  /** Normalized pointer y coordinate (-1 bottom to +1 top). */
  pointerY: number;
  /** Current acoustic energy from AudioLipSync engine. */
  audioState?: AudioLipSyncState | null;
  /** Current conversational status to drive behavioral modes. */
  conversationState?: 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';
}

// ─── Configuration & Limits ─────────────────────────────────────────────────

const BLINK_MIN_INTERVAL = 5.0; // Increased fallback interval for semantic blinking
const BLINK_MAX_INTERVAL = 10.0; // Maximum seconds between spontaneous blinks
const BLINK_DURATION = 0.16;    // Total duration of a blink cycle in seconds

const SACCADE_MIN_INTERVAL = 0.8; // Seconds between tiny ocular saccade shifts
const SACCADE_MAX_INTERVAL = 2.2;
const SACCADE_STRENGTH = 0.18;    // Intensity of spontaneous eye wander when idle

const MAX_NECK_YAW = 0.45;    // Max left/right head turn in radians (~25 deg)
const MAX_NECK_PITCH = 0.25;  // Max up/down head tilt in radians (~14 deg)
const HEAD_DAMPING = 0.12;    // Linear interpolation alpha per frame for head turning

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Linear interpolation between current and target value. */
function lerp(prev: number, target: number, alpha: number): number {
  return prev + (target - prev) * alpha;
}

/** Clamp a value between min and max bounds. */
function clamp(val: number, min: number = 0, max: number = 1): number {
  return Math.min(max, Math.max(min, val));
}

/** Generate random floating point number in range [min, max]. */
function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── AvatarDynamicsEngine Class ─────────────────────────────────────────────

export class AvatarDynamicsEngine {
  // Blinking State
  private nextBlinkTime: number = 2.0;
  private isBlinking: boolean = false;
  private blinkStartTime: number = 0;
  private wasSpeaking: boolean = false;
  private breathPhase: number = 0;
  private smoothedSceneRotZ: number = 0;

  // Saccadic Eye Darting State
  private nextSaccadeTime: number = 1.0;
  private targetSaccade = { x: 0, y: 0 };
  private currentSaccade = { x: 0, y: 0 };

  // Damped Head Tracking State
  private currentHeadRotation = { x: 0, y: 0, z: 0 };
  
  // Damped Eyebrow & Face State
  private smoothedBrowInner: number = 0;
  private smoothedBrowOuter: number = 0;
  private smoothedCheek: number = 0;

  constructor() {
    this.scheduleNextBlink(0);
    this.scheduleNextSaccade(0);
  }

  private scheduleNextBlink(currentTime: number, isListening: boolean = false): void {
    const min = isListening ? BLINK_MIN_INTERVAL * 2.0 : BLINK_MIN_INTERVAL;
    const max = isListening ? BLINK_MAX_INTERVAL * 2.0 : BLINK_MAX_INTERVAL;
    this.nextBlinkTime = currentTime + randomRange(min, max);
  }

  private forceBlink(currentTime: number): void {
    // Don't force a blink if we literally just blinked
    if (!this.isBlinking && (currentTime - this.blinkStartTime) > 0.8) {
      this.nextBlinkTime = Math.min(this.nextBlinkTime, currentTime);
    }
  }

  private scheduleNextSaccade(currentTime: number, isIdle: boolean = false): void {
    const saccadeMin = isIdle ? SACCADE_MIN_INTERVAL * 2.5 : SACCADE_MIN_INTERVAL;
    const saccadeMax = isIdle ? SACCADE_MAX_INTERVAL * 2.5 : SACCADE_MAX_INTERVAL;
    this.nextSaccadeTime = currentTime + randomRange(saccadeMin, saccadeMax);
    
    const nextX = randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH);
    const nextY = randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH);
    
    // Semantic blink on large saccades
    const dist = Math.hypot(nextX - this.currentSaccade.x, nextY - this.currentSaccade.y);
    if (dist > SACCADE_STRENGTH * 1.2) {
      this.forceBlink(currentTime);
    }
    
    this.targetSaccade = { x: nextX, y: nextY };
  }

  /**
   * Evaluates all autonomous micro-expressions and interactive pointer physics for the current frame.
   * Call once per animation frame (inside useFrame) before updating mesh blendshapes and armatures.
   */
  update(input: DynamicsInput): DynamicsOutputs {
    const { elapsedTime, pointerX, pointerY, audioState, conversationState = 'idle' } = input;
    const outputs: Record<string, number> = {};

    const isListening = conversationState === 'listening';
    const isThinking = conversationState === 'thinking';
    const isIdle = conversationState === 'idle';

    // Semantic blink on utterance boundary (speech stops)
    const isCurrentlySpeaking = conversationState === 'speaking';
    if (this.wasSpeaking && !isCurrentlySpeaking) {
      this.forceBlink(elapsedTime);
    }
    this.wasSpeaking = isCurrentlySpeaking;

    // ─── 1. Autonomous Blinking (Part 1.1) ──────────────────────────────────
    let blinkWeight = 0;
    
    // Cognitive load (thinking) elevates blink rate
    if (isThinking && !this.isBlinking && (this.nextBlinkTime - elapsedTime) > 2.0) {
      this.nextBlinkTime = elapsedTime + randomRange(0.2, 0.8);
    }

    if (!this.isBlinking && elapsedTime >= this.nextBlinkTime) {
      this.isBlinking = true;
      this.blinkStartTime = elapsedTime;
    }

    if (this.isBlinking) {
      const elapsedInBlink = elapsedTime - this.blinkStartTime;
      if (elapsedInBlink >= BLINK_DURATION) {
        this.isBlinking = false;
        this.scheduleNextBlink(elapsedTime, isListening);
        blinkWeight = 0;
      } else {
        // Smooth sine bell curve for eyelid closure (0 -> 1 -> 0)
        const progress = elapsedInBlink / BLINK_DURATION;
        blinkWeight = Math.sin(progress * Math.PI);
        // Ensure eyelids completely seal at the peak of the blink
        blinkWeight = Math.pow(blinkWeight, 0.7);
      }
    }

    outputs['eyeBlinkLeft'] = clamp(blinkWeight);
    outputs['eyeBlinkRight'] = clamp(blinkWeight);

    // ─── 2. Saccades & Cursor Eye-Contact Tracking (Part 1.1 & 2.1) ─────────
    if (elapsedTime >= this.nextSaccadeTime) {
      this.scheduleNextSaccade(elapsedTime, isIdle);
    }
    // Smoothly transition saccade position
    this.currentSaccade.x = lerp(this.currentSaccade.x, this.targetSaccade.x, 0.08);
    this.currentSaccade.y = lerp(this.currentSaccade.y, this.targetSaccade.y, 0.08);

    // Combine deliberate pointer tracking with unconscious saccade shifts.
    // In R3F screen coordinates: -pointerX is left of screen, +pointerX is right of screen.
    // Note: Viewer's left is the avatar's right eye perspective, so signs reverse appropriately!
    let effectiveGazeX = clamp(pointerX * 0.8 + this.currentSaccade.x, -1, 1);
    let effectiveGazeY = clamp(pointerY * 0.8 + this.currentSaccade.y, -1, 1);
    
    // State override: Gaze aversion when thinking (look up and away)
    if (isThinking) {
      effectiveGazeX = lerp(effectiveGazeX, 0.7, 0.5); // Look away horizontally
      effectiveGazeY = lerp(effectiveGazeY, 0.6, 0.5); // Look up
    }

    // Horizontal gaze distribution
    if (effectiveGazeX < 0) {
      // Viewer looking left -> Avatar turns eyes to its right
      const str = Math.abs(effectiveGazeX);
      outputs['eyeLookOutRight'] = str;
      outputs['eyeLookInLeft'] = str;
      outputs['eyeLookInRight'] = 0;
      outputs['eyeLookOutLeft'] = 0;
    } else {
      // Viewer looking right -> Avatar turns eyes to its left
      const str = Math.abs(effectiveGazeX);
      outputs['eyeLookInRight'] = str;
      outputs['eyeLookOutLeft'] = str;
      outputs['eyeLookOutRight'] = 0;
      outputs['eyeLookInLeft'] = 0;
    }

    // Vertical gaze distribution
    if (effectiveGazeY > 0) {
      // Looking upwards
      const str = Math.abs(effectiveGazeY);
      outputs['eyeLookUpLeft'] = str;
      outputs['eyeLookUpRight'] = str;
      outputs['eyeLookDownLeft'] = 0;
      outputs['eyeLookDownRight'] = 0;
    } else {
      // Looking downwards
      const str = Math.abs(effectiveGazeY);
      outputs['eyeLookDownLeft'] = str;
      outputs['eyeLookDownRight'] = str;
      outputs['eyeLookUpLeft'] = 0;
      outputs['eyeLookUpRight'] = 0;
    }

    // Subtle eye widening when tracking extreme cursor movements
    const extremeTracker = Math.min(1, Math.hypot(pointerX, pointerY) * 0.35);
    outputs['eyeWideLeft'] = extremeTracker * (1 - blinkWeight);
    outputs['eyeWideRight'] = extremeTracker * (1 - blinkWeight);
    outputs['eyeSquintLeft'] = Math.abs(this.currentSaccade.x) * 0.5 * (1 - blinkWeight);
    outputs['eyeSquintRight'] = Math.abs(this.currentSaccade.y) * 0.5 * (1 - blinkWeight);

    // ─── 3. Acoustic Eyebrow & Upper Face Coupling (Part 1.2) ───────────────
    let targetBrowInner = 0;
    let targetBrowOuter = 0;
    let targetCheek = 0;

    if (audioState && audioState.isSpeaking) {
      // Vocal RMS energy lifts inner brows on emphatic syllable spikes
      targetBrowInner = clamp(audioState.energy * 0.7 + audioState.highBand * 0.4);
      targetBrowOuter = clamp(audioState.energy * 0.45 + audioState.midBand * 0.25);
      targetCheek = clamp(audioState.energy * 0.3);
    } else if (isListening) {
      // Subtle attentive brow raise when actively listening to the user
      targetBrowInner = 0.3;
      targetBrowOuter = 0.2;
    }

    // Smooth temporal transition for expressive forehead muscles
    this.smoothedBrowInner = lerp(this.smoothedBrowInner, targetBrowInner, 0.2);
    this.smoothedBrowOuter = lerp(this.smoothedBrowOuter, targetBrowOuter, 0.2);
    this.smoothedCheek = lerp(this.smoothedCheek, targetCheek, 0.25);

    outputs['browInnerUp'] = this.smoothedBrowInner;
    outputs['browOuterUpLeft'] = this.smoothedBrowOuter;
    outputs['browOuterUpRight'] = this.smoothedBrowOuter;
    outputs['cheekSquintLeft'] = Math.max(outputs['cheekSquintLeft'] || 0, this.smoothedCheek);
    outputs['cheekSquintRight'] = Math.max(outputs['cheekSquintRight'] || 0, this.smoothedCheek);

    // ─── 4. Interactive Head & Neck Rotation (Part 2.1) ─────────────────────
    // Calculate targeted head yaw (y-axis) and pitch (x-axis) toward cursor coordinates.
    // Notice sign inversion on yaw: positive pointerX moves head towards positive X rotation.
    let targetHeadYaw = clamp(pointerX * 0.6, -MAX_NECK_YAW, MAX_NECK_YAW);
    let targetHeadPitch = clamp(-pointerY * 0.35, -MAX_NECK_PITCH, MAX_NECK_PITCH);

    // State override: Thinking head aversion and Listening lean
    if (isThinking) {
      targetHeadYaw = lerp(targetHeadYaw, 0.3, 0.4);
      targetHeadPitch = lerp(targetHeadPitch, -0.2, 0.4);
    } else if (isListening) {
      targetHeadPitch += 0.08; // Subtle forward tilt for attentiveness
    }

    const currentDamping = isIdle ? HEAD_DAMPING * 0.4 : HEAD_DAMPING;
    this.currentHeadRotation.y = lerp(this.currentHeadRotation.y, targetHeadYaw, currentDamping);
    this.currentHeadRotation.x = lerp(this.currentHeadRotation.x, targetHeadPitch, currentDamping);
    this.currentHeadRotation.z = lerp(this.currentHeadRotation.z, -pointerX * 0.08, currentDamping * 0.5); // Slight roll tilt for natural aesthetics

    // ─── 5. Full Body Procedural Dynamics (IK/FK) ───────────────────────────
    const boneRotations: Record<string, {x: number, y: number, z: number}> = {};
    const getRot = (name: string) => { 
      if (!boneRotations[name]) boneRotations[name] = {x:0, y:0, z:0}; 
      return boneRotations[name]; 
    };

    // 5.1 Rest Pose: Relax the RPM A-pose (arms closer to body and slightly pitched forward)
    getRot('LeftArm').z -= 0.2;
    getRot('RightArm').z += 0.2;
    
    // Pitch arms slightly forward so they don't clip into hips
    getRot('LeftArm').x += 0.1;
    getRot('RightArm').x += 0.1;
    
    // Add natural elbow bend (forearms) - X is the hinge axis. Positive X bends elbows forward.
    getRot('LeftForeArm').x += 0.25;
    getRot('RightForeArm').x += 0.25;

    // Relax the wrists (hands) - Positive X drops them slightly
    getRot('LeftHand').x += 0.1;
    getRot('RightHand').x += 0.1;

    // Accumulate breath phase
    const respirationSpeed = isIdle ? 1.0 : 1.5;
    this.breathPhase += input.delta * respirationSpeed;
    
    // 5.2 Core Vitality (Spine sway & Chest breathing)
    // Weight shifting: Slow, subtle side-to-side sway to mask stiffness
    const swayZ = Math.sin(elapsedTime * 0.4) * 0.015;
    const twistY = Math.cos(elapsedTime * 0.3) * 0.02;
    
    getRot('Spine').z += swayZ;
    getRot('Spine').y += twistY;
    
    getRot('Spine1').z += swayZ * 0.8;
    getRot('Spine1').y += twistY * 0.8;

    // Chest breathing: Forward pitch expansion
    const chestRiseX = Math.sin(this.breathPhase) * 0.015;
    getRot('Spine2').x += chestRiseX;
    
    // Shoulder breathing: Shoulders lift slightly during inhalation to make the chest expansion feel connected
    const shoulderRise = Math.sin(this.breathPhase) * 0.02;
    getRot('LeftShoulder').z += shoulderRise;
    getRot('RightShoulder').z -= shoulderRise;

    // 5.3 Cervical Chain Distribution
    // Yaw (Y) and pitch (X) are distributed across Head (50%), Neck (30%), Spine2 (20%).
    // Because bone rotations compound, the head achieves 100% total rotation, but via a natural curve.
    // Roll (Z) stays on the Head bone ONLY to prevent unnatural spine corkscrewing.
    getRot('Head').y += this.currentHeadRotation.y * 0.5;
    getRot('Head').x += this.currentHeadRotation.x * 0.5;
    getRot('Head').z += this.currentHeadRotation.z; // All roll on Head only

    getRot('Neck').y += this.currentHeadRotation.y * 0.3;
    getRot('Neck').x += this.currentHeadRotation.x * 0.3;

    getRot('Spine2').y += this.currentHeadRotation.y * 0.2;
    getRot('Spine2').x += this.currentHeadRotation.x * 0.2;

    // 5.4 Attentive tilt during listening (applied to Head)
    let targetTilt = 0;
    if (isListening) {
      targetTilt = -0.03;
    }
    this.smoothedSceneRotZ = lerp(this.smoothedSceneRotZ, targetTilt, 0.08);
    getRot('Head').z += this.smoothedSceneRotZ;

    return {
      blendshapes: outputs,
      boneRotations,
      sceneOffset: {
        positionY: 0, // Root vertical bobbing removed; shifted to chest breathing
        rotationY: Math.sin(elapsedTime * 0.5) * 0.04, // Fallback gentle idle turn
        rotationZ: 0,
      },
    };
  }

  /** Resets engine internal state. */
  reset(): void {
    this.isBlinking = false;
    this.wasSpeaking = false;
    this.currentHeadRotation = { x: 0, y: 0, z: 0 };
    this.smoothedBrowInner = 0;
    this.smoothedBrowOuter = 0;
    this.smoothedCheek = 0;
  }
}
