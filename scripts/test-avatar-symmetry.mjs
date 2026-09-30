/**
 * Checks that the shipped avatars stand symmetrically, and that the tool which
 * made them so still works.
 *
 * The avatars shipped lopsided for months, with the right hand about 8 cm
 * further from the body than the left, and nothing noticed because nothing
 * measured it: it only showed on camera once the arms started moving. Every
 * left bone is compared with its right twin reflected, so a converter change
 * that bends one side differently fails here rather than on the homepage.
 *
 * Run with: node scripts/test-avatar-symmetry.mjs
 */
import { Quaternion, Vector3 } from 'three';
import { readGlb, pose, asymmetry, mirrorRightArm } from './mirror-arm-rest-pose.mjs';

const AVATARS = ['assets/avatars/ananya.glb', 'assets/avatars/aarav.glb'];
/** Half a centimetre: well under anything visible, well over float noise. */
const TOLERANCE_M = 0.005;

let passed = 0;
let failed = 0;
function check(name, fn) {
  let problem;
  try {
    problem = fn();
  } catch (e) {
    problem = `threw: ${e.message}`;
  }
  if (problem) {
    console.error(`FAIL  ${name}\n      ${problem}`);
    failed++;
  } else {
    console.log(`ok    ${name}`);
    passed++;
  }
}

const worst = rows => rows.reduce((a, b) => (b.metres > a.metres ? b : a));
const cm = m => `${(m * 100).toFixed(1)} cm`;

for (const file of AVATARS) {
  check(`${file}: every left bone mirrors its right twin`, () => {
    const rows = asymmetry(readGlb(file).gltf);
    if (rows.length < 20) return `only ${rows.length} left/right pairs found; bone names changed?`;
    const w = worst(rows);
    return w.metres > TOLERANCE_M ? `${w.bone} is ${cm(w.metres)} off its mirror` : null;
  });

  check(`${file}: both elbows bend in toward the body, not out`, () => {
    // Guards the choice of side. The fix keeps the left arm, whose elbow bends
    // the hand in toward the thigh; mirroring the other way would pass the
    // symmetry check above with both hands flared out.
    const { gltf } = readGlb(file);
    const { world, index } = pose(gltf);
    const at = name => new Vector3().setFromMatrixPosition(world[index[name]]);
    const towardLeft = at('LeftArm').sub(at('RightArm')).setY(0).normalize();
    for (const [side, outward] of [['Left', towardLeft], ['Right', towardLeft.clone().negate()]]) {
      const upper = at(`${side}ForeArm`).sub(at(`${side}Arm`)).normalize().dot(outward);
      const fore = at(`${side}Hand`).sub(at(`${side}ForeArm`)).normalize().dot(outward);
      if (fore >= upper) return `${side} forearm points ${fore.toFixed(2)} outward, upper arm ${upper.toFixed(2)}: the elbow bends out`;
    }
    return null;
  });

  check(`${file}: mirroring an already symmetric avatar changes nothing`, () => {
    const { gltf } = readGlb(file);
    const changed = mirrorRightArm(gltf);
    return changed ? `rewrote ${changed} bone(s)` : null;
  });

  check(`${file}: a lopsided right arm is put back`, () => {
    // Recreate the converter's mistake: the right elbow and a knuckle turned
    // 20° the wrong way about their own X axis.
    const { gltf } = readGlb(file);
    const { index } = pose(gltf);
    for (const bone of ['RightForeArm', 'RightHandIndex1']) {
      const node = gltf.nodes[index[bone]];
      const q = new Quaternion(...node.rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (20 * Math.PI) / 180));
      node.rotation = q.toArray();
    }
    const leftBefore = gltf.nodes.filter(n => n.name?.startsWith('Left')).map(n => JSON.stringify(n.rotation));
    const broken = worst(asymmetry(gltf));
    if (broken.metres < 0.05) return `the sabotage only moved things ${cm(broken.metres)}; the test proves nothing`;
    mirrorRightArm(gltf);
    const leftAfter = gltf.nodes.filter(n => n.name?.startsWith('Left')).map(n => JSON.stringify(n.rotation));
    if (leftAfter.some((r, i) => r !== leftBefore[i])) return 'the left arm was changed';
    const w = worst(asymmetry(gltf));
    return w.metres > TOLERANCE_M ? `still ${cm(w.metres)} off at ${w.bone}` : null;
  });
}

check('a rig whose upper arms are not mirrored is refused, not "fixed"', () => {
  const { gltf } = readGlb(AVATARS[0]);
  const { index } = pose(gltf);
  const node = gltf.nodes[index.RightArm];
  node.rotation = new Quaternion(...node.rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6)).toArray();
  try {
    mirrorRightArm(gltf);
  } catch {
    return null;
  }
  // Mirroring below a lopsided shoulder would bake the shoulder's error into
  // every bone underneath it and report success.
  return 'accepted a rig with lopsided upper arms';
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
