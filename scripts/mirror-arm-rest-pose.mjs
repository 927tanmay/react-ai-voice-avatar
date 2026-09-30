/**
 * Make the right arm's rest pose the mirror image of the left, in place.
 *
 * WHY THIS EXISTS
 *
 * scripts/convert-rocketbox.py bent every elbow and knuckle by the same angle
 * about the bone's own X axis. On a mirrored skeleton that axis is reflected
 * between the sides, so the same angle bends them opposite ways: on the
 * shipped avatars the left forearm bent in toward the body and the right one
 * out, leaving the right hand about 8 cm further out and its fingertips 13 cm
 * off. Every right bone from the forearm down was exactly 20° from where the
 * mirror would put it — the converter's 10°, once each way.
 *
 * The converter now bends the right side the other way. This script corrects
 * avatars already converted, without the source files: the converter carries
 * its rest pose in the GLB's node rotations, so the pose can be rewritten there
 * and nothing else in the file needs to change.
 *
 * The left arm is kept and the right is made to match, because the left is the
 * natural one: a relaxed arm with the palm facing the thigh brings the hand
 * forward and slightly in.
 *
 * HOW
 *
 * A right bone's frame is the left twin's frame reflected, then with some axes
 * flipped by a convention fixed for the whole rig. That convention is read off
 * the upper arms, which the converter posed about a world axis and which are
 * already symmetric — never assumed. Each right bone below the upper arm is
 * then given the reflected left rotation, top down, so each parent is settled
 * before its children.
 *
 * Idempotent: a symmetric file comes out unchanged.
 *
 * Usage: node scripts/mirror-arm-rest-pose.mjs assets/avatars/ananya.glb [...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== JSON_CHUNK) throw new Error(`${path}: first chunk is not JSON`);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  // Everything after the JSON chunk — the binary chunk, header included — is
  // carried across byte for byte.
  const rest = buf.subarray(20 + jsonLength);
  return { gltf, rest };
}

export function writeGlb(path, { gltf, rest }) {
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  // Chunks are 4-byte aligned, and the JSON chunk pads with spaces.
  const padding = (4 - (json.length % 4)) % 4;
  json = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + rest.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(JSON_CHUNK, 16);
  if (rest.length && rest.readUInt32LE(4) !== BIN_CHUNK) throw new Error(`${path}: unexpected chunk after JSON`);
  writeFileSync(path, Buffer.concat([header, json, rest]));
}

function localMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

/** World matrix of every node, and each node's parent. */
export function pose(gltf) {
  const parent = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => (parent[c] = i)));
  const world = [];
  const resolve = i => {
    if (!world[i]) {
      const local = localMatrix(gltf.nodes[i]);
      world[i] = parent[i] === -1 ? local : resolve(parent[i]).clone().multiply(local);
    }
    return world[i];
  };
  gltf.nodes.forEach((_, i) => resolve(i));
  const index = Object.fromEntries(gltf.nodes.map((n, i) => [n.name, i]));
  return { world, parent, index };
}

const rotationOf = m => {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return new Matrix4().makeRotationFromQuaternion(q);
};
const positionOf = m => new Vector3().setFromMatrixPosition(m);

/** The reflection that swaps the body's left and right, from its shoulders. */
export function mirrorOf(gltf) {
  const { world, index } = pose(gltf);
  const across = positionOf(world[index.LeftArm]).sub(positionOf(world[index.RightArm])).normalize();
  // Householder reflection through the plane the shoulders are mirrored in.
  const n = across;
  return new Matrix4().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
    0, 0, 0, 1,
  );
}

/**
 * Left bones whose right twin should mirror them: everything below the upper
 * arm. The upper arm itself is where the convention is read from.
 */
function armChain(gltf, index) {
  const names = [];
  const walk = i => {
    for (const c of gltf.nodes[i].children ?? []) {
      const name = gltf.nodes[c].name;
      if (name?.startsWith('Left') && `Right${name.slice(4)}` in index) names.push(name.slice(4));
      walk(c);
    }
  };
  walk(index.LeftArm);
  return names; // Depth first from the shoulder: every parent precedes its children.
}

/** Rewrite the right arm below the shoulder as the mirror of the left. Returns bones changed. */
export function mirrorRightArm(gltf) {
  const M = mirrorOf(gltf);
  let { world, parent, index } = pose(gltf);

  // The frame convention between twins, read off the upper arms and checked
  // against the shoulders. On a mirrored rig it is a plain flip of axes, the
  // same for both. Anything else means the upper arms are not mirror images
  // themselves, and mirroring beneath them would bake their error into every
  // bone below and report success.
  const conventionAt = bone => M.clone().multiply(rotationOf(world[index[`Left${bone}`]])).invert().multiply(rotationOf(world[index[`Right${bone}`]]));
  const convention = conventionAt('Arm');
  const shoulders = conventionAt('Shoulder');
  const isAxisFlip = convention.elements.every(v => Math.abs(v) < 1e-3 || Math.abs(Math.abs(v) - 1) < 1e-3);
  const agrees = convention.elements.every((v, i) => Math.abs(v - shoulders.elements[i]) < 1e-3);
  if (!isAxisFlip || !agrees) {
    throw new Error('the upper arms are not mirror images of each other, so there is no left arm to copy from');
  }

  let changed = 0;
  for (const bone of armChain(gltf, index)) {
    const left = rotationOf(world[index[`Left${bone}`]]);
    const target = M.clone().multiply(left).multiply(convention);
    const i = index[`Right${bone}`];
    const parentRotation = rotationOf(world[parent[i]]);
    const local = new Quaternion().setFromRotationMatrix(parentRotation.invert().multiply(target)).normalize();

    const node = gltf.nodes[i];
    if (node.matrix) throw new Error(`Right${bone} uses a matrix transform, which this script does not rewrite`);
    const before = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
    if (Math.abs(before.dot(local)) < 1 - 1e-9) {
      node.rotation = local.toArray().map(v => Math.round(v * 1e9) / 1e9);
      changed++;
      // Children hang off this bone, so their world transforms are now stale.
      ({ world, parent, index } = pose(gltf));
    }
  }
  return changed;
}

/**
 * Distance in metres between each Left bone and its Right twin reflected, for
 * every twin pair in the file.
 */
export function asymmetry(gltf) {
  const M = mirrorOf(gltf);
  const { world, index } = pose(gltf);
  // Reflect about the point between the shoulders, not the origin, so a model
  // that is not centred on zero is not reported as lopsided.
  const middle = positionOf(world[index.LeftArm]).add(positionOf(world[index.RightArm])).multiplyScalar(0.5);
  const out = [];
  for (const name of Object.keys(index)) {
    if (!name.startsWith('Left')) continue;
    const twin = `Right${name.slice(4)}`;
    if (!(twin in index)) continue;
    const left = positionOf(world[index[name]]);
    const right = positionOf(world[index[twin]]).sub(middle).applyMatrix4(M).add(middle);
    out.push({ bone: name.slice(4), metres: left.distanceTo(right) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/mirror-arm-rest-pose.mjs <file.glb> [...]');
    process.exit(1);
  }
  for (const file of files) {
    const glb = readGlb(file);
    const worst = rows => rows.reduce((a, b) => (b.metres > a.metres ? b : a));
    const before = worst(asymmetry(glb.gltf));
    const changed = mirrorRightArm(glb.gltf);
    const after = worst(asymmetry(glb.gltf));
    if (changed) writeGlb(file, glb);
    console.log(
      `${file}: ${changed} bone(s) rewritten; largest left/right difference ` +
      `${(before.metres * 100).toFixed(1)} cm (${before.bone}) -> ${(after.metres * 100).toFixed(2)} cm (${after.bone})`,
    );
  }
}
