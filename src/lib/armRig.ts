/**
 * armRig.ts
 *
 * Turns anatomical arm poses — raise the upper arm, bend the elbow — into bone
 * rotations for whatever skeleton the avatar happens to have.
 *
 * WHY THIS IS NOT JUST ANGLES ON BONES
 *
 * The head and spine are moved by adding small angles to each bone's local
 * rotation, which works because those bones' axes roughly agree with the
 * body's. Arm bones do not. Their local axes depend on how the rig was built,
 * and on a mirrored rig the same local axis points opposite ways on the left
 * and right. The engine once relaxed the arms with fixed local angles, and on a
 * skeleton other than the one they were written for one arm swung forward while
 * the other tucked behind the back. See avatarDynamics.ts, section 5.1.
 *
 * So nothing here reads a bone's own axes. Where the body faces is worked out
 * from where the joints actually are — the shoulders give left and right, the
 * model's up gives up, their cross product gives forward — and each motion is
 * defined against those directions: an elbow bends by swinging the forearm
 * forward and up across the front of the body, whatever the asset's rest pose
 * looks like. Each axis is then expressed in its bone's parent frame once,
 * at load, so at runtime a pose is a couple of quaternion multiplies, and the
 * arms ride along with the torso as it sways.
 *
 * This is the same approach scripts/convert-rocketbox.py uses to bake the
 * relaxed rest pose: rotate about world axes, pivoting on the joint.
 */

import * as THREE from 'three';

export type Side = 'left' | 'right';

/**
 * One arm's pose, in radians, relative to the model's own rest pose. Zero is
 * the rest pose; every field is anatomical, so the same numbers mean the same
 * movement on either arm and on any skeleton.
 */
export interface ArmPose {
  /** Upper arm swung forward. */
  lift: number;
  /** Upper arm swung out from the body. */
  spread: number;
  /** Elbow bent further, bringing the hand forward and up. */
  elbow: number;
  /** Hand flexed at the wrist, in the same plane as the elbow. */
  wrist: number;
}

export const REST_POSE: ArmPose = Object.freeze({ lift: 0, spread: 0, elbow: 0, wrist: 0 });

interface Joint {
  bone: THREE.Object3D;
  /** The bone's local rotation in the rest pose. */
  rest: THREE.Quaternion;
}

export interface ArmRig {
  side: Side;
  upper: Joint & { liftAxis: THREE.Vector3; spreadAxis: THREE.Vector3 };
  fore: Joint & { bendAxis: THREE.Vector3 };
  hand?: Joint & { flexAxis: THREE.Vector3 };
}

export interface ArmRigs {
  left?: ArmRig;
  right?: ArmRig;
}

/** Below this the upper arm and forearm are too close to straight to define a hinge. */
const MIN_HINGE_SINE = 0.05;

const NAMES: Record<Side, { upper: string; fore: string; hand: string }> = {
  left: { upper: 'LeftArm', fore: 'LeftForeArm', hand: 'LeftHand' },
  right: { upper: 'RightArm', fore: 'RightForeArm', hand: 'RightHand' },
};

/**
 * Read the arms of a model in its rest pose.
 *
 * Call before anything animates the skeleton. Returns an empty object for a
 * model without the bones this needs — a bust, or a custom rig with other
 * names — and gestures then simply do not happen.
 */
export function buildArmRigs(
  root: THREE.Object3D,
  find: (name: string) => THREE.Object3D | undefined
): ArmRigs {
  root.updateMatrixWorld(true);

  const rootInverse = root.matrixWorld.clone().invert();
  const rootQuatInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();

  const position = (bone: THREE.Object3D) =>
    bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse);

  /** The rotation that takes a direction from `bone`'s parent frame into the root's. */
  const parentToRoot = (bone: THREE.Object3D) => {
    const parent = bone.parent;
    if (!parent) return new THREE.Quaternion();
    return rootQuatInverse.clone().multiply(parent.getWorldQuaternion(new THREE.Quaternion()));
  };

  const inParentFrame = (axis: THREE.Vector3, bone: THREE.Object3D) =>
    axis.clone().applyQuaternion(parentToRoot(bone).invert()).normalize();

  const leftUpper = find(NAMES.left.upper);
  const rightUpper = find(NAMES.right.upper);
  if (!leftUpper || !rightUpper) return {};

  // Where the body faces, from where its shoulders are rather than from any
  // bone's axes. glTF is Y-up, so up is the root's Y.
  const up = new THREE.Vector3(0, 1, 0);
  const towardLeft = position(leftUpper).sub(position(rightUpper));
  towardLeft.y = 0;
  if (towardLeft.lengthSq() < 1e-10) return {};
  towardLeft.normalize();
  const forward = new THREE.Vector3().crossVectors(towardLeft, up).normalize();

  const rigs: ArmRigs = {};

  for (const side of ['left', 'right'] as const) {
    const upperBone = find(NAMES[side].upper);
    const foreBone = find(NAMES[side].fore);
    const handBone = find(NAMES[side].hand);
    if (!upperBone || !foreBone || !handBone) continue;

    const shoulder = position(upperBone);
    const elbow = position(foreBone);
    const wrist = position(handBone);

    const upperDir = elbow.clone().sub(shoulder);
    const foreDir = wrist.clone().sub(elbow);
    if (upperDir.lengthSq() < 1e-10 || foreDir.lengthSq() < 1e-10) continue;
    upperDir.normalize();
    foreDir.normalize();

    const outward = side === 'left' ? towardLeft.clone() : towardLeft.clone().negate();

    // Rotating a direction about cross(d, target) moves it toward target.
    const liftAxis = new THREE.Vector3().crossVectors(upperDir, forward).normalize();
    const spreadAxis = new THREE.Vector3().crossVectors(upperDir, outward).normalize();

    // The elbow hinges across the body: it swings the forearm forward and up in
    // front of the torso, the same on both sides.
    //
    // It is deliberately not taken from the plane the rest pose's arm makes,
    // which was the first version. That copies whatever the asset's rest pose
    // got wrong into every gesture, and the shipped avatars got something
    // wrong: their right forearm hangs splayed about 10 cm further out than the
    // left. Bent the same amount on ananya.glb, the left hand folded onto the
    // stomach while the right forearm stuck out sideways. Hinging across the
    // body carries any such splay along unchanged rather than amplifying it.
    let bendAxis = new THREE.Vector3().crossVectors(upperDir, forward);
    if (bendAxis.length() < MIN_HINGE_SINE) {
      // An upper arm pointing straight forward has no such cross product; its
      // hinge is then the body's own left-right line.
      bendAxis = towardLeft.clone();
    }
    bendAxis.normalize();

    // Either sign of the hinge is a valid axis; only one of them is flexion.
    // Bending must bring the hand forward and up, never back into the body.
    const probe = foreDir.clone().applyAxisAngle(bendAxis, 0.2).sub(foreDir);
    if (probe.dot(forward) + 0.5 * probe.dot(up) < 0) bendAxis.negate();

    rigs[side] = {
      side,
      upper: {
        bone: upperBone,
        rest: upperBone.quaternion.clone(),
        liftAxis: inParentFrame(liftAxis, upperBone),
        spreadAxis: inParentFrame(spreadAxis, upperBone),
      },
      fore: {
        bone: foreBone,
        rest: foreBone.quaternion.clone(),
        bendAxis: inParentFrame(bendAxis, foreBone),
      },
      hand: {
        bone: handBone,
        rest: handBone.quaternion.clone(),
        // Wrist flexion runs in roughly the same plane as the elbow's.
        flexAxis: inParentFrame(bendAxis, handBone),
      },
    };
  }

  return rigs;
}

const scratchA = new THREE.Quaternion();
const scratchB = new THREE.Quaternion();

/** Pose one arm. `REST_POSE` puts it back exactly where the model had it. */
export function applyArmPose(rig: ArmRig, pose: ArmPose): void {
  const { upper, fore, hand } = rig;

  scratchA.setFromAxisAngle(upper.liftAxis, pose.lift);
  scratchB.setFromAxisAngle(upper.spreadAxis, pose.spread);
  upper.bone.quaternion.copy(scratchA).multiply(scratchB).multiply(upper.rest);

  scratchA.setFromAxisAngle(fore.bendAxis, pose.elbow);
  fore.bone.quaternion.copy(scratchA).multiply(fore.rest);

  if (hand) {
    scratchA.setFromAxisAngle(hand.flexAxis, pose.wrist);
    hand.bone.quaternion.copy(scratchA).multiply(hand.rest);
  }
}
