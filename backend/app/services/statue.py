"""Hero Statue: turn a hero's textured 3D model into a print-ready figurine.

    model.glb (Meshy, Y-up, ~30k triangles, one 2048 px texture)
      -> weld UV-seam vertices        (Meshy splits the surface at every seam)
      -> drop non-manifold slivers and floating crumbs, keep the main body
      -> consistent winding, outward normals
      -> fill the holes that leaves   (fan to the hole's centroid)
      -> Z-up, millimetres, scaled to the ordered height
      -> union a round base           (sized for the feet, the text and the
                                       centre of mass), engrave
                                       "{hero}" / "drawn by {child}, age {n}"
      -> one watertight, full-colour solid
      -> statue.obj + statue.mtl + texture.png, statue.3mf, statue.glb,
         report.json, zipped

Colour stays in a single texture for every format: the base and engraving
colours are painted as two swatches in a strip added above the hero's atlas,
because full-colour print services read colour from the texture map and
ignore per-material Kd.

Boolean work (base union, engraving) is done by manifold3d, which carries the
UVs through the booleans as vertex properties, so the output is a closed
solid AND keeps its texture seams. The OBJ writes positions and UVs with
separate indices (v / vt), which is how it stays watertight with seams.

Everything here is a pure function of (bytes, numbers, strings); the admin
endpoint and `scripts/make_statue.py` are thin wrappers.
"""
from __future__ import annotations

import io
import json
import math
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Fredoka-SemiBold.ttf"

PRICE_PER_CM3 = 1.30          # full-colour resin, Western service, $/cm^3
HOLLOW_WALL_MM = 2.5          # shell thickness for the hollow estimate
BASE_HEIGHT_MM = 5.0          # at 90 mm; scales with the statue
SINK_MM = 0.8                 # figure sinks into the base so the union is solid
SWATCH_PX = 64                # height of the colour strip added to the texture
BASE_RGB = (255, 246, 233)    # --tb-cream
TEXT_RGB = (75, 47, 224)      # --tb-grape-text
SIZES_MM = {"6 cm": 60, "9 cm": 90, "12 cm": 120}
SIZE_PRICES = {"6 cm": 49, "9 cm": 69, "12 cm": 99}


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

@dataclass
class TexturedMesh:
    """A triangle mesh whose UVs live on face corners, not on vertices.

    `faces` index `vertices` (welded positions); `corner_uv[f, k]` is the UV
    of corner k of face f. That separation is what lets a mesh be watertight
    and still have texture seams.
    """
    vertices: np.ndarray            # (n, 3) float64
    faces: np.ndarray               # (m, 3) int64
    corner_uv: np.ndarray           # (m, 3, 2) float64, OBJ convention (v up)
    texture: Optional["object"] = None  # PIL.Image or None


@dataclass
class Statue:
    vert_props: np.ndarray          # (p, 5) x y z u v, mm and UV
    tris: np.ndarray                # (t, 3) into vert_props
    pos_index: np.ndarray           # (p,) prop vertex -> welded position id
    texture: "object"               # PIL.Image, hero atlas + colour strip
    report: dict = field(default_factory=dict)

    @property
    def positions(self) -> np.ndarray:
        uniq, first = np.unique(self.pos_index, return_index=True)
        return self.vert_props[first, :3]

    @property
    def welded_faces(self) -> np.ndarray:
        _, inv = np.unique(self.pos_index, return_inverse=True)
        return inv.ravel()[self.tris]


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_glb(data: bytes) -> TexturedMesh:
    """Read a pipeline GLB into a seam-split TexturedMesh (not yet welded)."""
    import trimesh

    scene = trimesh.load(io.BytesIO(data), file_type="glb", force="scene")
    meshes = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        g = scene.geometry[name]
        if not isinstance(g, trimesh.Trimesh) or len(g.faces) == 0:
            continue
        g = g.copy()
        g.apply_transform(transform)
        meshes.append(g)
    if not meshes:
        raise ValueError("GLB has no triangle mesh")
    # The pipeline's model.glb is a single textured mesh. If there are more,
    # keep the biggest: a statue is printed from one texture.
    m = max(meshes, key=lambda g: len(g.faces))
    uv = getattr(m.visual, "uv", None)
    if uv is None or len(uv) != len(m.vertices):
        uv = np.zeros((len(m.vertices), 2))
    tex = None
    mat = getattr(m.visual, "material", None)
    if mat is not None:
        tex = getattr(mat, "baseColorTexture", None) or getattr(mat, "image", None)
    faces = np.asarray(m.faces, dtype=np.int64)
    return TexturedMesh(
        vertices=np.asarray(m.vertices, dtype=np.float64),
        faces=faces,
        corner_uv=np.asarray(uv, dtype=np.float64)[faces],
        texture=tex,
    )


# ---------------------------------------------------------------------------
# Pure geometry steps (unit-tested on synthetic meshes)
# ---------------------------------------------------------------------------

def weld(mesh: TexturedMesh, digits: int = 5) -> TexturedMesh:
    """Merge vertices that share a position (UV seams), drop degenerate faces."""
    scale = max(float(np.ptp(mesh.vertices, axis=0).max()), 1e-12)
    key = np.round(mesh.vertices / scale, digits)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    faces = inv[mesh.faces]
    ok = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    faces, cuv = faces[ok], mesh.corner_uv[ok]
    # duplicate triangles (same three vertices) make an edge non-manifold
    _, keep = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    keep = np.sort(keep)
    return TexturedMesh(mesh.vertices[first], faces[keep], cuv[keep], mesh.texture)


def _edges(faces: np.ndarray):
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    fid = np.tile(np.arange(len(faces)), 3)
    return e, fid


def _subset(mesh: TexturedMesh, keep_faces: np.ndarray) -> TexturedMesh:
    """Keep the given faces and drop vertices nothing uses any more."""
    faces = mesh.faces[keep_faces]
    used = np.unique(faces)
    remap = np.full(len(mesh.vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return TexturedMesh(mesh.vertices[used], remap[faces], mesh.corner_uv[keep_faces], mesh.texture)


def drop_nonmanifold(mesh: TexturedMesh) -> tuple[TexturedMesh, int]:
    """Remove every face on an edge shared by more than two faces.

    Those are the slivers where Meshy's seams fold over themselves. The holes
    this leaves are filled later by `fill_holes`.
    """
    e, fid = _edges(mesh.faces)
    es = np.sort(e, axis=1)
    _, inv, counts = np.unique(es, axis=0, return_inverse=True, return_counts=True)
    bad_faces = np.unique(fid[counts[inv.ravel()] > 2])
    keep = np.ones(len(mesh.faces), dtype=bool)
    keep[bad_faces] = False
    return _subset(mesh, np.nonzero(keep)[0]), int(len(bad_faces))


def components(faces: np.ndarray) -> list[np.ndarray]:
    """Face indices of each edge-connected shell, largest first."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    e, fid = _edges(faces)
    es = np.sort(e, axis=1)
    order = np.lexsort((es[:, 1], es[:, 0]))
    es, fid = es[order], fid[order]
    same = np.all(es[1:] == es[:-1], axis=1)
    a, b = fid[:-1][same], fid[1:][same]
    n = len(faces)
    g = coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n))
    k, labels = connected_components(g, directed=False)
    groups = [np.nonzero(labels == i)[0] for i in range(k)]
    return sorted(groups, key=len, reverse=True)


def keep_main_body(mesh: TexturedMesh, min_share: float = 0.01) -> tuple[TexturedMesh, int]:
    """Keep the largest shell plus any shell with >= min_share of its faces.

    Tiny shells are crumbs (1-4 triangles in real heroes): they would print as
    loose specks or fail the service's mesh check. Big secondary shells (an
    eyeball, a hat) are kept; the boolean union merges them with the body.
    """
    comps = components(mesh.faces)
    if not comps:
        raise ValueError("empty mesh")
    big = len(comps[0])
    kept = [c for c in comps if len(c) >= max(1, min_share * big)]
    return _subset(mesh, np.sort(np.concatenate(kept))), len(comps) - len(kept)


def fix_winding(mesh: TexturedMesh) -> TexturedMesh:
    """Make winding consistent and normals point outward, keeping corner UVs."""
    import trimesh

    tm = trimesh.Trimesh(mesh.vertices, mesh.faces.copy(), process=False)
    trimesh.repair.fix_winding(tm)
    trimesh.repair.fix_inversion(tm, multibody=True)
    new = np.asarray(tm.faces)
    old = mesh.faces
    # each new face is a permutation of the old one: find where each corner went
    src = np.argmax(old[:, None, :] == new[:, :, None], axis=2)
    cuv = np.take_along_axis(mesh.corner_uv, src[:, :, None].repeat(2, axis=2), axis=1)
    return TexturedMesh(mesh.vertices, new, cuv, mesh.texture)


def boundary_loops(faces: np.ndarray) -> list[list[tuple[int, int, int]]]:
    """Open boundaries as loops of (vertex_from, vertex_to, face) half-edges."""
    e, fid = _edges(faces)
    corner = np.repeat([[0, 1], [1, 2], [2, 0]], len(faces), axis=0)
    directed = {(int(a), int(b)) for a, b in e}
    out: dict[int, list[tuple[int, int, int, int]]] = {}
    for (a, b), f, c in zip(e, fid, corner[:, 0]):
        if (int(b), int(a)) not in directed:
            out.setdefault(int(a), []).append((int(a), int(b), int(f), int(c)))
    loops, used = [], set()
    for start in list(out):
        for he in out[start]:
            if he in used:
                continue
            loop, cur = [], he
            while cur not in used:
                used.add(cur)
                loop.append(cur)
                nxt = [h for h in out.get(cur[1], []) if h not in used]
                if not nxt:
                    break
                cur = nxt[0]
            if len(loop) >= 3 and loop[-1][1] == loop[0][0]:
                loops.append([(a, b, f * 3 + c) for a, b, f, c in loop])
    return loops


def fill_holes(mesh: TexturedMesh, max_loop: int = 400) -> tuple[TexturedMesh, int]:
    """Close each open boundary with a fan to its centroid.

    The new triangles take the UV of the boundary corner they start from, so a
    patch is painted the colour of the surface around it.
    """
    loops = boundary_loops(mesh.faces)
    if not loops:
        return mesh, 0
    verts = [mesh.vertices]
    faces = [mesh.faces]
    cuv = [mesh.corner_uv]
    flat_uv = mesh.corner_uv.reshape(-1, 2)
    n = len(mesh.vertices)
    filled = 0
    for loop in loops:
        if len(loop) > max_loop:
            continue
        ids = [a for a, _, _ in loop]
        c = mesh.vertices[ids].mean(axis=0)
        verts.append(c[None])
        new_f, new_uv = [], []
        for a, b, corner in loop:
            # the open half-edge runs a->b in its face; the patch runs b->a
            new_f.append([b, a, n])
            u = flat_uv[corner]
            new_uv.append([u, u, u])
        faces.append(np.array(new_f, dtype=np.int64))
        cuv.append(np.array(new_uv))
        n += 1
        filled += 1
    return TexturedMesh(np.vstack(verts), np.vstack(faces), np.concatenate(cuv), mesh.texture), filled


def repair(mesh: TexturedMesh) -> tuple[TexturedMesh, dict]:
    """weld -> drop slivers -> keep main body -> winding -> fill holes."""
    seam_split_vertices = len(mesh.vertices)
    m = weld(mesh)
    m, slivers = drop_nonmanifold(m)
    m, crumbs = keep_main_body(m)
    m = fix_winding(m)
    m, holes = fill_holes(m)
    # filling can expose a crumb that only hung on by a sliver; one more pass
    m, slivers2 = drop_nonmanifold(m)
    if slivers2:
        m, crumbs2 = keep_main_body(m)
        m, holes2 = fill_holes(m)
        slivers, crumbs, holes = slivers + slivers2, crumbs + crumbs2, holes + holes2
    return m, {
        "vertices_before_weld": seam_split_vertices,
        "vertices_after_weld": int(len(m.vertices)),
        "sliver_faces_removed": int(slivers),
        "floating_shells_removed": int(crumbs),
        "holes_filled": int(holes),
    }


def to_print_frame(vertices: np.ndarray) -> np.ndarray:
    """glTF is Y-up, facing +Z. Printers are Z-up: (x, y, z) -> (x, -z, y).

    The hero then faces -Y, which is "towards the viewer" in every slicer.
    """
    v = np.asarray(vertices, dtype=np.float64)
    return np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])


def scale_to_height(vertices: np.ndarray, height_mm: float) -> np.ndarray:
    """Uniformly scale so the Z extent is height_mm and the lowest point is z=0."""
    v = np.asarray(vertices, dtype=np.float64)
    h = np.ptp(v[:, 2])
    if h <= 0:
        raise ValueError("flat mesh")
    v = v * (height_mm / h)
    v[:, 2] -= v[:, 2].min()
    return v


def footprint(vertices: np.ndarray, band_mm: float) -> tuple[np.ndarray, float]:
    """Centre and radius of what touches the ground (lowest `band_mm`)."""
    v = np.asarray(vertices)
    low = v[v[:, 2] <= v[:, 2].min() + band_mm][:, :2]
    lo, hi = low.min(axis=0), low.max(axis=0)
    centre = (lo + hi) / 2
    return centre, float(np.linalg.norm(low - centre, axis=1).max())


def center_of_mass(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Volume centroid of a closed triangle mesh (signed tetrahedra)."""
    v = np.asarray(vertices, dtype=np.float64)
    a, b, c = v[faces[:, 0]], v[faces[:, 1]], v[faces[:, 2]]
    vol = np.einsum("ij,ij->i", a, np.cross(b, c)) / 6.0
    total = vol.sum()
    if abs(total) < 1e-12:
        return v.mean(axis=0)
    return ((a + b + c) / 4.0 * vol[:, None]).sum(axis=0) / total


# ---------------------------------------------------------------------------
# Text as geometry
# ---------------------------------------------------------------------------

def _glyph_contours(text: str, font_path: Path, em_mm: float) -> tuple[list[np.ndarray], float]:
    """Outline `text` as flattened closed polygons in mm. Returns (contours, width)."""
    from fontTools.pens.basePen import BasePen
    from fontTools.ttLib import TTFont

    font = TTFont(str(font_path))
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    k = em_mm / upm
    step = max(upm / 60.0, 1.0)

    class Flatten(BasePen):
        def __init__(self, glyphset, dx):
            super().__init__(glyphset)
            self.dx, self.contours, self.cur = dx, [], []

        def _moveTo(self, p):
            self.cur = [p]

        def _lineTo(self, p):
            self.cur.append(p)

        def _curveToOne(self, p1, p2, p3):
            p0 = self.cur[-1]
            n = max(2, int(math.dist(p0, p3) / step))
            for t in np.linspace(0, 1, n + 1)[1:]:
                s = 1 - t
                self.cur.append((s**3 * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t**3 * p3[0],
                                 s**3 * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t**3 * p3[1]))

        def _qCurveToOne(self, p1, p2):
            p0 = self.cur[-1]
            n = max(2, int(math.dist(p0, p2) / step))
            for t in np.linspace(0, 1, n + 1)[1:]:
                s = 1 - t
                self.cur.append((s * s * p0[0] + 2 * s * t * p1[0] + t * t * p2[0],
                                 s * s * p0[1] + 2 * s * t * p1[1] + t * t * p2[1]))

        def _closePath(self):
            if len(self.cur) >= 3:
                pts = np.array(self.cur, dtype=np.float64)
                if np.allclose(pts[0], pts[-1]):
                    pts = pts[:-1]
                pts[:, 0] += self.dx
                self.contours.append(pts * k)
            self.cur = []

        _endPath = _closePath

    contours: list[np.ndarray] = []
    x = 0.0
    for ch in text:
        gname = cmap.get(ord(ch)) or cmap.get(ord("?"))
        if gname is None:
            continue
        pen = Flatten(gs, x)
        gs[gname].draw(pen)
        contours.extend(pen.contours)
        x += hmtx[gname][0]
    return contours, x * k


def _resample(c: np.ndarray, max_seg: float) -> np.ndarray:
    out = []
    for a, b in zip(c, np.roll(c, -1, axis=0)):
        n = max(1, int(math.ceil(np.linalg.norm(b - a) / max_seg)))
        out.extend(a + (b - a) * (i / n) for i in range(n))
    return np.array(out)


def arc_text(text: str, em_mm: float, radius_mm: float, max_arc_deg: float,
             font_path: Path = FONT_PATH) -> tuple[list[np.ndarray], float]:
    """Polygons of `text` bent along the front of a circle, readable from the front.

    The baseline runs along `radius_mm`, centred on the -Y axis (the side the
    hero faces); letters grow inward, toward the hero. Text that would need
    more than `max_arc_deg` of arc is shrunk to fit. Returns (contours, em).
    """
    contours, width = _glyph_contours(text, font_path, em_mm)
    max_len = math.radians(max_arc_deg) * radius_mm
    if width > max_len and width > 0:
        f = max_len / width
        contours = [c * f for c in contours]
        width *= f
        em_mm *= f
    out = []
    for c in contours:
        c = _resample(c, max(em_mm / 30.0, 0.05))
        s = c[:, 0] - width / 2.0          # along the baseline, centred
        t = c[:, 1]                        # up from the baseline
        r = radius_mm - t
        theta = -math.pi / 2 + s / radius_mm
        out.append(np.column_stack([r * np.cos(theta), r * np.sin(theta)]))
    return out, em_mm


# ---------------------------------------------------------------------------
# Building the statue
# ---------------------------------------------------------------------------

def _texture_with_swatches(texture):
    """Hero atlas with a colour strip above it. Returns (image, v_scale, base_uv, text_uv)."""
    from PIL import Image

    if texture is None:
        texture = Image.new("RGB", (1024, 1024), (200, 200, 200))
    tex = texture.convert("RGB")
    w, h = tex.size
    strip = SWATCH_PX
    out = Image.new("RGB", (w, h + strip), BASE_RGB)
    out.paste(tex, (0, strip))
    # the strip: left half base colour, right half engraving colour
    out.paste(Image.new("RGB", (w - w // 2, strip), TEXT_RGB), (w // 2, 0))
    H = h + strip
    v_scale = h / H                                  # hero UVs: v' = v * v_scale
    base_uv = (0.25, 1 - (strip * 0.5) / H)
    text_uv = (0.75, 1 - (strip * 0.5) / H)
    return out, v_scale, base_uv, text_uv


def _manifold_from(mesh: TexturedMesh, v_scale: float):
    """TexturedMesh -> manifold3d.Manifold with props (u, v) and seam merges."""
    import manifold3d as mf

    m = mesh.faces.shape[0]
    corner_pos = mesh.faces.reshape(-1)
    corner_uv = mesh.corner_uv.reshape(-1, 2).copy()
    corner_uv[:, 1] *= v_scale
    # one property vertex per distinct (position, uv) pair
    key = np.column_stack([corner_pos.astype(np.float64), np.round(corner_uv, 6)])
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    pos_of_prop = corner_pos[first]
    props = np.column_stack([mesh.vertices[pos_of_prop], corner_uv[first]]).astype(np.float32)
    tris = inv.reshape(m, 3).astype(np.uint32)
    # merge every property vertex onto the first one sharing its position
    _, rep = np.unique(pos_of_prop, return_index=True)
    rep_of_pos = np.full(int(pos_of_prop.max()) + 1, -1, dtype=np.int64)
    rep_of_pos[pos_of_prop[rep]] = rep
    to = rep_of_pos[pos_of_prop]
    frm = np.nonzero(to != np.arange(len(to)))[0]
    mesh_gl = mf.Mesh(
        vert_properties=np.ascontiguousarray(props),
        tri_verts=np.ascontiguousarray(tris),
        merge_from_vert=frm.astype(np.uint32),
        merge_to_vert=to[frm].astype(np.uint32),
    )
    return mf.Manifold(mesh_gl)


def _paint(man, uv):
    return man.set_properties(2, lambda p, o: (uv[0], uv[1]))


def base_radius(fig_v: np.ndarray, fig_f: np.ndarray, height_mm: float,
                text_band_mm: float) -> tuple[np.ndarray, float, dict]:
    """Centre and radius of a base that holds the feet, the text, and the CoM."""
    centre, r_feet = footprint(fig_v, band_mm=max(1.0, 0.03 * height_mm))
    com = center_of_mass(fig_v, fig_f)
    com_off = float(np.linalg.norm(com[:2] - centre))
    r = max(
        r_feet + text_band_mm,             # feet, then the engraving in front
        com_off / 0.6 + 2.0,               # centre of mass well inside the rim
        0.24 * height_mm,                  # never a tiny pedestal
    )
    r = min(r, 0.6 * height_mm)            # never a dinner plate
    return centre, r, {"feet_radius_mm": round(r_feet, 1), "com_offset_mm": round(com_off, 1)}


def build_statue(mesh: TexturedMesh, height_mm: float = 90.0, hero_name: str = "",
                 child_name: str = "", age: Optional[int] = None,
                 font_path: Path = FONT_PATH) -> Statue:
    """The whole recipe: repair, scale, base, engrave. Returns a closed solid."""
    import manifold3d as mf

    k = height_mm / 90.0
    base_h = BASE_HEIGHT_MM * k
    sink = SINK_MM * k
    depth = 0.7 * k                                   # engraving depth

    fixed, rep = repair(mesh)
    fig_height = height_mm - base_h + sink
    v = scale_to_height(to_print_frame(fixed.vertices), fig_height)

    name_em = 6.0 * k
    sub_em = 3.6 * k
    gap = 1.2 * k
    band = 1.5 * k + name_em * 0.75 + gap + sub_em * 0.75 + 2.2 * k
    centre, R, stab = base_radius(v, fixed.faces, height_mm, band)
    v[:, 0] -= centre[0]
    v[:, 1] -= centre[1]
    v[:, 2] += base_h - sink
    fixed = TexturedMesh(v, fixed.faces, fixed.corner_uv, fixed.texture)

    texture, v_scale, base_uv, text_uv = _texture_with_swatches(fixed.texture)
    figure = _manifold_from(fixed, v_scale)
    if figure.status() != mf.Error.NoError or figure.is_empty():
        raise ValueError(f"hero mesh is not a closed solid after repair: {figure.status()}")

    seg = 160
    chamfer = 0.8 * k
    base = mf.Manifold.cylinder(base_h - chamfer, R, R, seg) + \
        mf.Manifold.cylinder(chamfer, R, R - chamfer, seg).translate((0, 0, base_h - chamfer))
    base = _paint(base, base_uv)

    solid = figure + base

    lines = []
    if hero_name.strip():
        lines.append((hero_name.strip(), name_em))
    sub = ""
    if child_name.strip():
        sub = f"drawn by {child_name.strip()}" + (f", age {age}" if age else "")
    if sub:
        lines.append((sub, sub_em))
    engraved = []
    radius = R - 2.2 * k                               # outermost baseline
    # draw from the rim inward: the last line (the credit) sits on the rim
    for text, em in reversed(lines):
        contours, used_em = arc_text(text, em, radius, max_arc_deg=110, font_path=font_path)
        if contours:
            cs = mf.CrossSection(contours, mf.FillRule.NonZero)
            cutter = cs.extrude(depth + 1.0).translate((0, 0, base_h - depth))
            solid = solid - _paint(cutter, text_uv)
            engraved.append({"text": text, "em_mm": round(used_em, 2), "baseline_radius_mm": round(radius, 1)})
        radius -= used_em * 0.75 + gap

    out = solid.to_mesh()
    props = np.asarray(out.vert_properties, dtype=np.float64)
    tris = np.asarray(out.tri_verts, dtype=np.int64)
    pos_index = np.arange(len(props))
    mfrom = np.asarray(out.merge_from_vert, dtype=np.int64)
    mto = np.asarray(out.merge_to_vert, dtype=np.int64)
    pos_index[mfrom] = mto

    statue = Statue(props, tris, pos_index, texture)
    statue.report = {
        "height_mm": round(height_mm, 1),
        "repair": rep,
        "base": {"diameter_mm": round(2 * R, 1), "height_mm": round(base_h, 1), **stab},
        "engraving": list(reversed(engraved)),
        "watertight": bool(solid.status() == mf.Error.NoError and not solid.is_empty()),
        "shells": len(solid.decompose()),
        "genus": int(solid.genus()),
        "volume_cm3": round(solid.volume() / 1000.0, 2),
        "triangles": int(len(tris)),
    }
    _measure(statue, solid)
    return statue


def wall_thickness_mm(vertices: np.ndarray, faces: np.ndarray, samples: int = 3000,
                      seed: int = 7, solid=None) -> dict:
    """Ray-cast inward from random surface points: distance to the far wall.

    Uses manifold3d's ray caster (BVH), so no extra spatial-index dependency.
    """
    import manifold3d as mf

    v = np.asarray(vertices, dtype=np.float64)
    if solid is None:
        solid = mf.Manifold(mf.Mesh(vert_properties=v.astype(np.float32),
                                    tri_verts=np.asarray(faces, dtype=np.uint32)))
    rng = np.random.default_rng(seed)
    a, b, c = v[faces[:, 0]], v[faces[:, 1]], v[faces[:, 2]]
    nrm = np.cross(b - a, c - a)
    area = np.linalg.norm(nrm, axis=1)
    keep = area > 1e-12
    fi = rng.choice(np.nonzero(keep)[0], size=samples, p=area[keep] / area[keep].sum())
    r1, r2 = rng.random(samples), rng.random(samples)
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    pts = a[fi] + (b[fi] - a[fi]) * r1[:, None] + (c[fi] - a[fi]) * r2[:, None]
    n = nrm[fi] / area[fi][:, None]
    reach = float(np.ptp(v, axis=0).max()) * 2
    d = []
    for p, nn in zip(pts, n):
        o = p - nn * 1e-3
        # RayHit.distance is the fraction of the segment, not millimetres
        hits = [h.distance * reach for h in solid.ray_cast(tuple(o), tuple(o - nn * reach))]
        hits = [h for h in hits if h > 1e-3]
        if hits:
            d.append(hits[0])
    d = np.array(d) if d else np.array([np.nan])
    return {
        "p5_mm": round(float(np.nanpercentile(d, 5)), 2),
        "median_mm": round(float(np.nanmedian(d)), 2),
        "share_under_1mm": round(float(np.mean(d < 1.0)), 4),
    }


def _measure(statue: Statue, solid=None) -> None:
    v, f = statue.positions, statue.welded_faces
    lo, hi = v.min(axis=0), v.max(axis=0)
    r = statue.report
    r["bbox_mm"] = [round(float(x), 1) for x in (hi - lo)]
    r["footprint_mm"] = [round(float(x), 1) for x in (hi - lo)[:2]]
    r["wall_thickness"] = wall_thickness_mm(v, f, solid=solid)
    com = center_of_mass(v, f)
    r["centre_of_mass_mm"] = [round(float(x), 1) for x in com]
    r["stable"] = bool(np.linalg.norm(com[:2]) < 0.6 * r["base"]["diameter_mm"] / 2)
    vol = r["volume_cm3"]
    h = r["height_mm"]
    area_cm2 = float(solid.surface_area()) / 100.0 if solid is not None else 0.0
    r["surface_area_cm2"] = round(area_cm2, 1)

    def hollow(s: float) -> float:
        # a 2.5 mm shell, wall thickness not scaled: area * wall, capped at solid
        return min(vol * s**3, area_cm2 * s**2 * HOLLOW_WALL_MM / 10.0)

    r["price_estimate_usd"] = {
        "rate_per_cm3": PRICE_PER_CM3,
        "solid": {label: round(vol * (mm / h) ** 3 * PRICE_PER_CM3, 2) for label, mm in SIZES_MM.items()},
        "hollow_2_5mm_estimate": {label: round(hollow(mm / h) * PRICE_PER_CM3, 2)
                                  for label, mm in SIZES_MM.items()},
        "note": "solid is what this file prints as; hollow is an estimate of a 2.5 mm shell "
                "(not generated yet: needs an inner offset + drain holes)",
    }
    r["retail_price_usd"] = SIZE_PRICES


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def to_obj(statue: Statue, mtl_name: str = "statue.mtl", tex_name: str = "texture.png") -> tuple[str, str]:
    """Watertight OBJ (shared v, separate vt) and its MTL."""
    v = statue.positions
    f = statue.welded_faces
    uv = statue.vert_props[:, 3:5]
    out = io.StringIO()
    out.write("# HeroMaker statue: units = millimetres, Z up, hero faces -Y\n")
    out.write(f"mtllib {mtl_name}\no statue\n")
    np.savetxt(out, v, fmt="v %.4f %.4f %.4f")
    np.savetxt(out, uv, fmt="vt %.6f %.6f")
    out.write("usemtl hero\n")
    t = statue.tris + 1
    fw = f + 1
    np.savetxt(out, np.column_stack([fw[:, 0], t[:, 0], fw[:, 1], t[:, 1], fw[:, 2], t[:, 2]]),
               fmt="f %d/%d %d/%d %d/%d")
    mtl = (f"newmtl hero\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd {tex_name}\n")
    return out.getvalue(), mtl


def to_3mf(statue: Statue, texture_png: bytes) -> bytes:
    """3MF with the 3MF Materials extension's texture2dgroup (full colour)."""
    v = statue.positions
    f = statue.welded_faces
    uv = statue.vert_props[:, 3:5]
    parts = ['<?xml version="1.0" encoding="UTF-8"?>\n'
             '<model unit="millimeter" xml:lang="en-US" '
             'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
             'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n'
             '<metadata name="Title">HeroMaker statue</metadata>\n<resources>\n'
             '<m:texture2d id="1" path="/3D/Texture/texture.png" contenttype="image/png" '
             'tilestyleu="clamp" tilestylev="clamp" filter="linear"/>\n'
             '<m:texture2dgroup id="2" texid="1">\n']
    parts.extend(f'<m:tex2coord u="{a:.6f}" v="{b:.6f}"/>\n' for a, b in uv)
    parts.append('</m:texture2dgroup>\n<object id="3" type="model" pid="2" pindex="0">\n<mesh>\n<vertices>\n')
    parts.extend(f'<vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>\n' for x, y, z in v)
    parts.append('</vertices>\n<triangles>\n')
    parts.extend(f'<triangle v1="{a}" v2="{b}" v3="{c}" pid="2" p1="{p}" p2="{q}" p3="{r}"/>\n'
                 for (a, b, c), (p, q, r) in zip(f, statue.tris))
    parts.append('</triangles>\n</mesh>\n</object>\n</resources>\n'
                 '<build>\n<item objectid="3"/>\n</build>\n</model>\n')
    content_types = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
                     '<Default Extension="png" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodeltexture"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    model_rels = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                  '<Relationship Target="/3D/Texture/texture.png" Id="rel1" '
                  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", "".join(parts))
        z.writestr("3D/_rels/3dmodel.model.rels", model_rels)
        z.writestr("3D/Texture/texture.png", texture_png)
    return buf.getvalue()


def to_glb(statue: Statue, texture_jpeg_quality: int = 88) -> bytes:
    """A web preview of the exact print geometry (Y-up, metres, textured)."""
    import trimesh
    from PIL import Image

    p = statue.vert_props
    verts = np.column_stack([p[:, 0], p[:, 2], -p[:, 1]]) / 1000.0   # back to glTF frame
    tex = statue.texture.convert("RGB")
    if max(tex.size) > 2048:
        tex.thumbnail((2048, 2048), Image.LANCZOS)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=tex, metallicFactor=0.0, roughnessFactor=0.6)
    vis = trimesh.visual.TextureVisuals(uv=p[:, 3:5], material=mat)
    tm = trimesh.Trimesh(verts, statue.tris, visual=vis, process=False)
    return trimesh.Scene(tm).export(file_type="glb")


def package(statue: Statue, basename: str = "statue", include_glb: bool = True) -> bytes:
    """The print package zip: OBJ+MTL+texture, 3MF, preview GLB, report, README."""
    tex = io.BytesIO()
    statue.texture.save(tex, "PNG", optimize=True)
    tex_png = tex.getvalue()
    obj, mtl = to_obj(statue, f"{basename}.mtl", "texture.png")
    readme = (
        "HeroMaker statue print package\n"
        "==============================\n\n"
        f"{basename}.obj + {basename}.mtl + texture.png  full-colour mesh (upload all three, or this zip)\n"
        f"{basename}.3mf                                 same solid, 3MF with texture (materials extension)\n"
        f"{basename}.glb                                 web preview of the same geometry\n"
        "report.json                                    watertight check, volume, wall thickness, price\n\n"
        "Units: millimetres. Z is up; the hero faces -Y. One closed solid, base included.\n"
        "Material: full-colour resin (PolyJet / WJP / Mimaki). Not a toy: display keepsake, 14+.\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{basename}.obj", obj)
        z.writestr(f"{basename}.mtl", mtl)
        z.writestr("texture.png", tex_png)
        z.writestr(f"{basename}.3mf", to_3mf(statue, tex_png))
        if include_glb:
            z.writestr(f"{basename}.glb", to_glb(statue))
        z.writestr("report.json", json.dumps(statue.report, indent=2))
        z.writestr("README.txt", readme)
    return buf.getvalue()


def first_name(name: Optional[str]) -> str:
    return (name or "").strip().split(" ")[0][:20] if name else ""


def make_statue_package(glb: bytes, height_mm: float = 90.0, hero_name: str = "",
                        child_name: str = "", age: Optional[int] = None) -> tuple[bytes, dict]:
    """GLB bytes in, (zip bytes, report) out."""
    if not 30 <= height_mm <= 250:
        raise ValueError("height_mm must be between 30 and 250")
    statue = build_statue(load_glb(glb), height_mm, hero_name, first_name(child_name), age)
    return package(statue), statue.report
