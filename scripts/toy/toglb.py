import sys, trimesh, numpy as np
m = trimesh.load(sys.argv[1], process=False)
fc = m.visual.face_colors[:, :3] / 255.0
lin = np.where(fc > 0.04045, ((fc + 0.055) / 1.055) ** 2.4, fc / 12.92)
V = m.vertices[m.faces].reshape(-1, 3); F = np.arange(len(V)).reshape(-1, 3)
vc = np.c_[np.repeat(lin, 3, 0) * 255, np.full(len(V), 255)].astype(np.uint8)
t = trimesh.Trimesh(np.c_[V[:, 0], V[:, 2], -V[:, 1]], F, vertex_colors=vc, process=False)
t.export(sys.argv[2])
