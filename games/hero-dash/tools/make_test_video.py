#!/usr/bin/env python3
"""Synthesise a Y4M clip of a 'player' for Hero Cam tests.

Chromium's built-in fake camera has no body in it, so it can never finish
calibration. This draws a simple figure that stands still, steps left and
right, jumps, crouches, and throws a star pose — enough to exercise every
Hero Cam action deterministically in CI.

Usage: make_test_video.py OUT.y4m [--seconds=15]
"""
import sys
from pathlib import Path

W, H, FPS = 320, 240, 30
BG_Y, FG_Y = 200, 40          # light room, dark figure


def figure(t: float):
    """Return (centre_x, head_y, half_width) in px, or None when out of shot."""
    cx, head, half = W * 0.5, H * 0.18, W * 0.085
    if t < 3.2:                       # step 1: empty room
        return None
    if t < 5.4:                       # step 2: stand still to be measured
        pass
    elif t < 7.0:                     # step left
        cx = W * 0.30
    elif t < 8.6:                     # step right
        cx = W * 0.70
    elif t < 10.2:                    # centre, then jump
        cx = W * 0.5
        if t > 9.2:
            head = H * 0.05
    elif t < 11.8:                    # crouch
        head = H * 0.44
    elif t < 13.4:                    # star pose: arms and legs wide
        half = W * 0.26
    return cx, head, half


def draw(t: float) -> bytes:
    y = bytearray([BG_Y]) * (W * H)
    # A little furniture, so the empty-room step has something to learn.
    for row in range(int(H * 0.62), int(H * 0.78)):
        for x in range(int(W * 0.04), int(W * 0.20)):
            y[row * W + x] = 120
    pose = figure(t)
    if pose is None:
        chroma = bytes([128]) * ((W // 2) * (H // 2))
        return bytes(y) + chroma + chroma
    cx, head, half = pose
    for row in range(int(head), H):
        # Narrow at the head, full width below the shoulders.
        w = half * (0.42 if row < head + H * 0.11 else 1.0)
        x0, x1 = max(0, int(cx - w)), min(W, int(cx + w))
        base = row * W
        for x in range(x0, x1):
            y[base + x] = FG_Y
    chroma = bytes([128]) * ((W // 2) * (H // 2))
    return bytes(y) + chroma + chroma


if __name__ == "__main__":
    out = Path(sys.argv[1])
    seconds = float(next((a.split("=")[1] for a in sys.argv[2:] if a.startswith("--seconds")), 15))
    with out.open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420mpeg2\n".encode())
        for i in range(int(seconds * FPS)):
            f.write(b"FRAME\n")
            f.write(draw(i / FPS))
    print(f"{out} {out.stat().st_size / 1e6:.1f} MB, {seconds}s")
