"""
A rig the converter cannot map must fail, not ship a broken VRM.

conversion_script.main() ignored map_vrm_bones()'s answer: with a required
bone missing it went on and exported anyway (ignore_warning=True), and Blender
exited 0. The service then returned a VRM with no humanoid, and the paid hero
was "ready" but could not be animated. Every other error also ended with
`return`, an exit code of 0.

Blender's `bpy` is not available outside Blender, so it is replaced by a
stand-in scene holding one armature. The script under test is the real one.
"""
import importlib
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

SERVICE = Path(__file__).resolve().parents[1]

REQUIRED = ["Hips", "Spine02", "neck", "Head", "LeftArm", "LeftForeArm", "LeftHand",
            "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot",
            "RightUpLeg", "RightLeg", "RightFoot"]


def _load(bones):
    armature = mock.MagicMock(name="armature")
    armature.type = "ARMATURE"
    armature.name = "Armature"
    armature.data.bones = {name: mock.MagicMock() for name in bones}
    armature.pose.bones = []

    bpy = mock.MagicMock(name="bpy")
    bpy.context.scene.objects = [armature]
    fakes = {"bpy": bpy, "addon_utils": mock.MagicMock(), "bmesh": mock.MagicMock()}
    with mock.patch.dict(sys.modules, fakes):
        sys.path.insert(0, str(SERVICE))
        try:
            sys.modules.pop("conversion_script", None)
            script = importlib.import_module("conversion_script")
        finally:
            sys.path.remove(str(SERVICE))
    script.bpy = bpy
    return script, bpy


def _main(script, tmp_path):
    argv = ["blender", "--background", "--python", "conversion_script.py", "--",
            str(tmp_path / "in.glb"), str(tmp_path / "out.vrm")]
    with mock.patch.object(sys, "argv", argv):
        script.main()


def test_a_rig_missing_a_required_bone_fails_and_exports_nothing(tmp_path):
    script, bpy = _load([b for b in REQUIRED if b != "LeftForeArm"])

    with pytest.raises(SystemExit) as exit_:
        _main(script, tmp_path)

    assert exit_.value.code == 1
    bpy.ops.export_scene.vrm.assert_not_called()


def test_a_scene_with_no_armature_fails(tmp_path):
    script, bpy = _load(REQUIRED)
    bpy.context.scene.objects = []

    with pytest.raises(SystemExit) as exit_:
        _main(script, tmp_path)
    assert exit_.value.code == 1


def test_an_export_that_writes_no_file_fails(tmp_path):
    script, bpy = _load(REQUIRED)   # every bone there; the exporter writes nothing

    with pytest.raises(SystemExit) as exit_:
        _main(script, tmp_path)
    assert exit_.value.code == 1
    bpy.ops.export_scene.vrm.assert_called_once()


def test_a_complete_rig_is_exported(tmp_path):
    """The guard must not stop a good rig: map_vrm_bones says True on success."""
    script, bpy = _load(REQUIRED + ["Spine01", "Spine", "LeftShoulder", "RightShoulder"])
    out = tmp_path / "out.vrm"
    bpy.ops.export_scene.vrm.side_effect = lambda **_kw: out.write_bytes(b"VRM")

    _main(script, tmp_path)      # no SystemExit

    assert out.read_bytes() == b"VRM"
