"""Video -> per-frame 3D body landmarks (MediaPipe Pose Landmarker, heavy).

Writes JSON: {fps, frames: [{world: [[x,y,z,vis]*33], image: [[x,y,vis]*33]} | null]}
World landmarks are metres, origin between the hips, x = image right, y = down,
z = away from the camera. Smoothing is done later, on rotations.

usage: python extract_pose.py video.mp4 model.task out.json [debug_dir]
"""
import json
import os
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

video, model, out = sys.argv[1:4]
debug = sys.argv[4] if len(sys.argv) > 4 else None

opts = vision.PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.4,
    min_tracking_confidence=0.4,
)
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 24
frames = []
with vision.PoseLandmarker.create_from_options(opts) as lm:
    i = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
        if res.pose_world_landmarks:
            w = res.pose_world_landmarks[0]
            im = res.pose_landmarks[0]
            frames.append({
                "world": [[p.x, p.y, p.z, p.visibility] for p in w],
                "image": [[p.x, p.y, p.visibility] for p in im],
            })
            if debug:
                h, wd = bgr.shape[:2]
                for a, b in [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
                             (23, 25), (25, 27), (24, 26), (26, 28), (27, 31), (28, 32)]:
                    pa, pb = im[a], im[b]
                    cv2.line(bgr, (int(pa.x * wd), int(pa.y * h)), (int(pb.x * wd), int(pb.y * h)), (0, 0, 255), 3)
        else:
            frames.append(None)
        if debug:
            os.makedirs(debug, exist_ok=True)
            cv2.imwrite(os.path.join(debug, f"{i:04d}.jpg"), bgr)
        i += 1

json.dump({"fps": fps, "frames": frames}, open(out, "w"))
print(f"{len(frames)} frames @ {fps:.2f} fps, tracked {sum(f is not None for f in frames)}")
