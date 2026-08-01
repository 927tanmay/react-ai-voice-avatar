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
  /** Damped rotational offset (in radians) to apply to the Head or Neck bone. */
  headRotation: { x: number; y: number; z: number };
  /** Root scene breathing and idle micro-movement offset. */
  sceneOffset: { positionY: number; rotationY: number; rotationZ: number };
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
}

// ─── Configuration & Limits ─────────────────────────────────────────────────

const BLINK_MIN_INTERVAL = 2.5; // Minimum seconds between spontaneous blinks
const BLINK_MAX_INTERVAL = 5.5; // Maximum seconds between spontaneous blinks
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

  private scheduleNextBlink(currentTime: number): void {
    this.nextBlinkTime = currentTime + randomRange(BLINK_MIN_INTERVAL, BLINK_MAX_INTERVAL);
  }

  private scheduleNextSaccade(currentTime: number): void {
    this.nextSaccadeTime = currentTime + randomRange(SACCADE_MIN_INTERVAL, SACCADE_MAX_INTERVAL);
    // Generate gentle random saccade target (-1 to +1 range)
    this.targetSaccade = {
      x: randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH),
      y: randomRange(-SACCADE_STRENGTH, SACCADE_STRENGTH),
    };
  }

  /**
   * Evaluates all autonomous micro-expressions and interactive pointer physics for the current frame.
   * Call once per animation frame (inside useFrame) before updating mesh blendshapes and armatures.
   */
  update(input: DynamicsInput): DynamicsOutputs {
    const { elapsedTime, pointerX, pointerY, audioState } = input;
    const outputs: Record<string, number> = {};

    // ─── 1. Autonomous Blinking (Part 1.1) ──────────────────────────────────
    let blinkWeight = 0;
    if (!this.isBlinking && elapsedTime >= this.nextBlinkTime) {
      this.isBlinking = true;
      this.blinkStartTime = elapsedTime;
    }

    if (this.isBlinking) {
      const elapsedInBlink = elapsedTime - this.blinkStartTime;
      if (elapsedInBlink >= BLINK_DURATION) {
        this.isBlinking = false;
        this.scheduleNextBlink(elapsedTime);
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
      this.scheduleNextSaccade(elapsedTime);
    }
    // Smoothly transition saccade position
    this.currentSaccade.x = lerp(this.currentSaccade.x, this.targetSaccade.x, 0.08);
    this.currentSaccade.y = lerp(this.currentSaccade.y, this.targetSaccade.y, 0.08);

    // Combine deliberate pointer tracking with unconscious saccade shifts.
    // In R3F screen coordinates: -pointerX is left of screen, +pointerX is right of screen.
    // Note: Viewer's left is the avatar's right eye perspective, so signs reverse appropriately!
    const effectiveGazeX = clamp(pointerX * 0.8 + this.currentSaccade.x, -1, 1);
    const effectiveGazeY = clamp(pointerY * 0.8 + this.currentSaccade.y, -1, 1);

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
    const targetHeadYaw = clamp(pointerX * 0.6, -MAX_NECK_YAW, MAX_NECK_YAW);
    const targetHeadPitch = clamp(-pointerY * 0.35, -MAX_NECK_PITCH, MAX_NECK_PITCH);

    this.currentHeadRotation.y = lerp(this.currentHeadRotation.y, targetHeadYaw, HEAD_DAMPING);
    this.currentHeadRotation.x = lerp(this.currentHeadRotation.x, targetHeadPitch, HEAD_DAMPING);
    this.currentHeadRotation.z = lerp(this.currentHeadRotation.z, -pointerX * 0.08, HEAD_DAMPING * 0.5); // Slight roll tilt for natural aesthetics

    // ─── 5. Root Scene Idle Dynamics ────────────────────────────────────────
    const sceneOffsetY = Math.sin(elapsedTime * 1.5) * 0.02;
    const sceneRotY = Math.sin(elapsedTime * 0.5) * 0.04;
    const sceneRotZ = Math.cos(elapsedTime * 0.3) * 0.015;

    return {
      blendshapes: outputs,
      headRotation: { ...this.currentHeadRotation },
      sceneOffset: {
        positionY: sceneOffsetY,
        rotationY: sceneRotY,
        rotationZ: sceneRotZ,
      },
    };
  }

  /** Resets engine internal state. */
  reset(): void {
    this.isBlinking = false;
    this.currentHeadRotation = { x: 0, y: 0, z: 0 };
    this.smoothedBrowInner = 0;
    this.smoothedBrowOuter = 0;
    this.smoothedCheek = 0;
  }
}
