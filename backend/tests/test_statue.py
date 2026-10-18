"""
Hero Statue: a hero's model.glb -> a watertight, full-colour, print-ready solid.

The pure geometry steps are tested on tiny synthetic meshes shaped like
Meshy's output (a surface split at every UV seam, with crumbs and slivers),
then the whole recipe and the admin endpoint on a small textured GLB.
"""
import io
import json
import zipfile

import numpy as np
import pytest

trimesh = pytest.importorskip("trimesh")
pytest.importorskip("manifold3d")
pytest.importorskip("fontTools")

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.services import statue  # noqa: E402
from app.services.statue import TexturedMesh  # noqa: E402

# ---------------------------------------------------------------------------
# Synthetic meshes
# ---------------------------------------------------------------------------

_CUBE_FACES = [  # (normal axis, sign) -> 4 corners, CCW seen from outside
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],  # z=0, faces -z
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],  # z=1, +z
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],  # y=0, -y
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],  # y=1, +y
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],  # x=0, -x
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],  # x=1, +x
]


def seam_split_box(size=(1.0, 2.0, 0.6), drop_quads=()):
    """A box whose six sides each have their own four vertices and UV island,
    the way Meshy splits a surface at texture seams. Y is up (glTF)."""
    verts, faces, uv = [], [], []
    for i, quad in enumerate(_CUBE_FACES):
        if i in drop_quads:
            continue
        base = len(verts)
        for j, c in enumerate(quad):
            verts.append(np.array(c, dtype=float) * size - np.array(size) / 2)
            uv.append([(i + (j in (1, 2))) / 6.0, float(j in (2, 3))])
        faces += [[base, base + 1, base + 2], [base, base + 2, base + 3]]
    v = np.array(verts)
    f = np.array(faces)
    return TexturedMesh(v, f, np.array(uv)[f], Image.new("RGB", (64, 64), (40, 90, 220)))


def box_glb(size=(1.0, 2.0, 0.6)) -> bytes:
    m = seam_split_box(size)
    tex = Image.new("RGB", (64, 64), (40, 90, 220))
    flat_v = m.vertices[m.faces.reshape(-1)]
    flat_uv = m.corner_uv.reshape(-1, 2)
    tm = trimesh.Trimesh(flat_v, np.arange(len(flat_v)).reshape(-1, 3),
                         visual=trimesh.visual.TextureVisuals(uv=flat_uv, image=tex), process=False)
    return trimesh.Scene(tm).export(file_type="glb")


def is_closed(vertices, faces):
    return trimesh.Trimesh(vertices, faces, process=False).is_watertight


# ---------------------------------------------------------------------------
# Pure steps
# ---------------------------------------------------------------------------

def test_weld_closes_a_seam_split_box_and_keeps_every_uv():
    m = seam_split_box()
    assert len(m.vertices) == 24 and not is_closed(m.vertices, m.faces)
    w = statue.weld(m)
    assert len(w.vertices) == 8
    assert len(w.faces) == 12
    assert is_closed(w.vertices, w.faces)
    np.testing.assert_allclose(w.corner_uv, m.corner_uv)  # seams survive on the corners


def test_weld_drops_degenerate_and_duplicate_triangles():
    m = seam_split_box()
    f = np.vstack([m.faces, m.faces[:1], [[0, 0, 1]]])
    cuv = np.concatenate([m.corner_uv, m.corner_uv[:1], m.corner_uv[:1]])
    w = statue.weld(TexturedMesh(m.vertices, f, cuv))
    assert len(w.faces) == 12


def test_drop_nonmanifold_removes_a_fin_on_a_shared_edge():
    w = statue.weld(seam_split_box())
    v = np.vstack([w.vertices, [[5.0, 5.0, 5.0]]])
    a, b = w.faces[0][:2]
    fin = np.array([[a, b, len(v) - 1]])
    m = TexturedMesh(v, np.vstack([w.faces, fin]), np.concatenate([w.corner_uv, w.corner_uv[:1]]))
    out, removed = statue.drop_nonmanifold(m)
    assert removed == 3  # the fin and the two box faces on that edge
    assert len(out.faces) == 10


def test_keep_main_body_drops_crumbs_but_keeps_big_shells():
    body = statue.weld(seam_split_box())
    crumb = TexturedMesh(np.array([[9, 9, 9], [9.1, 9, 9], [9, 9.1, 9]], float), np.array([[0, 1, 2]]), np.zeros((1, 3, 2)))
    twin = TexturedMesh(body.vertices + 5, body.faces, body.corner_uv)
    parts = [body, crumb, twin]
    off, vs, fs, uvs = 0, [], [], []
    for p in parts:
        vs.append(p.vertices); fs.append(p.faces + off); uvs.append(p.corner_uv); off += len(p.vertices)
    m = TexturedMesh(np.vstack(vs), np.vstack(fs), np.concatenate(uvs))
    out, dropped = statue.keep_main_body(m, min_share=0.5)
    assert dropped == 1
    assert len(out.faces) == 24


def test_fill_holes_closes_a_missing_side_with_its_neighbours_colour():
    m = statue.weld(seam_split_box(drop_quads=(1,)))
    assert len(statue.boundary_loops(m.faces)) == 1
    out, filled = statue.fill_holes(m)
    assert filled == 1
    assert is_closed(out.vertices, out.faces)
    tm = trimesh.Trimesh(out.vertices, out.faces, process=False)
    assert tm.is_winding_consistent and tm.volume > 0
    # each patch triangle takes a UV that already existed on the boundary
    patch = out.corner_uv[len(m.faces):].reshape(-1, 2)
    known = {tuple(x) for x in m.corner_uv.reshape(-1, 2)}
    assert all(tuple(x) in known for x in patch)


def test_fix_winding_turns_an_inverted_face_and_its_uvs_with_it():
    w = statue.weld(seam_split_box())
    f = w.faces.copy()
    cuv = w.corner_uv.copy()
    f[3] = f[3][::-1]
    cuv[3] = cuv[3][::-1]
    out = statue.fix_winding(TexturedMesh(w.vertices, f, cuv))
    tm = trimesh.Trimesh(out.vertices, out.faces, process=False)
    assert tm.is_winding_consistent and tm.volume > 0
    # a corner's UV still belongs to the same vertex it was on
    for fi in range(len(f)):
        for k in range(3):
            j = list(f[fi]).index(out.faces[fi][k])
            np.testing.assert_allclose(out.corner_uv[fi][k], cuv[fi][j])


def test_print_frame_is_z_up_with_the_hero_facing_minus_y():
    v = np.array([[0, 1, 0], [0, 0, 1]], float)   # glTF: up, front
    np.testing.assert_allclose(statue.to_print_frame(v), [[0, 0, 1], [0, -1, 0]])


def test_scale_to_height_stands_on_zero():
    v = statue.scale_to_height(np.array([[0, 0, -3], [1, 1, 1]], float), 90)
    assert v[:, 2].min() == 0 and v[:, 2].max() == pytest.approx(90)
    assert v[1, 0] == pytest.approx(90 / 4)


def test_center_of_mass_of_a_box_is_its_middle():
    w = statue.weld(seam_split_box())
    np.testing.assert_allclose(statue.center_of_mass(w.vertices, w.faces), [0, 0, 0], atol=1e-9)


def test_arc_text_sits_on_the_front_of_the_base_inside_its_radius():
    contours, em = statue.arc_text("Blue Bolt", 6.0, 20.0, max_arc_deg=110)
    pts = np.vstack(contours)
    r = np.linalg.norm(pts, axis=1)
    assert r.max() <= 20.0 + 0.5 and r.min() > 20.0 - 6.0 * 1.2
    assert pts[:, 1].max() < 0                           # all in front (-Y)
    assert abs(pts[:, 0].mean()) < 3                     # centred


def test_arc_text_shrinks_to_fit_the_arc():
    _, em = statue.arc_text("drawn by Maximiliana-Josephine, age 10", 3.6, 15.0, max_arc_deg=110)
    assert em < 3.6


# ---------------------------------------------------------------------------
# The whole recipe
# ---------------------------------------------------------------------------

def test_build_statue_makes_one_closed_full_colour_solid():
    s = statue.build_statue(statue.load_glb(box_glb()), 90, "Blue Bolt", "Maya", 6)
    r = s.report
    assert r["watertight"] and r["shells"] == 1
    assert r["height_mm"] == 90 and r["bbox_mm"][2] == pytest.approx(90, abs=0.2)
    assert is_closed(s.positions, s.welded_faces)
    base = r["base"]
    assert base["height_mm"] == 5.0 and base["diameter_mm"] >= 0.48 * 90
    assert [e["text"] for e in r["engraving"]] == ["Blue Bolt", "drawn by Maya, age 6"]
    assert r["stable"]
    assert r["volume_cm3"] > 0
    assert r["wall_thickness"]["p5_mm"] > 1.0
    assert set(r["price_estimate_usd"]["solid"]) == {"6 cm", "9 cm", "12 cm"}
    # every UV lands on the texture: hero below the strip, base and text on swatches
    uv = s.vert_props[:, 3:5]
    assert uv.min() >= 0 and uv.max() <= 1
    assert s.texture.size == (64, 64 + statue.SWATCH_PX)
    # and the base/engraving swatches are the colours they claim to be
    px = s.texture.load()
    assert px[10, 5] == statue.BASE_RGB and px[50, 5] == statue.TEXT_RGB


def test_engraving_cuts_into_the_base():
    glb = box_glb()
    plain = statue.build_statue(statue.load_glb(glb), 90).report["volume_cm3"]
    engraved = statue.build_statue(statue.load_glb(glb), 90, "Blue Bolt", "Maya", 6).report["volume_cm3"]
    assert 0 < plain - engraved < 1.0


def test_package_obj_is_watertight_and_3mf_is_textured():
    data, report = statue.make_statue_package(box_glb(), 60, "Rex", "Itai Cohen", 8)
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    assert {"statue.obj", "statue.mtl", "texture.png", "statue.3mf", "statue.glb", "report.json", "README.txt"} <= names
    assert json.loads(z.read("report.json"))["engraving"][1]["text"] == "drawn by Itai, age 8"
    obj = z.read("statue.obj").decode()
    v = np.array([list(map(float, ln.split()[1:])) for ln in obj.splitlines() if ln.startswith("v ")])
    f = np.array([[int(t.split("/")[0]) - 1 for t in ln.split()[1:]] for ln in obj.splitlines() if ln.startswith("f ")])
    assert is_closed(v, f)
    assert "map_Kd texture.png" in z.read("statue.mtl").decode()
    tmf = zipfile.ZipFile(io.BytesIO(z.read("statue.3mf")))
    model = tmf.read("3D/3dmodel.model").decode()
    assert "m:texture2dgroup" in model and 'pid="2"' in model
    assert "3D/Texture/texture.png" in tmf.namelist()
    assert report["height_mm"] == 60


def test_height_out_of_range_is_refused():
    with pytest.raises(ValueError):
        statue.make_statue_package(box_glb(), 10)


# ---------------------------------------------------------------------------
# The admin endpoint
# ---------------------------------------------------------------------------

class _Store:
    def __init__(self, files):
        self.files = files

    def file_exists(self, u, c, name):
        return (u, c, name) in self.files

    def download_file(self, u, c, name):
        return self.files[(u, c, name)]


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


def _auth(user):
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_print_file_is_admin_only(client, make_user, make_creation):
    owner = make_user(username="kid")
    c = make_creation(owner.id)
    url = f"/api/admin/creations/{c.id}/print-file"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=_auth(owner)).status_code == 403


def test_print_file_returns_the_package(client, make_user, make_creation, db, monkeypatch):
    from app.api import admin as admin_api

    admin = make_user(username="boss", is_admin=True)
    owner = make_user(username="kid")
    c = make_creation(owner.id)
    c.character_name, c.name, c.age = "Blue Bolt", "Maya Levi", 6
    db.commit()
    monkeypatch.setattr(admin_api, "get_storage", lambda: _Store({(owner.id, c.id, "model.glb"): box_glb()}))
    r = client.get(f"/api/admin/creations/{c.id}/print-file?height_mm=90", headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert 'filename="statue-blue-bolt-90mm.zip"' in r.headers["content-disposition"]
    assert r.headers["x-statue-watertight"] == "true"
    rep = json.loads(zipfile.ZipFile(io.BytesIO(r.content)).read("report.json"))
    assert [e["text"] for e in rep["engraving"]] == ["Blue Bolt", "drawn by Maya, age 6"]


def test_print_file_without_a_model_is_a_conflict(client, make_user, make_creation, monkeypatch):
    from app.api import admin as admin_api

    admin = make_user(username="boss", is_admin=True)
    c = make_creation(make_user(username="kid").id)
    monkeypatch.setattr(admin_api, "get_storage", lambda: _Store({}))
    r = client.get(f"/api/admin/creations/{c.id}/print-file", headers=_auth(admin))
    assert r.status_code == 409
    assert client.get("/api/admin/creations/nope/print-file", headers=_auth(admin)).status_code == 404
