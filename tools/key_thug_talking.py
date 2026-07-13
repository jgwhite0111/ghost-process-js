#!/usr/bin/env python3
"""
tools/key_thug_talking.py — reprocess the thug talking.webp into
clean jailbreak frames.

The source talking.webp is ALREADY pre-keyed:
  - alpha=0  (24840 pixels): correctly-removed white background
  - alpha=128 (480 pixels): a half-pixel halo around the figure
    edge. On a white-skinned character this would be a soft white
    falloff. On this character, it's TINTED GREEN — that's the
    "leftover green screen by his head" the user complained about.
  - alpha=255 (32280 pixels): the figure itself.

Previous attempts (a) over-zeroed and turned the bg black, or
(b) left the green halo around the head, or (c) despilled green
toward neutral grey which made the figure look sick.

Common-sense fix: this is a black character. Green halos near
his face are SKIN spillover — they'd be skin tone if the source
were key-corrected. So REPLACE the green pixels in the halo
(transparent-alpha band) with brown skin tones of matching
luminance, NOT with grey and NOT with transparency.

Steps:
  1. Load each frame.
  2. Identify green-tinted pixels (g dominant) within the alpha
     band of the figure (alpha > 0).
  3. Convert "green pixels" → brown skin via:
        luminance = 0.299*r + 0.587*g + 0.114*b
        target_g  = luminance  (so the resulting pixel has the
                                SAME brightness but with g dropped
                                to match r/b skin profile)
        target_b  = luminance * 0.45
        target_r  = 1.6 * luminance  (overshoot r for warmth)
     Then clamp to [0,255] and round.
  4. Save.
"""

import os, sys
import numpy as np
from PIL import Image

SRC = "assets/sprites/thug/raw/i2v_clip_thug_talking.webp"
OUT_DIR = "assets/sprites/thug/jailbreak"
FRAME_W, FRAME_H = 180, 320
N_FRAMES = 16


def green_to_skin(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Where mask is True, replace the green-dominant pixel with a
    brown skin tone of the same luminance.

    The conversion:
        lum = 0.299*r + 0.587*g + 0.114*b
        r' = clamp(lum * 1.6, 0, 255)
        g' = clamp(lum * 0.95, 0, 255)
        b' = clamp(lum * 0.50, 0, 255)
    Maps a "dark green" pixel (~ [0,89,20]) to a "dark brown" pixel
    (~ [69, 41, 22]) — that's a believable skin tone for a black
    character with similar luminance.
    """
    rgb_f = rgb.astype(np.float32)
    r = rgb_f[..., 0]
    g = rgb_f[..., 1]
    b = rgb_f[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    out = rgb_f.copy()
    out[..., 0] = np.where(mask, np.clip(lum * 1.6, 0, 255), r)
    out[..., 1] = np.where(mask, np.clip(lum * 0.95, 0, 255), g)
    out[..., 2] = np.where(mask, np.clip(lum * 0.50, 0, 255), b)
    return np.clip(out, 0, 255).astype(np.uint8)


def process_frame(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr)
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.full(arr.shape[:2] + (1,), 255, np.uint8)], axis=2)
    rgb = arr[..., :3].copy()
    a = arr[..., 3]

    r = rgb[..., 0].astype(np.int32)
    g = rgb[..., 1].astype(np.int32)
    b = rgb[..., 2].astype(np.int32)

    # The "spill" pixels:
    #  - alpha > 0 (so they're not already fully-transparent bg)
    #  - green-dominant (g significantly > r and > b)
    #  - not the dark jacket (luminance must be > 25 to avoid
    #    converting near-black jacket pixels that happen to have
    #    g slightly > r for some reason)
    # Threshold on alpha too: don't convert pixels at alpha<32 —
    # they're already on their way out. The spill is mostly at
    # alpha=128 (the half-pixel halo) and at alpha=255 (rare
    # over-saturation) so we want both.
    # The "spill" pixels: anywhere within the figure's silhouette
    # (alpha > 0) where green is the dominant or co-dominant
    # channel relative to red. Black skin has r > g > b. A skin
    # pixel where g >= r is wrong — that's greenspill bleeding
    # into the face. Catch them all.
    spill = (a > 0) & (g >= r) & (g > b) & (g > 30) & (a >= 32)
    if spill.any():
        rgb = green_to_skin(rgb, spill)
        # Promote alpha of converted spill to 255 so the brown halo
        # is solid colour rather than 50%-alpha blending. The
        # figure outline is already defined by its alpha=255
        # layer; promoting the alpha=128 spill to 255 just kills
        # the green-tinted semi-transparent halo without softening
        # the silhouette further.
        a_out = a.copy()
        a_out[spill] = 255
        return np.concatenate([rgb, a_out[..., None]], axis=-1).astype(np.uint8)

    return np.concatenate([rgb, a[..., None]], axis=-1).astype(np.uint8)


def main():
    if not os.path.exists(SRC):
        print(f"Source not found: {SRC}", file=sys.stderr)
        sys.exit(1)
    img = Image.open(SRC)
    n_total = getattr(img, "n_frames", 1)
    print(f"Source webp has {n_total} frames; processing first {N_FRAMES}")

    os.makedirs(OUT_DIR, exist_ok=True)
    saved = 0
    for fi in range(N_FRAMES):
        try:
            img.seek(fi)
        except EOFError:
            print(f"  frame {fi+1:02d}: only {n_total} frames in webp; stopping here")
            break
        arr = np.array(img.convert("RGBA"))
        if arr.shape[:2] != (FRAME_H, FRAME_W):
            print(f"  frame {fi+1:02d}: unexpected shape {arr.shape}, skipping")
            continue
        keyed = process_frame(arr)
        out_path = os.path.join(OUT_DIR, f"frame_{fi+1:02d}.png")
        Image.fromarray(keyed, "RGBA").save(out_path)
        op = (keyed[..., 3] > 128).sum()
        print(f"  frame {fi+1:02d}: opaque={op:5d} -> {out_path}")
        saved += 1
    print(f"Saved {saved} frames to {OUT_DIR}/")


if __name__ == "__main__":
    main()
