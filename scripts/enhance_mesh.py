#!/usr/bin/env python3
"""
Forensic 3D Mesh Enhancer & Architectural Scene Finisher.
Transforms raw photogrammetric point-and-shoot scans into clean, canonical digital twins:
1. Multi-primitive & single-primitive support via unified geometry pipeline
2. Inpaints and eliminates unobserved void / orange background texture artifacts across all atlases
3. Corrects COLMAP Y-down camera orientation (+Y up canonical frame)
4. Aligns rectangular room walls strictly with cardinal X and Z axes (flat walls = N, S, E, W)
5. Levels floor plane via least-squares plane fit
6. Centers digital twin at (0, 0) and grounds floor at Y = 0.00m
7. Re-packs a pristine self-contained binary GLB asset deployed to output and frontend
"""
import sys
import os
import shutil
import json
from pathlib import Path
import numpy as np
from PIL import Image

def enhance_scene_mesh(
    glb_path,
    tex_path=None,
    out_glb_path=None,
    min_component_size=1500,
    wall_color=(215, 210, 202)
):
    glb_path = Path(glb_path).resolve()
    if not glb_path.exists():
        raise FileNotFoundError(f"Mesh not found: {glb_path}")

    if out_glb_path is None:
        out_glb_path = glb_path
    else:
        out_glb_path = Path(out_glb_path).resolve()

    models_dir = glb_path.parent
    root = Path(__file__).resolve().parent.parent

    print(f"[enhance_mesh] Loading mesh: {glb_path}")

    # 1. Inpaint void spaces across all texture atlases
    all_tex = sorted(list(models_dir.glob("scene_textured*.png")))
    if not all_tex:
        # Check public/models
        public_models = root / "frontend" / "public" / "models"
        all_tex = sorted(list(public_models.glob("scene_textured*.png")))

    total_void_inpainted = 0
    try:
        from scipy.ndimage import distance_transform_edt
        for tp in all_tex:
            try:
                im = Image.open(tp).convert("RGB")
                ar = np.array(im)
                vmask = ((ar[:, :, 0] > 195) & (ar[:, :, 1] > 75) & (ar[:, :, 1] < 175) & (ar[:, :, 2] < 95)) | \
                        ((ar[:, :, 0] == 215) & (ar[:, :, 1] == 210) & (ar[:, :, 2] == 202))
                nv = int(np.sum(vmask))
                if nv > 0:
                    print(f"[enhance_mesh] Inpainting {nv:,} void pixels in {tp.name} from nearest neighbors...")
                    nidx = distance_transform_edt(vmask, return_distances=False, return_indices=True)
                    ar[vmask] = ar[nidx[0][vmask], nidx[1][vmask]]
                    Image.fromarray(ar).save(str(tp), quality=95)
                    total_void_inpainted += nv
            except Exception as tex_err:
                print(f"[enhance_mesh] Texture inpainting note for {tp.name}: {tex_err}")
    except Exception as e:
        print(f"[enhance_mesh] Scipy inpainting note: {e}")

    # 2. Load geometry using trimesh
    import trimesh
    scene = trimesh.load(str(glb_path))
    if isinstance(scene, trimesh.Scene):
        geoms = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    elif isinstance(scene, trimesh.Trimesh):
        geoms = [scene]
    else:
        raise ValueError(f"Unsupported scene type: {type(scene)}")

    if not geoms:
        raise ValueError("No Trimesh geometries found in GLB")

    orig_verts_count = sum(len(g.vertices) for g in geoms)
    orig_faces_count = sum(len(g.faces) for g in geoms)
    print(f"[enhance_mesh] Loaded {len(geoms)} primitive(s): {orig_verts_count:,} vertices, {orig_faces_count:,} faces")

    # Stack vertices & vertex normals to compute canonical room transform
    all_v = np.vstack([g.vertices for g in geoms]).astype(np.float64)
    all_n = np.vstack([g.vertex_normals for g in geoms]).astype(np.float64)

    T_total = np.eye(4, dtype=np.float64)

    # A. Orientation check: COLMAP / OpenCV Y-down
    up_count = int(np.sum(all_n[:, 1] > 0.4))
    down_count = int(np.sum(all_n[:, 1] < -0.4))
    is_inverted = down_count > up_count
    if is_inverted:
        print(f"[enhance_mesh] Inverting COLMAP coordinate frame (+Y up): up={up_count}, down={down_count}...")
        T_inv = np.diag([1.0, -1.0, -1.0, 1.0])
        all_v[:, 1] = -all_v[:, 1]
        all_v[:, 2] = -all_v[:, 2]
        all_n[:, 1] = -all_n[:, 1]
        all_n[:, 2] = -all_n[:, 2]
        T_total = T_inv @ T_total

    # B. Wall alignment: align rectangular room walls to cardinal X and Z axes
    wall_mask = np.abs(all_n[:, 1]) < 0.25
    if np.sum(wall_mask) > 500:
        wall_n = all_n[wall_mask]
        azimuths = np.arctan2(wall_n[:, 0], wall_n[:, 2])
        deg = (np.degrees(azimuths) % 90.0)
        hist, edges = np.histogram(deg, bins=90, range=(0, 90))
        peak_idx = int(np.argmax(hist))
        base_angle = float((edges[peak_idx] + edges[peak_idx + 1]) / 2.0)

        candidates = [base_angle, base_angle - 90.0, 90.0 - base_angle, -base_angle]
        cand_results = []
        for cand in candidates:
            rad = np.radians(cand)
            c, s = float(np.cos(rad)), float(np.sin(rad))
            Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)
            v_test = np.dot(all_v, Ry.T)
            p1 = np.percentile(v_test, 1.5, axis=0)
            p99 = np.percentile(v_test, 98.5, axis=0)
            span_x = float(p99[0] - p1[0])
            span_z = float(p99[2] - p1[2])
            area = span_x * span_z
            cand_results.append({"angle": cand, "area": area, "span_x": span_x, "span_z": span_z, "Ry": Ry})

        cand_results.sort(key=lambda x: x["area"])
        min_area = cand_results[0]["area"]
        best_cands = [c for c in cand_results if c["area"] <= min_area * 1.05]
        z_dominant = [c for c in best_cands if c["span_z"] >= c["span_x"]]
        selected_cand = z_dominant[0] if z_dominant else best_cands[0]

        print(f"[enhance_mesh] Aligning room walls to cardinal axes: rotating {selected_cand['angle']:+.2f}° (BBox area: {selected_cand['area']:.1f}m², X: {selected_cand['span_x']:.2f}m, Z: {selected_cand['span_z']:.2f}m)...")
        Ry_4 = np.eye(4, dtype=np.float64)
        Ry_4[:3, :3] = selected_cand["Ry"]
        all_v = np.dot(all_v, selected_cand["Ry"].T)
        all_n = np.dot(all_n, selected_cand["Ry"].T)
        T_total = Ry_4 @ T_total

    # C. Accurate floor plane leveling across the aligned axes
    z_min_p, z_max_p = np.percentile(all_v[:, 2], [2.0, 98.0])
    sample_flr_pts = []
    for z in np.linspace(z_min_p, z_max_p, 40):
        mask = (all_v[:, 2] >= z - 0.25) & (all_v[:, 2] <= z + 0.25)
        if np.sum(mask) > 50:
            ys = all_v[mask, 1]
            p5 = np.percentile(ys, 5)
            flr_pts = all_v[mask & (all_v[:, 1] >= p5 - 0.05) & (all_v[:, 1] <= p5 + 0.05)]
            if len(flr_pts) > 0:
                sample_flr_pts.append(flr_pts)

    if len(sample_flr_pts) > 0:
        all_flr = np.vstack(sample_flr_pts)
        A = np.column_stack([all_flr[:, 0], all_flr[:, 2], np.ones(len(all_flr))])
        (a, b, c), _, _, _ = np.linalg.lstsq(A, all_flr[:, 1], rcond=None)
        plane_norm = np.array([-a, 1.0, -b], dtype=np.float64)
        plane_norm /= np.linalg.norm(plane_norm)
        rot_x = -float(np.arctan2(plane_norm[2], plane_norm[1]))
        rot_z = float(np.arctan2(plane_norm[0], plane_norm[1]))
        if abs(rot_x) > 0.002 or abs(rot_z) > 0.002:
            print(f"[enhance_mesh] Leveling floor plane via plane fit: rotX = {np.degrees(rot_x):.2f}°, rotZ = {np.degrees(rot_z):.2f}°...")
            cx_a, sx_a = float(np.cos(rot_x)), float(np.sin(rot_x))
            cz_a, sz_a = float(np.cos(rot_z)), float(np.sin(rot_z))
            Rx = np.array([[1.0, 0.0, 0.0], [0.0, cx_a, -sx_a], [0.0, sx_a, cx_a]], dtype=np.float64)
            Rz = np.array([[cz_a, -sz_a, 0.0], [sz_a, cz_a, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
            R_level = np.dot(Rz, Rx)
            R_level_4 = np.eye(4, dtype=np.float64)
            R_level_4[:3, :3] = R_level
            all_v = np.dot(all_v, R_level.T)
            T_total = R_level_4 @ T_total

    # D. Center digital twin and ground floor plane at Y = 0.00m
    z_min_p, z_max_p = np.percentile(all_v[:, 2], [2.0, 98.0])
    sample_flr_pts = []
    for z in np.linspace(z_min_p, z_max_p, 40):
        mask = (all_v[:, 2] >= z - 0.25) & (all_v[:, 2] <= z + 0.25)
        if np.sum(mask) > 50:
            ys = all_v[mask, 1]
            p5 = np.percentile(ys, 5)
            flr_pts = all_v[mask & (all_v[:, 1] >= p5 - 0.05) & (all_v[:, 1] <= p5 + 0.05)]
            if len(flr_pts) > 0:
                sample_flr_pts.append(flr_pts)

    if len(sample_flr_pts) > 0:
        all_flr = np.vstack(sample_flr_pts)
        p1_x, p99_x = np.percentile(all_flr[:, 0], [1.5, 98.5])
        p1_z, p99_z = np.percentile(all_flr[:, 2], [1.5, 98.5])
        floor_y = float(np.percentile(all_flr[:, 1], 5.0))
        center_x = float((p1_x + p99_x) / 2.0)
        center_z = float((p1_z + p99_z) / 2.0)
    else:
        p1_x, p99_x = np.percentile(all_v[:, 0], [1.5, 98.5])
        p1_z, p99_z = np.percentile(all_v[:, 2], [1.5, 98.5])
        floor_y = float(np.percentile(all_v[:, 1], 2.5))
        center_x = float((p1_x + p99_x) / 2.0)
        center_z = float((p1_z + p99_z) / 2.0)

    print(f"[enhance_mesh] Centering digital twin: X shifted by {-center_x:.3f}m, Z shifted by {-center_z:.3f}m, floor Y grounded by {-floor_y:.3f}m...")
    T_trans = np.eye(4, dtype=np.float64)
    T_trans[0, 3] = -center_x
    T_trans[1, 3] = -floor_y
    T_trans[2, 3] = -center_z
    T_total = T_trans @ T_total

    # E. Architectural Metric Scale Normalization:
    # Photogrammetry/COLMAP outputs arbitrary units. In Three.js and forensic kinematics,
    # 1 unit = 1.0 meter (human mannequin height = 1.75m).
    # Normalize room ceiling height to architectural scale (3.6m) if outside [2.4m, 4.8m].
    all_v[:, 0] -= center_x
    all_v[:, 1] -= floor_y
    all_v[:, 2] -= center_z
    raw_ceiling = float(np.percentile(all_v[:, 1], 98.0))
    raw_floor = float(np.percentile(all_v[:, 1], 2.0))
    raw_height = max(1.0, raw_ceiling - raw_floor)
    if raw_height > 4.8 or raw_height < 2.2:
        metric_scale = float(np.clip(3.6 / raw_height, 0.1, 5.0))
        print(f"[enhance_mesh] Normalizing photogrammetry scale: ceiling was {raw_height:.2f} units, applying metric scale factor {metric_scale:.4f} (target ceiling ~3.6m)...")
        T_scale = np.diag([metric_scale, metric_scale, metric_scale, 1.0])
        all_v *= metric_scale
        T_total = T_scale @ T_total

    # Apply the combined 4x4 transform to all primitive geometries
    print("[enhance_mesh] Applying canonical 4x4 transform to all mesh geometries...")
    for g in geoms:
        g.apply_transform(T_total)

    # Compute final bounds
    v_final = np.vstack([g.vertices for g in geoms])
    b_p1 = np.percentile(v_final, 1.5, axis=0)
    b_p99 = np.percentile(v_final, 98.5, axis=0)
    print(f"[enhance_mesh] Final canonical bounds: X=[{b_p1[0]:.2f}, {b_p99[0]:.2f}], Y=[{b_p1[1]:.2f}, {b_p99[1]:.2f}], Z=[{b_p1[2]:.2f}, {b_p99[2]:.2f}]")

    # 3. Export canonical GLB
    print(f"[enhance_mesh] Exporting canonical GLB to: {out_glb_path}...")
    out_glb_path.parent.mkdir(parents=True, exist_ok=True)
    out_bytes = scene.export(file_type="glb")
    with open(out_glb_path, "wb") as f:
        f.write(out_bytes)

    # 4. Sync GLB and all textures across frontend public, dist, and output directories
    dist_models = root / "frontend" / "dist" / "models"
    public_models = root / "frontend" / "public" / "models"
    openmvs_models = root / "output" / "openmvs"

    for dest_dir in [dist_models, public_models, openmvs_models]:
        if dest_dir.exists():
            dest_file = dest_dir / "scene_textured.glb"
            if dest_file.resolve() != out_glb_path.resolve():
                shutil.copy2(out_glb_path, dest_file)
            for tp in all_tex:
                dest_tp = dest_dir / tp.name
                if tp.resolve() != dest_tp.resolve():
                    shutil.copy2(tp, dest_tp)

    report = {
        "success": True,
        "primitives": len(geoms),
        "vertices": int(len(v_final)),
        "faces": int(orig_faces_count),
        "bounds": {
            "min": [round(float(b_p1[0]), 3), round(float(b_p1[1]), 3), round(float(b_p1[2]), 3)],
            "max": [round(float(b_p99[0]), 3), round(float(b_p99[1]), 3), round(float(b_p99[2]), 3)],
            "size": [round(float(b_p99[0] - b_p1[0]), 3), round(float(b_p99[1] - b_p1[1]), 3), round(float(b_p99[2] - b_p1[2]), 3)]
        },
        "voidPixelsInpainted": total_void_inpainted,
        "outputPath": str(out_glb_path)
    }

    print(f"[enhance_mesh] Enhanced canonical GLB successfully saved to: {out_glb_path}")
    return report

if __name__ == "__main__":
    root_dir = Path(__file__).resolve().parent.parent
    if len(sys.argv) > 1:
        default_glb = Path(sys.argv[1]).resolve()
    else:
        default_glb = root_dir / "output" / "openmvs" / "scene_textured.glb"
        if not default_glb.exists():
            default_glb = root_dir / "frontend" / "public" / "models" / "scene_textured.glb"

    out_glb = default_glb
    res = enhance_scene_mesh(default_glb, out_glb_path=out_glb)
    print(json.dumps(res, indent=2))
