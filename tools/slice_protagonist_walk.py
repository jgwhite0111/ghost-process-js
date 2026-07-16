#!/usr/bin/env python3
"""Bake MiniMax's magenta eight-panel protagonist sheet into transparent frames."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/sprites/protagonist/obe_lab/walk_sheet_v1.png"
OUT = ROOT / "assets/sprites/protagonist/obe_lab/walk_frames_v1"
OUT.mkdir(parents=True, exist_ok=True)
source = np.array(Image.open(SRC).convert("RGB"))
height, width = source.shape[:2]
cell_w = width // 8
# The generated sheet adds a reflective magenta floor below the boots.
# Cut above it before keying so dark reflected legs cannot survive as sprites.
source = source[:648]

# Detect the separate heads in the upper band. MiniMax may not honour the
# requested panel count, so derive crop boundaries from what it actually made.
head_band = source[80:220]
head_foreground = ((head_band[:, :, 0] < 180) |
                   (head_band[:, :, 1] >= 82) |
                   (head_band[:, :, 2] <= 68)).astype(np.uint8)
try:
    import cv2
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(head_foreground, 8)
    centers = sorted(
        int(round(centroids[i][0]))
        for i in range(1, count)
        if stats[i][4] > 400
    )
except ImportError as exc:
    raise RuntimeError("opencv-python is required to detect generated pose panels") from exc
if len(centers) < 2:
    raise RuntimeError(f"could not detect pose heads; found centers={centers}")
bounds = [0] + [round((a + b) / 2) for a, b in zip(centers, centers[1:])] + [source.shape[1]]
print(f"Detected {len(centers)} generated poses at x={centers}")

# The model's poses overlap slightly at the panel edges. These conservative
# limits remove only the detached neighbouring boots while retaining the body.
EDGE_LIMITS = [(0, 159), (0, 112), (0, 112), (15, 130), (0, 130),
               (0, 140), (0, 112), (15, 130), (0, 178)]

# Generated background is hot pink/magenta: high red+blue, low green.
# The protagonist's oxblood jacket has substantially lower blue values.
for index, (left, right) in enumerate(zip(bounds, bounds[1:])):
    cell = source[:, left:right]
    local_left, local_right = EDGE_LIMITS[index]
    local_left = min(local_left, cell.shape[1] - 1)
    local_right = min(local_right, cell.shape[1])
    magenta = (cell[:, :, 0] > 175) & (cell[:, :, 1] < 82) & (cell[:, :, 2] > 68)
    foreground = (~magenta).astype(np.uint8)
    foreground[:, :local_left] = 0
    foreground[:, local_right:] = 0
    labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)[1:]
    if len(stats) <= 1:
        raise RuntimeError(f"frame {index + 1}: chroma key removed the whole figure")
    main_label = 1 + int(np.argmax(stats[1:, 4]))
    foreground = (labels == main_label).astype(np.uint8)
    alpha = (foreground * 255).astype(np.uint8)
    # Soften only the keyed edge, avoiding a visible magenta fringe.
    alpha_image = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(radius=0.7))
    rgba = np.dstack([cell, np.array(alpha_image)])
    ys, xs = np.where(rgba[:, :, 3] > 24)
    if len(xs) == 0:
        raise RuntimeError(f"frame {index + 1}: chroma key removed the whole figure")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    frame = Image.fromarray(rgba, mode="RGBA").crop(bbox)
    # Preserve a common feet baseline and body scale in a predictable frame box.
    target_h = 400
    scale = target_h / frame.height
    frame = frame.resize((round(frame.width * scale), target_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (240, 426), (0, 0, 0, 0))
    x = (canvas.width - frame.width) // 2
    canvas.alpha_composite(frame, (x, canvas.height - frame.height))
    output = OUT / f"frame_{index + 1:02d}.png"
    canvas.save(output)
    print(f"{output.relative_to(ROOT)} source_bbox={bbox} output={canvas.size}")

record = {
    "source": str(SRC.relative_to(ROOT)),
    "frames": str(OUT.relative_to(ROOT)),
    "frame_count": 8,
    "frame_size": [240, 426],
    "key": "magenta: R>175, G<82, B>68; source y<648 removes generated reflection",
    "source_prompt_sidecar": str(SRC.with_suffix(SRC.suffix + ".prompt.json").relative_to(ROOT)),
}
(OUT / "bake.json").write_text(json.dumps(record, indent=2) + "\n")
print(f"WROTE {OUT / 'bake.json'}")
