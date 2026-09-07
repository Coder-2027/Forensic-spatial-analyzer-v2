#!/usr/bin/env python3
import argparse, shutil, subprocess, sys
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
    if len(images) < 20:
        raise SystemExit("Need at least 20 images.")

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
         "--image_path", str(image_dir), "--ImageReader.single_camera", "1"])

    run(["colmap", "exhaustive_matcher", "--database_path", str(database)])

    run(["colmap", "mapper", "--database_path", str(database),
         "--image_path", str(image_dir), "--output_path", str(sparse)])

    model = sparse / "0"
    if not model.exists():
        raise SystemExit(f"COLMAP sparse model missing: {model}")

    run(["colmap", "image_undistorter", "--image_path", str(image_dir),
         "--input_path", str(model), "--output_path", str(dense),
         "--output_type", "COLMAP"])

    scene = mvs / "scene.mvs"
    run(["InterfaceCOLMAP", "-i", str(dense), "-o", str(scene),
         "--image-folder", str(dense / "images")])

    dense_scene = mvs / "scene_dense.mvs"
    run(["DensifyPointCloud", "-i", str(scene), "-o", str(dense_scene)])

    mesh_scene = mvs / "scene_mesh.mvs"
    mesh_ply = mvs / "scene_mesh.ply"
    run(["ReconstructMesh", "-i", str(dense_scene), "-o", str(mesh_scene)])

    if not mesh_ply.exists():
        raise SystemExit(f"Mesh missing: {mesh_ply}")

    glb = mvs / "scene_textured.glb"
    run(["TextureMesh", "-i", str(dense_scene), "-m", str(mesh_ply),
         "-o", str(glb), "--export-type", "glb"])

    if not glb.exists():
        raise SystemExit(f"GLB missing: {glb}")

    generated = mvs / "scene_textured0.png"
    expected = mvs / "scene_textured_0.png"
    if generated.exists():
        shutil.copy2(generated, expected)
    elif not expected.exists():
        raise SystemExit("Texture PNG missing.")

    shutil.copy2(glb, models / "scene_textured.glb")
    shutil.copy2(expected, models / "scene_textured_0.png")

    print("\nDONE.")
    print("Model:", models / "scene_textured.glb")
    print("Texture:", models / "scene_textured_0.png")
    print("Run the viewer with: cd frontend && npm run dev")

if __name__ == "__main__":
    main()
