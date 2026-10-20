import subprocess
from pathlib import Path
import shutil


IMAGE_DIR = Path("input/images")
WORKSPACE = Path("output/colmap")


def run_command(command):
    print("\nRunning:")
    print(" ".join(command))

    subprocess.run(command, check=True)


def main():

    if not IMAGE_DIR.exists():
        raise FileNotFoundError(
            f"Image directory not found: {IMAGE_DIR}"
        )

    images = list(IMAGE_DIR.glob("*"))

    if len(images) < 3:
        raise ValueError(
            f"Only {len(images)} images found. "
            "Use at least 3 images."
        )

    # Clean previous reconstruction
    if WORKSPACE.exists():
        shutil.rmtree(WORKSPACE)

    WORKSPACE.mkdir(parents=True)

    database = WORKSPACE / "database.db"
    sparse = WORKSPACE / "sparse"

    sparse.mkdir()

    # -------------------------------------------------
    # 1. Feature extraction
    # -------------------------------------------------

    run_command([
        "colmap",
        "feature_extractor",
        "--database_path",
        str(database),
        "--image_path",
        str(IMAGE_DIR),
        "--ImageReader.camera_model",
        "SIMPLE_RADIAL",
        "--ImageReader.single_camera",
        "1",
    ])

    # -------------------------------------------------
    # 2. Feature matching
    # -------------------------------------------------

    run_command([
        "colmap",
        "exhaustive_matcher",
        "--database_path",
        str(database),
    ])

    # -------------------------------------------------
    # 3. Structure from Motion
    # -------------------------------------------------

    run_command([
        "colmap",
        "mapper",
        "--database_path",
        str(database),
        "--image_path",
        str(IMAGE_DIR),
        "--output_path",
        str(sparse),
        "--Mapper.init_min_tri_angle",
        "4",
        "--Mapper.init_max_error",
        "8",
        "--Mapper.min_num_matches",
        "15",
        "--Mapper.abs_pose_min_num_inliers",
        "15",
        "--Mapper.ba_global_function_tolerance",
        "0.00001",
    ])

    print("\n====================================")
    print("COLMAP reconstruction completed!")
    print("====================================")
    print(f"Sparse reconstruction: {sparse}")


if __name__ == "__main__":
    main()