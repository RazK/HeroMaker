"""Turn a HeroMaker model.glb into a print-ready, colour-painted 3MF.

  toyprep.py model.glb outdir --height=100 --colours=5

1. scale to `height` mm, Z up, feet on the bed
2. repair to watertight (MeshFix), union with the base (manifold3d); report thin walls
3. optional round base under the feet (stability + bed adhesion)
4. sample the hero's texture onto the new triangles
5. choose N filaments from a real catalogue that best reproduce the texture
6. clean speckle (majority filter + tiny islands merged) -> fewer colour changes
7. write a 3MF painted per triangle (PrusaSlicer mmu_segmentation + Bambu/Orca paint_color)
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import zipfile

import numpy as np
import trimesh
from PIL import Image

# Bambu Lab PLA Basic / Matte colours (published hex on the colour cards).
CATALOGUE = {
    "Jade White": "#FFFFFF", "Beige": "#F7E6DE", "Matte Latte Brown": "#D3B7A7",
    "Matte Desert Tan": "#E8DBB7", "Gold": "#E4BD68", "Orange": "#FF6A13",
    "Yellow": "#F4EE2A", "Sunflower Yellow": "#FEC600", "Bambu Green": "#00AE42",
    "Cyan": "#0086D6", "Blue": "#0A2989", "Purple": "#5E43B7", "Indigo Purple": "#482960",
    "Magenta": "#EC008C", "Pink": "#F55A74", "Hot Pink": "#F5547C", "Red": "#C12E1F",
    "Brown": "#9D432C", "Cocoa Brown": "#6F5034", "Black": "#000000", "Gray": "#8E9089",
    "Light Gray": "#D1D3D5",
}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float) / 255


def rgb2lab(rgb):
    rgb = np.asarray(rgb, float)
    lin = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def load(path):
    scene = trimesh.load(path)
    g = list(scene.geometry.values())[0]
    tex = np.asarray(g.visual.material.baseColorTexture.convert("RGB"), float) / 255
    return g.vertices.copy(), g.faces.copy(), g.visual.uv.copy(), tex


def sample_tex(tex, uv):
    h, w, _ = tex.shape
    x = np.clip(uv[:, 0] % 1.0 * (w - 1), 0, w - 1)
    y = np.clip((1 - uv[:, 1] % 1.0) * (h - 1), 0, h - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    return (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x1] * fx * (1 - fy)
            + tex[y1, x0] * (1 - fx) * fy + tex[y1, x1] * fx * fy)


def kmeans(x, w, k, iters=30, seed=0):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False, p=w / w.sum())]
    for _ in range(iters):
        d = ((x[:, None] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for i in range(k):
            m = lab == i
            if m.any():
                c[i] = np.average(x[m], axis=0, weights=w[m])
    return c, lab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("out")
    ap.add_argument("--height", type=float, default=100.0)
    ap.add_argument("--colours", type=int, default=5)
    ap.add_argument("--edge", type=float, default=0.6, help="max triangle edge mm")
    ap.add_argument("--min-thick", type=float, default=1.2, help="mm; thinner parts are thickened")
    ap.add_argument("--faces", type=int, default=120000)
    ap.add_argument("--base", type=float, default=3.0, help="base height mm, 0 = none")
    ap.add_argument("--palette", default="", help="comma list of catalogue names to force")
    ap.add_argument("--bands", type=float, default=0, help="colour by height bands of at least this many mm (few swaps)")
    ap.add_argument("--paint-above", type=float, default=0, help="keep full per-triangle colour above this height (mm): the head")
    ap.add_argument("--base-colour", default="", help="catalogue name of the base's colour (must be in the palette)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    report = {}

    V, F, UV, tex = load(a.glb)
    # glTF Y-up metres -> Z-up mm
    V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
    s = a.height / (V[:, 2].max() - V[:, 2].min())
    V = V * s
    V -= [(V[:, 0].max() + V[:, 0].min()) / 2, (V[:, 1].max() + V[:, 1].min()) / 2, V[:, 2].min()]
    src = trimesh.Trimesh(V, F, process=False)
    report["figure_mm"] = np.round(V.max(0) - V.min(0), 1).tolist()

    # ---- repair the original surface (keeps it smooth) ----------------------
    import pymeshfix, manifold3d
    pre = trimesh.Trimesh(V, F, process=False)
    pre.merge_vertices(merge_tex=True, merge_norm=True)
    fx = pymeshfix.MeshFix(np.asarray(pre.vertices, float), np.asarray(pre.faces, np.int32))
    fx.repair(joincomp=True, remove_smallest_components=False)
    m = trimesh.Trimesh(fx.points, fx.faces, process=True)
    if m.volume < 0:
        m.invert()
    def to_man(t):
        return manifold3d.Manifold(manifold3d.Mesh(vert_properties=t.vertices.astype(np.float32),
                                                   tri_verts=t.faces.astype(np.uint32)))
    man = to_man(m)
    assert man.status() == manifold3d.Error.NoError, man.status()
    if a.base > 0:
        feet = m.vertices[m.vertices[:, 2] < 6]
        c = feet[:, :2].mean(0)
        rad = max(np.linalg.norm(feet[:, :2] - c, axis=1).max() + 6, 18)
        sink = 1.0
        man = man.translate((0, 0, a.base - sink))
        disc = manifold3d.Manifold.cylinder(a.base, rad, rad, 128).translate((c[0], c[1], 0))
        man = man + disc
        report["base_mm"] = [round(2 * rad, 1), a.base]
    mm = man.to_mesh()
    m = trimesh.Trimesh(np.asarray(mm.vert_properties)[:, :3], np.asarray(mm.tri_verts), process=True)
    # finer triangles -> cleaner colour borders
    v2, f2 = trimesh.remesh.subdivide_to_size(m.vertices, m.faces, max_edge=a.edge)
    m = trimesh.Trimesh(v2, f2, process=True)
    # thickness: rays inward from a sample of faces
    idx = np.random.default_rng(0).choice(len(m.faces), min(3000, len(m.faces)), replace=False)
    org = m.triangles_center[idx] - m.face_normals[idx] * 1e-3
    loc, ri, _ = m.ray.intersects_location(org, -m.face_normals[idx], multiple_hits=False)
    th = np.full(len(idx), np.inf)
    th[ri] = np.linalg.norm(loc - org[ri], axis=1)
    report["wall_lt_0.8mm_pct"] = round(100 * float((th < 0.8).mean()), 2)
    report["wall_lt_1.2mm_pct"] = round(100 * float((th < 1.2).mean()), 2)
    comps = m.split(only_watertight=False)
    if len(comps) > 1:
        m = max(comps, key=lambda c: c.volume if c.is_watertight else 0)
    m.vertices[:, 2] -= m.vertices[:, 2].min()
    report.update(watertight=bool(m.is_watertight), faces=int(len(m.faces)),
                  volume_cm3=round(m.volume / 1000, 2), size_mm=np.round(m.extents, 1).tolist())

    # ---- colour transfer ---------------------------------------------------
    src.vertices[:, 2] += (a.base - 1.0) if a.base > 0 else 0
    cen = m.triangles_center
    closest, dist, tri = trimesh.proximity.closest_point(src, cen)
    bary = trimesh.triangles.points_to_barycentric(src.triangles[tri], closest)
    uv = (UV[F[tri]] * bary[:, :, None]).sum(1)
    rgb = sample_tex(tex, uv)
    far = dist > 1.5  # base and filler: no texture there
    # full-colour copy (for a colour printer that takes vertex colours, e.g. JLC3DP PLY)
    fc = rgb.copy()
    fc[far] = hex2rgb(CATALOGUE.get(a.base_colour or "Purple", "#5E43B7"))
    vsum = np.zeros((len(m.vertices), 3)); vcnt = np.zeros(len(m.vertices))
    for k in range(3):
        np.add.at(vsum, m.faces[:, k], fc)
        np.add.at(vcnt, m.faces[:, k], 1)
    vcol = (np.clip(vsum / np.maximum(vcnt, 1)[:, None], 0, 1) * 255).astype(np.uint8)
    trimesh.Trimesh(m.vertices, m.faces, vertex_colors=np.c_[vcol, np.full(len(vcol), 255, np.uint8)],
                    process=False).export(os.path.join(a.out, "toy_fullcolour.ply"))
    area = m.area_faces
    lab = rgb2lab(rgb)

    # ---- choose filaments --------------------------------------------------
    names = list(CATALOGUE)
    cat_lab = rgb2lab(np.array([hex2rgb(CATALOGUE[n]) for n in names]))
    if a.palette:
        chosen = [names.index(n.strip()) for n in a.palette.split(",")]
    else:
        cents, cl = kmeans(lab[~far], area[~far], 12)
        wts = np.array([area[~far][cl == i].sum() for i in range(12)])
        dmat = ((cents[:, None] - cat_lab[None]) ** 2).sum(-1) ** 0.5  # 12 x catalogue
        best, chosen = 1e18, None
        for combo in itertools.combinations(range(len(names)), a.colours):
            e = (dmat[:, combo].min(1) ** 2 * wts).sum()
            if e < best:
                best, chosen = e, list(combo)
    pal_lab = cat_lab[chosen]
    lbl = ((lab[:, None] - pal_lab[None]) ** 2).sum(-1).argmin(1)

    # ---- clean speckle -----------------------------------------------------
    adj = m.face_adjacency
    k = len(chosen)
    for _ in range(4):
        votes = np.zeros((len(m.faces), k))
        np.add.at(votes, (adj[:, 0], lbl[adj[:, 1]]), area[adj[:, 1]])
        np.add.at(votes, (adj[:, 1], lbl[adj[:, 0]]), area[adj[:, 0]])
        votes[np.arange(len(lbl)), lbl] += area * 1.6  # keep own colour unless clearly outvoted
        lbl = votes.argmax(1)
    # base and non-textured filler take the colour of their neighbours / a chosen colour
    min_island = 2.0  # mm^2
    for _ in range(3):
        same = lbl[adj[:, 0]] == lbl[adj[:, 1]]
        g = trimesh.graph.connected_components(adj[same], nodes=np.arange(len(lbl)), min_len=1)
        changed = 0
        for comp in g:
            if area[comp].sum() >= min_island:
                continue
            comp_set = np.zeros(len(lbl), bool)
            comp_set[comp] = True
            border = adj[comp_set[adj[:, 0]] ^ comp_set[adj[:, 1]]].ravel()
            border = border[~comp_set[border]]
            if len(border):
                lbl[comp] = np.bincount(lbl[border], weights=area[border], minlength=k).argmax()
                changed += 1
        if not changed:
            break
    if a.base > 0:
        base_faces = (cen[:, 2] < a.base + 0.05) & far
        # base takes the darkest chosen colour that is not skin-like
        bi = [names[c] for c in chosen].index(a.base_colour) if a.base_colour else int(np.argmin(pal_lab[:, 0]))
        lbl[base_faces] = bi

    if a.bands > 0:
        step = 0.4
        zb = np.floor(cen[:, 2] / step).astype(int)
        nb = zb.max() + 1
        votes = np.zeros((nb, k))
        # vote only with what a person sees from the front: the nearest face in each 1 mm cell
        cell = np.floor(cen[:, [0, 2]]).astype(int)
        key = cell[:, 0] * 100000 + cell[:, 1]
        order = np.lexsort((cen[:, 1], key))
        first = order[np.r_[True, key[order][1:] != key[order][:-1]]]
        seen = np.zeros(len(cen), bool)
        seen[first] = True
        centre = np.abs(cen[:, 0] - np.median(cen[:, 0])) < 0.1 * a.height  # the body's middle, not the arms or a cape
        np.add.at(votes, (zb, lbl), area * (0.01 + seen * centre))
        seq = votes.argmax(1)
        # merge runs shorter than a.bands into the neighbour with the bigger vote
        minrun = int(round(a.bands / step))
        for _ in range(5000):
            runs = []
            i = 0
            while i < nb:
                j = i
                while j < nb and seq[j] == seq[i]:
                    j += 1
                runs.append((i, j))
                i = j
            short = [r for r in runs if r[1] - r[0] < minrun]
            if not short or len(runs) == 1:
                break
            i, j = min(short, key=lambda r: votes[r[0]:r[1]].sum())
            cands = []
            if i > 0: cands.append(seq[i - 1])
            if j < nb: cands.append(seq[j])
            seq[i:j] = max(cands, key=lambda c: votes[i:j, c].sum())
        full = lbl.copy()
        lbl = seq[zb]
        if a.paint_above > 0:
            lbl = np.where(cen[:, 2] > a.paint_above, full, lbl)
        report["band_changes"] = int((np.diff(seq) != 0).sum())
        report["bands"] = [(round(float(i * step), 1), CATALOGUE[names[chosen[c]]]) for i, c in enumerate(seq) if i == 0 or seq[i - 1] != c]
    same = lbl[adj[:, 0]] == lbl[adj[:, 1]]
    regions = len(trimesh.graph.connected_components(adj[same], nodes=np.arange(len(lbl)), min_len=1))
    report["palette"] = [{"extruder": i + 1, "name": names[c], "hex": CATALOGUE[names[c]],
                          "area_pct": round(100 * area[lbl == i].sum() / area.sum(), 1)}
                         for i, c in enumerate(chosen)]
    report["colour_regions"] = regions
    err = ((lab - pal_lab[lbl]) ** 2).sum(-1) ** 0.5
    report["mean_deltaE_textured"] = round(float(np.average(err[~far], weights=area[~far])), 1)

    # ---- write -------------------------------------------------------------
    cols = np.array([hex2rgb(CATALOGUE[names[c]]) for c in chosen])
    vc = trimesh.Trimesh(m.vertices, m.faces, process=False,
                         face_colors=np.c_[(cols[lbl] * 255).astype(np.uint8), np.full(len(lbl), 255, np.uint8)])
    vc.export(os.path.join(a.out, "toy_coloured.ply"))
    np.save(os.path.join(a.out, "labels.npy"), lbl)
    write_3mf(os.path.join(a.out, "toy.3mf"), m.vertices, m.faces, lbl, [CATALOGUE[names[c]] for c in chosen])
    m.export(os.path.join(a.out, "toy.stl"))
    json.dump(report, open(os.path.join(a.out, "report.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))


# PrusaSlicer TriangleSelector encoding for an unsplit triangle painted with extruder n (1-based)
def paint_code(n):
    if n < 3:
        return "%X" % (n << 2)
    return "%XC" % (n - 3)


def write_3mf(path, V, F, lbl, hexes):
    codes = [paint_code(i + 1) for i in range(len(hexes))]
    vs = "\n".join('<vertex x="%.4f" y="%.4f" z="%.4f"/>' % tuple(v) for v in V)
    ts = "\n".join('<triangle v1="%d" v2="%d" v3="%d" slic3rpe:mmu_segmentation="%s" paint_color="%s"/>'
                   % (f[0], f[1], f[2], codes[l], codes[l]) for f, l in zip(F, lbl))
    model = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
<metadata name="slic3rpe:Version3mf">1</metadata>
<metadata name="Title">HeroMaker toy</metadata>
<resources>
<object id="1" type="model">
<mesh>
<vertices>
{vs}
</vertices>
<triangles>
{ts}
</triangles>
</mesh>
</object>
</resources>
<build>
<item objectid="1" transform="1 0 0 0 1 0 0 0 1 120 120 0" printable="1"/>
</build>
</model>'''
    ct = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'''
    rels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'''
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
        z.writestr("Metadata/filament_colours.json", json.dumps(hexes))


if __name__ == "__main__":
    main()
