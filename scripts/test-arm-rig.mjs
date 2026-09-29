/**
 * test-arm-rig.mjs
 *
 * The arm rig against skeletons built to break it.
 *
 * The engine once posed arms with fixed local angles, and on a skeleton other
 * than the one those were written for, one arm swung forward while the other
 * tucked behind the back. So every check here is run on rigs whose bone axes
 * disagree with each other: mirrored between the sides, facing the other way,
 * and rotated the way an FBX import leaves an armature. A pose must mean the
 * same movement, in the body's own terms, on all of them.
 *
 * Positions are measured in the avatar's frame: where the hand ends up relative
 * to where the body faces, not which way a bone's X axis happens to point.
 *
 * Run: node --experimental-strip-types scripts/test-arm-rig.mjs
 */

import * as THREE from 'three';

const { buildArmRigs, applyArmPose, REST_POSE } = await import('../src/lib/armRig.ts');

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

/**
 * A torso with two arms hanging slightly forward of straight, the way the
 * converter's relaxed pose leaves them.
 *
 * `forearmLean` is how far forward the forearm hangs at rest. Negative leans it
 * back, so the plane it makes with the upper arm defines a hinge that would bend
 * the elbow the wrong way if taken at face value.
 *
 * `rightForearmSplay` angles only the right forearm outward at rest, as the
 * shipped Rocketbox avatars really are: their converter bent each elbow about
 * the bone's own axis, which on a mirrored rig bends the two differently, and
 * the right hand hangs about 10 cm further out than the left.
 *
 * `mirrored` gives every right-side bone a local frame spun 180° about its own
 * length, so its local X points the opposite way to the left side's — the
 * property that broke the old fixed angles. `facing` turns the whole body;
 * `zUp` wraps it in the -90° X rotation an FBX import applies.
 */
function makeAvatar({ mirrored = false, facing = 0, zUp = false, forearmLean = 0.18, rightForearmSplay = 0 } = {}) {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  root.add(holder);
  if (zUp) holder.rotation.x = -Math.PI / 2;

  const body = new THREE.Group();
  body.rotation.y = facing;
  // With zUp the holder turned Y into -Z, so stand the body back up inside it.
  if (zUp) body.rotation.x = Math.PI / 2;
  holder.add(body);

  const spine = new THREE.Bone();
  spine.name = 'Spine2';
  spine.position.set(0, 1.4, 0);
  body.add(spine);

  const bones = {};
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const shoulder = new THREE.Bone();
    shoulder.name = `${side}Shoulder`;
    shoulder.position.set(0.08 * sign, 0.05, 0);
    spine.add(shoulder);

    const upper = new THREE.Bone();
    upper.name = `${side}Arm`;
    upper.position.set(0.12 * sign, 0, 0);
    shoulder.add(upper);

    const fore = new THREE.Bone();
    fore.name = `${side}ForeArm`;
    upper.add(fore);

    const hand = new THREE.Bone();
    hand.name = `${side}Hand`;
    fore.add(hand);

    const spin = mirrored && side === 'Right' ? Math.PI : 0;

    // Point each bone's local +Y along the limb, as rigs usually do, then give
    // the right side its spun frame if asked.
    const along = (bone, dir) => {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
      return q;
    };

    // Upper arm hangs down and a touch outward; forearm hangs down and a touch
    // forward, which is the relaxed bend that defines the elbow's hinge.
    const upperDir = new THREE.Vector3(0.1 * sign, -1, 0);
    const splay = side === 'Right' ? rightForearmSplay : 0;
    const foreDir = new THREE.Vector3((0.02 + splay) * sign, -1, forearmLean);
    const upperQ = along(upper, upperDir);
    const foreWorldQ = along(fore, foreDir);

    upper.quaternion.copy(upperQ);
    fore.quaternion.copy(upperQ.clone().invert().multiply(foreWorldQ));
    fore.position.set(0, 0.28, 0);
    hand.position.set(0, 0.25, 0);

    bones[side.toLowerCase()] = { upper, fore, hand };
  }

  root.updateMatrixWorld(true);
  return { root, bones, facingDir: new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing)) };
}

const find = root => name => root.getObjectByName(name) ?? undefined;

/** A point in the body's own terms: forward of the chest, up, and out to that side. */
function bodyCoords(point, facingDir, sideSign) {
  const up = new THREE.Vector3(0, 1, 0);
  const left = new THREE.Vector3().crossVectors(up, facingDir).normalize();
  return {
    forward: point.dot(facingDir),
    up: point.dot(up),
    out: point.dot(left) * sideSign,
  };
}

function worldPos(obj, root) {
  root.updateMatrixWorld(true);
  return obj.getWorldPosition(new THREE.Vector3());
}

const variants = [
  ['a plain rig', {}],
  ['a mirrored rig', { mirrored: true }],
  ['a rig facing away from +Z', { facing: Math.PI * 0.8 }],
  ['an FBX-style Z-up rig', { zUp: true }],
  ['mirrored, turned and Z-up at once', { mirrored: true, facing: -1.1, zUp: true }],
  ['a rest pose with the forearms leaning back', { forearmLean: -0.12 }],
  ['leaning back and mirrored', { forearmLean: -0.12, mirrored: true }],
];

for (const [label, opts] of variants) {
  console.log(`\n${label}`);
  const { root, bones, facingDir } = makeAvatar(opts);
  const rigs = buildArmRigs(root, find(root));

  check('both arms are found', !!rigs.left && !!rigs.right);
  if (!rigs.left || !rigs.right) continue;

  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const rig = rigs[side];
    const { hand, fore } = bones[side];
    const restHand = bodyCoords(worldPos(hand, root), facingDir, sign);
    const restElbow = bodyCoords(worldPos(fore, root), facingDir, sign);

    applyArmPose(rig, { ...REST_POSE, elbow: 0.9 });
    const bent = bodyCoords(worldPos(hand, root), facingDir, sign);
    check(
      `${side}: bending the elbow brings the hand forward`,
      bent.forward > restHand.forward + 0.1,
      `forward ${restHand.forward.toFixed(3)} → ${bent.forward.toFixed(3)}`
    );
    check(
      `${side}: and up, not down`,
      bent.up > restHand.up + 0.05,
      `up ${restHand.up.toFixed(3)} → ${bent.up.toFixed(3)}`
    );

    applyArmPose(rig, { ...REST_POSE, lift: 0.5 });
    const lifted = bodyCoords(worldPos(fore, root), facingDir, sign);
    check(
      `${side}: lifting swings the elbow forward`,
      lifted.forward > restElbow.forward + 0.05,
      `forward ${restElbow.forward.toFixed(3)} → ${lifted.forward.toFixed(3)}`
    );

    applyArmPose(rig, { ...REST_POSE, spread: 0.4 });
    const spread = bodyCoords(worldPos(fore, root), facingDir, sign);
    check(
      `${side}: spreading swings the elbow away from the body`,
      spread.out > restElbow.out + 0.04,
      `out ${restElbow.out.toFixed(3)} → ${spread.out.toFixed(3)}`
    );

    applyArmPose(rig, REST_POSE);
    const back = worldPos(hand, root);
    const restWorld = new THREE.Vector3();
    // Rebuild the rest position from a fresh avatar to compare against.
    const fresh = makeAvatar(opts);
    fresh.bones[side].hand.getWorldPosition(restWorld);
    check(`${side}: the rest pose puts it back exactly`, back.distanceTo(restWorld) < 1e-6, `off by ${back.distanceTo(restWorld)}`);
  }

  // The same numbers on both arms must move them as mirror images: equal
  // distances forward and up, opposite sides.
  applyArmPose(rigs.left, { lift: 0.3, spread: 0.2, elbow: 0.8, wrist: 0.2 });
  applyArmPose(rigs.right, { lift: 0.3, spread: 0.2, elbow: 0.8, wrist: 0.2 });
  const l = bodyCoords(worldPos(bones.left.hand, root), facingDir, 1);
  const r = bodyCoords(worldPos(bones.right.hand, root), facingDir, -1);
  check(
    'the same pose on both arms is a mirror image',
    Math.abs(l.forward - r.forward) < 1e-4 && Math.abs(l.up - r.up) < 1e-4 && Math.abs(l.out - r.out) < 1e-4,
    `left ${JSON.stringify(l)} right ${JSON.stringify(r)}`
  );
}

console.log('\nA lopsided rest pose, as the shipped avatars have');
{
  // Measured on ananya.glb: elbows mirror-symmetric, right hand 10 cm further
  // out than the left. Taking the elbow's hinge from the rest pose copied that
  // into the motion — bent the same amount, the left hand folded onto the
  // stomach while the right forearm stuck out sideways. An elbow bends in front
  // of the body whatever the file's rest pose says, so the same bend must move
  // both hands by the same amount in the body's own terms.
  for (const [label, opts] of [
    ['splayed right forearm', { rightForearmSplay: 0.45 }],
    ['splayed and mirrored', { rightForearmSplay: 0.45, mirrored: true }],
  ]) {
    const { root, bones, facingDir } = makeAvatar(opts);
    const rigs = buildArmRigs(root, find(root));
    const move = {};
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const before = bodyCoords(worldPos(bones[side].hand, root), facingDir, sign);
      applyArmPose(rigs[side], { ...REST_POSE, elbow: 0.9 });
      const after = bodyCoords(worldPos(bones[side].hand, root), facingDir, sign);
      move[side] = { forward: after.forward - before.forward, up: after.up - before.up, out: after.out - before.out };
    }
    const f = v => v.toFixed(3);
    check(
      `${label}: both hands come forward by the same amount`,
      Math.abs(move.left.forward - move.right.forward) < 0.02,
      `left ${f(move.left.forward)}, right ${f(move.right.forward)}`
    );
    check(
      `${label}: and rise by the same amount`,
      Math.abs(move.left.up - move.right.up) < 0.02,
      `left ${f(move.left.up)}, right ${f(move.right.up)}`
    );
    check(
      `${label}: and neither swings sideways more than the other`,
      Math.abs(move.left.out - move.right.out) < 0.02,
      `left ${f(move.left.out)}, right ${f(move.right.out)}`
    );
  }
}

console.log('\nWhat it declines');
{
  const root = new THREE.Group();
  const spine = new THREE.Bone();
  spine.name = 'Spine2';
  root.add(spine);
  const rigs = buildArmRigs(root, find(root));
  check('a model with no arms gets no rig, and no error', !rigs.left && !rigs.right);
}
{
  const { root } = makeAvatar();
  root.getObjectByName('RightHand').removeFromParent();
  const rigs = buildArmRigs(root, find(root));
  check('an arm missing a bone is skipped, the other still works', !!rigs.left && !rigs.right);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
