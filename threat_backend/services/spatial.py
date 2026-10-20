"""
spatial.py – Proximity geometry between detected objects and bloodstains.

Public API
----------
compute_spatial_metrics(objects, blood_stains, blood_mask, img_shape)
    Enriches each object dict in-place with spatial blood-proximity fields.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def compute_spatial_metrics(
    objects: list[dict[str, Any]],
    blood_stains: list[dict[str, Any]],
    blood_mask: np.ndarray,
    img_shape: tuple[int, int],
) -> list[dict[str, Any]]:
    """Attach blood-proximity metrics to every detected object.

    Parameters
    ----------
    objects:
        List of object dicts as returned by ``detect_objects``.  Each dict
        must contain a ``"bbox"`` key with ``[x1, y1, x2, y2]`` integers.
        The function **mutates** each dict in-place and also returns the list.
    blood_stains:
        List of stain dicts as returned by ``segment_blood``.  Each must
        have ``"cx"`` and ``"cy"`` integer keys.
    blood_mask:
        Binary uint8 mask (0 / 255) of the same spatial size as the original
        image, as returned by ``segment_blood``.
    img_shape:
        ``(H, W)`` tuple – height and width of the source image in pixels.

    Returns
    -------
    list[dict]
        The same *objects* list, with three extra keys added per entry:

        * ``"nearest_blood_dist_px"`` – minimum Euclidean distance in pixels
          to the nearest blood stain centroid (``None`` if no stains exist).
        * ``"normalized_dist"`` – distance normalised by the image diagonal
          ``sqrt(W² + H²)`` (``None`` if no stains exist).
        * ``"blood_contact"`` – ``True`` if at least one blood pixel falls
          inside the object bounding box.
    """
    H, W = img_shape
    diagonal: float = math.sqrt(W ** 2 + H ** 2)

    for obj in objects:
        x1, y1, x2, y2 = obj["bbox"]

        # ── Object centre ──────────────────────────────────────────────────
        ox: float = (x1 + x2) / 2.0
        oy: float = (y1 + y2) / 2.0

        # ── Nearest blood stain centroid ───────────────────────────────────
        if blood_stains:
            min_dist = min(
                math.sqrt((ox - s["cx"]) ** 2 + (oy - s["cy"]) ** 2)
                for s in blood_stains
            )
            obj["nearest_blood_dist_px"] = round(min_dist, 2)
            obj["normalized_dist"] = round(min_dist / diagonal, 6) if diagonal else None
        else:
            obj["nearest_blood_dist_px"] = None
            obj["normalized_dist"] = None

        # ── Bounding-box overlap with blood mask ───────────────────────────
        # Clamp bbox to image boundaries before slicing
        bx1 = max(0, x1)
        by1 = max(0, y1)
        bx2 = min(W, x2)
        by2 = min(H, y2)

        if bx2 > bx1 and by2 > by1:
            roi = blood_mask[by1:by2, bx1:bx2]
            obj["blood_contact"] = bool(roi.any())
        else:
            obj["blood_contact"] = False

    return objects
