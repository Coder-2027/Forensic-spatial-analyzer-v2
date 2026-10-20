#!/usr/bin/env python3
import os
import json
import trimesh
import numpy as np

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mesh_path = os.path.join(base_dir, "output", "openmvs", "scene_textured.glb")
dir_path = os.path.join(base_dir, "output", "direction.json")

north_offset = 18.92
if os.path.exists(dir_path):
    with open(dir_path) as f:
        d = json.load(f)
        north_offset = float(d.get("northOffset", 18.92))

scene = trimesh.load(mesh_path)
mesh = trimesh.util.concatenate([g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)])
v = mesh.vertices.copy()
n = mesh.vertex_normals
is_inverted = np.sum(n[:, 1] < -0.4) > np.sum(n[:, 1] > 0.4)
if is_inverted:
    v[:, 1] = -v[:, 1]
    v[:, 2] = -v[:, 2]

p1_x, p99_x = np.percentile(v[:, 0], 1.5), np.percentile(v[:, 0], 98.5)
p1_y, p99_y = np.percentile(v[:, 1], 2.5), np.percentile(v[:, 1], 97.5)
p1_z, p99_z = np.percentile(v[:, 2], 1.5), np.percentile(v[:, 2], 98.5)

raw_height = max(1.0, p99_y - p1_y)
scale = float(np.clip(3.8 / raw_height, 0.4, 2.5))
cx = float((p1_x + p99_x) / 2.0)
cz = float((p1_z + p99_z) / 2.0)
floor_y = float(p1_y)

v_c = (v - np.array([cx, floor_y, cz])) * scale

# Grid definition: -3.5 to +3.5 in X and Z, cell size 0.2m
cell = 0.2
min_x, max_x = -3.5, 3.5
min_z, max_z = -3.5, 3.5
nx = int(np.ceil((max_x - min_x) / cell))
nz = int(np.ceil((max_z - min_z) / cell))

# Assign each vertex to cell ix, iz
ix = np.floor((v_c[:, 0] - min_x) / cell).astype(int)
iz = np.floor((v_c[:, 2] - min_z) / cell).astype(int)

valid = (ix >= 0) & (ix < nx) & (iz >= 0) & (iz < nz)
ix_v = ix[valid]
iz_v = iz[valid]
y_v = v_c[valid, 1]

has_pts = np.zeros((nz, nx), dtype=bool)
has_floor = np.zeros((nz, nx), dtype=bool)
has_obs = np.zeros((nz, nx), dtype=bool)

# Mark cells
for x_idx, z_idx, y_val in zip(ix_v, iz_v, y_v):
    has_pts[z_idx, x_idx] = True
    if -0.15 <= y_val <= 0.35:
        has_floor[z_idx, x_idx] = True
    if 0.35 < y_val <= 1.80:
        has_obs[z_idx, x_idx] = True

print(f"Room Centered Mesh (scale={scale:.3f}, northOffset={north_offset:.1f}°):")
print("Legend: [.] Walkable Floor, [#] Furniture/Wall Obstacle, [ ] Outside Model (Void)")

header = "      " + "".join(f"{min_x + c * cell:+4.1f}" if c % 5 == 0 else "  " for c in range(nx))
print(header)

for r in range(nz):
    z_val = min_z + r * cell
    row_chars = []
    for c in range(nx):
        if not has_pts[r, c]:
            row_chars.append(" ")
        elif has_obs[r, c]:
            row_chars.append("#")
        elif has_floor[r, c]:
            row_chars.append(".")
        else:
            row_chars.append("^")
    print(f"{z_val:+5.1f} " + "".join(row_chars))

# Summary of walkable bounds and furniture bounds
walk_z, walk_x = np.where(has_floor & (~has_obs))
if len(walk_x) > 0:
    min_walk_x = min_x + walk_x.min() * cell
    max_walk_x = min_x + walk_x.max() * cell
    min_walk_z = min_z + walk_z.min() * cell
    max_walk_z = min_z + walk_z.max() * cell
    print(f"\nWalkable Floor Extents: X=[{min_walk_x:.2f}, {max_walk_x:.2f}], Z=[{min_walk_z:.2f}, {max_walk_z:.2f}]")
