/**
 * pushToTalk.ts
 *
 * What to hand over when someone lets go of the talk button.
 *
 * WHY THIS EXISTS
 *
 * Push-to-talk never submitted anything. Every voice detector handler returned
 * early in that mode, and stopListening only paused the detector, so whatever
 * was said while the button was held was dropped and the status stayed on
 * 'listening' for good.
 *
 * The detector's own segments cannot simply be passed through either. It ends a
 * segment after `redemptionMs` of silence, which would submit half an answer
 * whenever someone paused for thought with the button still down. In
 * push-to-talk the button says when the turn ends, not the silence. So every
 * frame is kept while it is held, and on release this cuts the held audio down
 * to the speech in it, padded as the detector would have padded it.
 *
 * Pure, so the rules can be tested without a microphone.
 */

/** Every frame heard while the button was held, and whether each was speech. */
export interface HeldAudio {
  frames: Float32Array[];
  speech: boolean[];
}

export interface HeldSpeechOptions {
  /** Length of one frame. Frames are 16 kHz, so 1536 samples is 96 ms. */
  msPerFrame: number;
  /** Less speech than this is noise, not a turn: nothing is handed over. */
  minSpeechMs: number;
  /** Audio kept either side of the speech, so no syllable is clipped. */
  preSpeechPadMs: number;
}

/**
 * The speech in a hold, or null when there was none worth transcribing.
 *
 * Null matters: speech recognition handed a hold of pure room noise invents a
 * sentence rather than returning nothing, and the avatar would answer it.
 */
export function heldSpeech(
  held: HeldAudio,
  { msPerFrame, minSpeechMs, preSpeechPadMs }: HeldSpeechOptions,
): { audio: Float32Array; speechMs: number } | null {
  if (!(msPerFrame > 0)) return null;

  const first = held.speech.indexOf(true);
  if (first === -1) return null;
  const last = held.speech.lastIndexOf(true);

  const speechFrames = held.speech.reduce((n, isSpeech) => (isSpeech ? n + 1 : n), 0);
  if (speechFrames * msPerFrame < minSpeechMs) return null;

  const pad = Math.ceil(preSpeechPadMs / msPerFrame);
  const kept = held.frames.slice(Math.max(0, first - pad), Math.min(held.frames.length, last + 1 + pad));

  const audio = new Float32Array(kept.reduce((n, frame) => n + frame.length, 0));
  let offset = 0;
  for (const frame of kept) {
    audio.set(frame, offset);
    offset += frame.length;
  }

  return { audio, speechMs: Math.round((last - first + 1) * msPerFrame) };
}
