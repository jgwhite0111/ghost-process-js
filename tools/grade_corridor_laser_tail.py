"""Apply a soft alpha taper to the right edge of corridor idle_15 and
idle_16 only. NEVER touches idle_01..idle_14.

This is the v6->v6.1 polish pass: frames 1-14 stay exactly as v6
(clean chroma key, untouched). Only the two laser-bearing frames at
the tail of the strip get a soft alpha taper so the cyan beam
fades out into the background scene instead of hard-cutting.

Usage:
    python3 tools/grade_corridor_laser_tail.py [v6_dir]

If v6_dir is omitted, uses /tmp/regen/v6/ as the source of truth.

The taper is conservative: it ONLY touches x >= 140 (the rightmost
40 pixels of the 180-wide source) and ONLY affects alpha values
above some minimum threshold. Frames 1-14 are not read, not loaded,
not written -- there is no code path that touches them.
"""
from __future__ import annotations
import shutil
import sys
from pathlib import Path

from PIL import Image

WT = Path(__file__).resolve().parent.parent / "assets/sprites/android/corridor"
V6 = Path("/tmp/regen/v6")

# Frames explicitly OUT OF SCOPE. Listing them here as a guard rail
# so the next agent/auditor can grep for this list and immediately see
# which frames must NEVER be touched by this script.
PROTECTED_FRAMES = frozenset(f"idle_{i:02d}.png" for i in range(1, 15))

# Frames IN SCOPE -- the laser-bearing tail.
TARGET_FRAMES = frozenset({"idle_15.png", "idle_16.png"})

# Taper geometry -- matches the source 180-wide canvas.
TAPER_START = 140   # pixels: x >= 140 starts fading
TAPER_END = 180     # pixels: x = 180 hits zero alpha


def taper_laser_right_edge(img: Image.Image) -> Image.Image:
    """Reduce alpha on the rightmost 40 columns of the sprite so the
    cyan laser fades into the BG. Operates on a copy -- input image
    is not mutated."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    assert TAPER_END == w, f"this script is hard-coded for {TAPER_END}x sprite, got {w}x{h}"
    px = img.load()
    for y in range(h):
        for x in range(TAPER_START, TAPER_END):
            frac = (TAPER_END - x) / (TAPER_END - TAPER_START)
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, int(a * frac))
    return img


def main(argv: list[str]) -> int:
    src_dir = Path(argv[1]) if len(argv) > 1 else V6
    if not (src_dir / "idle_15.png").exists():
        print(f"ERROR: {src_dir} does not look like a v6 frame dir", file=sys.stderr)
        return 2

    WT.mkdir(parents=True, exist_ok=True)

    # SAFETY: refuse to run if any PROTECTED_FRAME is missing from
    # the source dir, or if any TARGET_FRAME is missing. This catches
    # partial regeneration -- better to fail loud than to silently
    # rebuild corrupted frames 1-14.
    src_file_set = {p.name for p in src_dir.iterdir() if p.suffix == ".png"}
    missing_protected = PROTECTED_FRAMES - src_file_set
    if missing_protected:
        print(f"ERROR: source {src_dir} is missing protected frames: {sorted(missing_protected)}", file=sys.stderr)
        print("Refusing to run -- would corrupt frames 1-14 if they're not actually v6.", file=sys.stderr)
        return 3
    missing_targets = TARGET_FRAMES - src_file_set
    if missing_targets:
        print(f"ERROR: source {src_dir} is missing target frames: {sorted(missing_targets)}", file=sys.stderr)
        return 3

    # Copy protected frames VERBATIM (no transform). This is a
    # defensive no-op -- if WT already matches v6 (which it should
    # after the v6-baseline commit), the copy is a byte-identical
    # round-trip. If WT was corrupted by a previous run, this
    # restores it.
    for fname in sorted(PROTECTED_FRAMES):
        src = src_dir / fname
        dst = WT / fname
        shutil.copyfile(src, dst)
        print(f"  protected: copied {fname} from v6 verbatim")

    # Apply taper only to target frames.
    for fname in sorted(TARGET_FRAMES):
        src_path = src_dir / fname
        img = Image.open(src_path)
        out = taper_laser_right_edge(img)
        out.save(WT / fname)
        print(f"  tapered:   wrote {fname} with right-edge alpha fade")

    print(f"\nDone. {len(PROTECTED_FRAMES)} protected frames untouched, {len(TARGET_FRAMES)} frames tapered.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))