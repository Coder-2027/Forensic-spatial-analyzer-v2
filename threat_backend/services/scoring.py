"""
scoring.py – Forensic probability engine.

Converts raw object detections (with spatial blood metrics) into posterior
probability estimates via a weighted scoring formula and softmax normalisation.

Public API
----------
calculate_forensic_probabilities(objects_with_metrics) -> list[dict]
"""

from __future__ import annotations

import math
from typing import Any

# ---------------------------------------------------------------------------
# Lethality weight lookup
# ---------------------------------------------------------------------------
_LETHALITY: dict[str, float] = {
    # Ballistic
    "gun":          0.95,
    "pistol":       0.95,
    "revolver":     0.95,
    "rifle":        0.95,
    # Sharp-edged
    "knife":        0.90,
    "dagger":       0.90,
    "axe":          0.90,
    "scissors":     0.90,
    # Heavy blunt
    "hammer":       0.75,
    "iron rod":     0.75,
    "baseball bat": 0.75,
    "crowbar":      0.75,
    "stone":        0.75,
    "rock":         0.75,
    "brick":        0.75,
    # Ligature
    "rope":         0.70,
    "wire":         0.70,
    "cable":        0.70,
    # Improvised / fragile blunt
    "glass bottle": 0.60,
    "wooden stick": 0.60,
    "wrench":       0.60,
}

_DEFAULT_LETHALITY = 0.35

# Softmax temperature – lower → sharper distribution
_SOFTMAX_TEMPERATURE = 0.5

# Forensic rationale templates
_RATIONALE_TEMPLATES = {
    "ballistic": (
        "Ballistic weapon ({label}) with {conf_pct}% detection confidence. "
        "{contact_clause} Nearest blood evidence {dist_clause}."
    ),
    "sharp": (
        "Sharp-edged instrument ({label}) detected at {conf_pct}% confidence. "
        "{contact_clause} Cutting/stabbing trauma pattern consistent with "
        "proximity {dist_clause}."
    ),
    "heavy_blunt": (
        "Heavy blunt object ({label}) capable of high-impact trauma. "
        "{contact_clause} {dist_clause_cap}."
    ),
    "ligature": (
        "Ligature-type object ({label}) at {conf_pct}% confidence. "
        "{contact_clause} {dist_clause_cap}."
    ),
    "improvised": (
        "Improvised blunt/fragile weapon ({label}). "
        "{contact_clause} {dist_clause_cap}."
    ),
    "unknown": (
        "Unclassified item ({label}) detected. Low base lethality assumed. "
        "{contact_clause} {dist_clause_cap}."
    ),
    "unaccounted": (
        "Baseline allowance for an unaccounted or missing weapon not visible "
        "in the scene. Static prior probability assigned."
    ),
}


def _lethality_category(label: str) -> str:
    """Return the forensic category name for a given label."""
    label_l = label.lower()
    if label_l in {"gun", "pistol", "revolver", "rifle"}:
        return "ballistic"
    if label_l in {"knife", "dagger", "axe", "scissors"}:
        return "sharp"
    if label_l in {"hammer", "iron rod", "baseball bat", "crowbar",
                   "stone", "rock", "brick"}:
        return "heavy_blunt"
    if label_l in {"rope", "wire", "cable"}:
        return "ligature"
    if label_l in {"glass bottle", "wooden stick", "wrench"}:
        return "improvised"
    return "unknown"


def _build_rationale(obj: dict[str, Any], category: str) -> str:
    """Compose a human-readable forensic rationale string."""
    if category == "unaccounted":
        return _RATIONALE_TEMPLATES["unaccounted"]

    label = obj.get("label", "unknown")
    conf = obj.get("confidence", 0.0)
    conf_pct = f"{conf * 100:.0f}"
    dist_px = obj.get("nearest_blood_dist_px")
    contact = obj.get("blood_contact", False)

    if contact:
        contact_clause = (
            f"Direct blood transfer detected — object bbox overlaps bloodstain."
        )
    else:
        contact_clause = "No direct blood contact detected in bounding box."

    if dist_px is None:
        dist_clause = "no blood evidence present in scene"
        dist_clause_cap = "No blood evidence present in scene"
    else:
        dist_clause = f"{dist_px:.0f} px from nearest stain centroid"
        dist_clause_cap = f"Located {dist_px:.0f} px from nearest blood stain centroid"

    template = _RATIONALE_TEMPLATES.get(category, _RATIONALE_TEMPLATES["unknown"])
    return template.format(
        label=label,
        conf_pct=conf_pct,
        contact_clause=contact_clause,
        dist_clause=dist_clause,
        dist_clause_cap=dist_clause_cap,
    )


def _softmax(scores: list[float], temperature: float = 1.0) -> list[float]:
    """Numerically stable softmax with temperature scaling."""
    scaled = [s / temperature for s in scores]
    max_s = max(scaled)
    exps = [math.exp(s - max_s) for s in scaled]
    total = sum(exps)
    return [e / total for e in exps]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def calculate_forensic_probabilities(
    objects_with_metrics: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Score each detected object and produce posterior probability estimates.

    Parameters
    ----------
    objects_with_metrics:
        List of object dicts already enriched by ``compute_spatial_metrics``.
        Each dict must contain: ``label``, ``confidence``, ``bbox``,
        ``nearest_blood_dist_px``, ``normalized_dist``, ``blood_contact``.

    Returns
    -------
    list[dict]
        Sorted (descending probability) list.  Each entry contains all
        original keys plus:

        * ``"lethality"``       – base lethality weight (float)
        * ``"proximity_score"`` – exp(-3.5 · d_norm)  (float)
        * ``"raw_score"``       – weighted sum before softmax (float)
        * ``"probability"``     – posterior probability in [0, 1] (float)
        * ``"probability_pct"`` – probability × 100, rounded to 2 dp (float)
        * ``"rationale"``       – forensic explanation string
        * ``"category"``        – weapon category string
    """
    entries: list[dict[str, Any]] = []

    for obj in objects_with_metrics:
        label = obj.get("label", "").lower()
        lethality = _LETHALITY.get(label, _DEFAULT_LETHALITY)
        confidence = float(obj.get("confidence", 0.0))
        d_norm = obj.get("normalized_dist") or 0.0
        contact = obj.get("blood_contact", False)

        # Proximity score
        s_prox = math.exp(-3.5 * d_norm)

        # Contact multiplier
        t_contact = 1.35 if contact else 1.0

        # Raw score
        raw = (
            0.45 * lethality
            + 0.35 * s_prox
            + 0.20 * confidence
        ) * t_contact

        category = _lethality_category(label)

        entry = {
            **obj,
            "lethality": lethality,
            "proximity_score": round(s_prox, 6),
            "raw_score": round(raw, 6),
            "category": category,
        }
        entries.append(entry)

    # Add the "Unaccounted / Missing Weapon" baseline item
    entries.append(
        {
            "label": "Unaccounted / Missing Weapon",
            "confidence": 0.0,
            "bbox": None,
            "nearest_blood_dist_px": None,
            "normalized_dist": None,
            "blood_contact": False,
            "lethality": _DEFAULT_LETHALITY,
            "proximity_score": 0.0,
            "raw_score": 0.30,
            "category": "unaccounted",
        }
    )

    # ── Softmax over raw scores ────────────────────────────────────────────
    raw_scores = [e["raw_score"] for e in entries]
    probs = _softmax(raw_scores, temperature=_SOFTMAX_TEMPERATURE)

    for entry, prob in zip(entries, probs):
        entry["probability"] = round(prob, 6)
        entry["probability_pct"] = round(prob * 100, 2)
        entry["rationale"] = _build_rationale(entry, entry["category"])

    # Sort descending by probability
    entries.sort(key=lambda e: e["probability"], reverse=True)

    return entries
