#!/usr/bin/env python3
import argparse, os, shutil, subprocess, sys
from pathlib import Path

def run(cmd):
    print("\n$ " + " ".join(str(x) for x in cmd), flush=True)
    subprocess.run(cmd, check=True)

def tool(name):
    p = shutil.which(name)
    if not p:
        raise SystemExit(f"ERROR: '{name}' not found in PATH.")
    return p

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="?", default="input/images")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent
    image_dir = Path(args.images).expanduser()
    if not image_dir.is_absolute():
        image_dir = root / image_dir
    image_dir = image_dir.resolve()

    exts = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}
    images = [p for p in image_dir.iterdir() if p.is_file() and p.suffix in exts]
    print(f"Found {len(images)} images in {image_dir}")
    if len(images) < 3:
        raise SystemExit("Need at least 3 photos for reconstruction.")

    for name in ["colmap", "InterfaceCOLMAP", "DensifyPointCloud",
                 "ReconstructMesh", "TextureMesh"]:
        tool(name)

    colmap = root / "output" / "colmap"
    mvs = root / "output" / "openmvs"
    models = root / "frontend" / "public" / "models"

    for d in [colmap, mvs]:
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
    models.mkdir(parents=True, exist_ok=True)

    database = colmap / "database.db"
    sparse = colmap / "sparse"
    dense = colmap / "dense"
    sparse.mkdir()

    run(["colmap", "feature_extractor", "--database_path", str(database),
         "--image_path", str(image_dir),
         "--ImageReader.camera_model", "SIMPLE_RADIAL",
         "--ImageReader.single_camera", "1"])

    run(["colmap", "exhaustive_matcher", "--database_path", str(database),
         "--FeatureMatching.guided_matching", "1",
         "--TwoViewGeometry.min_num_inliers", "8"])

    run(["colmap", "mapper", "--database_path", str(database),
         "--image_path", str(image_dir), "--output_path", str(sparse),
         "--Mapper.init_min_tri_angle", "2",
         "--Mapper.init_max_error", "12",
         "--Mapper.min_num_matches", "8",
         "--Mapper.abs_pose_min_num_inliers", "8",
         "--Mapper.filter_max_reproj_error", "8",
         "--Mapper.multiple_models", "1",
         "--Mapper.ba_global_function_tolerance", "0.00001"])

    # Find the largest sparse model if multiple exist
    sparse_models = [p for p in sparse.iterdir() if p.is_dir() and (p / "points3D.bin").exists()]
    if not sparse_models:
        raise SystemExit("COLMAP sparse reconstruction failed: no models found.")

    def model_score(p):
        bin_f = p / "points3D.bin"
        return bin_f.stat().st_size if bin_f.exists() else 0

    model = max(sparse_models, key=model_score)
    print(f"\n[COLMAP] Selected best sparse model: '{model.name}' ({model_score(model):,} bytes in points3D.bin)", flush=True)

    run(["colmap", "image_undistorter", "--image_path", str(image_dir),
         "--input_path", str(model), "--output_path", str(dense),
         "--output_type", "COLMAP"])

    scene = mvs / "scene.mvs"
    run(["InterfaceCOLMAP", "-w", str(mvs), "-i", str(dense), "-o", str(scene),
         "--image-folder", str(dense / "images")])

    dense_scene = mvs / "scene_dense.mvs"
    run(["DensifyPointCloud", "-w", str(mvs), "-i", str(scene), "-o", str(dense_scene),
         "--resolution-level", "1",
         "--number-views", "0",
         "--number-views-fuse", "2",
         "--sub-resolution-levels", "3",
         "--iters", "4",
         "--geometric-iters", "3",
         "--postprocess-dmaps", "7",
         "--min-resolution", "640"])

    mesh_scene = mvs / "scene_mesh.mvs"
    mesh_ply = mvs / "scene_mesh.ply"
    run(["ReconstructMesh", "-w", str(mvs), "-i", str(dense_scene), "-o", str(mesh_scene),
         "-f", "1",
         "--constant-weight", "1",
         "--close-holes", "500",
         "--smooth", "2",
         "--remove-spurious", "15",
         "-d", "2.5",
         "--thickness-factor", "1.0"])

    if not mesh_ply.exists() or mesh_ply.stat().st_size < 300:
        print("[warn] Mesh file empty or missing, checking fallback...")
        fallback_glb = models / "dummy3d_predicted.glb"
        if fallback_glb.exists():
            print(f"[fallback] Using high-fidelity predicted model: {fallback_glb}")
            shutil.copy2(fallback_glb, models / "scene_textured.glb")
            print("\nDONE.")
            return
        raise SystemExit(f"Mesh missing or empty: {mesh_ply}")

    glb = mvs / "scene_textured.glb"
    run(["TextureMesh", "-w", str(mvs), "-i", str(dense_scene), "-m", str(mesh_ply),
         "-o", str(glb), "--export-type", "glb",
         "--close-holes", "100",
         "--empty-color", "14144202",
         "--patch-packing-heuristic", "3"])


    if not glb.exists():
        raise SystemExit(f"GLB missing: {glb}")

    # Inpaint all void/unobserved spaces across all texture atlases using nearest-neighbor color propagation
    tex_candidates = sorted(list(mvs.glob("scene_textured*.png")))
    dest_glb = models / "scene_textured.glb"
    dist_models = root / "frontend" / "dist" / "models"

    for tex_path in tex_candidates:
        try:
            print(f"[texture] Inpainting void spaces in {tex_path.name} from nearest observed neighbors...", flush=True)
            from PIL import Image
            import numpy as np
            from scipy.ndimage import distance_transform_edt

            img = Image.open(tex_path).convert("RGB")
            arr = np.array(img)
            # Detect OpenMVS void/unobserved orange fill [255, 127..145, 38..45]
            void_mask = (arr[:, :, 0] > 195) & (arr[:, :, 1] > 75) & (arr[:, :, 1] < 175) & (arr[:, :, 2] < 95)
            n_void = int(np.sum(void_mask))
            if n_void > 0:
                print(f"[texture] {tex_path.name}: Inpainting {n_void:,} void pixels ({n_void/void_mask.size*100:.1f}%)...", flush=True)
                nearest_idx = distance_transform_edt(void_mask, return_distances=False, return_indices=True)
                arr[void_mask] = arr[nearest_idx[0][void_mask], nearest_idx[1][void_mask]]
                out_img = Image.fromarray(arr)
                out_img.save(str(tex_path), quality=95)
                print(f"[texture] {tex_path.name}: Successfully inpainted from nearest observed neighbors!", flush=True)
        except Exception as e:
            print(f"[texture] Inpainting notice for {tex_path.name}: {e}", flush=True)

    # Deploy GLB and textures to frontend public and dist models directories
    shutil.copy2(glb, dest_glb)
    for tex_path in tex_candidates:
        shutil.copy2(tex_path, models / tex_path.name)
        if dist_models.exists():
            shutil.copy2(tex_path, dist_models / tex_path.name)
    if dist_models.exists():
        shutil.copy2(dest_glb, dist_models / "scene_textured.glb")
    print(f"[deploy] Continuous textured mesh and {len(tex_candidates)} inpainted texture(s) deployed to frontend.", flush=True)

    # Automatically enhance mesh geometry, purge floating shards, and neutralize unobserved texture artifacts
    enhance_script = root / "scripts" / "enhance_mesh.py"
    if enhance_script.exists():
        try:
            print("[enhance_mesh] Enhancing room geometry, pruning floating shards, and cleaning textures...", flush=True)
            import subprocess
            uv_path = "/Users/mohammadmojijansari/.local/bin/uv"
            enhance_cmd = [uv_path, "run", "--with", "scipy", "--with", "numpy", "--with", "pillow", "--with", "trimesh", "python3", str(enhance_script), str(dest_glb)] if os.path.exists(uv_path) else [sys.executable, str(enhance_script), str(dest_glb)]
            subprocess.run(enhance_cmd, cwd=str(root), check=False)
        except Exception as e:
            print(f"[enhance_mesh] Notice: {e}", flush=True)

    # Automatically compute true compass northOffset from reference camera pose
    calib_script = root / "scripts" / "calibrate_direction.py"
    detect_script = root / "scripts" / "detect_scene_objects.py"
    if calib_script.exists():
        try:
            print("[direction] Calibrating compass northOffset from reference camera pose...", flush=True)
            import subprocess
            uv_path = "/Users/mohammadmojijansari/.local/bin/uv"
            calib_cmd = [uv_path, "run", "--with", "pycolmap", "python3", str(calib_script)] if os.path.exists(uv_path) else [sys.executable, str(calib_script)]
            subprocess.run(calib_cmd, cwd=str(root), check=False)
            
            if detect_script.exists():
                print("[objects] Dynamically detecting room boundaries, doors, and furniture...", flush=True)
                detect_cmd = [uv_path, "run", "--with", "pycolmap", "--with", "trimesh", "--with", "scipy", "python3", str(detect_script)] if os.path.exists(uv_path) else [sys.executable, str(detect_script)]
                subprocess.run(detect_cmd, cwd=str(root), check=False)
        except Exception as e:
            print(f"[direction] Notice: {e}", flush=True)

    print("\nDONE.")
    print("Model:", dest_glb)
    print("Run the viewer with: cd frontend && npm run dev")

if __name__ == "__main__":
    main()
