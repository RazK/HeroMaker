import sys, trimesh, numpy as np
m = trimesh.load(sys.argv[1], process=False)
c = m.visual.vertex_colors[:, :3] / 255.0
lin = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
t = trimesh.Trimesh(np.c_[m.vertices[:, 0], m.vertices[:, 2], -m.vertices[:, 1]], m.faces,
                    vertex_colors=np.c_[(lin * 255).astype(np.uint8), np.full(len(c), 255, np.uint8)], process=False)
t.export(sys.argv[2])
