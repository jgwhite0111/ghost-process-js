#!/usr/bin/env python3
"""
build_terminal_ui_icons.py — generate 32x32 token icons in PC-98 palette
for the terminal_ui desktop.

Saves to assets/icons/ (created if missing):
  log.png      notepad w/ lines (gold, captain's log)
  email.png    envelope (cyan, dispatch)
  crew.png     file cabinet / database (green, personnel)
  map.png      blueprint grid (cyan, schematic)
  sysinfo.png  gear / status (red, system)
  exit.png     door / arrow-out (white, exit)
  app.png      generic file (fallback)

All icons drawn at 32x32 with hard pixels (no antialias), ready to be
scaled up via CSS image-rendering: pixelated.
"""
from PIL import Image, ImageDraw
from pathlib import Path

REPO = Path("/Users/jwhite/ghost-process-js")
OUT_DIR = REPO / "assets/icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# PC-98 / lab_clinic palette
COL = {
    "bg_deep":    (12, 28, 32),
    "bg_mid":     (28, 60, 68),
    "shadow":     (8, 18, 20),
    "cyan":       (80, 200, 200),
    "green":      (160, 220, 100),
    "red":        (204, 32, 32),
    "red_dk":     (140, 16, 16),
    "gold":       (204, 168, 60),
    "white":      (252, 252, 248),
    "near_black": (16, 16, 24),
}


def new_icon(size=32):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def draw_pixel(d, x, y, color, size=32):
    if 0 <= x < size and 0 <= y < size:
        d.point((x, y), fill=color)


def fill_rect(d, x0, y0, x1, y1, color):
    d.rectangle([x0, y0, x1, y1], fill=color)


def icon_notepad():
    """Yellow notepad with horizontal lines and folded corner."""
    img, d = new_icon()
    # body
    fill_rect(d, 5, 4, 27, 28, COL["gold"])
    fill_rect(d, 5, 4, 27, 28, None)  # outline below
    d.rectangle([5, 4, 27, 28], outline=COL["near_black"])
    # binding stripe at top
    fill_rect(d, 5, 4, 27, 8, COL["red_dk"])
    # folded corner
    fill_rect(d, 22, 4, 27, 9, COL["bg_deep"])
    d.line([(22, 4), (27, 9)], fill=COL["near_black"])
    # horizontal lines (text)
    for i in range(5):
        y = 13 + i * 3
        fill_rect(d, 8, y, 24, y + 1, COL["near_black"])
    return img


def icon_envelope():
    """Cyan envelope with a sealed flap."""
    img, d = new_icon()
    # body
    fill_rect(d, 4, 8, 28, 26, COL["cyan"])
    d.rectangle([4, 8, 28, 26], outline=COL["near_black"])
    # flap (triangle from top edges to middle bottom)
    d.polygon([(4, 8), (28, 8), (16, 20)], fill=COL["bg_mid"])
    d.line([(4, 8), (16, 20), (28, 8)], fill=COL["near_black"])
    # wax seal-ish accent
    fill_rect(d, 14, 19, 18, 22, COL["red"])
    d.rectangle([14, 19, 18, 22], outline=COL["near_black"])
    return img


def icon_cabinet():
    """File cabinet / database - 3 stacked drawers in green."""
    img, d = new_icon()
    # body
    fill_rect(d, 6, 3, 26, 29, COL["green"])
    d.rectangle([6, 3, 26, 29], outline=COL["near_black"])
    # 3 drawers
    for i in range(3):
        y0 = 5 + i * 8
        y1 = y0 + 6
        fill_rect(d, 8, y0, 24, y1, COL["bg_deep"])
        d.rectangle([8, y0, 24, y1], outline=COL["near_black"])
        # drawer handle
        fill_rect(d, 14, y0 + 2, 18, y0 + 4, COL["gold"])
        d.rectangle([14, y0 + 2, 18, y0 + 4], outline=COL["near_black"])
    return img


def icon_blueprint():
    """Blueprint / schematic grid in cyan with corner markers."""
    img, d = new_icon()
    # paper background
    fill_rect(d, 5, 5, 27, 27, COL["bg_mid"])
    d.rectangle([5, 5, 27, 27], outline=COL["near_black"])
    # grid lines
    for x in range(9, 27, 4):
        d.line([(x, 5), (x, 27)], fill=COL["cyan"])
    for y in range(9, 27, 4):
        d.line([(5, y), (27, y)], fill=COL["cyan"])
    # crosshair center
    fill_rect(d, 15, 15, 17, 17, COL["red"])
    d.line([(11, 16), (21, 16)], fill=COL["red"])
    d.line([(16, 11), (16, 21)], fill=COL["red"])
    # corner markers
    for cx, cy in [(7, 7), (25, 7), (7, 25), (25, 25)]:
        fill_rect(d, cx, cy, cx + 1, cy + 1, COL["gold"])
    return img


def icon_gear():
    """Gear-like settings icon."""
    img, d = new_icon()
    # gear body (octagonal-ish via rect)
    fill_rect(d, 7, 7, 25, 25, COL["red"])
    d.rectangle([7, 7, 25, 25], outline=COL["near_black"])
    # 4 teeth (small rects on each side)
    for cx, cy, w, h in [(14, 2, 4, 4), (14, 26, 4, 4),
                          (2, 14, 4, 4), (26, 14, 4, 4)]:
        fill_rect(d, cx, cy, cx + w - 1, cy + h - 1, COL["red"])
        d.rectangle([cx, cy, cx + w - 1, cy + h - 1], outline=COL["near_black"])
    # center hole
    fill_rect(d, 13, 13, 19, 19, COL["bg_deep"])
    d.rectangle([13, 13, 19, 19], outline=COL["near_black"])
    # 4 small dots in corners of center
    for cx, cy in [(14, 14), (17, 14), (14, 17), (17, 17)]:
        draw_pixel(d, cx, cy, COL["gold"])
    return img


def icon_door():
    """Door / exit icon (white with arrow)."""
    img, d = new_icon()
    # doorframe
    fill_rect(d, 6, 4, 22, 28, COL["white"])
    d.rectangle([6, 4, 22, 28], outline=COL["near_black"])
    # door inset
    fill_rect(d, 9, 6, 19, 26, COL["bg_mid"])
    # arrow pointing right (out)
    d.polygon([(24, 16), (30, 16), (28, 12), (30, 16), (28, 20)],
              fill=COL["red"])
    # door handle
    fill_rect(d, 16, 14, 18, 18, COL["gold"])
    return img


def icon_generic():
    """Generic file icon."""
    img, d = new_icon()
    fill_rect(d, 7, 4, 25, 28, COL["bg_mid"])
    d.rectangle([7, 4, 25, 28], outline=COL["near_black"])
    # folded corner
    d.polygon([(20, 4), (25, 9), (20, 9)], fill=COL["bg_deep"])
    d.line([(20, 4), (25, 9)], fill=COL["near_black"])
    # 3 lines
    for i in range(3):
        y = 16 + i * 3
        fill_rect(d, 10, y, 22, y + 1, COL["white"])
    return img


ICONS = {
    "log": icon_notepad,
    "email": icon_envelope,
    "crew": icon_cabinet,
    "map": icon_blueprint,
    "sysinfo": icon_gear,
    "exit": icon_door,
    "app": icon_generic,
}


def main():
    for name, fn in ICONS.items():
        img = fn()
        path = OUT_DIR / f"{name}.png"
        img.save(path)
        print(f"wrote {path} ({path.stat().st_size} bytes, {img.size})")


if __name__ == "__main__":
    main()