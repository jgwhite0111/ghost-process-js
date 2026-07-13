"""Extract transparent keyframes from raw corridor android MP4.

Pipeline:
  1. cv2 reads the MP4, samples N evenly-spaced frames.
  2. np_despill + chroma key (green BG) → transparent RGBA frames
     written to transparent_sprites/frame_NN.png.
  3. Install pass: figure-trimmed aspect-preserving shrink into
     the runtime canvas (sibling of raw/, NOT raw/processed/).

Why step 3 trims transparent padding first:
  The source MP4 frames have large transparent margins (extracted from
  the green BG). If we shrink the WHOLE frame (including the empty
  margins) to fit the runtime canvas, the figure ends up with extra
  transparent space around it AND its width-fit calculation treats the
  padding as figure — arm gets cropped.

  Instead: trim transparent padding → get tight bbox of just the
  figure → shrink THAT to fit the runtime canvas height → paste-centre.
  Now the figure fills the slot naturally and nothing gets cropped.

Layout:
  <sprite>/raw/
    corridor.mp4                ← source (kept in repo for reproducibility)
    sprite_extractor.py         ← this file
    transparent_sprites/        ← step 2 output (160x280-ish RGBA, tight)
      frame_00.png .. frame_15.png
  <sprite>/                     ← step 3 output (runtime strip)
    frame_01.png .. frame_16.png
"""

import cv2
import numpy as np
from PIL import Image
from pathlib import Path
import sys, shutil, datetime, os

# ── Pipeline config ──────────────────────────────────────────────────
SRC_MP4 = Path(__file__).parent / "i2v_clip_android_corridor.mp4"  # 1280x1260 MP4 source
TRANSPARENT_DIR = Path(__file__).parent / "transparent_sprites"
RUN_TIME_TARGET = (180, 320)                            # legacy slot
N_FRAMES = 16
SRC_FPS = 4.0                                           # animation speed

# Chroma-key config (tuned per asset):
# chase: --black-threshold 5; corridor: green-screen BG (default).
KEY_MODE = "green"
KEY_SIMILARITY = 0.42
KEY_SPILL_SIM = 0.10


def chroma_key_green(rgb: np.ndarray, similarity: float, spill_similarity: float):
    """Green-screen BG removal. Returns (rgba, keep_mask, despill_mask).

    Uses HSV distance from the BG colour (median of corner pixels).
    NOTE: not used directly — `_chroma_key_pil` is the path that actually
    runs in the corridor pipeline. This stub lives here so the file
    imports clean for downstream tests.
    """
    raise NotImplementedError("Use _chroma_key_pil inline in extract_frames().")


def extract_frames():
    cap = cv2.VideoCapture(str(SRC_MP4))
    if not cap.isOpened():
        sys.exit(f"FAIL: cannot open {SRC_MP4}")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_fps = cap.get(cv2.CAP_PROP_FPS)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Source MP4: {src_w}x{src_h}, {total} frames, {src_fps:.2f} fps")

    # Pick 16 evenly-spaced source frames (skip the very first which can be setup).
    indices = np.linspace(1, total - 2, N_FRAMES, dtype=int)

    TRANSPARENT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for out_idx, src_idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(src_idx))
        ok, bgr = cap.read()
        if not ok:
            print(f"  WARN: read failed at src_idx={src_idx}")
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgba = _chroma_key_pil(rgb, KEY_SIMILARITY, KEY_SPILL_SIM)
        out = TRANSPARENT_DIR / f"frame_{out_idx:02d}.png"
        Image.fromarray(rgba, "RGBA").save(out)
        written += 1
    cap.release()
    print(f"  Extracted {written} transparent frames → {TRANSPARENT_DIR}")
    return written


def _chroma_key_pil(rgb: np.ndarray, similarity: float, spill_similarity: float) -> np.ndarray:
    """Green-key with HSV-band distance. Matches helpers in
    tools/key_sprite.py:chroma_key_green_pil.

    similarity is the fractional HSV-distance threshold below which a
    pixel is fully keyed (alpha → 0). Pixels between similarity and
    spill_similarity are partially keyed (linear ramp on alpha).
    """
    h, w, _ = rgb.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = 255

    # Sample median BG colour from the 4 corners (assumed green-screen).
    patches = []
    for y0, x0 in [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]:
        patch = rgb[y0:y0 + 16, x0:x0 + 16].reshape(-1, 3).astype(np.float32)
        patches.append(patch)
    samples = np.concatenate(patches, axis=0)
    bg_rgb = np.median(samples, axis=0)
    print(f"    BG colour (median corners): RGB={bg_rgb.astype(int).tolist()}")

    # Per-pixel HSV
    px = rgb.astype(np.float32) / 255.0
    pix_hsv = np.zeros_like(px)
    mx = px.max(axis=2)
    mn = px.min(axis=2)
    delta = mx - mn + 1e-9
    pix_hsv[..., 2] = mx
    pix_hsv[..., 1] = delta / (mx + 1e-9)
    rc = (mx - px[..., 0]) / delta
    gc = (mx - px[..., 1]) / delta
    bc = (mx - px[..., 2]) / delta
    pix_hsv[..., 0] = np.where(
        mx == px[..., 0], bc - gc,
        np.where(mx == px[..., 1], 2.0 + rc - bc, 4.0 + gc - rc),
    )
    pix_hsv[..., 0] = (pix_hsv[..., 0] / 6.0) % 1.0

    bg_px = bg_rgb.astype(np.float32).reshape(1, 1, 3) / 255.0
    bg_mx = bg_px.max(axis=2)[0, 0]
    bg_mn = bg_px.min(axis=2)[0, 0]
    bg_delta = bg_mx - bg_mn + 1e-9
    bg_hsv = np.zeros((1, 1, 3), dtype=np.float32)
    bg_hsv[0, 0, 2] = bg_mx
    bg_hsv[0, 0, 1] = bg_delta / (bg_mx + 1e-9)
    if bg_mx == bg_px[0, 0, 0]:
        bg_hsv[0, 0, 0] = ((bg_px[0, 0, 2] - bg_px[0, 0, 1]) / bg_delta) / 6.0 % 1.0
    elif bg_mx == bg_px[0, 0, 1]:
        bg_hsv[0, 0, 0] = (2.0 + (bg_px[0, 0, 0] - bg_px[0, 0, 2]) / bg_delta) / 6.0 % 1.0
    else:
        bg_hsv[0, 0, 0] = (4.0 + (bg_px[0, 0, 1] - bg_px[0, 0, 0]) / bg_delta) / 6.0 % 1.0

    # Hue distance (circular)
    dh = np.abs(pix_hsv[..., 0] - bg_hsv[0, 0, 0])
    dh = np.minimum(dh, 1.0 - dh) * 2.0  # 0..1
    # Saturation + value distance
    ds = pix_hsv[..., 1] - bg_hsv[0, 0, 1]
    dv = pix_hsv[..., 2] - bg_hsv[0, 0, 2]
    dist = np.sqrt(dh * dh + ds * ds + dv * dv)

    # Alpha ramp: fully transparent where dist <= similarity, fully opaque
    # where dist >= spill_similarity, linear between.
    sim = float(similarity)
    spill = float(spill_similarity)
    if spill < sim:
        spill = sim + 1e-3
    alpha = np.clip((dist - sim) / (spill - sim), 0.0, 1.0)
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return rgba


def install_to_runtime():
    """Step 3: shrink the transparent frames to the runtime canvas.

    Strategy:
      1. Trim transparent padding → tight figure bbox.
      2. Scale so figure height == *target* height (RUNTIME_HEIGHT).
      3. Figure's width is determined by its own aspect — the canvas
         auto-grows to width TARGET_W if the figure fits, OR to
         figure_w if the figure is wider than the legacy slot.
      4. Paste centred; if figure is wider than TARGET_W, it bleeds
         off both sides equally (no arm chopped off).

    This means the figure keeps its true aspect. Canvas size is
    *target*, not absolute — see docstring at top of file.
    """
    import shutil, datetime

    transparent_dir = Path(TRANSPARENT_DIR).resolve()
    corridor_dir = transparent_dir.parent.parent
    corridor_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path(f"/private/tmp/WT_pre_corridor_install_{ts}")
    if any(corridor_dir.glob("frame_*.png")):
        backup_dir.mkdir(parents=True, exist_ok=True)
        for f in corridor_dir.glob("frame_*.png"):
            shutil.copy2(f, backup_dir / f.name)
        print(f"Backed up existing corridor strip to {backup_dir}")

    target_w, target_h = RUN_TIME_TARGET  # (180, 320) — a target, not absolute
    installed = 0
    for src_path in sorted(transparent_dir.glob("frame_*.png")):
        idx = int(src_path.stem.split("_")[1])
        frame_n = idx + 1
        if not (1 <= frame_n <= 16):
            continue
        im = Image.open(src_path).convert("RGBA")
        arr = np.array(im)
        a = arr[..., 3]
        ys, xs = np.where(a > 8)
        if len(ys) == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        tight = im.crop((x0, y0, x1 + 1, y1 + 1))
        tight_w, tight_h = tight.size
        # Target height is fixed; target width is the figure's own
        # width at that height + padding so the arms never touch the
        # canvas edge. Padding H_SCALE_X handles wide figures with
        # outstretched arms (ball-frames).
        scale = target_h / tight_h
        new_h = target_h
        figure_w = max(1, int(round(tight_w * scale)))
        # Pad figure width so figure doesn't touch horizontal edges.
        # If figure is already wider than target_w, give it some
        # canvas breathing room by adding margin on the sides via
        # a wider target canvas (the runtime uses img.width).
        pad = max(12, int(round(figure_w * 0.06)))  # at least 12px, or 6% of width
        new_w = figure_w + 2 * pad
        # Centre the figure horizontally with pad of transparent pixels
        # on each side — arms can never spill off canvas because we
        # sized the canvas to fit.
        shrunk = tight.resize((figure_w, new_h), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))
        canvas.paste(shrunk, (pad, 0), shrunk)
        dst = corridor_dir / f"frame_{frame_n:02d}.png"
        canvas.save(dst)
        installed += 1
    print(f"  Installed {installed} sprites into {corridor_dir} "
          f"(target {target_w}x{target_h}).")
    return installed


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "install-only":
        install_to_runtime()
    else:
        written = extract_frames()
        if written > 0:
            install_to_runtime()
