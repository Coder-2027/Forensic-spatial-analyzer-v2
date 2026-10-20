/**
 * Forensic 3D Navigation Grid & A* Obstacle-Avoiding Path Planner
 *
 * Recreates the exact collision and obstacle-avoidance behavior of Dummy_3D:
 * - 2D floor occupancy grid (cell size 0.1m)
 * - Furniture and solid structure detection (knee-to-head height: 0.25m - 1.70m above floor)
 * - 8-way A* path search with MinHeap priority queue
 * - Diagonal corner-cutting prevention
 * - Line-of-sight (LOS) raycast shortcut smoothing
 */
import fs from "fs";
import path from "path";

const MOVES = [
  [1, 0, 1.0],
  [-1, 0, 1.0],
  [0, 1, 1.0],
  [0, -1, 1.0],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414]
];

class MinHeap {
  constructor() {
    this.heap = [];
  }
  push(node) {
    this.heap.push(node);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].f <= this.heap[i].f) break;
      const tmp = this.heap[p];
      this.heap[p] = this.heap[i];
      this.heap[i] = tmp;
      i = p;
    }
  }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const end = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = end;
      let i = 0;
      const len = this.heap.length;
      while (true) {
        let left = (i << 1) + 1;
        let right = left + 1;
        let smallest = i;
        if (left < len && this.heap[left].f < this.heap[smallest].f) smallest = left;
        if (right < len && this.heap[right].f < this.heap[smallest].f) smallest = right;
        if (smallest === i) break;
        const tmp = this.heap[i];
        this.heap[i] = this.heap[smallest];
        this.heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
  get size() {
    return this.heap.length;
  }
}

export class NavGrid {
  constructor(obs, origin, cell = 0.1, nx, nz, heights = null) {
    this.obs = obs; // Uint8Array(nx * nz), 1 = obstacle, 0 = walkable
    this.origin = [Number(origin[0]), Number(origin[1])];
    this.cell = cell;
    this.nx = nx;
    this.nz = nz;
    this.heights = heights;
  }

  getFloorY(x, z) {
    if (!this.heights || this.heights.length === 0) return 0.02;
    const ix = Math.floor((x - this.origin[0]) / this.cell);
    const iz = Math.floor((z - this.origin[1]) / this.cell);
    if (ix < 0 || ix >= this.nx || iz < 0 || iz >= this.nz) return 0.02;
    const val = this.heights[ix + iz * this.nx];
    return (val !== undefined && !isNaN(val)) ? Number(val) : 0.02;
  }

  _ij(p) {
    const ix = Math.floor((p[0] - this.origin[0]) / this.cell);
    const iz = Math.floor((p[1] - this.origin[1]) / this.cell);
    return [
      Math.min(this.nx - 1, Math.max(0, ix)),
      Math.min(this.nz - 1, Math.max(0, iz))
    ];
  }

  _xz(ix, iz) {
    return [
      Number((this.origin[0] + (ix + 0.5) * this.cell).toFixed(3)),
      Number((this.origin[1] + (iz + 0.5) * this.cell).toFixed(3))
    ];
  }

  _free(cellCoords) {
    const [cx, cz] = cellCoords;
    if (!this.obs[cx + cz * this.nx]) return cellCoords;

    // Expand search ring outward to find closest walkable cell
    for (let rad = 1; rad < 25; rad++) {
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) !== rad && Math.abs(dz) !== rad) continue;
          const xx = cx + dx, zz = cz + dz;
          if (xx >= 0 && xx < this.nx && zz >= 0 && zz < this.nz) {
            if (!this.obs[xx + zz * this.nx]) {
              return [xx, zz];
            }
          }
        }
      }
    }
    return cellCoords;
  }

  getFreePosition(pt) {
    const cell = this._free(this._ij(pt));
    return this._xz(cell[0], cell[1]);
  }

  /**
   * Computes the bounding box and center of all walkable cells in the room.
   */
  getWalkableBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let count = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        if (!this.obs[ix + iz * this.nx]) {
          const [x, z] = this._xz(ix, iz);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
          count++;
        }
      }
    }
    if (count === 0) {
      const min = [this.origin[0], this.origin[1]];
      const max = [this.origin[0] + this.nx * this.cell, this.origin[1] + this.nz * this.cell];
      return {
        min,
        max,
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
        spanX: max[0] - min[0],
        spanZ: max[1] - min[1]
      };
    }
    return {
      min: [Number(minX.toFixed(3)), Number(minZ.toFixed(3))],
      max: [Number(maxX.toFixed(3)), Number(maxZ.toFixed(3))],
      center: [Number(((minX + maxX) / 2).toFixed(3)), Number(((minZ + maxZ) / 2).toFixed(3))],
      spanX: Number((maxX - minX).toFixed(3)),
      spanZ: Number((maxZ - minZ).toFixed(3))
    };
  }

  /**
   * Dynamically calculates safe positions for 8 directions:
   * - Pure cardinal walls: N, S, E, W
   * - Diagonal corners: NW, NE, SW, SE
   * - Center: Center
   * Stretches across the full room area, and snaps to valid walkable floor cells.
   */
  getSafeDirectionPosition(dirCode, margin = 0.25, distFraction = 1.0) {
    const code = String(dirCode || "Center").toUpperCase();
    const bounds = this.getWalkableBounds();
    const cx = bounds.center[0];
    const cz = bounds.center[1];
    const minX = bounds.min[0] + margin;
    const maxX = bounds.max[0] - margin;
    const minZ = bounds.min[1] + margin;
    const maxZ = bounds.max[1] - margin;

    let targetX = cx;
    let targetZ = cz;
    let inward = [0, 1];

    switch (code) {
      case "N":
      case "NORTH":
        targetX = cx;
        targetZ = minZ;
        inward = [0, 1];
        break;
      case "S":
      case "SOUTH":
        targetX = cx;
        targetZ = maxZ;
        inward = [0, -1];
        break;
      case "E":
      case "EAST":
        targetX = maxX;
        targetZ = cz;
        inward = [-1, 0];
        break;
      case "W":
      case "WEST":
        targetX = minX;
        targetZ = cz;
        inward = [1, 0];
        break;
      case "NW":
      case "NORTHWEST":
      case "NORTH_WEST":
        targetX = minX;
        targetZ = minZ;
        inward = [0.707, 0.707];
        break;
      case "NE":
      case "NORTHEAST":
      case "NORTH_EAST":
        targetX = maxX;
        targetZ = minZ;
        inward = [-0.707, 0.707];
        break;
      case "SW":
      case "SOUTHWEST":
      case "SOUTH_WEST":
        targetX = minX;
        targetZ = maxZ;
        inward = [0.707, -0.707];
        break;
      case "SE":
      case "SOUTHEAST":
      case "SOUTH_EAST":
        targetX = maxX;
        targetZ = maxZ;
        inward = [-0.707, -0.707];
        break;
      case "CENTER":
      case "MIDDLE":
      default:
        targetX = cx;
        targetZ = cz;
        inward = [0, -1];
        break;
    }

    if (distFraction < 1.0 && code !== "CENTER" && code !== "MIDDLE") {
      targetX = cx + (targetX - cx) * distFraction;
      targetZ = cz + (targetZ - cz) * distFraction;
    }

    targetX = Math.max(minX, Math.min(maxX, targetX));
    targetZ = Math.max(minZ, Math.min(maxZ, targetZ));

    const freePos = this.getFreePosition([targetX, targetZ]);
    const floorY = this.getFloorY(freePos[0], freePos[1]);

    return {
      pos: freePos,
      y: floorY,
      inward: inward
    };
  }

  _los(c1, c2) {
    const dx = c2[0] - c1[0];
    const dz = c2[1] - c1[1];
    const steps = Math.max(Math.abs(dx), Math.abs(dz)) * 2 + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(c1[0] + dx * t);
      const z = Math.round(c1[1] + dz * t);
      if (x < 0 || x >= this.nx || z < 0 || z >= this.nz) return false;
      if (this.obs[x + z * this.nx]) return false;
    }
    return true;
  }

  /**
   * Plans an obstacle-free polyline from a to b in world coordinates.
   */
  path(a, b) {
    const pA = [Number(a[0]), Number(a[1])];
    const pB = [Number(b[0]), Number(b[1])];
    const dDirect = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
    if (dDirect < 0.1) return [pA, pB];

    const s = this._free(this._ij(pA));
    const g = this._free(this._ij(pB));

    if (s[0] === g[0] && s[1] === g[1]) {
      return [pA, pB];
    }

    const startKey = s[0] + s[1] * this.nx;
    const goalKey = g[0] + g[1] * this.nx;

    const gScore = new Float32Array(this.nx * this.nz).fill(1e9);
    const cameFrom = new Int32Array(this.nx * this.nz).fill(-1);
    const closed = new Uint8Array(this.nx * this.nz);
    gScore[startKey] = 0;

    const openSet = new MinHeap();
    openSet.push({ key: startKey, f: Math.hypot(g[0] - s[0], g[1] - s[1]) });

    while (openSet.size > 0) {
      const curr = openSet.pop();
      if (!curr) break;
      if (curr.key === goalKey) break;
      if (closed[curr.key]) continue;
      closed[curr.key] = 1;

      const cx = curr.key % this.nx;
      const cz = Math.floor(curr.key / this.nx);
      const cg = gScore[curr.key];

      for (const [dx, dz, cost] of MOVES) {
        const xx = cx + dx, zz = cz + dz;
        if (xx < 0 || xx >= this.nx || zz < 0 || zz >= this.nz) continue;
        const nKey = xx + zz * this.nx;
        if (this.obs[nKey] || closed[nKey]) continue;

        // Prevent corner cutting diagonally across adjacent obstacles
        if (dx !== 0 && dz !== 0) {
          if (this.obs[cx + dx + cz * this.nx] || this.obs[cx + (cz + dz) * this.nx]) {
            continue;
          }
        }

        const tentative = cg + cost;
        if (tentative < gScore[nKey]) {
          gScore[nKey] = tentative;
          cameFrom[nKey] = curr.key;
          const h = Math.hypot(g[0] - xx, g[1] - zz);
          openSet.push({ key: nKey, f: tentative + h });
        }
      }
    }

    if (cameFrom[goalKey] === -1 && startKey !== goalKey) {
      // If direct line cuts across an obstacle, route around via clear corridor
      if (!this._los(this._ij(pA), this._ij(pB))) {
        const detourX = (pA[0] + pB[0]) / 2 < 0 ? -1.65 : 1.65;
        const midZ = (pA[1] + pB[1]) / 2;
        const detourCell = this._free(this._ij([detourX, midZ]));
        const detourPoint = this._xz(detourCell[0], detourCell[1]);
        return [pA, detourPoint, pB];
      }
      return [pA, pB];
    }

    // Trace cell path back from goal
    const cells = [];
    let curr = goalKey;
    while (curr !== -1) {
      cells.push([curr % this.nx, Math.floor(curr / this.nx)]);
      if (curr === startKey) break;
      curr = cameFrom[curr];
    }
    cells.reverse();

    if (cells.length <= 2) return [pA, pB];

    // Line-of-Sight (LOS) smoothing
    const keep = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this._los(cells[i], cells[j])) {
        j--;
      }
      keep.push(cells[j]);
      i = j;
    }

    const waypoints = [pA];
    for (let k = 1; k < keep.length - 1; k++) {
      waypoints.push(this._xz(keep[k][0], keep[k][1]));
    }
    waypoints.push(pB);

    return waypoints;
  }

  /**
   * Factory: rasterizes 3D point cloud into 2D obstacle navigation grid
   */
  static fromPointCloud(pts, cell = 0.1, y_lo = 0.25, y_hi = 1.70, min_pts = 4) {
    const n = Math.floor(pts.length / 3);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], z = pts[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const loX = minX - 0.2;
    const loZ = minZ - 0.2;
    const nx = Math.ceil((maxX + 0.2 - loX) / cell);
    const nz = Math.ceil((maxZ + 0.2 - loZ) / cell);

    const counts = new Uint16Array(nx * nz);
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      if (y > y_lo && y < y_hi) {
        const ix = Math.floor((x - loX) / cell);
        const iz = Math.floor((z - loZ) / cell);
        if (ix >= 0 && ix < nx && iz >= 0 && iz < nz) {
          counts[ix + iz * nx]++;
        }
      }
    }

    const obs = new Uint8Array(nx * nz);
    for (let i = 0; i < nx * nz; i++) {
      if (counts[i] >= min_pts) obs[i] = 1;
    }

    // 1-cell dilation (0.1m human clearance)
    const dilated = new Uint8Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (obs[x + z * nx]) {
          dilated[x + z * nx] = 1;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = x + dx, zz = z + dz;
            if (xx >= 0 && xx < nx && zz >= 0 && zz < nz) {
              dilated[xx + zz * nx] = 1;
            }
          }
        }
      }
    }

    return new NavGrid(dilated, [loX, loZ], cell, nx, nz);
  }

  /**
   * Load active scene navigation grid from Dummy_3D cloud or mesh data
   */
  static loadActiveSceneGrid(customPath = null) {
    const jsonPaths = [
      customPath,
      path.resolve(process.cwd(), "output/navgrid.json"),
      path.resolve(process.cwd(), "output/openmvs/navgrid.json"),
    ].filter(Boolean);

    for (const jp of jsonPaths) {
      if (fs.existsSync(jp) && jp.endsWith(".json")) {
        try {
          const data = JSON.parse(fs.readFileSync(jp, "utf8"));
          if (data.origin && data.nx && data.nz && data.obs_b64) {
            const buf = Buffer.from(data.obs_b64, "base64");
            const obs = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            const heights = data.heights ? new Float32Array(data.heights) : null;
            console.log(`[NavGrid] Loaded centered room obstacle grid (${data.nx}x${data.nz}) with elevations from ${jp}`);
            return new NavGrid(obs, data.origin, data.cell || 0.1, data.nx, data.nz, heights);
          }
        } catch (e) {
          console.warn("[NavGrid] Error reading navgrid.json:", e.message);
        }
      }
    }

    const searchDirs = [
      customPath,
      path.resolve(process.cwd(), "output/openmvs"),
      "/Users/mohammadmojijansari/Documents/Dummy_3D/out",
      path.resolve(process.cwd(), "../Dummy_3D/out")
    ].filter(Boolean);

    for (const d of searchDirs) {
      const cloudBin = path.join(d, "cloud.bin");
      if (fs.existsSync(cloudBin)) {
        try {
          const buf = fs.readFileSync(cloudBin);
          const n = Math.floor(buf.length / 12);
          const pts = new Float32Array(buf.buffer, buf.byteOffset, n * 3);
          const grid = NavGrid.fromPointCloud(pts);
          console.log(`[NavGrid] Initialized obstacle grid (${grid.nx}x${grid.nz}) from ${cloudBin}`);
          return grid;
        } catch (e) {
          console.warn("[NavGrid] Error reading cloud.bin:", e.message);
        }
      }
    }

    return null;
  }

  /**
   * Factory: create synthetic grid stamped with room boundary walls & furniture footprints
   */
  static fromBoundsAndAnchors(bounds, anchors = {}) {
    const min = bounds?.min || [-5, 0, -5];
    const max = bounds?.max || [5, 3.8, 5];
    const cell = 0.1;

    const loX = min[0] - 0.5;
    const loZ = min[2] - 0.5;
    const nx = Math.ceil((max[0] + 0.5 - loX) / cell);
    const nz = Math.ceil((max[2] + 0.5 - loZ) / cell);

    const obs = new Uint8Array(nx * nz);

    function stampBox(cx, cz, halfW, halfH) {
      const minX = Math.floor((cx - halfW - loX) / cell);
      const maxX = Math.ceil((cx + halfW - loX) / cell);
      const minZ = Math.floor((cz - halfH - loZ) / cell);
      const maxZ = Math.ceil((cz + halfH - loZ) / cell);

      for (let z = Math.max(0, minZ); z <= Math.min(nz - 1, maxZ); z++) {
        for (let x = Math.max(0, minX); x <= Math.min(nx - 1, maxX); x++) {
          obs[x + z * nx] = 1;
        }
      }
    }

    // 1. Stamp room outer perimeter walls
    for (let x = 0; x < nx; x++) {
      obs[x + 0 * nx] = 1;
      obs[x + (nz - 1) * nx] = 1;
    }
    for (let z = 0; z < nz; z++) {
      obs[0 + z * nx] = 1;
      obs[(nx - 1) + z * nx] = 1;
    }

    // 2. Stamp furniture footprints from anchors
    for (const [name, anc] of Object.entries(anchors)) {
      if (!anc || !anc.pos) continue;
      const type = anc.type;
      const [px, pz] = anc.pos;

      if (type === "desk") {
        stampBox(px, pz, 0.8, 0.5);
      } else if (type === "table") {
        stampBox(px, pz, 1.0, 0.7);
      } else if (type === "couch" || type === "sofa") {
        stampBox(px, pz, 1.1, 0.55);
      } else if (type === "bed") {
        stampBox(px, pz, 1.2, 0.95);
      } else if (type === "chair") {
        stampBox(px, pz, 0.38, 0.38);
      }
    }

    // Only stamp central living room table if it is an actual physical object in anchors
    for (const [name, anc] of Object.entries(anchors)) {
      if (!anc || !anc.pos) continue;
      const type = anc.type;
      const [px, pz] = anc.pos;
      if (type === "table") {
        stampBox(px, pz, (anc.size?.[0] ? anc.size[0] / 2 : 0.8), (anc.size?.[1] ? anc.size[1] / 2 : 0.55));
      }
    }

    // 3. Clear openings around doors and exits
    for (const anc of Object.values(anchors)) {
      if (anc.type === "door" || anc.type === "exit" || anc.type === "window") {
        const ix = Math.floor((anc.pos[0] - loX) / cell);
        const iz = Math.floor((anc.pos[1] - loZ) / cell);
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            const xx = ix + dx, zz = iz + dz;
            if (xx >= 0 && xx < nx && zz >= 0 && zz < nz) {
              obs[xx + zz * nx] = 0;
            }
          }
        }
      }
    }

    return new NavGrid(obs, [loX, loZ], cell, nx, nz);
  }

  /**
   * Factory: create scene navigation grid.
   * Prioritizes the 100% dynamic obstacle grid derived from the 3D model mesh.
   */
  static createSceneGrid(bounds, anchors = {}, physicalObjects = []) {
    // 1. Prioritize active dynamic NavGrid from output/navgrid.json
    try {
      const active = NavGrid.loadActiveSceneGrid();
      if (active && active.obs && active.obs.length > 0) {
        console.log(`[NavGrid] Using dynamic 3D model obstacle grid (${active.nx}x${active.nz}, cell: ${active.cell}m)`);
        return active;
      }
    } catch (e) {
      console.warn("[NavGrid] Notice loading active scene grid:", e.message);
    }

    // Fallback: build grid from bounds and detected objects without hardcoded table
    return NavGrid.fromBoundsAndAnchors(bounds, anchors);
  }
}


