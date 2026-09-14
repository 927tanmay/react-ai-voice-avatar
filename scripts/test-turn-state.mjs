/**
 * Checks the conversation's transition rules.
 *
 * These sequences are the ones a microphone would exercise and a type checker
 * never will. They are written as whole conversations rather than single
 * transitions, because every bug this file exists to prevent came from events
 * arriving in an order nobody had pictured.
 *
 * Run with: node --experimental-strip-types scripts/test-turn-state.mjs
 */
import { nextStatus } from '../src/lib/turnState.ts';

/** Replay a sequence of events and return the status after each one. */
function replay(start, events) {
  let status = start;
  const trail = [];
  for (const event of events) {
    const target = nextStatus(status, event);
    if (target !== null) status = target;
    trail.push(`${event} -> ${status}`);
  }
  return { status, trail };
}

const cases = [
  {
    name: 'a whole ordinary turn',
    start: 'loading',
    events: ['models-ready', 'user-started-speaking', 'user-stopped-speaking', 'reply-audio-started', 'reply-finished'],
    expect: 'idle',
  },
  {
    name: 'barge-in: a late chunk cannot take the floor back',
    start: 'speaking',
    // The user interrupts, then a chunk generated before the interrupt lands.
    events: ['user-started-speaking', 'reply-audio-started'],
    expect: 'listening',
  },
  {
    name: 'barge-in: a late completion cannot drop the user to idle',
    start: 'speaking',
    events: ['user-started-speaking', 'reply-finished'],
    expect: 'listening',
  },
  {
    name: 'barge-in: a late stall cannot drop the user to idle',
    start: 'speaking',
    events: ['user-started-speaking', 'reply-stalled'],
    expect: 'listening',
  },
  {
    name: 'barge-in then finishing the sentence still gets a reply',
    start: 'speaking',
    events: ['user-started-speaking', 'reply-audio-started', 'user-stopped-speaking', 'reply-audio-started'],
    expect: 'speaking',
  },
  {
    name: 'a misfire returns to idle rather than sticking on listening',
    start: 'idle',
    events: ['user-started-speaking', 'user-speech-misfired'],
    expect: 'idle',
  },
  {
    name: 'interrupting while the avatar thinks',
    start: 'thinking',
    events: ['user-started-speaking'],
    expect: 'listening',
  },
  {
    name: 'a deliberate stop wins from anywhere in a reply',
    start: 'speaking',
    events: ['stop-requested'],
    expect: 'idle',
  },
  {
    name: 'nothing happens before the models are ready',
    start: 'loading',
    events: ['user-started-speaking', 'reply-audio-started', 'user-stopped-speaking'],
    expect: 'loading',
  },
  {
    name: 'several chunks of one reply keep it speaking',
    start: 'thinking',
    events: ['reply-audio-started', 'reply-audio-started', 'reply-audio-started'],
    expect: 'speaking',
  },
  {
    name: 'a failure anywhere in the pipeline lands on idle',
    start: 'thinking',
    events: ['pipeline-failed'],
    expect: 'idle',
  },
  {
    name: 'typed input interrupts a reply in progress',
    start: 'speaking',
    events: ['text-submitted'],
    expect: 'thinking',
  },
  {
    name: 'an engine swap only unloads from idle',
    start: 'speaking',
    events: ['models-unready'],
    expect: 'speaking',
  },
];

let failures = 0;
for (const { name, start, events, expect } of cases) {
  const { status, trail } = replay(start, events);
  if (status !== expect) {
    console.error(`FAIL  ${name}`);
    console.error(`      from ${start}, expected ${expect}, got ${status}`);
    trail.forEach(line => console.error(`        ${line}`));
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} turn-state check(s) failed.`);
  process.exit(1);
}
console.log(`All ${cases.length} turn-state checks passed.`);
