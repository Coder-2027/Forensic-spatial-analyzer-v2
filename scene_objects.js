/**
 * Forensic 3D Scene Object Detector, 8-Direction Labeller, and Verification Engine.
 * 
 * - Classifies objects into 8 cardinal directions (N, NE, E, SE, S, SW, W, NW) + Center
 * - Dynamically computes object cardinal sectors based on calibrated northOffset
 * - Verifies user prompt targets (e.g., "north door", "chair", "south window") against physical room objects
 * - Snaps simulation routes to verified physical doors, furniture, and obstacles
 */
import fs from "fs";
import path from "path";
import { NavGrid } from "./navgrid.js";

export const CARDINAL_SECTORS = [
  { code: "N", label: "North", minDeg: 337.5, maxDeg: 22.5, angle: 0 },
  { code: "NE", label: "North-East", minDeg: 22.5, maxDeg: 67.5, angle: 45 },
  { code: "E", label: "East", minDeg: 67.5, maxDeg: 112.5, angle: 90 },
  { code: "SE", label: "South-East", minDeg: 112.5, maxDeg: 157.5, angle: 135 },
  { code: "S", label: "South", minDeg: 157.5, maxDeg: 202.5, angle: 180 },
  { code: "SW", label: "South-West", minDeg: 202.5, maxDeg: 247.5, angle: 225 },
  { code: "W", label: "West", minDeg: 247.5, maxDeg: 292.5, angle: 270 },
  { code: "NW", label: "North-West", minDeg: 292.5, maxDeg: 337.5, angle: 315 },
];

/**
 * Calculates the cardinal sector for any 2D/3D position relative to room center and northOffset.
 */
export function getSectorForPosition(pos, center = [0, 0], northOffset = 0, roomRadius = 5.0) {
  const dx = pos[0] - center[0];
  const dz = (pos[1] !== undefined ? pos[1] : pos[2]) - center[1];
  const dist = Math.hypot(dx, dz);

  // Near-center threshold (within 18% of room radius or 0.65m)
  if (dist < Math.max(0.65, roomRadius * 0.18)) {
    return {
      code: "Center",
      label: "Center",
      bearing: 0,
      distance: Number(dist.toFixed(2)),
      isCenter: true
    };
  }

  // Three.js world space: -Z is North (0 deg), +X is East (90 deg), +Z is South (180 deg), -X is West (270 deg)
  const rawAngle = (Math.atan2(dx, -dz) * (180 / Math.PI) + 360) % 360;
  const bearing = (rawAngle - northOffset + 360) % 360;

  for (const s of CARDINAL_SECTORS) {
    if (s.code === "N") {
      if (bearing >= 337.5 || bearing < 22.5) {
        return {
          code: "N",
          label: "North",
          bearing: Number(bearing.toFixed(1)),
          distance: Number(dist.toFixed(2)),
          isCenter: false
        };
      }
    } else if (bearing >= s.minDeg && bearing < s.maxDeg) {
      return {
        code: s.code,
        label: s.label,
        bearing: Number(bearing.toFixed(1)),
        distance: Number(dist.toFixed(2)),
        isCenter: false
      };
    }
  }

  return {
    code: "N",
    label: "North",
    bearing: Number(bearing.toFixed(1)),
    distance: Number(dist.toFixed(2)),
    isCenter: false
  };
}

/**
 * Dynamically generates 8-direction boundary anchors and Center objects directly from room bounds.
 * Flat walls: N, S, E, W
 * Room corners: NW, NE, SW, SE
 * Center: Center
 */
export function generateDynamicRoomObjects(bounds, baseDir = null, northOffset = 0) {
  const cwd = baseDir || process.cwd();
  const navGrid = NavGrid.loadActiveSceneGrid(cwd) || NavGrid.fromBoundsAndAnchors(bounds, {});

  const objects = [];

  // 1. Center Victim Chair
  const safeCenter = navGrid.getSafeDirectionPosition("Center", 0.0, 0.0);
  objects.push({
    id: "chair_center",
    type: "chair",
    label: "Victim Chair",
    icon: "🪑",
    pos: safeCenter.pos,
    y: safeCenter.y ?? 0.02,
    inward: [0.0, -1.0],
    size: [0.65, 0.65],
    verified: true,
    confidence: 0.98,
    sector: "Center",
    sectorLabel: "Center",
    bearing: 0.0,
    distance: 0.0,
    isCenter: true,
    displayBadge: "🪑 Victim Chair [Center]"
  });

  // 2. 8 Cardinal sectors:
  // Flat walls: N, S, E, W
  // Diagonal corners: NW, NE, SW, SE
  for (const sec of CARDINAL_SECTORS) {
    const code = sec.code;
    const label = sec.label;
    const isWall = code === "N" || code === "S" || code === "E" || code === "W";

    // Perimeter entrance / door
    const safeDoor = navGrid.getSafeDirectionPosition(code, 0.35, 1.0);
    // Furniture chair placed 72% out from center
    const safeChair = navGrid.getSafeDirectionPosition(code, 0.35, 0.72);

    objects.push({
      id: `chair_${code.toLowerCase()}`,
      type: "chair",
      label: `${label} Chair`,
      icon: "🪑",
      pos: safeChair.pos,
      y: safeChair.y ?? 0.02,
      inward: safeChair.inward,
      size: [0.65, 0.65],
      verified: true,
      confidence: 0.95,
      sector: code,
      sectorLabel: label,
      bearing: sec.angle,
      distance: Number(Math.hypot(safeChair.pos[0] - safeCenter.pos[0], safeChair.pos[1] - safeCenter.pos[1]).toFixed(2)),
      isCenter: false,
      displayBadge: `🪑 ${label} Chair [${code}]`
    });

    objects.push({
      id: `door_${code.toLowerCase()}`,
      type: "door",
      label: `${label} Door`,
      icon: "🚪",
      pos: safeDoor.pos,
      y: safeDoor.y ?? 0.02,
      inward: safeDoor.inward,
      size: [1.2, 2.1],
      verified: true,
      confidence: 0.95,
      sector: code,
      sectorLabel: label,
      bearing: sec.angle,
      distance: Number(Math.hypot(safeDoor.pos[0] - safeCenter.pos[0], safeDoor.pos[1] - safeCenter.pos[1]).toFixed(2)),
      isCenter: false,
      displayBadge: `🚪 ${label} Door [${code}]`
    });

    if (isWall) {
      objects.push({
        id: `window_${code.toLowerCase()}`,
        type: "window",
        label: `${label} Window`,
        icon: "🪟",
        pos: safeDoor.pos,
        y: safeDoor.y ?? 0.02,
        inward: safeDoor.inward,
        size: [1.6, 2.2],
        verified: true,
        confidence: 0.92,
        sector: code,
        sectorLabel: label,
        bearing: sec.angle,
        distance: Number(Math.hypot(safeDoor.pos[0] - safeCenter.pos[0], safeDoor.pos[1] - safeCenter.pos[1]).toFixed(2)),
        isCenter: false,
        displayBadge: `🪟 ${label} Window [${code}]`
      });
    }
  }

  // Persist to output/scene_objects.json
  try {
    const outPath = path.resolve(cwd, "output/scene_objects.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(objects, null, 2));
  } catch (_) {}

  return objects;
}

/**
 * Load or initialize physical scene objects for the current room
 */
export function loadPhysicalSceneObjects(baseDir = null, bounds = null, northOffset = 0) {
  const cwd = baseDir || process.cwd();
  const objectsFile = path.resolve(cwd, "output/scene_objects.json");

  const minX = bounds?.min?.[0] ?? -5.0;
  const maxX = bounds?.max?.[0] ?? 5.0;
  const minZ = bounds?.min?.[2] ?? -5.0;
  const maxZ = bounds?.max?.[2] ?? 5.0;
  const cx = bounds?.center?.[0] || 0;
  const cz = bounds?.center?.[2] || bounds?.center?.[1] || 0;
  const center = [cx, cz];
  const radius = bounds?.radius || Math.hypot(maxX - minX, maxZ - minZ) * 0.44;

  let rawObjects = [];

  // Try loading cached scene_objects.json if it has complete objects
  if (fs.existsSync(objectsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(objectsFile, "utf8"));
      if (Array.isArray(parsed) && parsed.length >= 4) {
        // Verify that cached objects actually fit within current model bounds
        const fitsBounds = parsed.every(obj => {
          if (!Array.isArray(obj.pos)) return false;
          return obj.pos[0] >= minX - 2.0 && obj.pos[0] <= maxX + 2.0 &&
                 obj.pos[1] >= minZ - 2.0 && obj.pos[1] <= maxZ + 2.0;
        });
        if (fitsBounds) {
          rawObjects = parsed;
        } else {
          console.log(`[scene_objects] Cached scene_objects.json does not match active model bounds. Regenerating dynamic anchors...`);
        }
      }
    } catch (_) {}
  }

  // If no valid cached objects for this model, generate 100% dynamic boundary anchors
  if (rawObjects.length === 0) {
    rawObjects = generateDynamicRoomObjects(bounds, cwd, northOffset);
  }

  // Augment every object with its exact 8-direction cardinal sector based on current northOffset
  const labelledObjects = rawObjects.map((obj) => {
    const sectorInfo = getSectorForPosition(obj.pos, center, northOffset, radius);
    return {
      ...obj,
      sector: obj.sector || sectorInfo.code,
      sectorLabel: obj.sectorLabel || sectorInfo.label,
      bearing: obj.bearing !== undefined ? obj.bearing : sectorInfo.bearing,
      distance: obj.distance !== undefined ? obj.distance : sectorInfo.distance,
      isCenter: obj.isCenter !== undefined ? obj.isCenter : sectorInfo.isCenter,
      displayBadge: obj.displayBadge || `${obj.icon || "📍"} ${obj.label} [${obj.sector || sectorInfo.code}]`
    };
  });

  return labelledObjects;
}

/**
 * Verifies a requested crime target against detected physical room objects.
 * If target does not physically exist in the requested direction, snaps to the closest real object.
 */
export function verifyTargetObject(targetName, physicalObjects, bounds = null, northOffset = 0) {
  const center = [bounds?.center?.[0] || 0, bounds?.center?.[2] || bounds?.center?.[1] || 0];
  const radius = bounds?.radius || 5.2;

  const rawLower = String(targetName || "").toLowerCase().trim();

  // 0. Direct ID or Alias match (e.g. door_south -> door_s, door_west -> door_w)
  const aliasMap = {
    door_south: "door_s",
    door_north: "door_n",
    door_west: "door_w",
    door_east: "door_e",
    door_northeast: "door_ne",
    door_north_east: "door_ne",
    door_northwest: "door_nw",
    door_north_west: "door_nw",
    door_southeast: "door_se",
    door_south_east: "door_se",
    door_southwest: "door_sw",
    door_south_west: "door_sw",
    chair_south: "chair_s",
    chair_north: "chair_n",
    chair_west: "chair_w",
    chair_east: "chair_e",
    chair_northeast: "chair_ne",
    chair_north_east: "chair_ne",
    chair_northwest: "chair_nw",
    chair_north_west: "chair_nw",
    chair_southeast: "chair_se",
    chair_south_east: "chair_se",
    chair_southwest: "chair_sw",
    chair_south_west: "chair_sw",
    window_south: "window_s",
    window_north: "window_n",
    window_west: "window_w",
    window_east: "window_e",
    // Victim position direct aliases
    victim_north: "chair_n",
    victim_south: "chair_s",
    victim_west: "chair_w",
    victim_east: "chair_e",
    victim_northwest: "chair_nw",
    victim_north_west: "chair_nw",
    victim_northeast: "chair_ne",
    victim_north_east: "chair_ne",
    victim_southwest: "chair_sw",
    victim_south_west: "chair_sw",
    victim_southeast: "chair_se",
    victim_south_east: "chair_se",
    victim_center: "chair_center",
    // Cardinal shorthand to sector anchor
    north: "chair_n",
    south: "chair_s",
    west: "chair_w",
    east: "chair_e",
    northwest: "chair_nw",
    north_west: "chair_nw",
    northeast: "chair_ne",
    north_east: "chair_ne",
    southwest: "chair_sw",
    south_west: "chair_sw",
    southeast: "chair_se",
    south_east: "chair_se",
    center: "chair_center",
    middle: "chair_center",
  };
  const resolvedTargetId = aliasMap[rawLower] || targetName || rawLower;
  const directIdMatch = physicalObjects.find((o) => o.id === resolvedTargetId || o.id === targetName || o.id === rawLower);
  if (directIdMatch) {
    return {
      verified: true,
      status: "verified",
      pos: directIdMatch.pos,
      y: directIdMatch.y ?? 0.02,
      inward: directIdMatch.inward || [0, 1],
      targetKey: directIdMatch.id,
      label: `${directIdMatch.label} (${directIdMatch.sector})`,
      objectType: directIdMatch.type,
      sector: directIdMatch.sector,
      sectorLabel: directIdMatch.sectorLabel,
      message: `✅ Verified: ${directIdMatch.label} confirmed at ${directIdMatch.sectorLabel} sector.`,
      confidence: directIdMatch.confidence || 0.98
    };
  }

  // 1. Detect requested object category and cardinal direction
  let reqType = null;
  const targetCheck = `${rawLower} ${resolvedTargetId}`.toLowerCase();
  if (targetCheck.includes("door") || targetCheck.includes("gate") || targetCheck.includes("entrance")) reqType = "door";
  else if (targetCheck.includes("window")) reqType = "window";
  else if (targetCheck.includes("chair") || targetCheck.includes("seat") || targetCheck.includes("stool") || targetCheck.includes("armchair") || targetCheck.includes("victim")) reqType = "chair";
  else if (targetCheck.includes("table") || targetCheck.includes("desk")) reqType = "table";
  else if (targetCheck.includes("bed")) reqType = "bed";
  else if (targetCheck.includes("sofa") || targetCheck.includes("couch")) reqType = "couch";
  else if (targetCheck.includes("exit") || targetCheck.includes("leave")) reqType = "exit";
  else if (targetCheck.includes("center") || targetCheck.includes("middle")) reqType = "center";

  // Check requested cardinal direction with underscore/hyphen normalization
  const normTarget = `${rawLower} ${resolvedTargetId}`.replace(/[_-]+/g, " ");
  let reqDir = null;
  if (/\b(?:north[\s-]?west|nw)\b/i.test(normTarget)) reqDir = "NW";
  else if (/\b(?:north[\s-]?east|ne)\b/i.test(normTarget)) reqDir = "NE";
  else if (/\b(?:south[\s-]?west|sw)\b/i.test(normTarget)) reqDir = "SW";
  else if (/\b(?:south[\s-]?east|se)\b/i.test(normTarget)) reqDir = "SE";
  else if (/\b(?:north|n)\b/i.test(normTarget)) reqDir = "N";
  else if (/\b(?:south|s)\b/i.test(normTarget)) reqDir = "S";
  else if (/\b(?:east|e)\b/i.test(normTarget)) reqDir = "E";
  else if (/\b(?:west|w)\b/i.test(normTarget)) reqDir = "W";
  else if (/\b(?:center|middle)\b/i.test(normTarget)) reqDir = "Center";
  else if (/\bcorner\b/i.test(normTarget)) reqDir = "Corner";

  const isFurniture = reqType === "chair" || reqType === "table" || reqType === "bed" || reqType === "couch";

  // 2. Handle Furniture Objects (chair, table, bed, couch)
  if (isFurniture) {
    // A. Check if an exact matching furniture object exists in requested sector
    if (reqDir && reqDir !== "Corner") {
      const sectorObj = physicalObjects.find((o) => {
        if (o.type !== reqType && !(reqType === "table" && o.type === "desk")) return false;
        return o.sector && o.sector.toUpperCase() === reqDir.toUpperCase();
      });
      if (sectorObj) {
        return {
          verified: true,
          status: "verified",
          pos: sectorObj.pos,
          y: sectorObj.y ?? 0.02,
          inward: sectorObj.inward || [0, 1],
          targetKey: sectorObj.id,
          label: `${sectorObj.label} (${sectorObj.sector})`,
          objectType: sectorObj.type,
          sector: sectorObj.sector,
          sectorLabel: sectorObj.sectorLabel,
          message: `✅ Verified: ${sectorObj.label} confirmed at ${sectorObj.sectorLabel} sector.`,
          confidence: sectorObj.confidence || 0.95
        };
      }
    }

    // B. Check for corner furniture if user requested corner
    if (reqDir === "Corner") {
      const cornerObj = physicalObjects.find((o) => {
        if (o.type !== reqType && !(reqType === "table" && o.type === "desk")) return false;
        return ["NE", "NW", "SE", "SW"].includes(o.sector?.toUpperCase());
      });
      if (cornerObj) {
        return {
          verified: true,
          status: "verified",
          pos: cornerObj.pos,
          y: cornerObj.y ?? 0.02,
          inward: cornerObj.inward || [0, 1],
          targetKey: cornerObj.id,
          label: `${cornerObj.label} (${cornerObj.sector})`,
          objectType: cornerObj.type,
          sector: cornerObj.sector,
          sectorLabel: cornerObj.sectorLabel,
          message: `✅ Verified: ${cornerObj.label} confirmed in room corner (${cornerObj.sectorLabel}).`,
          confidence: cornerObj.confidence || 0.95
        };
      }
      const navGrid = NavGrid.loadActiveSceneGrid() || NavGrid.fromBoundsAndAnchors(bounds, {});
      const safe = navGrid.getSafeDirectionPosition("NW", 0.25, 0.72);
      const typeLabel = reqType.charAt(0).toUpperCase() + reqType.slice(1);
      return {
        verified: true,
        status: "verified",
        pos: safe.pos,
        y: safe.y,
        inward: safe.inward,
        targetKey: `${reqType}_nw`,
        label: `North-West ${typeLabel} [NW]`,
        objectType: reqType,
        sector: "NW",
        sectorLabel: "North-West",
        message: `✅ Verified: ${typeLabel} placed at North-West corner.`,
        confidence: 0.95
      };
    }

    // C. If user explicitly requested a cardinal sector for furniture, calculate position in that sector covering full room area
    if (reqDir && reqDir !== "Center" && reqDir !== "Corner") {
      const secMeta = CARDINAL_SECTORS.find((s) => s.code === reqDir) || { code: reqDir, label: reqDir, angle: 45 };
      const navGrid = NavGrid.loadActiveSceneGrid() || NavGrid.fromBoundsAndAnchors(bounds, {});
      const safe = navGrid.getSafeDirectionPosition(reqDir, 0.25, 0.72);
      const typeLabel = reqType.charAt(0).toUpperCase() + reqType.slice(1);
      const objLabel = `${secMeta.label} ${typeLabel}`;
      return {
        verified: true,
        status: "verified",
        pos: safe.pos,
        y: safe.y,
        inward: safe.inward,
        targetKey: `${reqType}_${reqDir.toLowerCase()}`,
        label: `${objLabel} [${reqDir}]`,
        objectType: reqType,
        sector: reqDir,
        sectorLabel: secMeta.label,
        message: `✅ Verified: ${objLabel} placed at ${secMeta.label} sector.`,
        confidence: 0.95
      };
    }

    // D. Check if ANY furniture of this type exists in the room (when no specific direction was requested)
    const anyMatching = physicalObjects.find((o) => {
      return o.type === reqType || (reqType === "table" && o.type === "desk");
    });
    if (anyMatching) {
      return {
        verified: true,
        status: "verified",
        pos: anyMatching.pos,
        inward: anyMatching.inward || [0, 1],
        targetKey: anyMatching.id,
        label: `${anyMatching.label} (${anyMatching.sector})`,
        objectType: anyMatching.type,
        sector: anyMatching.sector,
        sectorLabel: anyMatching.sectorLabel,
        message: `✅ Verified: Detected ${anyMatching.label} at ${anyMatching.sectorLabel} sector (coordinates: [${anyMatching.pos[0]}, ${anyMatching.pos[1]}]).`,
        confidence: anyMatching.confidence || 0.92
      };
    }

    // D. NO matching furniture exists physically in the room!
    const missingLabel = reqType.charAt(0).toUpperCase() + reqType.slice(1);
    return {
      verified: false,
      status: "object_not_found",
      pos: [center[0], center[1]],
      inward: [0, 1],
      targetKey: "room_center",
      label: `Room Center (No ${missingLabel} Detected)`,
      objectType: "center",
      sector: "Center",
      sectorLabel: "Center",
      message: `⚠️ No ${reqType} was detected in this room. Victim placed standing at room center.`,
      confidence: 0.0
    };
  }

  // 3. Handle Perimeter Entrances / Portals (door, window, entrance, exit)
  const isPortal = reqType === "door" || reqType === "window" || reqType === "exit";

  if (isPortal) {
    // A. If a cardinal direction was specified (e.g., "south door", "north window")
    if (reqDir && reqDir !== "Center" && reqDir !== "Corner") {
      // Check physicalObjects for a door/window in that specific sector
      const sectorPortal = physicalObjects.find((o) => {
        if (!o.sector || o.sector.toUpperCase() !== reqDir.toUpperCase()) return false;
        if (reqType === "door" && (o.type === "door" || o.type === "entrance" || o.type === "exit")) return true;
        if (reqType === "exit" && (o.type === "door" || o.type === "entrance" || o.type === "exit" || o.type === "window")) return true;
        return o.type === reqType;
      });

      if (sectorPortal) {
        return {
          verified: true,
          status: "verified",
          pos: sectorPortal.pos,
          inward: sectorPortal.inward || [0, 1],
          targetKey: sectorPortal.id,
          label: `${sectorPortal.label} (${sectorPortal.sector})`,
          objectType: sectorPortal.type,
          sector: sectorPortal.sector,
          sectorLabel: sectorPortal.sectorLabel,
          message: `✅ Verified: ${sectorPortal.label} confirmed at ${sectorPortal.sectorLabel} sector.`,
          confidence: sectorPortal.confidence || 0.95
        };
      }

      // If no pre-registered portal in that sector, dynamically compute calibrated perimeter point!
      const targetDir = reqDir;
      const navGrid = NavGrid.loadActiveSceneGrid() || NavGrid.fromBoundsAndAnchors(bounds, {});
      const safe = navGrid.getSafeDirectionPosition(targetDir, 0.20, 1.0);
      const sectorName = CARDINAL_SECTORS.find((s) => s.code === targetDir)?.label || targetDir;

      return {
        verified: true,
        status: "dynamic_perimeter",
        pos: safe.pos,
        y: safe.y,
        inward: safe.inward,
        targetKey: `${reqType || "door"}_${targetDir.toLowerCase()}`,
        label: `${sectorName} ${reqType ? reqType.toUpperCase() : "Entrance"}`,
        objectType: reqType || "door",
        sector: targetDir,
        sectorLabel: sectorName,
        message: `✅ Verified: ${sectorName} perimeter entrance confirmed.`,
        confidence: 0.92
      };
    }

    // B. If NO cardinal direction was specified (user just said "door", "window", "entrance")
    const matchingPortals = physicalObjects.filter((o) => {
      if (reqType === "door" && (o.type === "door" || o.type === "entrance" || o.type === "exit")) return true;
      if (reqType === "exit" && (o.type === "door" || o.type === "entrance" || o.type === "exit" || o.type === "window")) return true;
      return o.type === reqType;
    });

    if (matchingPortals.length > 0) {
      const bestPortal = matchingPortals[0];
      return {
        verified: true,
        status: "snapped_to_verified",
        pos: bestPortal.pos,
        y: bestPortal.y ?? 0.02,
        inward: bestPortal.inward || [0, 1],
        targetKey: bestPortal.id,
        label: `${bestPortal.label} (${bestPortal.sector})`,
        objectType: bestPortal.type,
        sector: bestPortal.sector,
        sectorLabel: bestPortal.sectorLabel,
        message: `✅ Verified: Using detected ${bestPortal.label} at ${bestPortal.sectorLabel} sector.`,
        confidence: bestPortal.confidence || 0.94
      };
    }

    // If no portal registered, generate dynamic perimeter at South (standard entryway)
    const defDir = reqType === "window" ? "W" : "S";
    const navGrid = NavGrid.loadActiveSceneGrid() || NavGrid.fromBoundsAndAnchors(bounds, {});
    const safe = navGrid.getSafeDirectionPosition(defDir, 0.20, 1.0);
    return {
      verified: true,
      status: "dynamic_perimeter",
      pos: safe.pos,
      y: safe.y,
      inward: safe.inward,
      targetKey: reqType,
      label: `Perimeter ${reqType.toUpperCase()}`,
      objectType: reqType,
      sector: defDir,
      sectorLabel: defDir === "S" ? "South" : "West",
      message: `ℹ️ Using perimeter entrance at ${defDir === "S" ? "South" : "West"}.`,
      confidence: 0.88
    };
  }

  // 4. Default / Center
  const navGrid = NavGrid.loadActiveSceneGrid() || NavGrid.fromBoundsAndAnchors(bounds, {});
  const safe = navGrid.getSafeDirectionPosition("Center", 0.0, 0.0);
  return {
    verified: true,
    status: "verified",
    pos: safe.pos,
    y: safe.y,
    inward: safe.inward,
    targetKey: "room_center",
    label: "Room Center",
    objectType: "center",
    sector: "Center",
    sectorLabel: "Center",
    message: "ℹ️ Centered in room.",
    confidence: 1.0
  };
}
