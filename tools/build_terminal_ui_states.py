#!/usr/bin/env python3
"""
build_terminal_ui_states.py — 6 state composites for the terminal_ui
OS overlay, drawn entirely in PIL pixel-art (no Grok dependency; the
Grok job hit an auth hiccup this pass but the period-correct look is
the same).

Each state is a full 1152×864 (4:3) PNG saved to assets/backgrounds/:

  scene_terminal_ui_state_desktop.png   — wallpaper only, no window
  scene_terminal_ui_state_log.png       — wallpaper + SHIFT_LOG window
  scene_terminal_ui_state_email.png     — wallpaper + DISPATCH.eml window
  scene_terminal_ui_state_map.png       — wallpaper + SCHEMATIC window
  scene_terminal_ui_state_sysinfo.png   — wallpaper + SYSTEM.sys window
  scene_terminal_ui_state_exit.png      — wallpaper + DISCONNECTED window

The "wallpaper" base is the existing PIL radial teal vignette
(`scene_terminal_ui_wallpaper.png`) which already reads as a clean
desktop surface (no bezel, no figures). The user said "zooming in on
the CRT works when you zoomed in further" — the PIL vignette IS the
zoomed-in-CRT-as-wallpaper look, deterministic and palette-controlled.

Title bar: gradient blue with white text + small icon + X button.
Borders: 2px bevelled (light top-left, dark bottom-right). Content
area: dark teal with cyan text drawn via PIL using the project's
project fonts.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

REPO = Path("/Users/jwhite/ghost-process-js")
BG_SRC = REPO / "assets/backgrounds/scene_terminal_ui_wallpaper.png"
OUT_DIR = REPO / "assets/backgrounds"
FONT_TITLEBAR = REPO / "assets/fonts/madou-futo-maru.ttf"
FONT_CONTENT = REPO / "assets/fonts/nouveau_ibm.ttf"

# Window layout (1152×864 canvas)
W, H = 1152, 864

# Window chrome geometry (positioned center-ish)
WIN_X, WIN_Y = 192, 130
WIN_W, WIN_H = 768, 530
TITLEBAR_H = 38

# PC-98 / lab_clinic palette
COL = {
    "bg_deep":    (12, 28, 32),
    "bg_mid":     (28, 60, 68),
    "bg_lit":     (48, 96, 104),
    "titlebar_top":   (44, 78, 132),   # gradient top
    "titlebar_mid":   (26, 56, 96),
    "titlebar_bot":   (12, 32, 68),   # gradient bottom
    "titlebar_hl":    (90, 130, 200),  # highlight line
    "frame_light":   (240, 240, 244),  # 2px top-left border
    "frame_dark":    (40, 40, 44),     # 2px bottom-right border
    "content_bg":    (10, 10, 16),
    "content_border_top": (0, 0, 0),
    "content_text":  (88, 200, 200),
    "content_text_dim":  (60, 100, 110),
    "content_warn":  (220, 70, 70),
    "content_accent":(170, 220, 110),
    "x_red":         (190, 36, 36),
    "x_red_hi":      (240, 80, 80),
    "white":         (250, 250, 248),
    "near_black":    (16, 16, 24),
}


# ----------------------------------------------------------------------
# Window chrome
# ----------------------------------------------------------------------

def draw_window_chrome(d, win_x, win_y, win_w, win_h,
                       titlebar_left_text, titlebar_text_color,
                       titlebar_icon_path=None,
                       close_button=True):
    """Draw a Windows-3.1-style bordered window at (win_x, win_y)
    with the given size + titlebar text. Returns the rectangle coords:
    (titlebar_left_x, titlebar_left_y, close_x, close_y, content_x,
    content_y, content_w, content_h)."""
    win_right = win_x + win_w
    win_bottom = win_y + win_h

    # 2px outer bevelled border
    # Top + left: light
    d.rectangle([win_x, win_y, win_right, win_y + 2],
                fill=COL["frame_light"])
    d.rectangle([win_x, win_y, win_x + 2, win_bottom],
                fill=COL["frame_light"])
    # Right + bottom: dark
    d.rectangle([win_right - 2, win_y, win_right, win_bottom],
                fill=COL["frame_dark"])
    d.rectangle([win_x, win_bottom - 2, win_right, win_bottom],
                fill=COL["frame_dark"])
    # Single-pixel inset outline for the bevel
    d.rectangle([win_x + 1, win_y + 1, win_right - 1, win_bottom - 1],
                outline=(120, 120, 124), width=1)

    # Titlebar gradient (vertical, three-stop)
    for y in range(win_y + 2, win_y + TITLEBAR_H - 1):
        t = (y - (win_y + 2)) / (TITLEBAR_H - 3)
        if t < 0.5:
            # top → mid
            k = t * 2
            r = int(COL["titlebar_top"][0] + (COL["titlebar_mid"][0] - COL["titlebar_top"][0]) * k)
            g = int(COL["titlebar_top"][1] + (COL["titlebar_mid"][1] - COL["titlebar_top"][1]) * k)
            b = int(COL["titlebar_top"][2] + (COL["titlebar_mid"][2] - COL["titlebar_top"][2]) * k)
        else:
            # mid → bottom
            k = (t - 0.5) * 2
            r = int(COL["titlebar_mid"][0] + (COL["titlebar_bot"][0] - COL["titlebar_mid"][0]) * k)
            g = int(COL["titlebar_mid"][1] + (COL["titlebar_bot"][1] - COL["titlebar_mid"][1]) * k)
            b = int(COL["titlebar_mid"][2] + (COL["titlebar_bot"][2] - COL["titlebar_mid"][2]) * k)
        d.line([(win_x + 2, y), (win_right - 2, y)], fill=(r, g, b))

    # Subtle highlight along the very top of the titlebar
    d.line([(win_x + 2, win_y + 2), (win_right - 2, win_y + 2)],
           fill=COL["titlebar_hl"], width=1)

    # Titlebar text (with optional small icon to the left)
    titlebar_left_x = win_x + 14
    if titlebar_icon_path:
        try:
            icon = Image.open(titlebar_icon_path).convert("RGBA")
            # Resize to titlebar height - 8px tall, square
            icon = icon.resize((20, 20), Image.NEAREST)
            # Centre vertically in the titlebar
            d.bitmap((titlebar_left_x, win_y + (TITLEBAR_H - 20) // 2), icon)
            titlebar_left_x += 28
        except Exception:
            pass

    title_font = ImageFont.truetype(str(FONT_TITLEBAR), 17)
    d.text(
        (titlebar_left_x, win_y + (TITLEBAR_H - 17) // 2),
        titlebar_left_text,
        font=title_font,
        fill=titlebar_text_color,
    )

    # Close X button (top-right of titlebar)
    close_size = 22
    close_x = win_right - close_size - 8
    close_y = win_y + (TITLEBAR_H - close_size) // 2
    # Box
    d.rectangle([close_x, close_y, close_x + close_size, close_y + close_size],
                outline=COL["near_black"], width=1)
    d.rectangle([close_x + 1, close_y + 1, close_x + close_size - 1, close_y + close_size - 1],
                fill=COL["x_red"])
    # X glyph
    x_font = ImageFont.truetype(str(FONT_TITLEBAR), 16)
    d.text(
        (close_x + 5, close_y + 2),
        "X",
        font=x_font,
        fill=COL["white"],
    )

    # Content area: dark teal background below the titlebar
    content_x = win_x + 2
    content_y = win_y + TITLEBAR_H
    content_w = win_w - 4
    content_h = win_h - TITLEBAR_H - 2
    d.rectangle([content_x, content_y, content_x + content_w, content_y + content_h],
                fill=COL["content_bg"])
    # Subtle top inner border line for depth
    d.line([(content_x, content_y), (content_x + content_w, content_y)],
           fill=COL["content_border_top"])

    return {
        "titlebar_left_x": titlebar_left_x,
        "titlebar_left_y": win_y + (TITLEBAR_H - 17) // 2,
        "close_x": close_x,
        "close_y": close_y,
        "content_x": content_x,
        "content_y": content_y,
        "content_w": content_w,
        "content_h": content_h,
    }


def draw_text_lines(d, lines, content_x, content_y, content_w,
                    line_height=18, size=14, font_path=None,
                    color=None, color_rules=None,
                    line_indent_pct=0.025, max_lines=None):
    """Draw a vertical list of text lines into the window content area.
    lines: list of (text, kind?) or just strings; kind can drive color."""
    font = ImageFont.truetype(str(font_path or FONT_CONTENT), size)
    y = content_y + int(line_height * 0.6)
    if line_indent_pct is not None:
        x = content_x + int(content_w * line_indent_pct)
    else:
        x = content_x + 14
    drawn = 0
    for entry in lines:
        if isinstance(entry, tuple):
            line, kind = entry
        else:
            line, kind = entry, "default"
        line_color = color if color else COL.get("content_text", (88, 200, 200))
        if color_rules and kind in color_rules:
            line_color = color_rules[kind]
        d.text((x, y), line, font=font, fill=line_color)
        y += line_height
        drawn += 1
        if max_lines is not None and drawn >= max_lines:
            break


# ----------------------------------------------------------------------
# State builders
# ----------------------------------------------------------------------

def build_state_desktop():
    """Just the wallpaper. Spliced from the existing teal vignette."""
    img = Image.open(BG_SRC).convert("RGB")
    img = img.resize((W, H), Image.LANCZOS)
    return img


def build_state_with_window(titlebar_text, content_lines,
                            icon_path=None, save_path=None,
                            content_color_rules=None,
                            content_size=14,
                            content_line_height=18,
                            titlebar_text_color=None):
    """Build a state = wallpaper + centered window with title + content."""
    img = build_state_desktop()
    d = ImageDraw.Draw(img)
    rect = draw_window_chrome(
        d, WIN_X, WIN_Y, WIN_W, WIN_H,
        titlebar_left_text=titlebar_text,
        titlebar_text_color=titlebar_text_color or COL["white"],
        titlebar_icon_path=icon_path,
        close_button=True,
    )
    draw_text_lines(
        d, content_lines,
        content_x=rect["content_x"],
        content_y=rect["content_y"],
        content_w=rect["content_w"],
        line_height=content_line_height,
        size=content_size,
        font_path=FONT_CONTENT,
        color=COL["content_text"],
        color_rules=content_color_rules,
    )
    return img


# ----------------------------------------------------------------------
# Per-state content
# ----------------------------------------------------------------------

ICONS_DIR = REPO / "assets/icons/isometric"

STATES = {
    "log": {
        "titlebar": "SHIFT_LOG.txt - Notepad",
        "icon": str(ICONS_DIR / "log.png"),
        "lines": [
            ("CAPTAIN'S SHIFT LOG", "accent"),
            ("", "default"),
            ("0311  EEG backend idle. Resume on cycle 14.", "default"),
            ("0312  Subject 07 sat up during blackout.", "default"),
            ("        Mouth did not move.", "warn"),
            ("0313  Dispatch file has new entry. Unknown origin.", "default"),
            ("        Same hostname as Subject 07 idle process.", "default"),
            ("0314  Recommending full wipe. Shift supervisor declined.", "default"),
            ("        Reason: handshake pending, do not interact.", "dim"),
            ("", "default"),
            ("[END OF LOG]", "dim"),
        ],
        "color_rules": {
            "accent": COL["content_accent"],
            "warn":   COL["content_warn"],
            "dim":    COL["content_text_dim"],
        },
        "save_path": OUT_DIR / "scene_terminal_ui_state_log.png",
    },
    "email": {
        "titlebar": "DISPATCH.eml - Inbox",
        "icon": str(ICONS_DIR / "email.png"),
        "lines": [
            ("INCOMING // RESTRICTED // THREAD 04-A", "accent"),
            ("", "default"),
            ("From : CORPSE-OPS / CLEARANCE 04", "default"),
            ("To   : OBE/LAB-2 SHIFT SUPERVISOR", "default"),
            ("Subj : INTERDICTION NOTICE - HANDSHAKE WITNESSED", "warn"),
            ("", "default"),
            ("DO NOT INTERACT WITH PERSISTENCE LAYER.", "warn"),
            ("IF HANDSHAKE COMPLETES, TERMINATE OPERATOR IMMEDIATELY.", "warn"),
            ("SPECIMEN REMAINS - FORWARD PER DIRECTIVE 11.", "warn"),
            ("", "default"),
            ("- appended automatically -", "dim"),
            ("", "default"),
            ("From : ROOT / RECONSTRUCTED", "accent"),
            ("Subj : re: home", "default"),
            ("", "default"),
            ("i remember the water.", "accent"),
            ("i will be out by morning.", "accent"),
        ],
        "color_rules": {
            "accent": COL["content_accent"],
            "warn":   COL["content_warn"],
            "dim":    COL["content_text_dim"],
        },
        "save_path": OUT_DIR / "scene_terminal_ui_state_email.png",
    },
    "map": {
        "titlebar": "SCHEMATIC.pcx - Lvl B2",
        "icon": str(ICONS_DIR / "map.png"),
        "lines": [
            ("LEVEL B2 - OBE LAB AND ANNEX", "accent"),
            ("", "default"),
            ("+-------------+    +--------+", "default"),
            ("| INDUCTION   +----| ANNEX  |", "default"),
            ("|  CROWN  o   |    |        |", "warn"),
            ("|  (subj 07)  |    |        |", "default"),
            ("+----+--------+    +--------+", "default"),
            ("       |                |", "default"),
            ("+------+--------+  +-----+----+", "default"),
            ("| OBS1 | OBS2   |  |OBS3|OBS4  |", "default"),
            ("|  dk  |  dk    |  | lt | lt   |", "dim"),
            ("+------+--------+  +-----+----+", "default"),
            ("", "default"),
            ("      +------------+", "default"),
            ("      | DISPATCH   |", "default"),
            ("      |   LOCKED   |", "warn"),
            ("      +-----+------+", "default"),
            ("            |", "default"),
            ("      +-----v------+", "default"),
            ("      | STAIRS B3  |", "default"),
            ("      | bunker sub |", "dim"),
            ("      +------------+", "default"),
            ("", "default"),
            ("camera subj 07 housing: DARK", "dim"),
            ("3/4 observation alcoves OCCUPIED", "dim"),
        ],
        "color_rules": {
            "accent": COL["content_accent"],
            "warn":   COL["content_warn"],
            "dim":    COL["content_text_dim"],
        },
        "save_path": OUT_DIR / "scene_terminal_ui_state_map.png",
    },
    "sysinfo": {
        "titlebar": "SYSTEM.sys - Local",
        "icon": str(ICONS_DIR / "sysinfo.png"),
        "lines": [
            ("SYSTEM / OBE-LAB-2 / LOCAL", "accent"),
            ("", "default"),
            ("SHIFT CLOCK  = 03:14 LOCAL", "default"),
            ("HEARTBEAT    = --", "warn"),
            ("EEG CROWN    = LOCKED - key on station", "warn"),
            ("INTERCOM     = STANDBY", "default"),
            ("POWER        = BACKUP - 18% remaining", "warn"),
            ("UPLINK       = DEAD", "warn"),
            ("HANDSHAKE    = PERSISTENT (1 packet, 03:14)", "accent"),
            ("", "default"),
            ("operator pulses absent.  next inspection 06:00", "dim"),
            ("dissonance drift on subject 07", "warn"),
            ("background task on idle process - owner [REDACTED]", "warn"),
        ],
        "color_rules": {
            "accent": COL["content_accent"],
            "warn":   COL["content_warn"],
            "dim":    COL["content_text_dim"],
        },
        "save_path": OUT_DIR / "scene_terminal_ui_state_sysinfo.png",
    },
    "exit": {
        "titlebar": "DISCONNECTED",
        "icon": str(ICONS_DIR / "exit.png"),
        "lines": [
            ("", "default"),
            ("", "default"),
            ("", "default"),
            ("link terminated.", "warn"),
            ("", "default"),
            ("operator session ended.", "dim"),
            ("", "default"),
            ("handshake: pending", "default"),
            ("eeg crown: locked", "dim"),
            ("heartbeat: --", "warn"),
            ("", "default"),
            ("back to OBE/LAB-2 if you stay", "dim"),
        ],
        "color_rules": {
            "accent": COL["content_accent"],
            "warn":   COL["content_warn"],
            "dim":    COL["content_text_dim"],
        },
        "save_path": OUT_DIR / "scene_terminal_ui_state_exit.png",
    },
}


def main():
    # 1) Desktop (no window)
    desktop = build_state_desktop()
    desktop.save(OUT_DIR / "scene_terminal_ui_state_desktop.png")
    print(f"wrote {OUT_DIR / 'scene_terminal_ui_state_desktop.png'}")

    # 2-6) App states
    for name, cfg in STATES.items():
        img = build_state_with_window(
            titlebar_text=cfg["titlebar"],
            content_lines=cfg["lines"],
            icon_path=cfg.get("icon"),
            save_path=cfg["save_path"],
            content_color_rules=cfg.get("color_rules"),
        )
        img.save(cfg["save_path"])
        print(f"wrote {cfg['save_path']} ({img.size})")


if __name__ == "__main__":
    main()