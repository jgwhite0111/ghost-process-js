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
HALO_RADIUS = 1  # pixels — erode the brown halo within this distance
                   # of any transparent neighbour


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
    else:
        a_out = a.copy()

    # Halo erosion: any opaque pixel within HALO_RADIUS px of a
    # transparent pixel is part of the brown halo outline and gets
    # wiped to transparency. This erodes the post-conversion
    # "brownscreen outline" so it doesn't read as a solid brown
    # rim around the silhouette in-game.
    #
    # The 5px radius is implemented by checking each opaque pixel
    # against a 5px-disk of its neighbours; if ANY neighbour is
    # alpha=0 (or its converted-spill counterpart is) then this
    # pixel is on the halo boundary and gets dropped.
    #
    # We use a simple but exact approach: scan ±HALO_RADIUS rows
    # and columns, mark any opaque cell that has a transparent
    # cell in that window. This avoids needing scipy's cKDTree or
    # binary_dilation and runs in milliseconds for 180x320 frames.
    a_out = erode_halo(a_out, radius=HALO_RADIUS)

    return np.concatenate([rgb, a_out[..., None]], axis=-1).astype(np.uint8)


def erode_halo(a: np.ndarray, radius: int = 5) -> np.ndarray:
    """Return alpha with any opaque pixel that is within `radius`
    pixels of an alpha=0 neighbour erased to alpha=0.

    Algorithm: a pixel P at (r, c) is "halo" if there exists some
    (dr, dc) with dr² + dc² <= radius² such that a[r+dr, c+dc] == 0.

    Implemented with a 2D walk over the disk — for each radius
    band we check the four arc points (and the full inner box on
    radius=1) which is equivalent to a Euclidean disk thanks to
    4-fold symmetry. For correctness we just iterate the inner
    (2r+1)x(2r+1) box and check the squared-distance, which is
    O(r²) per pixel = ~100 ops per pixel for r=5 = O(320k) per
    180x320 frame. Fast enough at human iteration speed.
    """
    out = a.copy()
    H, W = a.shape
    # Pre-compute the integer (dr, dc) offsets that satisfy
    # dr² + dc² <= radius². For radius=5 this is ~81 offsets.
    offs = [(dr, dc)
            for dr in range(-radius, radius + 1)
            for dc in range(-radius, radius + 1)
            if dr * dr + dc * dc <= radius * radius and (dr or dc)]
    transparent = (a == 0)
    for dr, dc in offs:
        # transparent shifted by (dr, dc) on the original alpha
        if dr < 0:
            rows_t = slice(-dr, H)
            rows_o = slice(0, H + dr)
        elif dr > 0:
            rows_t = slice(0, H - dr)
            rows_o = slice(dr, H)
        else:
            rows_t = slice(0, H)
            rows_o = slice(0, H)
        if dc < 0:
            cols_t = slice(-dc, W)
            cols_o = slice(0, W + dc)
        elif dc > 0:
            cols_t = slice(0, W - dc)
            cols_o = slice(dc, W)
        else:
            cols_t = slice(0, W)
            cols_o = slice(0, W)
        # Pixels that are opaque at (rows_o, cols_o) AND have a
        # transparent pixel at offset (-dr, -dc) from them.
        halo_here = transparent[rows_t, cols_t] & (a[rows_o, cols_o] > 0)
        # Don't re-promote already-transparent pixel to opaque
        # by setting just the cells we computed:
        window = out[rows_o, cols_o]
        window = np.where(halo_here, 0, window)
        out[rows_o, cols_o] = window
    return out


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
