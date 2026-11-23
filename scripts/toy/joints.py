"""Playmobil-style shoulders for an A-posed hero.

  joints.py posed.glb posed.glb.bones.json toy.stl toy_fullcolour.ply outdir --height=100 --base=3

Each arm is cut off at its shoulder by a plane perpendicular to X (the pin axis), and
a round pin on the body goes into a hole in the arm: the arm swings forward and back
like a Playmobil arm. Left arm hole: tight (0.15 mm), right arm: loose (0.25 mm), so one
test print tells which fits. Writes body/left_arm/right_arm as STL and full-colour PLY.
"""
import argparse, json, os
import numpy as np, trimesh, manifold3d as mf
from scipy.spatial import cKDTree

ap = argparse.ArgumentParser()
for k in ["glb", "bones", "stl", "ply", "out"]:
    ap.add_argument(k)
ap.add_argument("--height", type=float, default=100)
ap.add_argument("--base", type=float, default=3)
ap.add_argument("--pin-d", type=float, default=3.4)
ap.add_argument("--pin-len", type=float, default=4.0)
ap.add_argument("--clear", default="0.15,0.25")
ap.add_argument("--cut-in", type=float, default=1.5, help="mm inside the shoulder joint where the cut plane sits")
ap.add_argument("--arm-r", type=float, default=7.0, help="radius of the region taken as 'arm' around the bone line, mm")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

# same transform as toyprep: glTF Y-up metres -> Z-up mm, figure height, centred, on the base
g = list(trimesh.load(a.glb).geometry.values())[0]
V = g.vertices
V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
s = a.height / (V[:, 2].max() - V[:, 2].min())
V = V * s
off = np.array([(V[:, 0].max() + V[:, 0].min()) / 2, (V[:, 1].max() + V[:, 1].min()) / 2, V[:, 2].min()])
def tr(p):
    p = np.array([p[0], -p[2], p[1]]) * s - off
    p[2] += a.base - 1.0
    return p
BJ = json.load(open(a.bones))
DOM = np.array(BJ.pop("__dominant")); POS = np.array(BJ.pop("__positions")).reshape(-1, 3)
B = {k: tr(v) for k, v in BJ.items()}
POSmm = np.array([tr(p) for p in POS])
def seg_dist(p, a0, a1):
    d = a1 - a0; t = np.clip(((p - a0) @ d) / (d @ d), 0, 1)
    return np.linalg.norm(p - (a0 + t[:, None] * d), axis=1)
def hull_of(names, seg=None, rmax=7.0, grow=0.4):
    pts = POSmm[np.isin(DOM, names)]
    if seg is not None:
        pts = pts[seg_dist(pts, *seg) < rmax]
    c = pts.mean(0); pts = c + (pts - c) * (1 + grow / max(1e-6, np.linalg.norm(pts - c, axis=1).mean()))
    return mf.Manifold.hull_points(pts.astype(np.float64))

body_t = trimesh.load(a.stl)
col = trimesh.load(a.ply, process=False)
tree = cKDTree(col.vertices)
def M(t):
    return mf.Manifold(mf.Mesh(vert_properties=np.asarray(t.vertices, np.float32), tri_verts=np.asarray(t.faces, np.uint32)))
def T(m):
    mm = m.to_mesh()
    return trimesh.Trimesh(np.asarray(mm.vert_properties)[:, :3], np.asarray(mm.tri_verts), process=True)
def cyl_between(p0, p1, r, seg=48):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0; L = np.linalg.norm(d)
    c = mf.Manifold.cylinder(L, r, r, seg)  # along +Z from origin
    z = d / L; x = np.cross([0, 0, 1], z)
    if np.linalg.norm(x) < 1e-9:
        R = np.eye(3) if z[2] > 0 else np.diag([1, -1, -1])
    else:
        x /= np.linalg.norm(x); y = np.cross(z, x); R = np.stack([x, y, z], 1)
        R = R @ np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        # map local Z to z: build rotation with columns (e1', e2', z)
        e1 = np.cross(z, [1, 0, 0]) if abs(z[0]) < 0.9 else np.cross(z, [0, 1, 0]); e1 /= np.linalg.norm(e1)
        e2 = np.cross(z, e1); R = np.stack([e1, e2, z], 1)
    A = np.c_[R, p0]
    return c.transform(A[:3, :4])

body = M(body_t)
assert body.status() == mf.Error.NoError
clears = [float(c) for c in a.clear.split(",")]
parts = {}
report = {}
for side, sign, clr in [("left", 1, clears[0]), ("right", -1, clears[1])]:
    S, F, H = B[f"{'Left' if side=='left' else 'Right'}Arm"], B[f"{'Left' if side=='left' else 'Right'}ForeArm"], B[f"{'Left' if side=='left' else 'Right'}Hand"]
    xcut = S[0] - sign * a.cut_in
    # the arm region: a fat capsule along shoulder->elbow->hand, only beyond the cut plane
    d = (H - S) / np.linalg.norm(H - S)
    P = 'Left' if side == 'left' else 'Right'
    Hend = H + (H - F) / np.linalg.norm(H - F) * 20
    region = hull_of([P + 'Arm'], (S, F), a.arm_r) + hull_of([P + 'ForeArm'], (F, H), a.arm_r) + hull_of([P + 'Hand'], (H, Hend), a.arm_r + 3)
    # elbow/wrist gaps between the hulls: bridge with thin capsules
    region = region + cyl_between(S, F, 3.0) + cyl_between(F, H, 2.5)
    big = 500.0
    half = mf.Manifold.cube((big, big, big)).translate((xcut if sign > 0 else xcut - big, -big / 2, -big / 2))
    cutter = region ^ half
    arm = body ^ cutter
    body = body - cutter
    # pin along X at the shoulder joint's (y, z), from 2 mm inside the body to pin_len into the arm
    r = a.pin_d / 2
    # pin centre: on the upper-arm bone line, half a pin past the cut plane
    t = (xcut + sign * a.pin_len * 0.5 - S[0]) / (F[0] - S[0])
    Q = S + (F - S) * t
    p0 = np.array([xcut - sign * 2.0, Q[1], Q[2]]); p1 = np.array([xcut + sign * a.pin_len, Q[1], Q[2]])
    pin = cyl_between(p0, p1, r)
    tip = mf.Manifold.sphere(r * 1.08, 48).translate(tuple(p1 - sign * np.array([r * 0.6, 0, 0])))  # small snap bulge
    hole = cyl_between(p0, p1 + sign * np.array([0.4, 0, 0]), r + clr) + mf.Manifold.sphere(r * 1.08 + clr, 48).translate(tuple(p1 - sign * np.array([r * 0.6, 0, 0])))
    body = body + pin + tip
    arm = arm - hole
    parts[f"{side}_arm"] = arm
    sec = T(arm).section(plane_origin=[xcut + sign * 0.3, 0, 0], plane_normal=[1, 0, 0])
    report[side] = {"pin_centre": [round(float(v), 2) for v in Q], "cut_x_mm": round(float(xcut), 1), "pin_d": a.pin_d, "clearance": clr,
                    "arm_volume_cm3": round(arm.volume() / 1000, 2)}
parts["body"] = body
for n, m in parts.items():
    t = T(m)
    comps = t.split(only_watertight=False)
    t = max(comps, key=lambda c: c.area) if len(comps) > 1 else t
    report.setdefault("parts", {})[n] = {"watertight": bool(t.is_watertight), "volume_cm3": round(t.volume / 1000, 2),
                                          "pieces_dropped": len(comps) - 1}
    t.export(os.path.join(a.out, f"{n}.stl"))
    # colour: nearest coloured vertex of the full-colour model (new faces from the pin get body colour)
    _, idx = tree.query(t.vertices)
    vc = col.visual.vertex_colors[idx]
    trimesh.Trimesh(t.vertices, t.faces, vertex_colors=vc, process=False).export(os.path.join(a.out, f"{n}_fullcolour.ply"))
json.dump(report, open(os.path.join(a.out, "joints.json"), "w"), indent=1)
print(json.dumps(report, indent=1))
