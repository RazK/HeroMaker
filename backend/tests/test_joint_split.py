"""Our own printable split: closed parts that snap together on ball joints.

A synthetic figure stands in for a hero: a box torso, a sphere head, two
cylinder arms in a T-pose and two cylinder legs, unioned into one surface the
way a pipeline mesh is one surface.
"""
import io
import zipfile

import numpy as np
import pytest

m3 = pytest.importorskip("manifold3d")
trimesh = pytest.importorskip("trimesh")

from app.utils.joint_split import Limb, split_figure  # noqa: E402


def _cyl(a, b, r):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    length = float(np.linalg.norm(d))
    z = d / length
    x = np.cross([0, 0, 1.0] if abs(z[2]) < 0.9 else [1.0, 0, 0], z); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return m3.Manifold.cylinder(length, r, r, 48).transform(np.hstack([np.stack([x, y, z], 1), a.reshape(3, 1)]))


@pytest.fixture(scope="module")
def figure():
    # Units are arbitrary on purpose (split_figure scales to height_mm): 0..30 tall.
    torso = m3.Manifold.cube([8, 10, 5], center=True).translate([0, 15, 0])
    head = m3.Manifold.sphere(4.0, 64).translate([0, 23, 0])
    neck = _cyl([0, 19.5, 0], [0, 20.5, 0], 1.8)
    arms = _cyl([3, 18, 0], [14, 18, 0], 1.3) + _cyl([-3, 18, 0], [-14, 18, 0], 1.3)
    legs = _cyl([2, 11, 0], [2, 0, 0], 1.6) + _cyl([-2, 11, 0], [-2, 0, 0], 1.6)
    body = torso + head + neck + arms + legs
    mesh = body.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3].astype(float)
    f = np.asarray(mesh.tri_verts).astype(np.int64)
    limbs = {
        "head": Limb([0, 20, 0], [0, 27, 0]),
        "left_arm": Limb([4, 18, 0], [14, 18, 0]),
        "right_arm": Limb([-4, 18, 0], [-14, 18, 0]),
        "left_leg": Limb([2, 10, 0], [2, 0, 0]),
        "right_leg": Limb([-2, 10, 0], [-2, 0, 0]),
    }
    return v, f, limbs


@pytest.fixture(scope="module")
def split(figure):
    v, f, limbs = figure
    return split_figure(v, f, limbs, height_mm=150.0, pitch=0.8)


def test_six_closed_parts(split):
    names = sorted(p.name for p in split.parts)
    assert names == sorted(["torso", "head", "left_arm", "right_arm", "left_leg", "right_leg"])
    for p in split.parts:
        assert p.solid.status() == m3.Error.NoError and not p.solid.is_empty(), p.name
        v, f = p.mesh()
        tm = trimesh.Trimesh(v, f, process=False)
        assert tm.is_watertight and tm.is_winding_consistent, p.name
        assert len(np.unique(np.sort(f, axis=1), axis=0)) == len(f), f"{p.name} has duplicate triangles"
        assert p.volume_mm3 > 0


def test_every_limb_carries_a_ball_that_sits_in_a_socket(split):
    torso = next(p for p in split.parts if p.name == "torso").solid
    for p in split.parts:
        if p.name == "torso":
            continue
        assert p.ball_diameter_mm and p.ball_diameter_mm >= 3.6, p.name
        centre, _ = split.joints_mm[p.name]
        # The ball's centre is inside the limb part, and inside the torso's
        # socket: the torso has no material there.
        probe = m3.Manifold.sphere(0.2, 12).translate(centre)
        assert (p.solid ^ probe).volume() > 0, f"{p.name}: no ball at the joint"
        assert (torso ^ probe).volume() == 0, f"{p.name}: the torso fills the socket"


def test_parts_do_not_overlap_so_they_print_apart(split):
    for i, a in enumerate(split.parts):
        for b in split.parts[i + 1:]:
            assert (a.solid ^ b.solid).volume() < 1e-3, f"{a.name} overlaps {b.name}"


def test_figure_is_the_height_asked_for(split):
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for p in split.parts:
        v, _ = p.mesh()
        lo, hi = np.minimum(lo, v.min(0)), np.maximum(hi, v.max(0))
    assert hi[1] - lo[1] == pytest.approx(150.0, abs=2.0)


def test_exports_a_3mf_with_one_object_per_part(split):
    from app.utils.glb_to_3mf import glb_to_3mf

    scene = trimesh.Scene()
    for p in split.parts:
        v, f = p.mesh()
        scene.add_geometry(trimesh.Trimesh(v, f, process=False), node_name=p.name, geom_name=p.name)
    model = zipfile.ZipFile(io.BytesIO(glb_to_3mf(scene.export(file_type="glb"), height_mm=150.0))).read(
        "3D/3dmodel.model").decode()
    assert model.count("<object ") == 6
