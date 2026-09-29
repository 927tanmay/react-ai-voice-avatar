/**
 * test-gestures.mjs
 *
 * The gesture engine's behaviour over time, driven by a synthetic voice.
 *
 * What makes gestures read as a person rather than a machine is mostly timing:
 * arms that drop between two words look broken, arms that never come down look
 * frozen, and one frame's jump looks like a glitch. So these run the engine
 * frame by frame, as the renderer does, and check the motion rather than any
 * single value.
 *
 * Whether it looks right is a separate question, answered by watching it in a
 * browser. These keep it from regressing once it does.
 *
 * Run: node --experimental-strip-types scripts/test-gestures.mjs
 */

const { GestureEngine } = await import('../src/lib/gestures.ts');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A repeatable random stream (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME = 1 / 60;

/** Syllable-rate energy, as speech produces it: roughly 4 peaks a second. */
const voice = t => 0.35 + 0.3 * Math.max(0, Math.sin(t * 2 * Math.PI * 4));

/**
 * AudioLipSync eases energy by 0.3 of the way each frame before anything else
 * sees it, so the engine never receives the raw corners above. Feeding them in
 * would test against an input that cannot occur.
 */
function smoothed(energyAt) {
  let value = 0;
  let last = -1;
  return t => {
    const frame = Math.round(t / FRAME);
    while (last < frame) {
      last += 1;
      value += (energyAt(last * FRAME) - value) * 0.3;
    }
    return value;
  };
}

/** Run for `seconds`, calling `sample(pose, t)` every frame. */
function run(engine, seconds, { speaking = true, energy = smoothed(voice), status, start = 0 } = {}, sample) {
  let pose;
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    const t = start + i * FRAME;
    const e = speaking ? energy(t) : 0;
    pose = engine.update({
      delta: FRAME,
      energy: e,
      isSpeaking: speaking && e > 0.02,
      status: status ?? (speaking ? 'speaking' : 'idle'),
    });
    sample?.(pose, t);
  }
  return pose;
}

const magnitude = pose =>
  Math.max(...['left', 'right'].flatMap(s => ['lift', 'spread', 'elbow', 'wrist'].map(c => Math.abs(pose[s][c]))));

console.log('\nAt rest');
{
  const engine = new GestureEngine({ random: seeded(1) });
  let worst = 0;
  run(engine, 5, { speaking: false }, pose => (worst = Math.max(worst, magnitude(pose))));
  check('an idle avatar holds exactly the model\'s own pose', worst === 0, `moved by ${worst}`);
}
for (const status of ['listening', 'thinking', 'loading']) {
  const engine = new GestureEngine({ random: seeded(2) });
  let worst = 0;
  // Energy present but the avatar is not the one speaking — the user is.
  run(engine, 3, { speaking: true, status }, pose => (worst = Math.max(worst, magnitude(pose))));
  check(`while ${status}, the arms stay still even with sound in the room`, worst === 0, `moved by ${worst}`);
}

console.log('\nWhile speaking');
{
  const engine = new GestureEngine({ random: seeded(3) });
  let moved = 0;
  run(engine, 20, {}, pose => (moved = Math.max(moved, magnitude(pose))));
  check('the arms move', moved > 0.3, `largest movement ${moved.toFixed(3)} rad`);
}
{
  const engine = new GestureEngine({ random: seeded(4) });
  const peak = { lift: 0, spread: 0, elbow: 0, wrist: 0 };
  run(engine, 60, { energy: () => 1 }, pose => {
    for (const s of ['left', 'right']) for (const c of Object.keys(peak)) peak[c] = Math.max(peak[c], Math.abs(pose[s][c]));
  });
  // Degrees, because that is how anyone reviewing this will think about it.
  //
  // These were 12° and 80° until the gestures were looked at on the homepage's
  // framing, where hands kept that low never entered the frame. Hands in front
  // of the chest need about 85° at the elbow and 15° at the shoulder; these
  // limits leave room for a larger phrase and a beat on top, and no more. An
  // elbow past 105° puts the hand at the collarbone, which no longer reads as
  // conversation.
  const deg = r => Math.round((r * 180) / Math.PI);
  check('an upper arm never lifts more than 20°', peak.lift < (20 * Math.PI) / 180, `${deg(peak.lift)}°`);
  check('or swings out more than 12°', peak.spread < (12 * Math.PI) / 180, `${deg(peak.spread)}°`);
  check('an elbow never bends more than 105° past rest, even at full voice', peak.elbow < (105 * Math.PI) / 180, `${deg(peak.elbow)}°`);
  check('a wrist never flexes more than 25°', peak.wrist < (25 * Math.PI) / 180, `${deg(peak.wrist)}°`);
}
{
  // Two limits, both from how people move rather than from this code.
  //
  // Peak speed: conversational gesture strokes top out at a few hundred degrees
  // a second at the elbow. 300°/s is quick but human; faster reads as a glitch.
  //
  // No snap: a joint must not go from still to fast in one frame. Gaining more
  // than 60°/s of speed in a single 1/60 s frame is the visible "twitch" at the
  // start of a movement — what an arm does when something yanks it.
  const engine = new GestureEngine({ random: seeded(5) });
  let peakSpeed = 0;
  let worstSpeedChange = 0;
  let prev = null;
  let prevSpeed = null;
  run(engine, 60, {}, pose => {
    if (prev) {
      const speed = {};
      for (const s of ['left', 'right'])
        for (const c of ['lift', 'spread', 'elbow', 'wrist']) {
          const v = (pose[s][c] - prev[s][c]) / FRAME;
          speed[`${s}.${c}`] = v;
          peakSpeed = Math.max(peakSpeed, Math.abs(v));
          if (prevSpeed) worstSpeedChange = Math.max(worstSpeedChange, Math.abs(v - prevSpeed[`${s}.${c}`]));
        }
      prevSpeed = speed;
    }
    prev = structuredClone(pose);
  });
  const dps = r => Math.round((r * 180) / Math.PI);
  check('no joint moves faster than 300°/s', dps(peakSpeed) <= 300, `peak ${dps(peakSpeed)}°/s`);
  check('no joint snaps into motion: under 60°/s of speed gained in one frame', dps(worstSpeedChange) <= 60, `${dps(worstSpeedChange)}°/s gained in one frame`);
}

console.log('\nBeats');
{
  // Hold one phrase and compare the raised hand's elbow on loud and quiet frames.
  //
  // Loud and quiet are judged by the energy the engine was actually given, not
  // the raw voice. That smoothed energy is also what moves the mouth, so a
  // stroke in step with it is a stroke in step with the lips.
  const energy = smoothed(voice);
  const engine = new GestureEngine({ random: seeded(6) });
  run(engine, 1.2, { energy });
  const shape = engine.currentShape;
  const loud = [];
  const quiet = [];
  run(engine, 1.0, { start: 1.2, energy }, (pose, t) => {
    if (shape === 'rest' || shape === 'both') return;
    const raised = pose[shape].elbow;
    const e = energy(t);
    (e > 0.5 ? loud : e < 0.42 ? quiet : []).push(raised);
  });
  // A beat is a down-stroke landing on the stressed syllable, the way a hand
  // "hits" a word for emphasis — so the raised hand is lower on loud frames.
  if (shape === 'left' || shape === 'right') {
    const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    check('the raised hand strokes down on loud syllables', avg(loud) < avg(quiet) - 0.02, `loud ${avg(loud).toFixed(3)} vs quiet ${avg(quiet).toFixed(3)}`);
  } else {
    check('the raised hand strokes down on loud syllables', false, `seed gave a '${shape}' phrase; pick another seed`);
  }
}
{
  // The hand that is not gesturing must not twitch in time with the voice.
  const engine = new GestureEngine({ random: seeded(6) });
  run(engine, 1.2);
  const shape = engine.currentShape;
  const other = shape === 'left' ? 'right' : 'left';
  let lo = Infinity;
  let hi = -Infinity;
  run(engine, 1.0, { start: 1.2 }, pose => {
    lo = Math.min(lo, pose[other].elbow);
    hi = Math.max(hi, pose[other].elbow);
  });
  check('the resting hand does not beat along', hi - lo < 0.01, `range ${(hi - lo).toFixed(4)} rad`);
}

console.log('\nStopping and pausing');
{
  const engine = new GestureEngine({ random: seeded(7) });
  run(engine, 3);
  const after = run(engine, 2.5, { speaking: false, status: 'idle' });
  check('when speech ends the arms return to rest', magnitude(after) < 0.01, `still ${magnitude(after).toFixed(4)} rad out`);
}
{
  const engine = new GestureEngine({ random: seeded(8) });
  // Find a phrase with a gesture, so there is something to drop.
  let t = 0;
  do {
    run(engine, 0.5, { start: t });
    t += 0.5;
  } while (engine.currentShape === 'rest' && t < 30);
  run(engine, 1, { start: t });
  const before = magnitude(run(engine, FRAME, { start: t + 1 }));
  // A 0.3 s gap between words: still speaking, audio briefly silent.
  let lowest = Infinity;
  run(engine, 0.3, { energy: () => 0, start: t + 1 }, pose => (lowest = Math.min(lowest, magnitude(pose))));
  check('a short pause between words does not drop the arms', lowest > before * 0.6, `fell from ${before.toFixed(3)} to ${lowest.toFixed(3)}`);
}

console.log('\nVariety');
{
  const engine = new GestureEngine({ random: seeded(9) });
  const shapes = [];
  let last = null;
  run(engine, 400, {}, () => {
    if (engine.currentShape !== last) {
      shapes.push(engine.currentShape);
      last = engine.currentShape;
    }
  });
  // Consecutive duplicates collapse above, so compare shapes by phrase instead.
  const engine2 = new GestureEngine({ random: seeded(9) });
  const phrases = [];
  let prevLeft = null;
  run(engine2, 400, {}, () => {
    const s = engine2.currentShape;
    const left = engine2['phraseLeft'];
    if (prevLeft !== null && left > prevLeft) phrases.push(s);
    prevLeft = left;
  });
  const repeats = phrases.filter((s, i) => i > 0 && (s === 'left' || s === 'right') && s === phrases[i - 1]).length;
  check('the same hand never gestures two phrases running', repeats === 0, `${repeats} repeats in ${phrases.length} phrases`);
  const restShare = phrases.filter(s => s === 'rest').length / phrases.length;
  check('about one phrase in six has no gesture', restShare > 0.07 && restShare < 0.3, `${Math.round(restShare * 100)}% of ${phrases.length}`);
  const kinds = new Set(phrases);
  check('all four kinds of phrase occur', kinds.size === 4, [...kinds].join(', '));
}

console.log('\nRobustness');
{
  const engine = new GestureEngine({ random: seeded(10) });
  run(engine, 2);
  // A tab left in the background: one enormous frame.
  const pose = engine.update({ delta: 12, energy: 1, isSpeaking: true, status: 'speaking' });
  const finite = ['left', 'right'].every(s => Object.values(pose[s]).every(Number.isFinite));
  check('a 12-second frame produces finite numbers', finite, JSON.stringify(pose));
  check('and does not fling an arm', magnitude(pose) < 1.5, `${magnitude(pose).toFixed(3)} rad`);
}
{
  const engine = new GestureEngine({ random: seeded(11) });
  const pose = engine.update({ delta: -1, energy: NaN, isSpeaking: true, status: 'speaking' });
  check('nonsense input does not produce NaN', ['left', 'right'].every(s => Object.values(pose[s]).every(Number.isFinite)), JSON.stringify(pose));
}
{
  const engine = new GestureEngine({ random: seeded(12), intensity: 0 });
  let worst = 0;
  run(engine, 10, {}, pose => (worst = Math.max(worst, magnitude(pose))));
  check('intensity 0 turns gestures off completely', worst === 0, `moved by ${worst}`);
}
{
  const a = new GestureEngine({ random: seeded(13) });
  const b = new GestureEngine({ random: seeded(13) });
  const pa = run(a, 10);
  const pb = run(b, 10);
  check('the same random stream gives the same motion', JSON.stringify(pa) === JSON.stringify(pb));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
