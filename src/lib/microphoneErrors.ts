/**
 * microphoneErrors.ts
 *
 * Tell the user's microphone failing apart from the voice detector failing.
 *
 * WHY THIS EXISTS
 *
 * Both used to be reported as "Microphone access denied". A detector whose
 * model, WebAssembly or audio worklet would not load is not the user refusing
 * permission, and an app that told them to check their settings sent them
 * looking for a problem they did not have. The `detail` values here are
 * stable, so a host can branch on them.
 */

export type MicrophoneErrorDetail =
  /** The user, or the page's permissions policy, refused the microphone. */
  | 'permission-denied'
  /** There is no microphone, or none that meets the constraints. */
  | 'no-microphone'
  /** It exists but could not be started, usually because another app holds it. */
  | 'microphone-busy'
  /** Anything else from the browser while opening it. */
  | 'microphone-unavailable';

export type SpeechDetectionErrorDetail =
  /** The detector's model did not download or would not load. */
  | 'vad-model'
  /** onnxruntime's WebAssembly, which runs the model, did not load. */
  | 'vad-wasm'
  /** The audio worklet that feeds it the microphone did not load. */
  | 'vad-worklet'
  /** Starting the detector failed some other way. */
  | 'vad-start';

const MICROPHONE_NAMES: Record<string, MicrophoneErrorDetail> = {
  NotAllowedError: 'permission-denied',
  SecurityError: 'permission-denied',
  PermissionDeniedError: 'permission-denied',
  NotFoundError: 'no-microphone',
  DevicesNotFoundError: 'no-microphone',
  OverconstrainedError: 'no-microphone',
  NotReadableError: 'microphone-busy',
  TrackStartError: 'microphone-busy',
};

const MICROPHONE_MESSAGES: Record<MicrophoneErrorDetail, string> = {
  'permission-denied': 'Microphone permission was denied. Allow it in the browser’s site settings to talk.',
  'no-microphone': 'No microphone was found.',
  'microphone-busy': 'The microphone could not be started. Another app may be using it.',
  'microphone-unavailable': 'The microphone could not be opened.',
};

const errorName = (err: unknown) => (err && typeof err === 'object' && 'name' in err ? String((err as Error).name) : '');
const errorMessage = (err: unknown) => (err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : String(err));

/** Whether a failure came from the browser's microphone, as opposed to anything else. */
export function isMicrophoneError(err: unknown): boolean {
  return errorName(err) in MICROPHONE_NAMES;
}

/** A failure from getUserMedia, as a stable detail and a message for the user. */
export function classifyMicrophoneError(err: unknown): { detail: MicrophoneErrorDetail; message: string } {
  const detail = MICROPHONE_NAMES[errorName(err)] ?? 'microphone-unavailable';
  const message = detail === 'microphone-unavailable'
    ? `${MICROPHONE_MESSAGES[detail]} ${errorMessage(err)}`.trim()
    : MICROPHONE_MESSAGES[detail];
  return { detail, message };
}

/**
 * A failure from the voice detector. `phase` is where it happened: loading
 * fetches the model and builds it with onnxruntime, and the first start loads
 * the audio worklet. vad-web reports none of these with a type of its own, so
 * the browser's message decides, and the original stays in the message.
 */
export function classifyDetectorError(
  err: unknown,
  phase: 'load' | 'start',
): { detail: SpeechDetectionErrorDetail; message: string } {
  const raw = errorMessage(err);
  let detail: SpeechDetectionErrorDetail;
  if (/worklet/i.test(raw)) detail = 'vad-worklet';
  else if (phase === 'start') detail = 'vad-start';
  else if (/wasm|backend/i.test(raw)) detail = 'vad-wasm';
  else detail = 'vad-model';
  const what = {
    'vad-model': 'could not load its model',
    'vad-wasm': 'could not load its WebAssembly runtime',
    'vad-worklet': 'could not load its audio worklet',
    'vad-start': 'could not start',
  }[detail];
  return { detail, message: `The voice detector ${what}, so speech cannot be heard. ${raw}`.trim() };
}
