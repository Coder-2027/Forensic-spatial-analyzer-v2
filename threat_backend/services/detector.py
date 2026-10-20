"""
detector.py – Open-vocabulary threat detector powered by YOLO-World.

The model is loaded once at module import time so subsequent calls share
the same weights in memory. Negative distractor categories and geometric
shape analysis are utilized to eliminate false positives on footwear,
clothing, and household items, and to resolve competing zero-shot CLIP
classifications (e.g. handgun vs scissors/knife).
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default threat categories (prioritized for crime scene forensic detection)
# ---------------------------------------------------------------------------
DEFAULT_CLASSES: list[str] = [
    "gun",
    "pistol",
    "handgun",
    "revolver",
    "firearm",
    "rifle",
    "knife",
    "dagger",
    "blade",
    "scissors",
    "wood axe",
    "rope",
    "wire",
    "cable",
    "stone",
    "rock",
    "brick",
    "baseball bat",
    "wooden stick",
    "iron rod",
    "hammer",
    "wrench",
    "crowbar",
    "glass bottle",
]

# ---------------------------------------------------------------------------
# Negative distractor categories (common scene items that must NOT be mapped to weapons)
# ---------------------------------------------------------------------------
DISTRACTOR_CLASSES: list[str] = [
    "shoe",
    "sandal",
    "high heel",
    "footwear",
    "sneaker",
    "boot",
    "clothing",
    "dress",
    "nightgown",
    "shirt",
    "pants",
    "sock",
    "person",
    "human body",
    "arm",
    "leg",
    "hand",
    "foot",
    "chair",
    "table",
    "bed",
    "sofa",
    "couch",
    "pillow",
    "cushion",
    "curtain",
    "floor",
    "evidence marker",
    "number marker",
    "cone",
    "briefcase",
    "camera",
    "flashlight",
]

# ---------------------------------------------------------------------------
# Model initialisation (downloaded on first run, cached by Ultralytics)
# ---------------------------------------------------------------------------
logger.info("Loading YOLO-World model …")
model: YOLO = YOLO("yolov8m-worldv2.pt")
logger.info("YOLO-World model ready.")


def _compute_iou(box1: list[int], box2: list[int]) -> float:
    """Compute Intersection over Union between two [x1, y1, x2, y2] bounding boxes."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    a1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    a2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = a1 + a2 - inter
    return inter / union if union > 0 else 0.0


def _classify_weapon_geometry(
    image_np: np.ndarray,
    bbox: list[int],
    current_label: str,
    cluster_labels: list[str],
) -> str:
    """Analyze morphological contours and aspect ratios to verify weapon classification.

    - Handgun / Pistol:
        Exhibits characteristic L-shape (slide + grip at ~90-110 deg). The convex hull
        bridges across the open angle between barrel and grip, creating moderate solidity
        (0.50 - 0.78) and aspect ratio (1.3 - 3.2).
    - Knife / Blade:
        Exhibits elongated straight geometry (aspect ratio >= 3.2, solidity >= 0.78).
    """
    x1, y1, x2, y2 = bbox
    H, W = image_np.shape[:2]
    crop = image_np[max(0, y1 - 4): min(H, y2 + 4), max(0, x1 - 4): min(W, x2 + 4)]
    if crop is None or crop.size == 0:
        return current_label

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    firearm_types = {"gun", "pistol", "handgun", "revolver", "firearm", "rifle"}
    has_firearm_vote = any(l.lower() in firearm_types for l in cluster_labels)

    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return current_label

    c = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(c)
    if area < 30:
        return current_label

    hull = cv2.convexHull(c)
    hull_area = cv2.contourArea(hull)
    solidity = area / hull_area if hull_area > 0 else 1.0
    rect = cv2.minAreaRect(c)
    (rw, rh) = rect[1]
    aspect = max(rw, rh) / (min(rw, rh) + 1e-5)

    # 1. Knife / blade check: Straight elongated profile
    if aspect >= 3.2 and solidity >= 0.78:
        return "knife"

    # 2. Firearm / handgun check: L-shaped corner between slide and grip
    if (solidity <= 0.78 and 1.3 <= aspect <= 3.2) or has_firearm_vote:
        if current_label.lower() in {"scissors", "knife", "blade", "dagger", "axe", "wood axe", "wrench"}:
            return "gun"

    return current_label


def _deduplicate_detections(
    image_np: np.ndarray,
    detections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge overlapping bounding boxes (IoU > 0.45) for the same physical object.

    Applies morphological geometric verification and normalizes synonym names.
    """
    if not detections:
        return []

    clusters: list[list[dict[str, Any]]] = []
    for det in detections:
        matched = False
        for cluster in clusters:
            if _compute_iou(det["bbox"], cluster[0]["bbox"]) > 0.45:
                cluster.append(det)
                matched = True
                break
        if not matched:
            clusters.append([det])

    deduped: list[dict[str, Any]] = []

    for cluster in clusters:
        cluster_labels = [d["label"].lower() for d in cluster]
        best = max(cluster, key=lambda d: d["confidence"])

        # Geometric and vote-based classification
        resolved_label = _classify_weapon_geometry(
            image_np=image_np,
            bbox=best["bbox"],
            current_label=best["label"],
            cluster_labels=cluster_labels,
        )

        # Normalize weapon category names
        if resolved_label in {"firearm", "pistol", "handgun", "revolver"}:
            resolved_label = "gun"
        elif resolved_label in {"dagger", "blade"}:
            resolved_label = "knife"
        elif resolved_label == "wood axe":
            resolved_label = "axe"

        # When a firearm or knife is verified, ensure confidence appropriately reflects certainty
        conf = best["confidence"]
        if resolved_label == "gun":
            conf = max(conf, 0.65)
        elif resolved_label == "knife":
            conf = max(conf, 0.55)

        deduped.append(
            {
                "label": resolved_label,
                "confidence": round(conf, 4),
                "bbox": best["bbox"],
            }
        )

    return deduped


# ---------------------------------------------------------------------------
# Public detection API
# ---------------------------------------------------------------------------

def detect_objects(
    image_np: np.ndarray,
    candidate_classes: list[str] | None = None,
    confidence_threshold: float = 0.015,
) -> list[dict[str, Any]]:
    """Run open-vocabulary object detection on a single image.

    Parameters
    ----------
    image_np:
        HxWxC NumPy array in **BGR** colour order.
    candidate_classes:
        List of text labels to detect. When *None* or empty the
        :data:`DEFAULT_CLASSES` list is used.
    confidence_threshold:
        Minimum confidence score required to keep a detection (default 0.015).

    Returns
    -------
    list[dict]
        Clean list of detected objects: [{"label": str, "confidence": float, "bbox": [x1, y1, x2, y2]}]
    """
    weapon_classes: list[str] = candidate_classes if candidate_classes else DEFAULT_CLASSES

    # Combine weapon categories with negative distractor categories to prevent false mappings
    all_classes: list[str] = list(weapon_classes)
    for dist in DISTRACTOR_CLASSES:
        if dist not in all_classes:
            all_classes.append(dist)

    model.set_classes(all_classes)

    # Dynamic image size to resolve small objects in high-res scenes
    max_dim = max(image_np.shape[:2])
    imgsz = max(640, min(1280, (max_dim + 31) // 32 * 32))

    # Pass conf=0.01 directly to Ultralytics so low-confidence faint objects are captured
    results = model.predict(
        source=image_np,
        conf=0.01,
        imgsz=imgsz,
        verbose=False,
    )

    raw_weapons: list[dict[str, Any]] = []
    raw_distractors: list[dict[str, Any]] = []

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            conf = float(box.conf[0])
            cls_idx = int(box.cls[0])
            label = all_classes[cls_idx]
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            bbox = [int(x1), int(y1), int(x2), int(y2)]

            item = {
                "label": label,
                "confidence": round(conf, 4),
                "bbox": bbox,
            }

            if label in weapon_classes:
                raw_weapons.append(item)
            else:
                raw_distractors.append(item)

    # Distractor suppression: discard weapon detections that heavily overlap with high-confidence distractors
    surviving_weapons: list[dict[str, Any]] = []
    for w in raw_weapons:
        suppressed = False
        for d in raw_distractors:
            iou = _compute_iou(w["bbox"], d["bbox"])
            if iou > 0.35 and d["confidence"] >= 0.12 and d["confidence"] > 1.2 * w["confidence"]:
                suppressed = True
                break
        if not suppressed and w["confidence"] >= confidence_threshold:
            surviving_weapons.append(w)

    return _deduplicate_detections(image_np, surviving_weapons)
