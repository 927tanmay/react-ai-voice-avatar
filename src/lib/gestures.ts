/**
 * gestures.ts
 *
 * Decides what the arms do while the avatar talks. Pure numbers in and out —
 * turning a pose into bone rotations is armRig.ts's job — so the behaviour can
 * be tested without a model, a browser or a GPU.
 *
 * WHAT IT IS MODELLED ON
 *
 * People talking do not gesture continuously, and they do not gesture the same
 * way twice. Most conversational gesture is small "beats" — the hand dipping on
 * a stressed syllable — laid over a held position for each phrase: one hand
 * raised a little, both hands open, or none at all. So:
 *
 * - Each phrase of speech gets one position, chosen with some randomness and
 *   never the same one-handed gesture twice running. Roughly one phrase in six
 *   gets no gesture, because constant motion reads as nervous.
 * - While it is held, the gesturing hand dips and rises with the voice's
 *   energy, which puts the beats on the loud syllables.
 * - When the voice stops, the arms go back to the model's own rest pose — not
 *   at once, because a pause between words is not the end of a phrase.
 * - Nothing jumps. Every channel is driven through a critically damped spring,
 *   so a new target is eased into rather than snapped to, and a long frame (a
 *   tab switch, a GC pause) cannot fling an arm.
 *
 * Where the hands go was decided by looking, not guessed. The first version
 * kept them low — an elbow a little past 45° — on the theory that big gestures
 * read as flailing. On the homepage's framing, head to belt, that left the hands
 * below the frame: all a visitor saw was fingertips flickering in at the bottom
 * corners, which is worse than no gesture. The hands now come up in front of
 * the chest and stomach, where most conversational gesture actually happens and
 * where a head-and-torso shot can see it: the elbow bent to around 85°, the
 * upper arm lifted about 15°.
 */

import type { ArmPose } from './armRig';

export type ConversationStatus = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';

export interface GestureInput {
  /** Seconds since the last update. */
  delta: number;
  /** Voice energy, 0–1, from the lip-sync analysis. */
  energy: number;
  /** Whether audio is audibly playing right now. */
  isSpeaking: boolean;
  status: ConversationStatus;
}

export interface GesturePose {
  left: ArmPose;
  right: ArmPose;
}

export interface GestureOptions {
  /** 0 turns gestures off, 1 is the default size. Values above 1 are capped at 1.5. */
  intensity?: number;
  /** Random numbers in [0, 1). Injectable so behaviour is repeatable in tests. */
  random?: () => number;
}

type Shape = 'rest' | 'left' | 'right' | 'both';

/** Held positions, before intensity and per-phrase variation. Radians. */
const SHAPES: Record<Shape, GesturePose> = {
  rest: {
    left: { lift: 0, spread: 0, elbow: 0, wrist: 0 },
    right: { lift: 0, spread: 0, elbow: 0, wrist: 0 },
  },
  // One hand up to the chest, the other only slightly bent, so it is not a
  // mirror image.
  left: {
    left: { lift: 0.26, spread: 0.08, elbow: 1.5, wrist: -0.12 },
    right: { lift: 0.04, spread: 0, elbow: 0.3, wrist: 0 },
  },
  right: {
    left: { lift: 0.04, spread: 0, elbow: 0.3, wrist: 0 },
    right: { lift: 0.26, spread: 0.08, elbow: 1.5, wrist: -0.12 },
  },
  // Both hands forward in front of the torso and a little apart: an open,
  // explaining gesture.
  both: {
    left: { lift: 0.24, spread: 0.1, elbow: 1.4, wrist: -0.1 },
    right: { lift: 0.24, spread: 0.1, elbow: 1.4, wrist: -0.1 },
  },
};

/** How often each shape is chosen for a phrase. */
const SHAPE_WEIGHTS: Array<[Shape, number]> = [
  ['right', 0.32],
  ['left', 0.28],
  ['both', 0.24],
  ['rest', 0.16],
];

/** How long one held position lasts within continuous speech, in seconds. */
const PHRASE_MIN = 2.2;
const PHRASE_MAX = 4.5;

/** How long the voice must be quiet before the arms go back to rest. */
const RELEASE_AFTER = 0.6;

/**
 * How far a beat moves the gesturing hand. Radians per unit of beat signal,
 * which swings about ±0.5 on ordinary speech — so about ±5° at the elbow.
 *
 * The wrist's is a little smaller than the elbow's, not larger: the hand
 * already rides the elbow's stroke, and at 0.22 the wrist alone broke the snap
 * limit, gaining 66°/s in a single frame.
 */
const BEAT_ELBOW = 0.18;
const BEAT_WRIST = 0.15;

/**
 * Beats come from the voice's energy with its slow trend removed: a slow
 * follower tracks the phrase's loudness, and energy minus that swings positive
 * on a stressed syllable and negative between syllables. That keeps beats
 * centred on the held position rather than pushing the hand further the louder
 * someone talks. Energy arrives already smoothed by the lip-sync analysis, so it
 * is not smoothed again here: a second follower only added delay, measured at
 * 50 ms between a syllable and its stroke, against 17 ms without.
 *
 * They bypass the pose springs on purpose. Syllables come about four times a
 * second, and the springs that make a phrase's position ease in are slow enough
 * to average them away entirely — measured, the raised elbow read the same on
 * loud and quiet syllables to three decimal places.
 */
const BEAT_SLOW_SECONDS = 0.35;
const BEAT_GAIN = 3;

/**
 * The beat itself goes through a spring, fast enough to keep up with syllables.
 * Energy has corners — every syllable starts and stops abruptly — and a hand
 * following them directly changes speed in one frame at each one, measured at
 * 96°/s gained in a single frame at the wrist. 8 Hz was chosen by sweep: beats
 * of about 5° peak to peak at the elbow, landing 17 ms after the syllable,
 * inside both of test-gestures.mjs's motion limits. Slower lags and shrinks
 * them; faster gets close to the snap limit for no visible gain.
 */
const BEAT_HZ = 8;

/**
 * How quickly beats fade in and out as a hand is raised or lowered, in Hz.
 *
 * Beats used to be weighted by how high the elbow was at that instant. As an
 * arm swung down at a phrase's end, that weight changed fast while the beat
 * itself was oscillating fast, and the two together broke the snap limit —
 * 64°/s gained in one frame, which slowing the elbow barely touched (still 55
 * at 1.8 Hz). Fading beats from the phrase's plan instead takes the gate off the
 * fastest-moving joint.
 */
const BEAT_FADE_HZ = 2;

/**
 * Spring frequencies in Hz: the upper arm moves slowly, the hand quickly.
 *
 * The elbow was 2.2 until the gestures were raised to chest height. A bigger
 * movement then needed a little longer to start — as it does for a person — or
 * an arm dropping from 85° at a phrase's end broke the snap limit at 61°/s
 * gained in one frame. 2.0 with a 0.16 s ease measures 54.
 */
const FREQUENCY: Record<keyof ArmPose, number> = {
  lift: 1.3,
  spread: 1.3,
  elbow: 2.0,
  wrist: 3.0,
};

/**
 * A new phrase's position is eased in before the springs see it.
 *
 * A spring given a new target accelerates at once, so on its own it takes a
 * joint from still to full speed in one frame — measured at nearly 5° in a
 * single frame at the start of every gesture. Easing the target first lets
 * speed build over several frames, the way an arm actually starts to move.
 */
const TARGET_EASE_SECONDS = 0.16;

/** Longer frames are integrated as this, so a stall cannot fling an arm. */
const MAX_STEP = 1 / 30;

const CHANNELS = ['lift', 'spread', 'elbow', 'wrist'] as const;

interface Spring {
  value: number;
  velocity: number;
}

const zeroArm = (): Record<keyof ArmPose, Spring> => ({
  lift: { value: 0, velocity: 0 },
  spread: { value: 0, velocity: 0 },
  elbow: { value: 0, velocity: 0 },
  wrist: { value: 0, velocity: 0 },
});

export class GestureEngine {
  private readonly random: () => number;
  private intensity: number;

  private springs = { left: zeroArm(), right: zeroArm() };
  /** The target as eased toward, per channel, before the springs follow it. */
  private eased: GesturePose = { left: { ...SHAPES.rest.left }, right: { ...SHAPES.rest.right } };
  private slowEnergy = 0;
  private beat: Spring = { value: 0, velocity: 0 };
  /** How much each hand beats, eased toward whether the phrase raises it. */
  private beatWeight = { left: { value: 0, velocity: 0 } as Spring, right: { value: 0, velocity: 0 } as Spring };
  private shape: Shape = 'rest';
  private lastOneHanded: Shape | null = null;
  /** Per-phrase size, so no two phrases are exactly alike. */
  private scale = { left: 1, right: 1 };
  private phraseLeft = 0;
  private quietFor = Infinity;
  private inPhrase = false;

  constructor(options: GestureOptions = {}) {
    this.random = options.random ?? Math.random;
    this.intensity = clampIntensity(options.intensity ?? 1);
  }

  setIntensity(intensity: number): void {
    this.intensity = clampIntensity(intensity);
  }

  /** The position the current phrase is holding, for diagnostics and tests. */
  get currentShape(): Shape {
    return this.shape;
  }

  update(input: GestureInput): GesturePose {
    const delta = Math.max(0, input.delta);
    const speaking = input.status === 'speaking' && input.isSpeaking;

    this.quietFor = speaking ? 0 : this.quietFor + delta;
    const talking = this.quietFor < RELEASE_AFTER && input.status === 'speaking';

    if (talking && !this.inPhrase) {
      this.inPhrase = true;
      this.beginPhrase();
    } else if (!talking && this.inPhrase) {
      this.inPhrase = false;
      this.shape = 'rest';
    }

    if (this.inPhrase) {
      this.phraseLeft -= delta;
      if (this.phraseLeft <= 0) this.beginPhrase();
    }

    const energy = speaking && Number.isFinite(input.energy) ? clamp(input.energy, 0, 1) : 0;
    const target = this.target();

    // Integrate in small steps: a critically damped spring is only stable when
    // each step is short compared with its period. A frame longer than a
    // quarter second — a background tab — is treated as a quarter second.
    let remaining = Math.min(delta, 0.25);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, MAX_STEP);
      remaining -= step;

      this.slowEnergy += (energy - this.slowEnergy) * (1 - Math.exp(-step / BEAT_SLOW_SECONDS));
      const rawBeat = clamp((energy - this.slowEnergy) * BEAT_GAIN, -1, 1);
      stepSpring(this.beat, rawBeat, BEAT_HZ, step);
      for (const side of ['left', 'right'] as const) {
        stepSpring(this.beatWeight[side], this.isRaised(side) ? 1 : 0, BEAT_FADE_HZ, step);
      }

      const ease = 1 - Math.exp(-step / TARGET_EASE_SECONDS);
      for (const side of ['left', 'right'] as const) {
        for (const channel of CHANNELS) {
          const eased = this.eased[side];
          eased[channel] += (target[side][channel] - eased[channel]) * ease;
          stepSpring(this.springs[side][channel], eased[channel], FREQUENCY[channel], step);
        }
      }
    }

    const pose: GesturePose = {
      left: read(this.springs.left),
      right: read(this.springs.right),
    };

    // Beats ride on top of the springs, only on a hand the phrase has raised,
    // faded in and out smoothly so a hand at rest never twitches along.
    const beat = this.beat.value * this.intensity;
    for (const side of ['left', 'right'] as const) {
      const weight = clamp(this.beatWeight[side].value, 0, 1);
      pose[side].elbow -= BEAT_ELBOW * beat * weight;
      pose[side].wrist += BEAT_WRIST * beat * weight;
    }

    return pose;
  }

  /** Back to rest at once, for a reset or an unmount. */
  reset(): void {
    this.springs = { left: zeroArm(), right: zeroArm() };
    this.eased = { left: { ...SHAPES.rest.left }, right: { ...SHAPES.rest.right } };
    this.slowEnergy = 0;
    this.beat = { value: 0, velocity: 0 };
    this.beatWeight = { left: { value: 0, velocity: 0 }, right: { value: 0, velocity: 0 } };
    this.shape = 'rest';
    this.inPhrase = false;
    this.quietFor = Infinity;
  }

  private beginPhrase(): void {
    this.shape = this.pickShape();
    this.phraseLeft = PHRASE_MIN + this.random() * (PHRASE_MAX - PHRASE_MIN);
    this.scale = {
      left: 0.85 + this.random() * 0.25,
      right: 0.85 + this.random() * 0.25,
    };
  }

  private pickShape(): Shape {
    // The same hand twice in a row looks like a tic, so the last one-handed
    // shape is excluded from the draw.
    const pool = SHAPE_WEIGHTS.filter(([shape]) => shape !== this.lastOneHanded);
    const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.random() * total;
    let chosen: Shape = pool[pool.length - 1][0];
    for (const [shape, weight] of pool) {
      roll -= weight;
      if (roll < 0) {
        chosen = shape;
        break;
      }
    }
    this.lastOneHanded = chosen === 'left' || chosen === 'right' ? chosen : null;
    return chosen;
  }

  /** Whether the current phrase holds this hand up, as opposed to at its side. */
  private isRaised(side: 'left' | 'right'): boolean {
    return SHAPES[this.shape][side].elbow > SHAPES.both.left.elbow * 0.5;
  }

  /** The current phrase's held position, sized for this phrase and intensity. */
  private target(): GesturePose {
    const base = SHAPES[this.shape];
    const out: GesturePose = { left: { ...base.left }, right: { ...base.right } };
    for (const side of ['left', 'right'] as const) {
      const size = this.scale[side] * this.intensity;
      for (const channel of CHANNELS) out[side][channel] *= size;
    }
    return out;
  }
}

/**
 * Advance a critically damped spring toward `target` by `dt` seconds.
 *
 * The exact solution rather than a numerical step. Stepping numerically is
 * stable only while each step is short against the spring's period, and a fast
 * spring broke that the moment one existed: the 6 Hz beat spring, given a long
 * frame, diverged and flung an arm 26 radians. The closed form is exact for any
 * `dt`, so no choice of frequency or frame length can do that again.
 */
function stepSpring(spring: Spring, target: number, hz: number, dt: number): void {
  const omega = 2 * Math.PI * hz;
  const offset = spring.value - target;
  const c = spring.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  spring.value = target + (offset + c * dt) * decay;
  spring.velocity = (spring.velocity - omega * c * dt) * decay;
}

function read(arm: Record<keyof ArmPose, Spring>): ArmPose {
  return {
    lift: arm.lift.value,
    spread: arm.spread.value,
    elbow: arm.elbow.value,
    wrist: arm.wrist.value,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampIntensity(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1.5) : 1;
}
