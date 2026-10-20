"""
main.py – FastAPI application entry point.

Endpoints
---------
POST /api/analyze
    Accept an uploaded image, run the full forensic pipeline, and return
    structured JSON with detections, blood geometry, and probability scores.

POST /api/analyze-batch
    Accept multiple uploaded images, run the forensic pipeline on each,
    and return an array of structured analysis results.

GET /api/health
    Simple liveness check.
"""

from __future__ import annotations

import io
import logging
import os
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from services.blood_analyzer import segment_blood
from services.detector import detect_objects
from services.scoring import calculate_forensic_probabilities
from services.spatial import compute_spatial_metrics

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Forensic Threat Detector",
    description="Open-vocabulary object detection + bloodstain analysis API.",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "application/octet-stream",
}

_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


def _is_valid_image_file(file: UploadFile) -> bool:
    """Validate content type or file extension."""
    if file.content_type and file.content_type in _ALLOWED_CONTENT_TYPES:
        if file.content_type != "application/octet-stream":
            return True

    if file.filename:
        _, ext = os.path.splitext(file.filename.lower())
        if ext in _ALLOWED_EXTENSIONS:
            return True

    return False


def _decode_image(data: bytes) -> np.ndarray:
    """Decode raw image bytes into a BGR NumPy array."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image – unsupported format or corrupted file.")
    return img


def _polygon_to_list(polygon: np.ndarray) -> list[list[int]]:
    """Convert an OpenCV contour array to a JSON-serialisable list of [x, y] pairs."""
    return polygon.reshape(-1, 2).tolist()


def _run_forensic_pipeline(
    image_np: np.ndarray,
    classes: list[str] | None = None,
    filename: str = "",
) -> dict[str, Any]:
    """Execute detection, blood segmentation, spatial geometry, and probability scoring."""
    H, W = image_np.shape[:2]
    logger.info("Processing image %dx%d ('%s')", W, H, filename)

    # 1. Object detection
    objects = detect_objects(image_np=image_np, candidate_classes=classes)
    logger.info("Detected %d weapon object(s) in '%s'", len(objects), filename)

    # 2. Blood segmentation
    blood_mask, blood_centroids, blood_polygons = segment_blood(image_np)
    logger.info("Found %d blood stain(s) in '%s'", len(blood_centroids), filename)

    # 3. Spatial proximity & surface contact
    objects = compute_spatial_metrics(
        objects=objects,
        blood_stains=blood_centroids,
        blood_mask=blood_mask,
        img_shape=(H, W),
    )

    # 4. Forensic probability scoring
    results = calculate_forensic_probabilities(objects)

    # 5. Serialize blood stains
    stains_out = []
    for stain, polygon in zip(blood_centroids, blood_polygons):
        stains_out.append(
            {
                **stain,
                "polygon": _polygon_to_list(polygon),
            }
        )

    return {
        "filename": filename,
        "image": {"width": W, "height": H},
        "blood": {
            "stain_count": len(stains_out),
            "stains": stains_out,
        },
        "results": results,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["meta"])
def health() -> dict:
    """Liveness / readiness probe."""
    return {"status": "ok", "service": "forensic-threat-detector"}


@app.post("/api/analyze", tags=["inference"])
async def analyze(
    file: UploadFile = File(..., description="Image file to analyse"),
    candidate_classes: str | None = None,
) -> dict:
    """Run the forensic pipeline on a single uploaded image."""
    if not _is_valid_image_file(file):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type: {file.content_type} / {file.filename}. "
                   f"Accepted formats: JPEG, PNG, WebP, BMP, TIFF.",
        )

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        image_np = _decode_image(raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    classes: list[str] | None = None
    if candidate_classes:
        classes = [c.strip() for c in candidate_classes.split(",") if c.strip()]

    return _run_forensic_pipeline(image_np, classes=classes, filename=file.filename or "image")


@app.post("/api/analyze-batch", tags=["inference"])
async def analyze_batch(
    files: list[UploadFile] = File(..., description="Multiple image files to analyse"),
    candidate_classes: str | None = None,
) -> dict:
    """Run the forensic pipeline across multiple uploaded images."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    classes: list[str] | None = None
    if candidate_classes:
        classes = [c.strip() for c in candidate_classes.split(",") if c.strip()]

    items: list[dict[str, Any]] = []

    for file in files:
        if not _is_valid_image_file(file):
            logger.warning("Skipping unsupported file %s (%s)", file.filename, file.content_type)
            continue

        raw_bytes = await file.read()
        if not raw_bytes:
            continue

        try:
            image_np = _decode_image(raw_bytes)
            analyzed = _run_forensic_pipeline(
                image_np,
                classes=classes,
                filename=file.filename or f"image_{len(items)+1}",
            )
            items.append(analyzed)
        except Exception as exc:
            logger.error("Failed to process %s: %s", file.filename, exc)

    return {
        "count": len(items),
        "items": items,
    }
