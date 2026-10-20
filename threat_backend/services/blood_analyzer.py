"""
blood_analyzer.py – Forensic bloodstain segmentation.

Accurately segments both fresh liquid/pooling blood and dried brownish bloodstains on various floor surfaces
while rejecting false positives on furniture (armchairs, sofas), standing investigators in PPE, and tile patterns.

Public API
----------
segment_blood(image_np) -> (mask, centroids, polygons)
"""

from __future__ import annotations

import logging
import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Detector for excluding standing investigators and large furniture
_COCO_DETECTOR = None
try:
    from ultralytics import YOLO
    _COCO_DETECTOR = YOLO("yolov8m.pt")
except Exception as e:
    logger.warning("Could not load COCO detector for scene context: %s", e)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MORPH_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
_OPEN_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
_BLACKHAT_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))

_MIN_AREA_PX = 25
_MAX_AREA_PX = 100000
_POOL_THRESHOLD_PX = 2000


def segment_blood(
    image_np: np.ndarray,
) -> tuple[np.ndarray, list[dict], list[np.ndarray]]:
    """Detect bloodstains in a BGR image using dual fresh/dried blood analysis.

    Parameters
    ----------
    image_np:
        BGR uint8 NumPy array (H × W × 3).

    Returns
    -------
    mask : np.ndarray
        Binary (uint8, 0/255) blood mask.
    centroids : list[dict]
        One dict per valid stain with keys: cx, cy, area, type.
    polygons : list[np.ndarray]
        Simplified contour polygons.
    """
    H, W = image_np.shape[:2]

    hsv = cv2.cvtColor(image_np, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(image_np.astype(np.float32))

    # ── 1. Fresh vibrant blood (chest wounds, pooling, droplets, footprints) ──
    # Crimson red: H <= 8 or H >= 170, distinct excess of red over green and blue, dark enough to exclude bright skin
    fresh_hue = (hsv[:, :, 0] <= 8) | (hsv[:, :, 0] >= 170)
    fresh = (
        fresh_hue
        & (hsv[:, :, 1] >= 48)
        & (hsv[:, :, 2] >= 35)
        & ((r - g) >= 28)
        & ((r - b) >= 28)
        & (r >= 80)
        & (g <= 135)
        & (b <= 135)
    )

    # ── 2. Dried brownish bloodstains on floor surfaces ──
    gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, _BLACKHAT_KERNEL)
    dried_hue = (hsv[:, :, 0] <= 24) | (hsv[:, :, 0] >= 160)
    dried = (
        dried_hue
        & (hsv[:, :, 1] >= 28)
        & ((r - b) >= 16)
        & ((r - g) >= 8)
        & (blackhat >= 8)
        & (r >= 90)
        & (b <= 155)
        & (g <= 170)
        & (gray >= 45)
        & (gray <= 210)
    )

    combined = ((fresh | dried).astype(np.uint8) * 255)

    # ── 3. Furniture and Standing Investigator Suppression ──
    if _COCO_DETECTOR is not None:
        try:
            results = _COCO_DETECTOR.predict(source=image_np, conf=0.25, verbose=False)
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                name = _COCO_DETECTOR.names[cls_id]
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                area = (x2 - x1) * (y2 - y1)

                # Mask out large furniture pieces (red armchair, large couch, bookcase)
                if name in ["chair", "couch", "bed"] and area > 10000:
                    cv2.rectangle(combined, (x1, y1), (x2, y2), 0, -1)

                # Mask out standing upright investigators in clean PPE (not victims lying down)
                elif name == "person":
                    bh = y2 - y1
                    bw = x2 - x1
                    if bh > bw * 1.35 and y1 < H * 0.35 and bh > H * 0.35:
                        cv2.rectangle(
                            combined,
                            (max(0, x1 - 10), max(0, y1 - 10)),
                            (min(W, x2 + 10), min(H, y2 + 45)),
                            0,
                            -1,
                        )
        except Exception as e:
            logger.warning("Error running context detector: %s", e)

    # ── 4. Morphological clean-up ──
    closed = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, _MORPH_KERNEL)
    cleaned = cv2.morphologyEx(closed, cv2.MORPH_OPEN, _OPEN_KERNEL)

    # ── 5. Contour extraction & geometric filtering ──
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    centroids: list[dict] = []
    polygons: list[np.ndarray] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < _MIN_AREA_PX or area > _MAX_AREA_PX:
            continue

        _bx, _by, bw, bh = cv2.boundingRect(cnt)
        aspect = bh / max(bw, 1)
        if aspect > 4.0 or (bw / max(bh, 1)) > 7.5:
            continue

        hull_area = cv2.contourArea(cv2.convexHull(cnt))
        if hull_area > 0 and (area / hull_area) < 0.10:
            continue

        M = cv2.moments(cnt)
        if M["m00"] == 0:
            continue
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])

        # Filter out extreme edge artifacts (wall/ceiling borders)
        if cy < 25 or cy > (H - 8) or cx < 8 or cx > (W - 8):
            continue

        # Polygon simplification
        eps = 0.015 * cv2.arcLength(cnt, closed=True)
        approx = cv2.approxPolyDP(cnt, eps, closed=True)

        stain_type = "pool" if area > _POOL_THRESHOLD_PX else "spatter"
        centroids.append({"cx": cx, "cy": cy, "area": float(area), "type": stain_type})
        polygons.append(approx)

    return cleaned, centroids, polygons
