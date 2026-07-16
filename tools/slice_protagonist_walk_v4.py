#!/usr/bin/env python3
"""Bake recoverable MiniMax protagonist poses with complete feet and padding.

The original sheet is a 1280x720 image with nine generated poses. Pose 9 is
clipped by the source image's right edge and is intentionally excluded.
"""
from pathlib import Path
import json

import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/sprites/protagonist/obe_lab/walk_sheet_v1.png"
OUT = ROOT / "assets/sprites/protagonist/obe_lab/walk_frames_v4"
OUT.mkdir(parents=True, exist_ok=True)

source = np.array(Image.open(SRC).convert("RGB"))
# Keep the real soles (around y=650) but exclude the reflected floor below.
source = source[:662]

head_band = source[80:220]
head_foreground = (
    (head_band[:, :, 0] < 180)
    | (head_band[:, :, 1] >= 82)
    | (head_band[:, :, 2] <= 68)
).astype(np.uint8)
count, _labels, stats, centroids = cv2.connectedComponentsWithStats(
    head_foreground, 8
)
centers = sorted(
    int(round(centroids[i][0]))
    for i in range(1, count)
    if stats[i][4] > 400
)
if len(centers) != 9:
    raise RuntimeError(f"expected 9 generated poses, found centers={centers}")
bounds = [0] + [round((a + b) / 2) for a, b in zip(centers, centers[1:])] + [
    source.shape[1]
]

# Preserve the accepted horizontal isolation rules from v1. The salvage fix
# changes only the vertical source crop and bottom placement; it must not
# reintroduce neighboring pose fragments while recovering the soles.
EDGE_LIMITS = [
    (0, 159), (0, 112), (0, 112), (15, 130),
    (0, 130), (0, 140), (0, 112), (15, 130),
]

for index, (left, right) in enumerate(zip(bounds[:8], bounds[1:9])):
    cell = source[:, left:right]
    local_left, local_right = EDGE_LIMITS[index]
    local_left = min(local_left, cell.shape[1] - 1)
    local_right = min(local_right, cell.shape[1])
    magenta = (
        (cell[:, :, 0] > 175)
        & (cell[:, :, 1] < 82)
        & (cell[:, :, 2] > 68)
    )
    foreground = (~magenta).astype(np.uint8)
    foreground[:, :local_left] = 0
    foreground[:, local_right:] = 0
    _count, labels, component_stats, _centroids = cv2.connectedComponentsWithStats(
        foreground, 8
    )
    if len(component_stats) <= 1:
        raise RuntimeError(f"frame {index + 1}: no foreground components")
    main_label = 1 + int(np.argmax(component_stats[1:, 4]))
    alpha = ((labels == main_label) * 255).astype(np.uint8)
    alpha_image = Image.fromarray(alpha, mode="L").filter(
        ImageFilter.GaussianBlur(radius=0.7)
    )
    rgba = np.dstack([cell, np.array(alpha_image)])
    ys, xs = np.where(rgba[:, :, 3] > 24)
    if len(xs) == 0:
        raise RuntimeError(f"frame {index + 1}: chroma key removed the figure")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    frame = Image.fromarray(rgba, mode="RGBA").crop(bbox)

    target_h = 400
    scale = target_h / frame.height
    frame = frame.resize(
        (round(frame.width * scale), target_h), Image.Resampling.LANCZOS
    )
    canvas = Image.new("RGBA", (240, 426), (0, 0, 0, 0))
    x = (canvas.width - frame.width) // 2
    bottom_padding = 16
    canvas.alpha_composite(frame, (x, canvas.height - target_h - bottom_padding))
    output = OUT / f"frame_{index + 1:02d}.png"
    canvas.save(output)
    print(f"{output.relative_to(ROOT)} source_bbox={bbox} output={canvas.size}")

record = {
    "source": str(SRC.relative_to(ROOT)),
    "frames": str(OUT.relative_to(ROOT)),
    "frame_count": 8,
    "frame_size": [240, 426],
    "source_size": [1280, 720],
    "source_crop_y": 662,
    "bottom_padding": 16,
    "excluded_source_pose": 9,
    "reason_pose_9_excluded": "forward leg and boot leave the original sheet's right edge",
    "key": "magenta: R>175, G<82, B>68",
    "source_prompt_sidecar": str(SRC.with_suffix(SRC.suffix + ".prompt.json").relative_to(ROOT)),
}
(OUT / "bake.json").write_text(json.dumps(record, indent=2) + "\n")
print(f"WROTE {OUT / 'bake.json'}")
