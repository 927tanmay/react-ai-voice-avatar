/**
 * audioLipSync.ts
 *
 * Real-time FFT-based lip sync engine.
 *
 * Reads frequency-band energy from a Web Audio AnalyserNode and converts it
 * into normalized mouth-shape parameters that drive the avatar's morph targets.
 *
 * This module produces audio-driven "how wide / how rounded" signals, while
 * phonemeTiming.ts determines "what shape" based on the known text. The two
 * are blended in the final useFrame render loop.
 *
 * Band layout (tuned for human speech at 24 kHz / 44.1 kHz sample rates):
 *   Low   (  0 – 500 Hz)  → fundamental + jaw openness
 *   Mid   (500 – 2500 Hz) → formants F1/F2 → vowel shape / lip stretch
 *   High  (2500 – 8000 Hz) → fricatives, sibilants, plosive bursts
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AudioLipSyncState {
  /** Overall vocal energy (0–1). Drives general jaw openness. */
  energy: number;
  /** Low-frequency vocal power (0–1). Correlates with voiced phonation. */
  lowBand: number;
  /** Mid-frequency formant energy (0–1). Indicates vowel / lip stretch. */
  midBand: number;
  /** High-frequency energy (0–1). Indicates fricatives / sibilants. */
  highBand: number;
  /** Whether the audio is actively producing speech (above silence threshold). */
  isSpeaking: boolean;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const SILENCE_THRESHOLD = 0.02;    // Below this energy = silence
const SMOOTHING_FACTOR = 0.3;      // Lerp alpha for frame-to-frame smoothing (0 = frozen, 1 = raw)
const ENERGY_SCALE = 2.5;          // Multiplier to map typical speech dB into 0–1 range

// ─── AudioLipSync Class ─────────────────────────────────────────────────────

export class AudioLipSync {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private binCount: number;
  private sampleRate: number;
  private binWidth: number;

  // Smoothed output state
  private _state: AudioLipSyncState = {
    energy: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false,
  };

  // Previous frame values for smoothing
  private _prev: AudioLipSyncState = {
    energy: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false,
  };

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.binCount = analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.binCount);
    this.sampleRate = analyser.context.sampleRate;
    // Each FFT bin covers sampleRate / fftSize Hz
    this.binWidth = this.sampleRate / (this.binCount * 2);
  }

  /**
   * Call once per animation frame (inside useFrame).
   * Reads fresh FFT data and returns smoothed lip-sync parameters.
   */
  update(): AudioLipSyncState {
    this.analyser.getByteFrequencyData(this.dataArray as unknown as Uint8Array<ArrayBuffer>);

    // Compute frequency band boundaries in bin indices
    const lowEnd = Math.min(Math.floor(500 / this.binWidth), this.binCount);
    const midEnd = Math.min(Math.floor(2500 / this.binWidth), this.binCount);
    const highEnd = Math.min(Math.floor(8000 / this.binWidth), this.binCount);

    let lowSum = 0, midSum = 0, highSum = 0, totalSum = 0;
    let lowCount = 0, midCount = 0, highCount = 0;

    for (let i = 0; i < this.binCount && i < highEnd; i++) {
      const val = this.dataArray[i] / 255; // Normalize 0–1
      totalSum += val;

      if (i < lowEnd) {
        lowSum += val;
        lowCount++;
      } else if (i < midEnd) {
        midSum += val;
        midCount++;
      } else {
        highSum += val;
        highCount++;
      }
    }

    // Average energy per band (avoid division by zero)
    const rawLow = lowCount > 0 ? (lowSum / lowCount) * ENERGY_SCALE : 0;
    const rawMid = midCount > 0 ? (midSum / midCount) * ENERGY_SCALE : 0;
    const rawHigh = highCount > 0 ? (highSum / highCount) * ENERGY_SCALE : 0;
    const rawEnergy = this.binCount > 0
      ? (totalSum / Math.min(this.binCount, highEnd)) * ENERGY_SCALE
      : 0;

    // Clamp all values to 0–1
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

    const energy = clamp01(rawEnergy);
    const lowBand = clamp01(rawLow);
    const midBand = clamp01(rawMid);
    const highBand = clamp01(rawHigh);
    const isSpeaking = energy > SILENCE_THRESHOLD;

    // Smooth with previous frame to avoid jittery movements
    const lerp = (prev: number, next: number) =>
      prev + (next - prev) * SMOOTHING_FACTOR;

    this._state = {
      energy: lerp(this._prev.energy, energy),
      lowBand: lerp(this._prev.lowBand, lowBand),
      midBand: lerp(this._prev.midBand, midBand),
      highBand: lerp(this._prev.highBand, highBand),
      isSpeaking,
    };

    this._prev = { ...this._state };
    return this._state;
  }

  /**
   * Get the last computed state without reading new FFT data.
   */
  get state(): AudioLipSyncState {
    return this._state;
  }

  /**
   * Reset to silence. Call when speech playback stops.
   */
  reset(): void {
    const silent: AudioLipSyncState = {
      energy: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false,
    };
    this._state = silent;
    this._prev = silent;
  }
}
