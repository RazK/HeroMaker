"""
One conversion must not freeze the converter.

/convert was an `async def` that ran Blender with the blocking
subprocess.run (up to 5 minutes), on the event loop. While one hero converted,
every other request waited, /health included, so Railway's health check and
the next hero's conversion both stalled behind it.

Blender is replaced by a small script that takes a second and writes the
output file, as Blender would. Everything else is the real service.
"""
import asyncio
import stat
import sys
import time
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as service  # noqa: E402

SLOW = 1.5   # seconds the fake Blender takes


@pytest.fixture
def fake_blender(tmp_path, monkeypatch):
    blender = tmp_path / "blender"
    blender.write_text(
        "#!/bin/sh\n"
        "# args: ... -- input.glb output.vrm [thumbnail]\n"
        'while [ "$1" != "--" ]; do shift; done; shift\n'
        f"sleep {SLOW}\n"
        'printf VRM > "$2"\n'
    )
    blender.chmod(blender.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(service, "BLENDER_PATH", str(blender))
    return blender


def test_health_answers_while_a_conversion_runs(fake_blender):
    async def scenario():
        transport = httpx.ASGITransport(app=service.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://converter") as client:
            started = time.monotonic()
            conversion = asyncio.create_task(client.post(
                "/convert", files={"file": ("hero.glb", b"glTF", "model/gltf-binary")},
            ))
            await asyncio.sleep(0.2)          # Blender is now running
            health = await client.get("/health")
            # Measured from the start: a blocked event loop cannot even wake
            # from the 0.2 s sleep until Blender is done.
            answered_after = time.monotonic() - started
            converted = await conversion
        return health, answered_after, converted

    health, answered_after, converted = asyncio.run(scenario())

    assert health.status_code == 200
    assert answered_after < SLOW - 0.5, (
        f"/health answered {answered_after:.2f}s in, behind a {SLOW}s conversion")
    assert converted.status_code == 200
    assert converted.content == b"VRM"


def test_blender_reports_a_crashing_script_as_a_failure(fake_blender, monkeypatch):
    """Without --python-exit-code Blender exits 0 when the script raises."""
    seen = []

    def record(cmd, **_kw):
        seen.append(cmd)
        raise service.subprocess.CalledProcessError(1, cmd, "", "")

    monkeypatch.setattr(service.subprocess, "run", record)
    with pytest.raises(Exception, match="VRM conversion failed"):
        service.blender_convert("/tmp/in.glb", "/tmp/out.vrm")

    assert "--python-exit-code" in seen[0]
