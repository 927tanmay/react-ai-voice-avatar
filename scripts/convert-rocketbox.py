"""
Convert a Microsoft Rocketbox avatar (FBX) into a web-ready GLB for this library.

Microsoft Rocketbox is MIT licensed and ships avatars carrying the full 52 ARKit
blendshapes plus 15 Oculus visemes on a rigged body, which is exactly what this
engine drives. The only obstacles are the file format and the naming: Rocketbox
uses 3ds Max Biped bone names and prefixed shape key names.

This script fixes both, so the output drops into the same code paths that already
work, and shrinks the textures enough for a browser to download the result.

Run headless, no GUI:

    blender --background --python scripts/convert-rocketbox.py -- \\
        --input  path/to/Female_Adult_01_facial.fbx \\
        --output assets/avatars/ananya.glb

The source avatar needs its sibling `Textures/` folder present, because the FBX
embeds the absolute paths of the machine it was authored on and cannot resolve
them anywhere else.

Optional flags:
    --textures DIR        Texture folder (default: ../Textures beside the FBX)
    --keep-reference-pose Skip the relaxed standing pose and keep the wide
                          reference stance the avatars ship in
    --texture-size 1024   Longest texture edge after downscaling (default 1024)
    --height 1.7          Target height in metres (default 1.7)
"""

import argparse
import math
import os
import sys

import bpy
import mathutils

# ─── Naming maps ────────────────────────────────────────────────────────────
#
# Bones: 3ds Max Biped -> the standard humanoid names the dynamics engine looks
# up (src/lib/avatarDynamics.ts). These match the Mixamo/Ready Player Me
# convention, so one code path serves every avatar family.

BONE_MAP = {
    "Bip01": "Armature",
    "Bip01 Pelvis": "Hips",
    "Bip01 Spine": "Spine",
    "Bip01 Spine1": "Spine1",
    "Bip01 Spine2": "Spine2",
    "Bip01 Neck": "Neck",
    "Bip01 Head": "Head",
}

for side, prefix in (("L", "Left"), ("R", "Right")):
    BONE_MAP[f"Bip01 {side} Clavicle"] = f"{prefix}Shoulder"
    BONE_MAP[f"Bip01 {side} UpperArm"] = f"{prefix}Arm"
    BONE_MAP[f"Bip01 {side} Forearm"] = f"{prefix}ForeArm"
    BONE_MAP[f"Bip01 {side} Hand"] = f"{prefix}Hand"
    BONE_MAP[f"Bip01 {side} Thigh"] = f"{prefix}UpLeg"
    BONE_MAP[f"Bip01 {side} Calf"] = f"{prefix}Leg"
    BONE_MAP[f"Bip01 {side} Foot"] = f"{prefix}Foot"
    BONE_MAP[f"Bip01 {side} Toe0"] = f"{prefix}ToeBase"

    # Biped numbers fingers 0-4 from the thumb, with joints as a trailing digit:
    # "Finger0" is the thumb root, "Finger01" and "Finger02" its next two joints.
    for index, finger in enumerate(("Thumb", "Index", "Middle", "Ring", "Pinky")):
        BONE_MAP[f"Bip01 {side} Finger{index}"] = f"{prefix}Hand{finger}1"
        BONE_MAP[f"Bip01 {side} Finger{index}1"] = f"{prefix}Hand{finger}2"
        BONE_MAP[f"Bip01 {side} Finger{index}2"] = f"{prefix}Hand{finger}3"

# Visemes: Rocketbox "AA_VI_10_aa" -> "viseme_aa", matching the Oculus naming that
# Ready Player Me also emits, so getVisemeForChar output maps straight onto a
# morph target without a per-avatar lookup.
VISEME_MAP = {
    "AA_VI_00_Sil": "viseme_sil",
    "AA_VI_01_PP": "viseme_PP",
    "AA_VI_02_FF": "viseme_FF",
    "AA_VI_03_TH": "viseme_TH",
    "AA_VI_04_DD": "viseme_DD",
    "AA_VI_05_KK": "viseme_kk",
    "AA_VI_06_CH": "viseme_CH",
    "AA_VI_07_SS": "viseme_SS",
    "AA_VI_08_nn": "viseme_nn",
    "AA_VI_09_RR": "viseme_RR",
    "AA_VI_10_aa": "viseme_aa",
    "AA_VI_11_E": "viseme_E",
    "AA_VI_12_I": "viseme_I",
    "AA_VI_13_O": "viseme_O",
    "AA_VI_14_U": "viseme_U",
}

# The 52 ARKit names the engine writes to, used to verify the conversion landed.
ARKIT_EXPECTED = 52


def log(msg):
    print(f"[rocketbox] {msg}", flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="convert-rocketbox")
    p.add_argument("--input", required=True, help="Rocketbox *_facial.fbx")
    p.add_argument("--output", required=True, help="Destination .glb")
    p.add_argument("--textures", default=None,
                   help="Texture folder. Defaults to ../Textures beside the FBX.")
    p.add_argument("--keep-reference-pose", action="store_true",
                   help="Keep the wide reference stance instead of relaxing the arms.")
    p.add_argument("--texture-size", type=int, default=1024)
    p.add_argument("--height", type=float, default=1.7)
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def rename_arkit_key(name):
    """AK_25_JawOpen -> jawOpen. Returns None if the name is not an ARKit key."""
    if not name.startswith("AK_"):
        return None
    parts = name.split("_", 2)
    if len(parts) != 3:
        return None
    label = parts[2]
    return label[0].lower() + label[1:]


def rename_shape_keys(obj):
    """Rename recognised keys in place and report which names survived."""
    keys = obj.data.shape_keys
    if not keys:
        return 0, 0, set()
    arkit = visemes = 0
    kept = set()
    for block in keys.key_blocks:
        if block.name in VISEME_MAP:
            block.name = VISEME_MAP[block.name]
            kept.add(block.name)
            visemes += 1
            continue
        renamed = rename_arkit_key(block.name)
        if renamed:
            block.name = renamed
            kept.add(renamed)
            arkit += 1
    return arkit, visemes, kept


def prune_shape_keys(obj, keep):
    """
    Drop every morph target the engine will never drive.

    Rocketbox ships 175 shape keys per avatar: the 52 ARKit blendshapes, the 15
    Oculus visemes, and 108 more for FACS action units and the Vive facial
    tracker. Morph deltas dominate the file size, so carrying the unused 108
    nearly triples the download for animation nobody plays.

    `keep` is the set of names rename_shape_keys() actually recognised, so a key
    is only removed when it is provably not one the engine drives.
    """
    keys = obj.data.shape_keys
    if not keys:
        return 0

    basis = keys.reference_key.name
    doomed = [b.name for b in keys.key_blocks if b.name != basis and b.name not in keep]

    removed = 0
    for name in doomed:
        block = obj.data.shape_keys.key_blocks.get(name)
        if block is not None:
            obj.shape_key_remove(block)
            removed += 1
    return removed


def rename_bones(armature):
    renamed = 0
    for bone in armature.data.bones:
        target = BONE_MAP.get(bone.name)
        if target and target != bone.name:
            bone.name = target
            renamed += 1
    # Blender keeps vertex groups in sync when a bone is renamed through the data
    # API, but rename any stragglers so skinning cannot silently detach.
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for group in obj.vertex_groups:
            target = BONE_MAP.get(group.name)
            if target and target != group.name:
                group.name = target
    return renamed


# ─── Rest pose ──────────────────────────────────────────────────────────────
#
# Rocketbox avatars ship in a wide reference pose: upper arms held roughly 40
# degrees out from the body with the fingers splayed flat. That is right for a
# scanning rig and wrong for a character standing in a room, which is what this
# library renders. Ready Player Me models ship much closer to the body, which is
# why swapping the assets made the arms look like they were dangling.
#
# Bake a relaxed standing pose into the rest pose at conversion time, so the
# model is correct on its own and the engine's small runtime relaxation offsets
# land on top of something sensible.

# Degrees about the world Y axis (the body's forward/back axis) to bring each
# upper arm down toward the torso. Mirrored between sides.
ARM_DROP_DEGREES = 32.0
# Degrees of elbow bend, so the forearms read as relaxed rather than locked.
ELBOW_BEND_DEGREES = 10.0
# Degrees of curl per finger joint. Flat splayed fingers are the single biggest
# reason a resting humanoid reads as a mannequin.
FINGER_CURL_DEGREES = (14.0, 18.0, 16.0)
THUMB_CURL_DEGREES = (10.0, 8.0, 8.0)


def _rotate_bone_world(armature, bone_name, degrees, axis):
    """
    Rotate a pose bone about a world axis, pivoting on its own head.

    Done with matrix maths rather than bpy.ops.transform.rotate, because the
    operator needs bone selection state and Blender 5 removed Bone.select.
    """
    pose_bone = armature.pose.bones.get(bone_name)
    if pose_bone is None:
        return 0

    # pose_bone.matrix is in armature space, and the FBX importer leaves the
    # armature object rotated to convert Y-up to Z-up. Composing with the
    # armature's world matrix keeps the axis meaning what the caller intended.
    to_world = armature.matrix_world
    world_matrix = to_world @ pose_bone.matrix

    pivot = world_matrix.translation.copy()
    rotation = mathutils.Matrix.Rotation(math.radians(degrees), 4, axis)
    about_pivot = (
        mathutils.Matrix.Translation(pivot)
        @ rotation
        @ mathutils.Matrix.Translation(-pivot)
    )

    pose_bone.matrix = to_world.inverted() @ about_pivot @ world_matrix
    bpy.context.view_layer.update()
    return 1


def _rotate_bone_local(armature, bone_name, degrees, axis="X"):
    """Rotate a pose bone about its own axis, for hinges like elbows and knuckles."""
    pose_bone = armature.pose.bones.get(bone_name)
    if pose_bone is None:
        return 0
    pose_bone.rotation_mode = "XYZ"
    component = axis.lower()
    current = getattr(pose_bone.rotation_euler, component)
    setattr(pose_bone.rotation_euler, component, current + math.radians(degrees))
    bpy.context.view_layer.update()
    return 1


def apply_rest_pose(armature):
    """Pose the arms and hands, then bake that pose as the new rest pose."""
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")

    moved = 0

    # Upper arms first: children follow, so the forearm and hand come along.
    # The sides mirror, hence the sign flip.
    moved += _rotate_bone_world(armature, "LeftArm", ARM_DROP_DEGREES, "Y")
    moved += _rotate_bone_world(armature, "RightArm", -ARM_DROP_DEGREES, "Y")

    # Elbows and knuckles are hinges, so rotate about the bone's own axis.
    moved += _rotate_bone_local(armature, "LeftForeArm", ELBOW_BEND_DEGREES)
    moved += _rotate_bone_local(armature, "RightForeArm", ELBOW_BEND_DEGREES)

    for side in ("Left", "Right"):
        for finger in ("Index", "Middle", "Ring", "Pinky"):
            for joint, degrees in enumerate(FINGER_CURL_DEGREES, start=1):
                moved += _rotate_bone_local(armature, f"{side}Hand{finger}{joint}", degrees)
        for joint, degrees in enumerate(THUMB_CURL_DEGREES, start=1):
            moved += _rotate_bone_local(armature, f"{side}HandThumb{joint}", degrees)

    # Deliberately NOT bpy.ops.pose.armature_apply(). That rebinds the skeleton
    # without rebaking the mesh, and rebaking would mean applying the armature
    # modifier, which destroys all 67 shape keys. Instead the pose is carried out
    # through the exporter (export_rest_position_armature=False), which writes it
    # into the node transforms. Skinning then resolves it correctly on load, and
    # the runtime engine adds its own offsets on top of whatever rest pose the
    # model arrives with.
    bpy.ops.object.mode_set(mode="OBJECT")
    return moved


def normalize_scale(armature, target_height):
    """Rocketbox exports in centimetres; glTF expects metres."""
    corners = []
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            corners.extend(obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box)
    if not corners:
        return 1.0
    height = max(c.z for c in corners) - min(c.z for c in corners)
    if height <= 0:
        return 1.0
    factor = target_height / height
    log(f"model height {height:.3f} -> scaling by {factor:.4f} to reach {target_height} m")

    armature.scale = (factor, factor, factor)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return factor


def relink_textures(texture_dir, max_edge):
    """
    Repoint image paths at the local texture folder.

    The Rocketbox FBX files embed the absolute paths of the machine they were
    authored on ("D:/temp/Humans/.../f001_body_color.tga"), so every image loads
    empty and the exporter drops it. Match on filename instead, which is stable,
    and load from the sibling Textures directory.

    Repointing an existing image and reloading it leaves Blender's copy lazy, so
    `size` still reads (0, 0) and any downscale silently does nothing while the
    exporter goes on to embed the full-resolution file. Loading a fresh image and
    swapping it into the material nodes gives real dimensions immediately.
    """
    replacements = {}
    missing = 0

    for image in list(bpy.data.images):
        if not image.filepath:
            continue
        # The stored path uses Windows separators, so normalise before splitting.
        basename = image.filepath.replace("\\", "/").rstrip("/").split("/")[-1]
        if not basename:
            continue
        candidate = os.path.join(texture_dir, basename)
        if not os.path.isfile(candidate):
            missing += 1
            log(f"  texture not found, will be skipped: {basename}")
            continue
        loaded = bpy.data.images.load(candidate, check_existing=True)
        # Downscale here, while the image is freshly loaded and its dimensions are
        # known. A separate later pass sees a mix of these and the original stubs
        # and cannot tell them apart reliably.
        w, h = loaded.size
        longest = max(w, h)
        if longest > max_edge:
            ratio = max_edge / longest
            loaded.scale(max(1, int(w * ratio)), max(1, int(h * ratio)))
        replacements[image.name] = loaded

    if not replacements:
        return 0, missing

    swapped = 0
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                target = replacements.get(node.image.name)
                if target is not None and target is not node.image:
                    node.image = target
                    swapped += 1
    return swapped, missing


def main():
    args = parse_args()
    if not os.path.isfile(args.input):
        log(f"ERROR: input not found: {args.input}")
        sys.exit(1)

    reset_scene()

    log(f"importing {args.input}")
    bpy.ops.import_scene.fbx(filepath=args.input, automatic_bone_orientation=True)

    armature = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if armature is None:
        log("ERROR: no armature in the imported file")
        sys.exit(1)

    renamed_bones = rename_bones(armature)
    log(f"renamed {renamed_bones} bones from Biped to standard humanoid names")

    total_arkit = total_visemes = total_pruned = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        a, v, kept = rename_shape_keys(obj)
        total_arkit += a
        total_visemes += v
        total_pruned += prune_shape_keys(obj, kept)
    log(f"renamed {total_arkit} ARKit blendshapes and {total_visemes} visemes")
    log(f"pruned {total_pruned} unused morph targets (FACS action units, Vive tracker)")

    if total_arkit < ARKIT_EXPECTED:
        log(
            f"ERROR: expected {ARKIT_EXPECTED} ARKit blendshapes, found {total_arkit}. "
            "Use the *_facial.fbx variant, not the plain body FBX."
        )
        sys.exit(1)

    if args.keep_reference_pose:
        log("keeping the original reference pose")
    else:
        posed = apply_rest_pose(armature)
        log(f"baked a relaxed standing rest pose ({posed} bones adjusted)")

    normalize_scale(armature, args.height)

    texture_dir = args.textures or os.path.join(
        os.path.dirname(os.path.abspath(args.input)), os.pardir, "Textures"
    )
    texture_dir = os.path.abspath(texture_dir)
    if os.path.isdir(texture_dir):
        found, missing = relink_textures(texture_dir, args.texture_size)
        log(
            f"relinked {found} texture slots from {texture_dir}, "
            f"downscaled to a {args.texture_size}px longest edge ({missing} unresolved)"
        )
    else:
        log(f"WARNING: texture folder not found at {texture_dir}; exporting untextured")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    log(f"exporting {args.output}")
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_morph=True,
        # Morph normals and tangents roughly triple the file size and the engine
        # drives mouth shapes from positions alone, so leave them out.
        export_morph_normal=False,
        export_morph_tangent=False,
        export_skins=True,
        # Carry the relaxed standing pose set by apply_rest_pose() into the file,
        # rather than exporting the wide reference stance underneath it.
        export_rest_position_armature=False,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_image_format="AUTO",
    )

    size_mb = os.path.getsize(args.output) / 1024 / 1024
    log(f"done: {args.output} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
