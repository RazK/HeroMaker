"""Cut a hero into printable parts that snap together on ball joints.

Our own split, from our own data, at no cost per print. It replaces Hi3D's,
whose parts measured far from printable (holes, thousands of non-manifold
edges, triangles stacked up to 18 deep; see docs in the PR).

    parts = split_figure(vertices, faces, joints)

`vertices`/`faces` are the hero's mesh (any units, Y up, as the pipeline's
rigged.glb holds it). `joints` names, for each limb, where it meets the body
and where it ends - the rig gives both (`joints_from_rig`). Out come six solid
parts - head, torso, two arms, two legs - each one closed and manifold, so a
slicer prints it as it is, in millimetres at `height_mm`.

How
---
1. The mesh is rebuilt as a solid. AI meshes are surfaces, not solids: they
   have holes, strands that cross themselves, faces inside faces. Sampling the
   surface into voxels, closing small gaps and filling the inside gives an
   occupancy grid whatever the input; its signed distance field, smoothed a
   little, is turned back into a surface by manifold3d's level set, which only
   ever returns closed, manifold meshes. Thin strands come out at least one
   voxel (`pitch`) thick, which is what a nozzle can print anyway.
2. Each limb is cut on a SPHERE centred on its ball, not on a plane. A flat
   cut cannot swing: the limb's face hits the body's face at once. Two
   concentric spherical faces, `gap` apart, keep the same gap at any angle, so
   the limb turns about the ball until its own surface meets the body's. The
   sphere's radius is where the limb first stands free of the body (walking
   out along the bone until its cross-section is no bigger than the limb's
   middle), and only a cone around the bone is cut: hair that hangs beside an
   arm, or a skirt round a leg, stays where it is.
3. The joint: a ball on a stem on the limb, inside a socket in the body. The
   socket is the ball plus `clearance`, its mouth narrower than the ball so it
   snaps in and holds, its throat a cone so the stem can swing. The ball is
   sized to the material around it (`wall` left all round) and to the limb.

Everything is in millimetres after the first step.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy import ndimage

import manifold3d as m3

LIMBS = ("head", "left_arm", "right_arm", "left_leg", "right_leg")


@dataclass
class Limb:
    """Where a limb meets the body (`root`, the joint centre) and where it ends (`tip`)."""
    root: Sequence[float]
    tip: Sequence[float]


@dataclass
class Part:
    name: str
    solid: m3.Manifold
    ball_diameter_mm: Optional[float] = None
    notes: List[str] = field(default_factory=list)

    def mesh(self) -> Tuple[np.ndarray, np.ndarray]:
        out = self.solid.to_mesh()
        return np.asarray(out.vert_properties)[:, :3].astype(np.float64), np.asarray(out.tri_verts).astype(np.int64)

    @property
    def volume_mm3(self) -> float:
        return float(self.solid.volume())

    @property
    def triangles(self) -> int:
        return int(self.solid.num_tri())


@dataclass
class Split:
    parts: List[Part]
    scale: float  # source units -> mm
    offset: np.ndarray  # mm, added after scaling
    joints_mm: Dict[str, Tuple[np.ndarray, np.ndarray]]  # name -> (ball centre, direction)


# -- 1. the mesh as a solid ------------------------------------------------------

def _surface_points(v: np.ndarray, f: np.ndarray, spacing: float) -> np.ndarray:
    """Points over every triangle, no two neighbours further apart than `spacing`."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    longest = np.max(np.stack([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1),
                               np.linalg.norm(a - c, axis=1)]), axis=0)
    n = np.clip(np.ceil(longest / spacing).astype(int), 1, 256)
    out = [v]
    for k in np.unique(n):
        sel = n == k
        i, j = np.meshgrid(np.arange(k + 1), np.arange(k + 1), indexing="ij")
        keep = (i + j) <= k
        u, w = (i[keep] / k)[None, :, None], (j[keep] / k)[None, :, None]
        pts = a[sel][:, None] * (1 - u - w) + b[sel][:, None] * u + c[sel][:, None] * w
        out.append(pts.reshape(-1, 3))
    return np.vstack(out)


def _solid_grid(v: np.ndarray, f: np.ndarray, pitch: float, close: int = 2):
    pad = close + 4
    origin = v.min(0) - pad * pitch
    dims = np.ceil((v.max(0) - v.min(0)) / pitch).astype(int) + 2 * pad + 1
    pts = _surface_points(v, f, pitch * 0.5)
    idx = np.floor((pts - origin) / pitch).astype(int)
    shell = np.zeros(dims, bool)
    shell[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    ball = ndimage.generate_binary_structure(3, 1)
    grown = ndimage.binary_dilation(shell, ball, iterations=close)
    solid = ndimage.binary_fill_holes(grown)
    solid = ndimage.binary_erosion(solid, ball, iterations=close) | shell
    return solid, origin


def _sdf(solid: np.ndarray, pitch: float, smooth: float) -> np.ndarray:
    inside = ndimage.distance_transform_edt(solid)
    outside = ndimage.distance_transform_edt(~solid)
    d = np.where(solid, inside - 0.5, -(outside - 0.5)) * pitch
    return ndimage.gaussian_filter(d, smooth) if smooth > 0 else d


class _Field:
    """Trilinear lookup into the signed distance grid (positive inside)."""

    def __init__(self, grid: np.ndarray, origin: np.ndarray, pitch: float):
        self.g = np.ascontiguousarray(grid, dtype=np.float64)
        self.flat = memoryview(self.g.reshape(-1))
        self.nx, self.ny, self.nz = self.g.shape
        self.o = [float(x) for x in origin]
        self.p = float(pitch)
        self.sy, self.sx = self.nz, self.ny * self.nz

    def __call__(self, x: float, y: float, z: float) -> float:
        fx = (x - self.o[0]) / self.p
        fy = (y - self.o[1]) / self.p
        fz = (z - self.o[2]) / self.p
        if fx < 0 or fy < 0 or fz < 0 or fx >= self.nx - 1 or fy >= self.ny - 1 or fz >= self.nz - 1:
            return -self.p
        i, j, k = int(fx), int(fy), int(fz)
        u, v, w = fx - i, fy - j, fz - k
        g, sx, sy = self.flat, self.sx, self.sy
        b = i * sx + j * sy + k
        c00 = g[b] * (1 - u) + g[b + sx] * u
        c01 = g[b + 1] * (1 - u) + g[b + sx + 1] * u
        c10 = g[b + sy] * (1 - u) + g[b + sx + sy] * u
        c11 = g[b + sy + 1] * (1 - u) + g[b + sx + sy + 1] * u
        return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w


def solidify(v: np.ndarray, f: np.ndarray, pitch: float, smooth: float = 0.7) -> Tuple[m3.Manifold, _Field]:
    solid, origin = _solid_grid(v, f, pitch)
    field_ = _Field(_sdf(solid, pitch, smooth), origin, pitch)
    top = origin + (np.array(solid.shape) - 1) * pitch
    body = m3.Manifold.level_set(field_, [*origin, *top], pitch)
    if body.status() != m3.Error.NoError or body.is_empty():
        raise ValueError(f"could not rebuild the hero as a solid: {body.status()}")
    pieces = sorted(body.decompose(), key=lambda m: -m.volume())
    body = pieces[0]  # crumbs off the main body (stray strands) would print loose
    return body, field_


# -- geometry helpers -------------------------------------------------------------

def _frame(d: np.ndarray) -> np.ndarray:
    """A rotation taking +Z to `d` (columns: x, y, z axes)."""
    d = d / np.linalg.norm(d)
    helper = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    x = np.cross(helper, d); x /= np.linalg.norm(x)
    y = np.cross(d, x)
    return np.stack([x, y, d], axis=1)


def _place(shape: m3.Manifold, at: np.ndarray, d: np.ndarray) -> m3.Manifold:
    """Move a shape built along +Z from the origin to start at `at`, pointing along `d`."""
    r = _frame(d)
    return shape.transform(np.hstack([r, np.asarray(at, float).reshape(3, 1)]))


def _local(body: m3.Manifold, at: np.ndarray, d: np.ndarray) -> m3.Manifold:
    """The body seen from `at` with `d` as +Z (the inverse of _place)."""
    r = _frame(d)
    return body.transform(np.hstack([r.T, (-r.T @ np.asarray(at, float)).reshape(3, 1)]))


def _inside(pt: np.ndarray, poly: np.ndarray) -> bool:
    x, y = pt
    xs, ys = poly[:, 0], poly[:, 1]
    xs2, ys2 = np.roll(xs, -1), np.roll(ys, -1)
    cross = ((ys > y) != (ys2 > y)) & (x < (xs2 - xs) * (y - ys) / (ys2 - ys + 1e-30) + xs)
    return bool(np.count_nonzero(cross) % 2)


def _area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _section(local_body: m3.Manifold, z: float) -> Optional[np.ndarray]:
    """The outline, at height z, that the bone axis passes through (or the nearest one)."""
    polys = [np.asarray(p) for p in local_body.slice(z).to_polygons()]
    polys = [p for p in polys if len(p) >= 3 and _area(p) > 0]
    if not polys:
        return None
    holding = [p for p in polys if _inside((0.0, 0.0), p)]
    if holding:
        # The outermost: a sleeve open at the cuff leaves an air gap round the
        # arm, and the arm's own outline nests inside the sleeve's.
        return max(holding, key=_area)
    return min(polys, key=lambda p: np.linalg.norm(p.mean(0)))


def _radius(poly: np.ndarray, about=(0.0, 0.0)) -> float:
    return float(np.max(np.linalg.norm(poly - np.asarray(about), axis=1)))


# -- 2 and 3. cutting a limb with its joint ---------------------------------------

def _cut_limb(body: m3.Manifold, field_: _Field, name: str, root: np.ndarray, tip: np.ndarray, *,
              clearance: float, gap: float, wall: float, max_ball: float, min_ball: float,
              others: Sequence[Tuple[np.ndarray, np.ndarray]] = ()):
    """Returns (limb part with ball, the body with the socket cut, notes)."""
    notes: List[str] = []
    d = tip - root
    length = float(np.linalg.norm(d)); d = d / length

    # The region that goes with the limb follows the limb itself: along the
    # bone, the limb's own outline (a little over), never more than half way
    # to another limb - so a leg does not take the other leg, an arm the hair.
    def room_to_others(p: np.ndarray) -> float:
        best = np.inf
        for o_root, o_tip in others:
            seg = o_tip - o_root
            t = np.clip(np.dot(p - o_root, seg) / max(np.dot(seg, seg), 1e-9), 0.0, 1.0)
            best = min(best, float(np.linalg.norm(p - (o_root + seg * t))))
        return 0.5 * best

    # Where the limb stands free of the body: walk out along the bone from the
    # rig's joint until its section is no bigger than its middle.
    local0 = _local(body, root, d)
    mid = _section(local0, 0.5 * length)
    r_mid = _radius(mid, mid.mean(0)) if mid is not None else 0.25 * length
    free, sect = None, None
    for s in np.arange(1.0, 0.7 * length, 0.5):
        sec = _section(local0, s)
        if sec is not None and _radius(sec, sec.mean(0)) <= 1.35 * r_mid:
            free, sect = float(s), sec
            break
    if free is None:
        free, sect = 1.0, _section(local0, 1.0)
        notes.append("never stands free of the body; cut close to the joint")
    face = min((_radius(sect) * 1.08 + gap) if sect is not None else r_mid, room_to_others(root + d * free))

    # The ball: slide it along the bone, from a little inside the joint to the
    # free point, and keep the place that gives the strongest stem, then the
    # biggest ball. (At the rig's joint itself, a leg's ball can sit 14 mm up
    # inside a skirt, and its stem has to be a needle to swing at all.)
    snap = lambda r: math.asin(min(1.0, 0.88 * r / (r + clearance)))  # socket mouth 12% under the ball
    best = None
    for t in np.arange(-min(0.08 * length, 5.0), free + 0.01, 0.5):
        c = root + d * t
        room = field_(*c)
        r = float(np.clip(min(room - clearance - wall, 0.55 * r_mid), min_ball, max_ball))
        cr = max(free - t, r + clearance + 1.5)
        throat = min(snap(r), math.atan2(max(face - 0.6, 0.1), cr))
        st = min(0.42 * r, (r + clearance) * math.sin(max(throat - math.radians(10), 0.05)) - clearance)
        score = (round(st, 1), r, room)
        if best is None or score > best[0]:
            best = (score, c, r, cr, room)
    _, centre, ball, cut_r, room = best
    need = ball + clearance + wall
    if room < need:
        notes.append(f"thin: {room:.1f} mm of material round the ball, a {2 * ball:.1f} mm ball wants {need:.1f}")
    stem = 0.42 * ball
    local = _local(body, centre, d)

    end = length * 1.15 + 5
    stations = np.arange(cut_r, end + 1.5, 1.5)
    raw, mids, real = [], [], []
    for s_ in stations:
        sec = _section(local, s_)
        real.append(sec is not None and s_ <= length)
        if sec is None:
            raw.append(raw[-1] if raw else r_mid); mids.append(mids[-1] if mids else np.zeros(2))
            continue
        # Centre each slice on the limb's own outline, not on the bone: a rig's
        # bone can run off-centre along an arm, and a region round the bone
        # would then take a sliver of the arm and leave the rest behind.
        c2 = sec.mean(0)
        raw.append(_radius(sec, c2) * 1.08 + gap); mids.append(c2)
    raw, mids = np.array(raw), np.array(mids)
    # Long hair is often fused along an arm and makes its outline balloon; the
    # arm itself is about its typical thickness. Cap an arm there, except at
    # the hand. (Not the head: everything above the neck is the head, hair and
    # hat included. Not the legs: the other leg already bounds them.)
    radii = raw
    if name.endswith("_arm") and any(real):
        # Only real slices of the arm: past the hand the slices are empty, and
        # counting them would make the arm look as thin as a fingertip.
        typical = float(np.percentile(raw[np.array(real)], 30))
        cap = max(1.35 * typical, typical + 2.0)
        at_hand = (stations - cut_r) / max(end - cut_r, 1e-6) > 0.85
        radii = np.where(at_hand, raw, np.minimum(raw, cap))
    radii = np.array([min(r, room_to_others(centre + d * s_)) for r, s_ in zip(radii, stations)])
    radii = np.maximum(radii, stem + clearance + 1.0)
    collar = radii[0]
    if collar > cut_r:
        notes.append(f"the limb is wider ({collar:.1f} mm) than its cut sphere ({cut_r:.1f} mm): the cut has a flat edge")
    frame = _frame(d)
    at = [centre + frame @ np.array([m[0], m[1], s_]) for m, s_ in zip(mids, stations)]

    def disc(p, r):
        return _place(m3.Manifold.cylinder(0.02, r, r, 96), p, d)

    # From the ball out to the sphere, then slice to slice along the limb.
    slices = [m3.Manifold.batch_hull([disc(centre, collar), disc(at[0], collar)])]
    for i in range(len(stations) - 1):
        slices.append(m3.Manifold.batch_hull([disc(at[i], radii[i]), disc(at[i + 1], radii[i + 1])]))
    region = m3.Manifold.batch_boolean(slices, m3.OpType.Add)
    region_out = region - m3.Manifold.sphere(cut_r + gap / 2, 128).translate(centre)
    region_in = region - m3.Manifold.sphere(cut_r - gap / 2, 128).translate(centre)

    pieces = sorted((body ^ region_out).decompose(), key=lambda m: -m.volume())
    if not pieces:
        raise ValueError(f"{name}: nothing to cut")
    # A limb can come out of the region in more than one piece (a hand that
    # only touches its arm, a sleeve over an arm): big pieces are limb; crumbs
    # of hair or cloth caught at the region's edge go back to the body.
    big = [p for p in pieces if p.volume() >= 0.15 * pieces[0].volume()]
    limb = m3.Manifold.batch_boolean(big, m3.OpType.Add) if len(big) > 1 else pieces[0]
    rest = body - region_in
    for crumb in pieces[len(big):]:
        rest = rest + crumb
    if len(big) > 1:
        notes.append(f"{len(big)} pieces: they print as one part only if they touch")

    # Socket: the ball plus clearance; a throat that lets the stem swing, its
    # mouth narrower than the ball so it snaps in and stays, and never wider
    # than the limb's own face where it meets the sphere.
    snap_limit = math.asin(min(1.0, 0.88 * ball / (ball + clearance)))  # mouth 12% under the ball
    face_limit = math.atan2(max(collar - 0.6, 0.1), cut_r)
    throat_half = min(snap_limit, face_limit)
    # The stem must pass through the throat with at least 10° to swing.
    stem = min(stem, (ball + clearance) * math.sin(max(throat_half - math.radians(10), 0.05)) - clearance)
    if stem < 0.9:
        notes.append(f"stem only {2 * max(stem, 0):.1f} mm thick before the 1.8 mm floor: too weak, scale up")
        stem = 0.9
    stem_angle = math.asin(min(1.0, (stem + clearance) / (ball + clearance)))
    throat_half = max(min(throat_half, stem_angle + math.radians(30)), stem_angle + math.radians(2))

    # Ball on a stem, reaching from the limb's spherical face to the centre.
    stem_len = cut_r + gap / 2 + 1.0
    limb = limb + _place(m3.Manifold.cylinder(stem_len, stem, stem, 48), centre, d) + \
        m3.Manifold.sphere(ball, 64).translate(centre)
    throat_len = cut_r + gap
    throat = _place(m3.Manifold.cylinder(throat_len, 0.0, throat_len * math.tan(throat_half), 64), centre, d)
    rest = rest - (m3.Manifold.sphere(ball + clearance, 64).translate(centre) + throat)
    mouth = 2 * (ball + clearance) * math.sin(throat_half)
    notes.append(f"ball {2 * ball:.1f} mm, socket mouth {mouth:.1f} mm ({'snaps in' if mouth < 2 * ball else 'loose'}); "
                 f"swings ±{math.degrees(throat_half - stem_angle):.0f}°, turns freely; cut sphere r={cut_r:.1f} mm")
    return limb, rest, ball, notes, centre, d


# -- the whole figure -----------------------------------------------------------

def split_figure(vertices: np.ndarray, faces: np.ndarray, limbs: Dict[str, Limb], *, height_mm: float = 120.0,
                 pitch: float = 0.5, clearance: float = 0.3, gap: float = 0.5, wall: float = 1.2,
                 min_ball: float = 1.8, max_ball: float = 6.0) -> Split:
    """Six closed parts that snap together on ball joints. See the module docstring."""
    v = np.asarray(vertices, float)
    lo, hi = v.min(0), v.max(0)
    scale = height_mm / (hi[1] - lo[1])
    offset = -np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * scale
    mm = v * scale + offset

    body, field_ = solidify(mm, np.asarray(faces, np.int64), pitch)
    parts: List[Part] = []
    joints_mm = {}
    placed = {n: (np.asarray(l.root, float) * scale + offset, np.asarray(l.tip, float) * scale + offset)
              for n, l in limbs.items()}
    for name in LIMBS:
        if name not in limbs:
            continue
        root, tip = placed[name]
        # Only the legs crowd each other; an arm's or the head's neighbours
        # start where it starts and would pinch it to nothing.
        pair = {"left_leg": "right_leg", "right_leg": "left_leg"}.get(name)
        others = [placed[pair]] if pair in placed else []
        limb, body, ball, notes, centre, d = _cut_limb(body, field_, name, root, tip, clearance=clearance,
                                                       gap=gap, wall=wall, max_ball=max_ball, min_ball=min_ball,
                                                       others=others)
        parts.append(Part(name, limb, round(2 * ball, 2), notes))
        joints_mm[name] = (centre, d)
    pieces = sorted(body.decompose(), key=lambda m: -m.volume())
    torso = pieces[0]
    notes = [f"{len(pieces) - 1} loose crumb(s) dropped"] if len(pieces) > 1 else []
    parts.insert(0, Part("torso", torso, None, notes))
    return Split(parts, scale, offset, joints_mm)


def joints_from_rig(jpos: Dict[str, np.ndarray], dominant: np.ndarray, vertices: np.ndarray) -> Dict[str, Limb]:
    """Limbs from a Meshy rig: joint centres, and each limb's farthest skinned vertex as its tip."""
    # name: (joint at the root, joint the limb points to, bones skinned to the limb)
    chains = {
        "head": ("neck", "Head", ("Head", "head_end", "headfront")),
        "left_arm": ("LeftArm", "LeftHand", ("LeftArm", "LeftForeArm", "LeftHand")),
        "right_arm": ("RightArm", "RightHand", ("RightArm", "RightForeArm", "RightHand")),
        "left_leg": ("LeftUpLeg", "LeftFoot", ("LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase")),
        "right_leg": ("RightUpLeg", "RightFoot", ("RightUpLeg", "RightLeg", "RightFoot", "RightToeBase")),
    }
    out = {}
    for name, (root_joint, aim_joint, bones) in chains.items():
        if root_joint not in jpos or aim_joint not in jpos:
            continue
        root = np.asarray(jpos[root_joint], float)
        axis = np.asarray(jpos[aim_joint], float) - root
        axis /= np.linalg.norm(axis)
        # The bones give the axis. (Not the skinned vertices: long hair is often
        # skinned to the arms, and a fit through it points anywhere.)
        mine = vertices[np.isin(dominant, bones)]
        reach = float(np.max((mine - root) @ axis)) if len(mine) else 0.0
        out[name] = Limb(root, root + axis * max(reach, 1e-6))
    # Heroes are made in a symmetric T-pose, but Meshy's rig is not always:
    # one shoulder can sit forward of the other. Average each pair with its
    # mirror image (x -> -x) so both sides are cut alike.
    for left, right in (("left_arm", "right_arm"), ("left_leg", "right_leg")):
        if left in out and right in out:
            flip = np.array([-1.0, 1.0, 1.0])
            lr, lt = np.asarray(out[left].root), np.asarray(out[left].tip)
            rr, rt = np.asarray(out[right].root) * flip, np.asarray(out[right].tip) * flip
            root, tip = (lr + rr) / 2, (lt + rt) / 2
            out[left], out[right] = Limb(root, tip), Limb(root * flip, tip * flip)
    return out
