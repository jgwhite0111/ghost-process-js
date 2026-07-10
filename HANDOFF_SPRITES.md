# SPRITE FIX HANDOFF — corridor android idle

**Created:** 2026-07-10 by the previous AI agent who made a mess.

**Project:** `~/ghost-process-js` (JS rebuild, vanilla JS + InkJS + Express, served at `:8765` via `npm start`).

**Read first:** `~/ghost-process-js/LEGACY.md` (project handoff). Then `~/ghost-process-js/AI-HANDOFF.md` if it exists.

---

## Raw source location (DO NOT HUNT)

The 141-frame green-screen MP4 source frames live at:

```
~/ghost-process-js/assets/sprites/android/_raw_source/
```

Contents:
- `frame_001.png` … `frame_141.png` (768×1364 RGBA each, vivid green screen `(17, 145, 42)`)
- `i2v_clip_android_corridor.mp4` (the original source video)

This directory is committed (untracked new dir but it's a sibling to the in-use
`corridor/` folder so it cannot be missed). The legacy location
`~/ghost-process-98/.wip-android-sprite/i2v_clip_android_corridor_frames/`
still exists but is not the canonical copy — **use `assets/sprites/android/_raw_source/`**.

### Frame → idle_*.png selection

This is the 16-frame selection (zero-indexed MP4 frame → 1-indexed sprite file):

| idle_*.png | MP4 frame | has laser at edge? |
|---|---|---|
| idle_01 | f002 | no |
| idle_02 | f005 | no |
| idle_03 | f008 | no |
| idle_04 | f010 | no |
| idle_05 | f015 | no |
| idle_06 | f020 | no |
| idle_07 | f025 | no |
| idle_08 | f030 | no |
| idle_09 | f040 | no |
| idle_10 | f050 | no |
| idle_11 | f060 | no |
| idle_12 | f076 | no |
| idle_13 | f096 | no |
| idle_14 | f116 | no |
| idle_15 | f136 | **YES** |
| idle_16 | f140 | **YES** |

If you need to re-key the strip from raw green screen, the function lives in
`tools/` somewhere — search for `chroma` or `key_green` in `tools/*.py` and `src/runtime/sprites.js`.

---

## TL;DR — what to do

The corridor android's idle animation has a hard-cut laser beam at the right edge of frames 15 and 16. Need to apply a soft alpha fade to only those two frames while keeping the rest of the 16-frame strip exactly as it is in `v6`. Do not touch anything else.

**Action plan (one step):**
1. Copy `idle_01.png` … `idle_14.png` from `/tmp/regen/v6/` to `~/ghost-process-js/assets/sprites/android/corridor/`
2. Take `v6` `idle_15.png` and `idle_16.png`, apply the taper function below, save to working tree.
3. Reload the game, verify the laser tapers cleanly at x=140→180.

Do not re-key any frame other than idle_15 / idle_16. The user has already complained three times about me re-keying the whole strip.

---

## Ground truth

### User's complaint (verbatim last 3)

1. "every frame has too much transparency. great work... sigh — why did you change every frame when i said just the frames with the laser?"
2. "even the laser frames still suffer from the same problem of left over green screen — the shade of the green just changed" (then retracted: "ignore that last comment about the shade of the green actually")
3. "its not much better and youve started making it overly transparent well before the laser even appears"
4. "thats not the problem — the fact its still clearly cropped by the edge of the animation sheet is — when i asked you to make it look more tapered/faded off and natural how a burst of energy would look"
5. "now youll have reverted all the chrome key so now it will just be a green block over the scene. congrats dipshit"

### What the user wants

- idle_01 .. idle_14 must look exactly like v6 (clean chroma key, no transparency issues, dark navy uniform, white beard intact, gold epaulettes, red sash)
- idle_15, idle_16 must have a **soft alpha taper** at the right edge of the canvas where the laser/energy beam exits — so it looks like an energy burst dissipating into the BG, not a hard crop

### Source frames in MP4

The 141-frame MP4 source has the laser-edge issue only in `frame_131` through `frame_141`. In the current selection of 16, those map to:

| Working-tree frame | MP4 frame | Has laser at edge? |
|---|---|---|
| idle_01 | f002 | no |
| idle_02 | f005 | no |
| idle_03 | f008 | no |
| idle_04 | f010 | no |
| idle_05 | f015 | no |
| idle_06 | f020 | no |
| idle_07 | f025 | no |
| idle_08 | f030 | no |
| idle_09 | f040 | no |
| idle_10 | f050 | no |
| idle_11 | f060 | no |
| idle_12 | f076 | no |
| idle_13 | f096 | no |
| idle_14 | f116 | no |
| **idle_15** | **f136** | **YES — laser at right edge** |
| **idle_16** | **f140** | **YES — laser at right edge** |

The exact selection list (from the previous agent's notes; confirm with `grep -A 5 '"corridor"' ~/ghost-process-js/story.json`) may need re-verification. But **only idle_15 and idle_16 have the laser-edge cropping problem**.

---

## Sprite candidates on disk — verified transparency ratios

Run this to regenerate:

```python
from PIL import Image
import subprocess
from pathlib import Path

dest_dir = "/Users/jwhite/ghost-process-js/assets/sprites/android/corridor"
def transparency(p):
    img = Image.open(p).convert("RGBA")
    a = img.split()[-1]
    return sum(1 for px in a.getdata() if px > 0) / img.size[0] / img.size[1] * 100

for i in range(1, 17):
    print(f"idle_{i:02d}:", end=" ")
    for label, path in [
        ("v3", f"/tmp/regen/v3/idle_{i:02d}.png"),
        ("v6", f"/tmp/regen/v6/idle_{i:02d}.png"),
        ("v9", f"/tmp/regen/v9/idle_{i:02d}.png"),
        ("WT", f"{dest_dir}/idle_{i:02d}.png"),
    ]:
        if Path(path).exists():
            print(f"{label}={transparency(path):.0f}%", end=" ")
    print()
```

Recorded survey (from previous session 2026-07-10):

| frame | v2 | v3 | v4 | v5 | **v6** | v7 | v8 | v9 | WT (HEAD) |
|---|---|---|---|---|---|---|---|---|---|
| idle_01 | 100% | 100% | 100% | 100% | **47%** | 61% | 61% | 54% | 58% ❌ |
| idle_02-idle_13 | 60-65% | 53-63% | 60-65% | 60-65% | **60-65%** | 60-65% | 60-65% | 50-57% | 58% ❌ |
| idle_14 | 59% | 54% | 59% | 59% | **59%** | 59% | 59% | 49% | 57% ❌ |
| **idle_15** | 58% | 47% | 58% | 58% | **58%** | 58% | 36% (over-faded) | 47% | 57% |
| **idle_16** | 56% | 46% | 56% | 56% | **56%** | 56% | 38% (over-faded) | 45% | 57% |

**Interpret this table:**
- **HEAD = 58% uniform, visually broken** (cyan-uniform bug — the user called this "green block over the scene"). DO NOT keep HEAD.
- **v2, v3 — unsafe** (v2 has halo bleed; v3 idle_01 is broken black-BG issue from frame_001).
- **v4, v5, v6, v7 — clean chroma**, look correct on the rest of the strip. v6 is the one the user accepted ("the animation itself is an improvement - it has keyed well"). Use v6 as the baseline.
- **v8 — over-faded laser taper** (alpha dropped to 36/38% on idle_15/16 — too much).
- **v9 — proper laser taper** but applied via a full strip re-key, which the user hated.

### What went wrong (so you don't repeat it)

I (the previous agent) applied three full-strip re-keys, each one making the user's "every frame too transparent" complaint worse. The bug is specifically:

1. The user's "the laser is cropped at the edge" complaint is correct only for idle_15 / idle_16. Earlier turns over-fixed it by re-keying all 16 frames.
2. The chroma key in v6/v7 already works for the rest of the strip. Re-running any chroma function on idle_01-idle_14 will subtly change them (because resize + chroma is not perfectly idempotent — LANCZOS resampling with binary alpha doesn't preserve exact pixels). The user notices.

---

## The taper function (use ONLY on idle_15 and idle_16)

```python
from PIL import Image

def taper_laser_right_edge(img, taper_start_x=140, taper_end_x=180):
    """Fade any opaque pixel past x=taper_start_x to alpha=0 at x=taper_end_x.
    Body silhouettes end well before x=140 in 180x320 sprites so this is safe.
    Energy bursts have multi-color afterglow (cyan core, orange/yellow envelope,
    white hotspots) so the taper MUST apply to all colors, not just cyan."""
    w, h = img.size
    out = img.copy()
    op = out.load()
    for x in range(w):
        if x < taper_start_x:
            continue
        # Linear frac: 1.0 at x=140, 0.0 at x=180
        frac = max(0.0, (taper_end_x - x) / (taper_end_x - taper_start_x))
        for y in range(h):
            r, g, b, a = op[x, y]
            if a == 0:
                continue
            new_alpha = int(round(a * frac))
            if new_alpha < a:
                op[x, y] = (r, g, b, new_alpha)
    return out

# Apply ONLY to v6 idle_15 and idle_16:
for i in [15, 16]:
    src = Image.open(f"/tmp/regen/v6/idle_{i:02d}.png").convert("RGBA")
    tapered = taper_laser_right_edge(src)
    tapered.save(f"/Users/jwhite/ghost-process-js/assets/sprites/android/corridor/idle_{i:02d}.png")
```

Then for idle_01 through idle_14, just copy from v6 untouched:

```python
import shutil
for i in range(1, 15):
    shutil.copy(
        f"/tmp/regen/v6/idle_{i:02d}.png",
        f"/Users/jwhite/ghost-process-js/assets/sprites/android/corridor/idle_{i:02d}.png",
    )
```

That's it. No chroma re-keying. No resize. No re-runs.

---

## Verification

After copying, run:

```bash
cd /Users/jwhite/ghost-process-js && python3 -c "
from PIL import Image
import os
for i in range(1, 17):
    img = Image.open(f'assets/sprites/android/corridor/idle_{i:02d}.png').convert('RGBA')
    a = img.split()[-1]
    opaque = sum(1 for p in a.getdata() if p > 0) / img.size[0] / img.size[1] * 100
    print(f'idle_{i:02d}: {opaque:.0f}% opaque')
"
```

Expected:
- idle_01: ~47%
- idle_02 - idle_14: ~58-65%
- idle_15: ~38-42% (lower because taper kills half the beam)
- idle_16: ~36-40%

### Visual check (use playwright/browser automation or have the user reload the game)

Tell the user to reload the game (cmd+shift+R), PRESS START, advance to the corridor scene. They should see:
- The android character with full body intact
- idle_15, idle_16 (the last frames of the one-shot) showing a soft cyan energy burst fading off at the right edge
- No hard vertical cut at x=180

### In-game debug helper

If the user wants to verify in-game without reloading, in the browser dev console:

```javascript
window.Engine.goTo('corridor');   // jumps to corridor scene
const c = window.__activeScene.characters[0];   // android
c.frameRate = 0;   // freeze frame advance
c._hasFiredOneShot = true;
c._phase = 2;   // DONE phase (frozen)
c.currentFrame = 14;   // 0-indexed → idle_15
c.elapsed = 999999;
c.setVisible(true); c.setSpeaking(true);
```

This skips the dialog and locks the character on idle_15 so you can verify the taper.

---

## If the taper curve is wrong

The user may want:

- **Longer fade (more gradual)** — change `taper_start_x = 130` so the taper starts further left
- **Shorter fade (abrupt end)** — change `taper_start_x = 155` so the taper only runs over the last 25 pixels
- **Exponential curve (snappier end)** — replace the linear `frac` with:

  ```python
  import math
  frac = math.exp(-3.0 * (x - taper_start_x) / (taper_end_x - taper_start_x)) if x >= taper_start_x else 1.0
  ```

  This makes the alpha drop fast then plateau — looks like a "core intensity" falloff.

Try linear first; only change shape if the user says it looks wrong.

---

## Files and locations

| Path | What |
|---|---|
| `~/ghost-process-js/LEGACY.md` | project handoff, read first |
| `~/ghost-process-js/story.json` | scene config (corridor/idle_*.png = android sprites) |
| `~/ghost-process-js/src/runtime/sprites.js` | runtime sprite loading + ping-pong logic |
| `~/ghost-process-js/assets/sprites/android/corridor/idle_01.png` … `idle_16.png` | the 16 sprite frames (180×320 RGBA) |
| `~/ghost-process-js/tools/test_corridor_render.py` | playwright bypass-title-screen test |
| `/tmp/regen/v6/` | **the user's accepted baseline** — clean chroma, healthy 60-65% opaque |
| `/tmp/regen/v9/` | laser taper but with full re-key (more transparent on idle_01..14) |
| `~/ghost-process-98/.wip-android-sprite/i2v_clip_android_corridor_frames/frame_001.png` … `frame_141.png` | the 141 MP4 source frames (768×1364 each, green BG `(17, 145, 42)`) |

---

## Do NOT do these (previous agent's mistakes)

- ❌ Do not re-key idle_01 to idle_14 with a different chroma function. v6 is the baseline; copy it untouched.
- ❌ Do not apply a taper that uses `is_laser = g > 150 AND r < g + 20` (cyan-only). Energy bursts have multi-color afterglow — orange, yellow, white. The taper must fade ALL colors in the right-edge region.
- ❌ Do not run the taper at source resolution (768×1364). The `taper_start_x=140` etc. assumes the final 180×320 sprite size. Run taper AFTER resize.
- ❌ Do not assume HEAD is the last good state. HEAD is the broken cyan-uniform version. Always check `/tmp/regen/v6/` first.

---

## Why HEAD is broken

Head was committed as a "pre-phaser-removal snapshot" — a back-up made BEFORE the chroma key work began. It contains the raw 16 frames with the original green-screen BG, but with a different chroma key applied (probably the `convicts` sprite's keyer from `src/runtime/sprites.js`'s `_despillGreen`) that does NOT properly handle the android's green halo. Result: every android looks like a cyan uniform.

If the user asks "why is HEAD broken?": the previous agent committed it as a snapshot before realizing the chroma keyer was scene-specific (written for a different sprite design).

---

## End of handoff. Good luck. Don't re-key what isn't broken.
