#!/usr/bin/env python3
"""Rebuild a 16-frame Grok stroll from a retained MP4."""
import argparse
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path('/Users/jwhite/.openclaw/media/tool-video-generation/ghost-process-grok-i2v-investigator-stroll-v2---19185de8-2fd6-4bce-b9a9-df2e8a9d7e9e.mp4')
DEFAULT_OUT = ROOT / 'assets/sprites/protagonist/obe_lab/walk_frames_grok_stroll_v2_16'
W, H, FIGURE_H, PAD = 240, 426, 400, 16

def border_ref(rgb, band=12):
    p = np.concatenate((rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3),
                        rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3)))
    return np.median(p, axis=0).astype(np.float32)

def largest(mask):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1: raise RuntimeError('no foreground component')
    return labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))

def fill_holes(mask):
    inv = (~mask).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, 8)
    out = mask.copy(); h, w = mask.shape
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h and area <= 900:
            out[labels == i] = True
    return out

def detect(rgb):
    bg = border_ref(rgb)
    dist = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    mask = fill_holes(largest(dist > 22.0))
    depth = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    r, g, b = [rgb[:, :, i] for i in range(3)]
    fringe = (r > 140) & (g < 115) & (b > 90) & (b > g * 1.08) & (r > g * 1.25)
    mask[fringe & (depth <= 4)] = False
    mask[(r > 205) & (g < 65) & (b > 170)] = False
    core = mask & (dist > 48.0) & (cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5) >= 2.8)
    if not core.any(): raise RuntimeError('no clean foreground core')
    src = np.where(core, 0, 255).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lookup = np.zeros((int(labels.max()) + 1, 3), dtype=np.uint8)
    lookup[labels[core]] = rgb[core]
    clean = lookup[labels]
    clean[core] = rgb[core]
    ys, xs = np.where(mask)
    return clean, mask, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

def normalize(rgb, mask, bbox, scale):
    x0, y0, x1, y1 = bbox
    rgba = np.dstack((rgb, mask.astype(np.uint8) * 255))
    crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').crop(Image.fromarray((mask[y0:y1, x0:x1] * 255).astype(np.uint8)).getbbox())
    resized = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
    if resized.width > W: raise RuntimeError(f'frame width {resized.width} exceeds {W}')
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(resized, ((W - resized.width) // 2, H - PAD - resized.height))
    arr = np.array(out); arr[arr[:, :, 3] < 16] = 0
    return Image.fromarray(arr, 'RGBA')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--label', default='grok_stroll_v2')
    parser.add_argument('--start', type=int, default=88)
    parser.add_argument('--step', type=int, default=3)
    args = parser.parse_args()
    end = args.start + args.step * 16
    if not args.source.exists(): raise FileNotFoundError(args.source)
    args.out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(args.source)); raw = []
    for n in range(end):
        ok, bgr = cap.read()
        if not ok: raise RuntimeError(f'MP4 ended at source frame {n}')
        if n >= args.start and (n - args.start) % args.step == 0:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            clean, mask, bbox = detect(rgb); raw.append((n, clean, mask, bbox))
    cap.release()
    scale = min(FIGURE_H / float(np.median([b[3] - b[1] for _, _, _, b in raw])),
                (W - 8) / float(max(b[2] - b[0] for _, _, _, b in raw)))
    frames = []
    for i, (source_frame, clean, mask, bbox) in enumerate(raw, 1):
        frame = normalize(clean, mask, bbox, scale)
        frame.save(args.out / f'frame_{i:02d}.png'); frames.append(frame)
    strip = Image.new('RGBA', (W * len(frames), H))
    for i, f in enumerate(frames): strip.alpha_composite(f, (i * W, 0))
    strip.save(args.out / f'sprite_strip_{args.label}.png')
    contact = Image.new('RGB', (W * 4, H * 4), (30, 37, 48)); d = ImageDraw.Draw(contact)
    for i, f in enumerate(frames):
        x, y = (i % 4) * W, (i // 4) * H
        for yy in range(y, y + H, 12):
            for xx in range(x, x + W, 12):
                if ((xx - x) // 12 + (yy - y) // 12) % 2: d.rectangle((xx, yy, xx + 11, yy + 11), fill=(46, 55, 69))
        contact.paste(f, (x, y), f)
    contact.save(args.out / 'contact.png')
    preview = [Image.alpha_composite(Image.new('RGBA', (W, H), (17, 24, 34, 255)), f).convert('RGB') for f in frames]
    preview[0].save(args.out / f'walk_preview_{args.label}.gif', save_all=True, append_images=preview[1:], duration=125, loop=0, disposal=2)
    print(f'rebuilt {len(frames)} frames at {args.out}')

if __name__ == '__main__': main()
