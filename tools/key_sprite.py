#!/usr/bin/env python3
"""
key_sprite.py — generalized green-screen keyer for MiniMax-Image outputs.

MiniMax-Image has no alpha-channel output, so sprites are generated on a
solid green BG and chroma-keyed post-hoc. This tool is the bake-time half
of that workflow: turn green-BG PNGs or MP4 frames into transparent RGBA
PNGs ready for the runtime.

Pipeline:
    [green-screen PNG | green-screen MP4]
        → chroma key (HSV)
        → soft 3x3 Gaussian on alpha
        → (optional) resize to target WxH
        → write RGBA PNG(s)

Deps: opencv-python (cv2), numpy, Pillow.

Usage:
    # Single PNG:
    python3 tools/key_sprite.py \
        --src foo.png \
        --out out.png

    # Glob of PNGs:
    python3 tools/key_sprite.py \
        --src 'sprites/alley/idle_*.png' \
        --out sprites/alley_keyed/

    # MP4 → N evenly-spaced keyframes:
    python3 tools/key_sprite.py \
        --src corridor.mp4 \
        --start 1 --end 130 \
        --keyframes 16 \
        --out transparent_sprites/

    # With resize:
    python3 tools/key_sprite.py \
        --src 'alley/idle_*.png' \
        --out alley/ \
        --size 240x426

Defaults (MiniMax-Image standard green, HSV):
    --hue-lo 35 --hue-hi 80 --sat-min 40 --val-min 40

These match the corridor clip's green ((17, 145, 42) RGB ≈ H≈39 S≈76 V≈57).
Tune --hue-lo/--hue-hi if a different batch of outputs uses a different
green; sample the source PNG with any image tool first.
"""

import argparse
import glob
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def key_png(src_path, hsv_lo, hsv_hi, soften=3):
    """Read a PNG, chroma-key it, return RGBA numpy array at source res."""
    img = cv2.imread(str(src_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"could not read {src_path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        # Already RGBA — assume alpha is correct, return as-is.
        return cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    green_mask = cv2.inRange(hsv, hsv_lo, hsv_hi)
    sprite_mask = cv2.bitwise_not(green_mask)
    if soften > 0:
        # odd kernel size required; clamp to odd >= 1
        k = soften if soften % 2 == 1 else soften + 1
        sprite_mask = cv2.GaussianBlur(sprite_mask, (k, k), 0)
    b, g, r = cv2.split(img)
    rgba = cv2.merge([b, g, r, sprite_mask])
    return cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)


def key_video(src_path, start_frame, end_frame, keyframes, hsv_lo, hsv_hi, soften=3):
    """Pull N evenly-spaced keyframes from MP4 and key each one."""
    cap = cv2.VideoCapture(str(src_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"could not open video {src_path}")
    indices = np.linspace(start_frame, end_frame - 1, keyframes, dtype=int)
    saved = []
    cur = 0
    while True:
        ret, frame = cap.read()
        if not ret or cur >= end_frame:
            break
        if cur in indices:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            green_mask = cv2.inRange(hsv, hsv_lo, hsv_hi)
            sprite_mask = cv2.bitwise_not(green_mask)
            if soften > 0:
                k = soften if soften % 2 == 1 else soften + 1
                sprite_mask = cv2.GaussianBlur(sprite_mask, (k, k), 0)
            b, g, r = cv2.split(frame)
            rgba = cv2.merge([b, g, r, sprite_mask])
            rgba = cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)
            saved.append((indices_search(indices, cur), rgba))
        cur += 1
    cap.release()
    return saved


def indices_search(indices, cur):
    """Return position of cur in indices (assumes cur is in indices)."""
    return int(np.where(indices == cur)[0][0])


def write_rgba(rgba_array, dst_path, size=None):
    """Save RGBA numpy array as PNG, optionally resizing first."""
    if size:
        # cv2.resize is faster than PIL for batch ops; use INTER_LANCZOS4.
        h, w = rgba_array.shape[:2]
        tw, th = size
        if (w, h) != (tw, th):
            rgba_array = cv2.resize(rgba_array, (tw, th), interpolation=cv2.INTER_LANCZOS4)
    # PIL handles RGBA → PNG cleanly; cv2.imwrite drops the alpha on some builds.
    Image.fromarray(rgba_array, mode="RGBA").save(str(dst_path))


def main():
    ap = argparse.ArgumentParser(description="Green-screen keyer for MiniMax-Image outputs.")
    ap.add_argument("--src", required=True, help="Source PNG path, glob, or MP4 path.")
    ap.add_argument("--out", required=True, help="Output PNG path (single PNG src) or directory.")
    ap.add_argument("--hue-lo", type=int, default=35, help="HSV hue lower bound (0-179).")
    ap.add_argument("--hue-hi", type=int, default=80, help="HSV hue upper bound (0-179).")
    ap.add_argument("--sat-min", type=int, default=40, help="HSV saturation min (0-255).")
    ap.add_argument("--val-min", type=int, default=40, help="HSV value min (0-255).")
    ap.add_argument("--soften", type=int, default=3, help="Gaussian kernel size on alpha (odd, 0=off).")
    ap.add_argument("--size", default=None, help="WxH to resize output (e.g. 180x320). Skips if already that size.")
    # Video-only:
    ap.add_argument("--start", type=int, default=1, help="[video] first frame index to consider.")
    ap.add_argument("--end", type=int, default=130, help="[video] stop before this frame index.")
    ap.add_argument("--keyframes", type=int, default=16, help="[video] number of frames to extract.")
    ap.add_argument("--prefix", default="frame_", help="[video] output filename prefix; final name is <prefix><NN:02d>.png")
    args = ap.parse_args()

    hsv_lo = np.array([args.hue_lo, args.sat_min, args.val_min])
    hsv_hi = np.array([args.hue_hi, 255, 255])
    size = None
    if args.size:
        w, h = args.size.lower().split("x")
        size = (int(w), int(h))

    src = args.src
    out = Path(args.out)

    # Decide input mode: MP4, single PNG, or glob.
    if src.lower().endswith((".mp4", ".mov", ".webm", ".avi")):
        # Video → directory of keyframes
        out.mkdir(parents=True, exist_ok=True)
        keyed = key_video(src, args.start, args.end, args.keyframes, hsv_lo, hsv_hi, args.soften)
        for idx, rgba in keyed:
            dst = out / f"{args.prefix}{idx:02d}.png"
            write_rgba(rgba, dst, size=size)
            print(f"wrote {dst}")
        print(f"done: {len(keyed)} keyframes → {out}")
        return

    # PNG mode: glob or single
    if any(c in src for c in "*?["):
        paths = sorted(glob.glob(src))
        if not paths:
            print(f"no files matched {src}", file=sys.stderr)
            sys.exit(1)
        out.mkdir(parents=True, exist_ok=True)
        for p in paths:
            rgba = key_png(p, hsv_lo, hsv_hi, args.soften)
            dst = out / Path(p).name
            write_rgba(rgba, dst, size=size)
            print(f"wrote {dst}")
        print(f"done: {len(paths)} files → {out}")
        return

    # Single PNG → out as PNG (or as directory if --out ends in /)
    src_path = Path(src)
    if not src_path.exists():
        print(f"not found: {src}", file=sys.stderr)
        sys.exit(1)
    rgba = key_png(src_path, hsv_lo, hsv_hi, args.soften)
    if str(args.out).endswith(os.sep) or out.is_dir():
        out.mkdir(parents=True, exist_ok=True)
        dst = out / src_path.name
    else:
        dst = out
        dst.parent.mkdir(parents=True, exist_ok=True)
    write_rgba(rgba, dst, size=size)
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()