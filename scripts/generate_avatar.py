import json
import struct
import math
import os

# 52 ARKit blendshapes
blendshapes = [
    "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
    "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
    "jawForward", "jawLeft", "jawRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
    "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthDimpleLeft", "mouthDimpleRight",
    "mouthStretchLeft", "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft",
    "cheekSquintRight", "noseSneerLeft", "noseSneerRight", "tongueOut"
]

def create_glb():
    # Create a simple box with one triangle for simplicity, but with 52 morph targets.
    # We will just generate 3 vertices.
    positions = [
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0
    ]
    # Pack positions
    pos_bytes = b"".join(struct.pack("<f", f) for f in positions)

    # For each blendshape, we need a POSITION target of the same size
    target_bytes = bytearray()
    for i in range(52):
        # Just a tiny offset for each blendshape
        offset = [0.01 * (i+1), 0.01 * (i+1), 0.0] * 3
        target_bytes += b"".join(struct.pack("<f", f) for f in offset)

    buffer_data = pos_bytes + target_bytes
    buffer_len = len(buffer_data)

    # glTF JSON
    gltf = {
        "asset": {"version": "2.0", "generator": "python-gltf"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 0},
                "targets": [{"POSITION": i + 1} for i in range(52)]
            }],
            "weights": [0.0] * 52,
            "extras": {
                "targetNames": blendshapes
            }
        }],
        "buffers": [{
            "byteLength": buffer_len
        }],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962}
        ],
        "accessors": [
            {
                "bufferView": 0, "byteOffset": 0, "componentType": 5126,
                "count": 3, "type": "VEC3",
                "max": [1.0, 1.0, 0.0], "min": [0.0, 0.0, 0.0]
            }
        ]
    }

    # Add bufferViews and accessors for targets
    for i in range(52):
        bv_idx = 1 + i
        offset = len(pos_bytes) + i * len(pos_bytes)
        gltf["bufferViews"].append({
            "buffer": 0, "byteOffset": offset, "byteLength": len(pos_bytes)
        })
        gltf["accessors"].append({
            "bufferView": bv_idx, "byteOffset": 0, "componentType": 5126,
            "count": 3, "type": "VEC3"
        })

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode("utf-8")
    # Pad JSON to 4 byte alignment
    padding_len = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b' ' * padding_len

    # Pad binary buffer to 4 byte alignment
    bin_padding_len = (4 - (len(buffer_data) % 4)) % 4
    buffer_data += b'\x00' * bin_padding_len

    # Write GLB
    with open("assets/avatars/default.glb", "wb") as f:
        # Header (magic, version, length)
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_bytes) + 8 + len(buffer_data)))
        # JSON chunk header
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        # BIN chunk header
        f.write(struct.pack("<I4s", len(buffer_data), b"BIN\x00"))
        f.write(buffer_data)

create_glb()
print("Generated assets/avatars/default.glb")
