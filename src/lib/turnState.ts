/**
 * turnState.ts
 *
 * The rules for how a conversation moves between states.
 *
 * WHY THIS EXISTS
 *
 * The status used to be assigned from seventeen places: voice detection
 * callbacks, worker message handlers, a watchdog timer, the imperative methods,
 * and a readiness effect. Each assignment was locally correct and the set of
 * them was not, because nothing said which transitions were legal and the
 * events do not arrive in the order the code is written in.
 *
 * The bug that made this worth extracting: a reply chunk generated moments
 * before the user interrupted would arrive afterwards and set the status to
 * 'speaking' while the user was mid-sentence. Nothing in the code looked wrong.
 * The rule that was missing — a reply may never start while someone is speaking
 * — had nowhere to live.
 *
 * Now it has somewhere to live, and it is a pure function, so the rules can be
 * tested without a browser, a microphone, or a model download.
 */

export type TurnStatus = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking';

export type TurnEvent =
  /** The models finished loading. */
  | 'models-ready'
  /** The models went away, usually an engine swap. */
  | 'models-unready'
  /** Voice detection heard speech begin. */
  | 'user-started-speaking'
  /** Voice detection heard speech end and handed over the audio. */
  | 'user-stopped-speaking'
  /** Voice detection decided the sound was not speech after all. */
  | 'user-speech-misfired'
  /** The host called startListening(). */
  | 'listen-requested'
  /** The host called stopListening() or interrupt(). */
  | 'stop-requested'
  /** The host called speak(). */
  | 'speak-requested'
  /** The host called sendText(). */
  | 'text-submitted'
  /** A chunk of the reply began playing. */
  | 'reply-audio-started'
  /**
   * A reply that was paused by a false trigger is continuing.
   *
   * Distinct from `reply-audio-started`, which is refused while someone is
   * speaking so that a late chunk cannot take the floor back. This one is only
   * ever sent after the detector has withdrawn its claim that anyone spoke.
   */
  | 'reply-resumed'
  /** The reply finished and the queue is empty. */
  | 'reply-finished'
  /** Promised audio never arrived. */
  | 'reply-stalled'
  /** Transcription, generation or synthesis failed. */
  | 'pipeline-failed';

/**
 * Legal transitions. An event absent from a state's row is ignored there.
 *
 * Ignoring rather than throwing is deliberate: these events come from timers,
 * workers and a voice detector, all of which can deliver late. A late event is
 * normal, not a fault, and the right response is to let it pass.
 */
const TRANSITIONS: Record<TurnStatus, Partial<Record<TurnEvent, TurnStatus>>> = {
  // Nothing can happen until the models are up. The imperative methods guard on
  // readiness themselves, so they are not listed here.
  loading: {
    'models-ready': 'idle',
  },

  idle: {
    'models-unready': 'loading',
    'user-started-speaking': 'listening',
    'listen-requested': 'listening',
    'user-stopped-speaking': 'thinking',
    'text-submitted': 'thinking',
    'speak-requested': 'speaking',
  },

  // The user holds the floor. Every event belonging to the abandoned reply is
  // absent on purpose: none of them may take the floor back.
  listening: {
    'user-stopped-speaking': 'thinking',
    'user-speech-misfired': 'idle',
    'reply-resumed': 'speaking',
    'stop-requested': 'idle',
    'pipeline-failed': 'idle',
    'text-submitted': 'thinking',
    'speak-requested': 'speaking',
  },

  thinking: {
    'reply-audio-started': 'speaking',
    'reply-finished': 'idle',
    'reply-stalled': 'idle',
    'pipeline-failed': 'idle',
    'stop-requested': 'idle',
    'user-started-speaking': 'listening',
    'speak-requested': 'speaking',
  },

  speaking: {
    // Each chunk of a reply reports itself; staying put is the normal case.
    'reply-audio-started': 'speaking',
    'reply-finished': 'idle',
    'reply-stalled': 'idle',
    'pipeline-failed': 'idle',
    'stop-requested': 'idle',
    'user-started-speaking': 'listening',
    'speak-requested': 'speaking',
    'text-submitted': 'thinking',
  },
};

/**
 * The status this event leads to, or null when it does not apply here.
 *
 * Returning null rather than the current status lets a caller tell "this event
 * was ignored" from "this event kept us where we were", which matters when
 * deciding whether to fire a side effect alongside the transition.
 */
export function nextStatus(current: TurnStatus, event: TurnEvent): TurnStatus | null {
  const target = TRANSITIONS[current]?.[event];
  if (target === undefined) return null;
  return target;
}

/** True when this event would be ignored in this state. */
export function isIgnored(current: TurnStatus, event: TurnEvent): boolean {
  return nextStatus(current, event) === null;
}
