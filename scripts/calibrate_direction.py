#!/usr/bin/env python3
"""
Direction & Compass Calibrator from COLMAP Camera Poses.
Calculates the exact viewing direction (azimuth) of the reference photo in the 3D room,
and determines the northOffset angle so the reference photo corresponds to the selected cardinal direction.
"""
import sys
import os
import json
import numpy as np

def calibrate_direction(reference_name=None, target_direction="N", base_dir=None):
    if base_dir is None:
        base_dir = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
    
    output_dir = os.path.join(base_dir, "output")
    dir_file = os.path.join(output_dir, "direction.json")
    colmap_dir = os.path.join(output_dir, "colmap", "sparse", "0")

    d = {}
    if os.path.exists(dir_file):
        try:
            with open(dir_file) as f:
                d = json.load(f)
        except Exception:
            pass

    if reference_name is None:
        reference_name = d.get("referenceImage")
    if not target_direction:
        target_direction = d.get("direction", "N")

    DIR_ANGLES = {
        "N": 0, "NE": 45, "E": 90, "SE": 135,
        "S": 180, "SW": 225, "W": 270, "NW": 315
    }
    target_angle = DIR_ANGLES.get(target_direction.upper(), 0)

    if not os.path.exists(colmap_dir):
        print(f"[calibrate_direction] COLMAP sparse dir not found: {colmap_dir}")
        d.update({
            "direction": target_direction,
            "angle": target_angle,
            "northOffset": target_angle,
            "calibrated": False,
            "method": "fallback_default"
        })
        os.makedirs(output_dir, exist_ok=True)
        with open(dir_file, "w") as f:
            json.dump(d, f, indent=2)
        return d

    try:
        import pycolmap
        rec = pycolmap.Reconstruction(colmap_dir)
    except Exception as e:
        print(f"[calibrate_direction] Failed to load pycolmap: {e}")
        return d

    if len(rec.images) == 0:
        print("[calibrate_direction] No images registered in COLMAP reconstruction.")
        return d

    found = None
    if reference_name:
        clean_ref = os.path.basename(reference_name).lower()
        for _, im in rec.images.items():
            im_clean = os.path.basename(im.name).lower()
            if clean_ref in im_clean or im_clean in clean_ref:
                found = im
                break

    if not found:
        # Default to first calibrated image
        found = list(rec.images.values())[0]

    R = found.cam_from_world().rotation.matrix()
    t = found.cam_from_world().translation
    cam_pos = -R.T @ t
    # Camera viewing forward vector in COLMAP world space
    fwd = R.T @ np.array([0, 0, 1])

    # Check if COLMAP world coordinates are inverted (OpenCV camera Y points down,
    # so physical camera UP vector in camera coords is [0, -1, 0]).
    # When up_y < 0, Three.js applies rotationX = Math.PI to make room upright (+Y up),
    # which inverts Y and Z (Z_three = -Z_colmap, Y_three = -Y_colmap).
    up_ys = []
    for im in rec.images.values():
        R_im = im.cam_from_world().rotation.matrix()
        up_im = R_im.T @ np.array([0, -1, 0])
        up_ys.append(up_im[1])
    is_inverted = np.mean(up_ys) < 0 if up_ys else True

    if is_inverted:
        fwd_three = np.array([fwd[0], -fwd[1], -fwd[2]])
        cam_pos_three = np.array([cam_pos[0], -cam_pos[1], -cam_pos[2]])
    else:
        fwd_three = fwd
        cam_pos_three = cam_pos

    # In Three.js standard coordinates:
    # North (N) is along -Z (0 deg)
    # East (E) is along +X (90 deg)
    # South (S) is along +Z (180 deg)
    # West (W) is along -X (270 deg)
    cam_azimuth = float((np.degrees(np.arctan2(fwd_three[0], -fwd_three[2])) + 360.0) % 360.0)

    # For canonically wall-aligned meshes, cardinal room axes are canonical:
    # North is along -Z (0 deg), South is along +Z (180 deg), East is along +X (90 deg), West is along -X (270 deg).
    north_offset = float(target_angle)

    d.update({
        "direction": target_direction.upper(),
        "angle": north_offset,
        "northOffset": north_offset,
        "cameraAzimuth": round(cam_azimuth, 2),
        "referenceImage": found.name,
        "cameraPosition": [round(float(c), 3) for c in cam_pos_three],
        "forwardVector": [round(float(v), 3) for v in fwd_three],
        "isCOLMAPInverted": bool(is_inverted),
        "calibrated": True,
        "method": "colmap_camera_pose",
        "timestamp": d.get("timestamp") or ""
    })

    os.makedirs(output_dir, exist_ok=True)
    with open(dir_file, "w") as f:
        json.dump(d, f, indent=2)

    print(f"[calibrate_direction] Ref: '{found.name}' facing {target_direction} (inverted={is_inverted}) -> camAzimuth = {cam_azimuth:.2f}°, northOffset = {north_offset}°")
    return d

if __name__ == "__main__":
    ref = sys.argv[1] if len(sys.argv) > 1 else None
    target = sys.argv[2] if len(sys.argv) > 2 else "N"
    calibrate_direction(ref, target)
