#!/usr/bin/env python3
"""
build_terminal_ui_v2.py — re-do the terminal_ui wallpaper and icons with
better aesthetics:

  - scene_terminal_ui_wallpaper.png : a clean dark-teal PC-98 desktop
    wallpaper. Subtle radial vignette, horizontal scanlines, a faint
    corporate mark in one corner. No CRT hardware visible.

  - icons/isometric/*.png : the five app icons, redrawn as small
    pixel-art icons with explicit depth shading (light top-left, dark
    bottom-right, simulated highlight strip). The CSS layer adds an
    isometric tilt on top.

The previous Grok attempt produced a landscape photo. PIL gives us
deterministic, period-correct pixel art in milliseconds.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math

REPO = Path("/Users/jwhite/ghost-process-js")
WALLPAPER_OUT = REPO / "assets/backgrounds/scene_terminal_ui_wallpaper.png"
ICON_DIR = REPO / "assets/icons/isometric"
ICON_DIR.mkdir(parents=True, exist_ok=True)

# PC-98 / lab_clinic palette
COL = {
    "bg_deep":    (12, 28, 32),
    "bg_mid":     (28, 60, 68),
    "bg_lit":     (48, 96, 104),
    "shadow":     (8, 18, 20),
    "cyan":       (80, 200, 200),
    "cyan_bright":(140, 232, 232),
    "green":      (160, 220, 100),
    "red":        (204, 32, 32),
    "red_dk":     (140, 16, 16),
    "gold":       (204, 168, 60),
    "gold_dk":    (140, 100, 32),
    "white":      (252, 252, 248),
    "near_black": (16, 16, 24),
}


# ============================================================
# Wallpaper
# ============================================================

def make_wallpaper(w=1152, h=864):
    """Dark teal PC-98 desktop background:
    - radial vignette (slightly lighter near top-left)
    - horizontal scanlines every 3px
    - faint corporate mark in the bottom-right corner
    - subtle CRT glow around the edges
    """
    img = Image.new("RGB", (w, h), COL["bg_deep"])
    px = img.load()

    # Radial vignette — brighter near upper-left, fading darker to lower-right.
    cx, cy = int(w * 0.35), int(h * 0.30)
    max_r = math.hypot(w, h)
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy)
            t = min(1.0, d / max_r)
            # Interpolate bg_deep -> bg_lit by inverse distance
            k = 1.0 - t
            r = int(COL["bg_deep"][0] + (COL["bg_lit"][0] - COL["bg_deep"][0]) * k * 0.45)
            g = int(COL["bg_deep"][1] + (COL["bg_lit"][1] - COL["bg_deep"][1]) * k * 0.45)
            b = int(COL["bg_deep"][2] + (COL["bg_lit"][2] - COL["bg_deep"][2]) * k * 0.45)
            px[x, y] = (r, g, b)

    # Horizontal scanlines — slightly darker every 3 rows.
    for y in range(0, h, 3):
        for x in range(w):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r - 8), max(0, g - 6), max(0, b - 6))

    # Edge glow: subtle cyan tint along the inner perimeter.
    glow = 24  # px
    for x in range(w):
        for d in range(glow):
            t = 1.0 - d / glow
            k = t * 12
            # top
            r, g, b = px[x, d]
            px[x, d] = (min(255, r + int(k * 0.4)), min(255, g + int(k * 1.2)), min(255, b + int(k * 1.2)))
            # bottom
            r, g, b = px[x, h - 1 - d]
            px[x, h - 1 - d] = (min(255, r + int(k * 0.4)), min(255, g + int(k * 1.2)), min(255, b + int(k * 1.2)))
    for y in range(h):
        for d in range(glow):
            t = 1.0 - d / glow
            k = t * 8
            r, g, b = px[d, y]
            px[d, y] = (min(255, r + int(k * 0.3)), min(255, g + int(k * 0.9)), min(255, b + int(k * 0.9)))
            r, g, b = px[w - 1 - d, y]
            px[w - 1 - d, y] = (min(255, r + int(k * 0.3)), min(255, g + int(k * 0.9)), min(255, b + int(k * 0.9)))

    # Faint corporate mark in the bottom-right corner — concentric arcs
    # + a tiny serial number. Very low contrast.
    d = ImageDraw.Draw(img)
    mark_cx, mark_cy = w - 96, h - 80
    for r in (40, 50, 60, 70, 80):
        d.arc((mark_cx - r, mark_cy - r, mark_cx + r, mark_cy + r),
              start=200, end=340, fill=(36, 76, 84), width=1)
    # Crosshair through it
    d.line((mark_cx - 50, mark_cy, mark_cx + 50, mark_cy), fill=(40, 80, 88), width=1)
    d.line((mark_cx, mark_cy - 50, mark_cx, mark_cy + 50), fill=(40, 80, 88), width=1)
    # Tiny serial
    d.text((mark_cx - 24, mark_cy + 6), "K-7", fill=(48, 88, 96))

    return img


# ============================================================
# Isometric-style icons (depth-shaded, 48x48 for more detail)
# ============================================================

SIZE = 48

def new_icon():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def depth_shade(d, x0, y0, x1, y1, top_color, side_color, side_dark, side_shadow):
    """Draw a 'box' with light top face, slightly darker front, dark right."""
    # Top face (parallelogram — fake iso by skewing the top edge)
    top_h = 8  # height of top face
    # Light top face (parallelogram via 4 points)
    d.polygon([
        (x0 + 4, y0 + top_h),
        (x1 - 4, y0 + top_h),
        (x1 - 8, y0),
        (x0 + 8, y0),
    ], fill=top_color)
    # Front face
    d.rectangle([x0, y0 + top_h, x1, y1], fill=side_color)
    # Right side (darker, narrower for depth)
    d.polygon([
        (x1, y0 + top_h),
        (x1 - 8, y0),
        (x1 - 8, y0 + top_h),
        (x1, y1),
    ], fill=side_dark)
    # Outline
    d.rectangle([x0, y0 + top_h, x1, y1], outline=side_shadow, width=1)


def icon_log():
    """Notepad: yellow book with binding + lines."""
    img, d = new_icon()
    # Book base — light top, gold front, dark right
    depth_shade(d, 6, 10, 42, 42,
                top_color=COL["gold_dk"], side_color=COL["gold"],
                side_dark=(120, 80, 24), side_shadow=COL["near_black"])
    # Binding stripe across the top
    d.rectangle([6, 18, 42, 22], fill=COL["red_dk"])
    # Horizontal lines (text)
    for i in range(5):
        y = 25 + i * 3
        d.rectangle([10, y, 38, y + 1], fill=COL["near_black"])
    # Edge highlight (left side bright)
    d.line([(6, 18), (6, 42)], fill=(244, 200, 76), width=1)
    return img


def icon_email():
    """Envelope: cyan paper, gold seal."""
    img, d = new_icon()
    depth_shade(d, 4, 12, 44, 40,
                top_color=(80, 140, 140), side_color=COL["cyan"],
                side_dark=(40, 100, 100), side_shadow=COL["near_black"])
    # Flap (V from top corners to center)
    d.polygon([(4, 12), (44, 12), (24, 28)], fill=COL["bg_mid"])
    d.line([(4, 12), (24, 28), (44, 12)], fill=COL["near_black"], width=1)
    # Wax seal (red dot)
    d.ellipse([(18, 26), (30, 38)], fill=COL["red"])
    d.ellipse([(18, 26), (30, 38)], outline=COL["near_black"], width=1)
    # Seal highlight
    d.ellipse([(20, 27), (23, 30)], fill=(240, 80, 80))
    return img


def icon_crew():
    """File cabinet / database — three stacked drawers in green."""
    img, d = new_icon()
    depth_shade(d, 6, 8, 42, 44,
                top_color=COL["green"], side_color=(120, 168, 76),
                side_dark=(80, 120, 50), side_shadow=COL["near_black"])
    # 3 drawers
    for i in range(3):
        y0 = 12 + i * 11
        y1 = y0 + 8
        d.rectangle([9, y0, 39, y1], fill=COL["shadow"])
        d.rectangle([9, y0, 39, y1], outline=COL["near_black"], width=1)
        # Handle (gold dot)
        d.rectangle([21, y0 + 3, 27, y0 + 5], fill=COL["gold"])
        d.rectangle([21, y0 + 3, 27, y0 + 5], outline=COL["near_black"], width=1)
    return img


def icon_map():
    """Blueprint: cyan paper, grid lines, crosshair."""
    img, d = new_icon()
    depth_shade(d, 4, 8, 44, 44,
                top_color=(56, 100, 108), side_color=COL["bg_lit"],
                side_dark=(28, 60, 68), side_shadow=COL["near_black"])
    # Grid lines on the front face
    for x in range(8, 44, 4):
        d.line([(x, 16), (x, 44)], fill=COL["cyan"], width=1)
    for y in range(16, 44, 4):
        d.line([(4, y), (44, y)], fill=COL["cyan"], width=1)
    # Crosshair center
    d.line([(12, 30), (36, 30)], fill=COL["red"], width=1)
    d.line([(24, 20), (24, 40)], fill=COL["red"], width=1)
    d.ellipse([(22, 28), (26, 32)], fill=COL["red"])
    # Corner ticks
    for cx, cy in [(8, 16), (40, 16), (8, 44), (40, 44)]:
        d.rectangle([cx, cy, cx + 2, cy + 2], fill=COL["gold"])
    return img


def icon_sysinfo():
    """Settings: red gear with 4 teeth + center hole + dot pattern."""
    img, d = new_icon()
    depth_shade(d, 4, 4, 44, 44,
                top_color=(160, 32, 32), side_color=COL["red"],
                side_dark=(100, 16, 16), side_shadow=COL["near_black"])
    # Center hole
    d.ellipse([(16, 16), (32, 32)], fill=COL["shadow"])
    d.ellipse([(16, 16), (32, 32)], outline=COL["near_black"], width=1)
    # 4 small gold dots in center
    for cx, cy in [(18, 18), (28, 18), (18, 28), (28, 28)]:
        d.rectangle([cx, cy, cx + 2, cy + 2], fill=COL["gold"])
    # 4 small notch indicators on edges (gear teeth feel)
    for cx, cy, w, h in [(18, 4, 6, 4), (18, 44, 6, 4),
                          (4, 18, 4, 6), (44, 18, 4, 6)]:
        d.rectangle([cx, cy, cx + w, cy + h], fill=COL["red_dk"])
        d.rectangle([cx, cy, cx + w, cy + h], outline=COL["near_black"], width=1)
    return img


def icon_door():
    """Door (for the EXIT button). White door + red arrow."""
    img, d = new_icon()
    depth_shade(d, 6, 6, 38, 44,
                top_color=(200, 200, 200), side_color=COL["white"],
                side_dark=(160, 160, 160), side_shadow=COL["near_black"])
    # Door inset (darker panel)
    d.rectangle([10, 14, 34, 40], fill=COL["bg_mid"])
    d.rectangle([10, 14, 34, 40], outline=COL["near_black"], width=1)
    # Arrow pointing right (out of door)
    d.polygon([(34, 22), (44, 22), (40, 18), (44, 22), (40, 26)],
              fill=COL["red"])
    d.polygon([(34, 22), (44, 22), (40, 18), (44, 22), (40, 26)],
              outline=COL["near_black"])
    # Door handle
    d.rectangle([28, 24, 30, 30], fill=COL["gold"])
    return img


ICONS = {
    "log": icon_log,
    "email": icon_email,
    "crew": icon_crew,
    "map": icon_map,
    "sysinfo": icon_sysinfo,
    "exit": icon_door,
}


def main():
    # Wallpaper
    wp = make_wallpaper()
    wp.save(WALLPAPER_OUT)
    print(f"wrote {WALLPAPER_OUT} ({WALLPAPER_OUT.stat().st_size} bytes, {wp.size})")

    # Icons
    for name, fn in ICONS.items():
        img = fn()
        path = ICON_DIR / f"{name}.png"
        img.save(path)
        print(f"wrote {path} ({path.stat().st_size} bytes, {img.size})")


if __name__ == "__main__":
    main()