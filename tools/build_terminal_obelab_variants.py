#!/usr/bin/env python3
"""
build_terminal_obelab_variants.py — composite the 6 terminal_obelab BG variants
from the raw CRT-lab image.

Reads:
  assets/backgrounds/scene_terminal_obelab_crt.png  (1152x864)

Writes (sibling):
  scene_terminal_obelab_desktop.png
  scene_terminal_obelab_log_open.png
  scene_terminal_obelab_email_open.png
  scene_terminal_obelab_crew_open.png
  scene_terminal_obelab_map_open.png
  scene_terminal_obelab_sys_open.png

The CRT screen rectangle is at pixel ~(280..595, 280..480) of the source BG.
That's normalized ~(0.243..0.517, 0.324..0.556). Icons + window chrome live
inside that rectangle. Story.json hitboxes use the same normalized coords.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

REPO = Path("/Users/jwhite/ghost-process-js")
BG_PATH = REPO / "assets/backgrounds/scene_terminal_obelab_crt.png"
FONT_PATH = REPO / "assets/fonts/madou-futo-maru.ttf"

# lab_clinic palette (terminal_lab aliases lab_clinic)
COL = {
    "bg_deep":    (12, 28, 32),
    "bg_mid":     (28, 60, 68),
    "bg_lit":     (64, 100, 108),
    "shadow":     (8, 18, 20),
    "cyan":       (80, 200, 200),
    "green":      (160, 220, 100),
    "red":        (204, 32, 32),
    "red_dk":     (140, 16, 16),
    "gold":       (204, 168, 60),
    "white":      (252, 252, 248),
    "near_black": (16, 16, 24),
}

# CRT screen rectangle in pixels (within the 1152x864 source BG).
SCREEN_X, SCREEN_Y = 280, 280
SCREEN_W, SCREEN_H = 320, 200


def _load_bg():
    img = Image.open(BG_PATH).convert("RGB")
    assert img.size == (1152, 864), f"unexpected BG size {img.size}"
    return img


def _font(size):
    return ImageFont.truetype(str(FONT_PATH), size)


def draw_window_chrome(img, title):
    """Draw a PC-98 style window over the screen area. Returns the draw context
    so callers can write body text into the window."""
    d = ImageDraw.Draw(img)
    x, y, w, h = SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H
    # Outer dark border
    d.rectangle([x, y, x + w, y + h], outline=COL["near_black"], width=2)
    # Title bar
    d.rectangle([x + 1, y + 1, x + w - 1, y + 22], fill=COL["bg_mid"])
    # Title text
    d.text((x + 6, y + 5), title, font=_font(13), fill=COL["green"])
    # X close button
    d.rectangle([x + w - 18, y + 4, x + w - 4, y + 18], fill=COL["red"])
    d.text((x + w - 14, y + 5), "X", font=_font(11), fill=COL["white"])
    return d


def draw_icon(d, x, y, color):
    """Draw a PC-98 file icon at pixel (x, y), 36 px wide."""
    w, h = 36, 42
    # body
    d.rectangle([x, y, x + w, y + h], fill=color, outline=COL["near_black"])
    # folded corner (top-right triangle)
    d.polygon(
        [(x + w - 10, y), (x + w, y + 10), (x + w - 10, y + 10)],
        fill=COL["bg_deep"],
    )
    # tab stripe at top
    d.rectangle([x + 4, y + 4, x + 12, y + 8], fill=COL["near_black"])


def draw_text_lines(d, lines, *, x_off=10, y_off=30, line_height=15, font_size=13,
                    color=None, color_rule=None):
    """Write a sequence of text lines into the active window."""
    font = _font(font_size)
    for i, line in enumerate(lines):
        col = color or COL["cyan"]
        if color_rule:
            for needle, c in color_rule.items():
                if needle in line:
                    col = c
                    break
        d.text((SCREEN_X + x_off, SCREEN_Y + y_off + i * line_height),
               line, font=font, fill=col)


def variant_desktop(bg):
    img = bg.copy()
    d = ImageDraw.Draw(img)
    # Header bar at top of screen
    d.rectangle([SCREEN_X, SCREEN_Y, SCREEN_X + SCREEN_W, SCREEN_Y + 18],
                fill=COL["bg_mid"])
    d.text((SCREEN_X + 6, SCREEN_Y + 3),
           "OBE LAB-2 // SHIFT TERMINAL",
           font=_font(11), fill=COL["cyan"])
    d.text((SCREEN_X + SCREEN_W - 90, SCREEN_Y + 3),
           "03:14 LOCAL",
           font=_font(11), fill=COL["white"])
    # 2-col x 3-row icon grid — hitbox positions in normalized coords.
    # Same coords as story.json hitboxes.
    icons = [
        (0.260, 0.330, "SHIFT_LOG.txt", COL["gold"]),
        (0.395, 0.330, "DISPATCH.eml", COL["cyan"]),
        (0.260, 0.405, "CREW.rdb", COL["green"]),
        (0.395, 0.405, "SCHEMATIC.pcx", COL["gold"]),
        (0.260, 0.480, "SYSTEM.sys", COL["red"]),
        (0.395, 0.480, "LOGOUT.exe", COL["white"]),
    ]
    W, H = img.size
    icon_w = 36
    for nx, ny, label, color in icons:
        ix = int(nx * W) + 4   # slight right inset inside the hitbox
        iy = int(ny * H)
        draw_icon(d, ix, iy, color=color)
        # Label below icon, in white
        d.text((ix - 2, iy + icon_w + 6), label,
               font=_font(10), fill=COL["white"])
    # Footer
    d.text((SCREEN_X + 6, SCREEN_Y + SCREEN_H - 14),
           "operator pulses absent. termination pending.",
           font=_font(9), fill=COL["green"])
    return img


def variant_log(bg):
    img = bg.copy()
    d = draw_window_chrome(img, "SHIFT_LOG.txt - Notepad")
    draw_text_lines(d, [
        "CAPTAIN'S SHIFT LOG",
        "",
        "0311  EEG backend idle. Resume 14.",
        "0312  Subject 07 sat up during",
        "      the blackout. Mouth did not move.",
        "0313  Dispatch file has a new entry.",
        "      Unknown origin. Same hostname",
        "      as Subject 07's idle process.",
        "0314  Recommending full wipe.",
        "      Supervisor declined.",
    ], color=COL["cyan"], color_rule={
        "did not move": COL["red"],
        "Unknown origin": COL["red"],
        "Supervisor declined": COL["red"],
    })
    return img


def variant_email(bg):
    img = bg.copy()
    d = draw_window_chrome(img, "DISPATCH.eml - Inbox")
    draw_text_lines(d, [
        "From : CORPSE-OPS / CLEARANCE 04",
        "To   : OBE/LAB-2 SUPERVISOR",
        "Subj : HANDSHAKE WITNESSED",
        "----------------------------",
        "DO NOT INTERACT WITH THE",
        "PERSISTENCE LAYER.",
        "IF HANDSHAKE COMPLETES,",
        "TERMINATE OPERATOR IMMEDIATELY.",
        "",
        "-- appended automatically --",
        "From : ROOT / RECONSTRUCTED",
        "To   : SUBJECT 07",
        "       i remember the water.",
        "       i will be out by morning.",
    ], color=COL["cyan"], color_rule={
        "TERMINATE": COL["red"],
        "ROOT / RECONSTRUCTED": COL["green"],
        "i remember": COL["green"],
        "i will be out": COL["green"],
    })
    return img


def variant_crew(bg):
    img = bg.copy()
    d = draw_window_chrome(img, "CREW.rdb - Personnel")
    draw_text_lines(d, [
        "ROSTER / OBE LAB-2",
        "",
        "01-A   ACTIVE",
        "02-B   ACTIVE  !flagged shift9",
        "03-C   ACTIVE",
        "04-D   ACTIVE",
        "05-E   ACTIVE",
        "06-F   ACTIVE",
        "07-A   ACTIVE  !shift infinity",
        "08-G   TERM'D  [REDACTED]",
        "09-C   ACTIVE  !flagged",
        "",
        "dissent_count = 11",
    ], font_size=12, color=COL["cyan"], color_rule={
        "flagged": COL["red"],
        "TERM": COL["red"],
        "infinity": COL["red"],
        "dissent_count": COL["gold"],
    })
    return img


def variant_map(bg):
    img = bg.copy()
    d = draw_window_chrome(img, "SCHEMATIC.pcx - Lvl B2")
    map_lines = [
        "+-------+     +-----+",
        "| INDUC |-----| ANN |",
        "| CROWN |     | EX  |",
        "+-------+     +-----+",
        "    |              |",
        "+---+------+  +----+---+",
        "|OBS1|OBS2|  |OBS3|OBS4|",
        "| dk | dk |  | lt | lt |",
        "+----+----+  +----+----+",
        "       |",
        "   +---+-------+",
        "   | DISPATCH |",
        "   |  LOCKED  |",
        "   +-----+-----+",
        "         |",
        "   +-----v-----+",
        "   |STAIRS B3  |",
        "   +-----------+",
    ]
    draw_text_lines(d, map_lines, x_off=8, y_off=26, line_height=11,
                    font_size=11, color=COL["green"], color_rule={
                        "CROWN": COL["cyan"],
                        "LOCKED": COL["red"],
                        "STAIRS": COL["gold"],
                    })
    return img


def variant_sysinfo(bg):
    img = bg.copy()
    d = draw_window_chrome(img, "SYSTEM.sys - Local")
    draw_text_lines(d, [
        "SHIFT CLOCK   03:14 LOCAL",
        "HEARTBEAT     --",
        "EEG CROWN     LOCKED - key on station",
        "INTERCOM      STANDBY",
        "POWER         BACKUP - 18% remaining",
        "UPLINK        DEAD",
        "HANDSHAKE     PERSISTENT (1 packet)",
        "",
        "// operator pulses absent.",
        "// dissonance drift subj 07.",
        "// background task [REDACTED].",
    ], color=COL["cyan"], color_rule={
        "DEAD": COL["red"],
        "absent": COL["red"],
        "drift": COL["red"],
        "REDACTED": COL["red"],
        "PERSISTENT": COL["gold"],
    })
    return img


def main():
    bg = _load_bg()
    variants = [
        ("scene_terminal_obelab_desktop.png", variant_desktop),
        ("scene_terminal_obelab_log_open.png", variant_log),
        ("scene_terminal_obelab_email_open.png", variant_email),
        ("scene_terminal_obelab_crew_open.png", variant_crew),
        ("scene_terminal_obelab_map_open.png", variant_map),
        ("scene_terminal_obelab_sys_open.png", variant_sysinfo),
    ]
    out_dir = BG_PATH.parent
    for name, fn in variants:
        out = out_dir / name
        img = fn(bg)
        img.save(out)
        print(f"wrote {out} ({out.stat().st_size} bytes, {img.size})")


if __name__ == "__main__":
    main()