#!/usr/bin/env python3
"""Build a clean 4:3 terminal UI plate from provenance-backed Grok candidates."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = ROOT / "assets/backgrounds/_candidates/terminal_ui_grok"
OUT = ROOT / "assets/backgrounds/scene_terminal_ui_grok.png"
SIDECAR = OUT.with_suffix(OUT.suffix + ".prompt.json")
LOG = ROOT / "tools/generation_log.jsonl"

SOURCES = {
    "window": CANDIDATES / "terminal_ui_grok_v2_window.jpg",
    "components": CANDIDATES / "terminal_ui_grok_v4_components.jpg",
}

RUNTIME_ICONS = {
    "log": ROOT / "assets/icons/isometric/log.png",
    "email": ROOT / "assets/icons/isometric/email.png",
    "map": ROOT / "assets/icons/isometric/map.png",
    "sysinfo": ROOT / "assets/icons/isometric/sysinfo.png",
    "exit": ROOT / "assets/icons/isometric/exit.png",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return img.resize(size, Image.Resampling.LANCZOS)


def bevel_panel(size: tuple[int, int], outer=(19, 78, 92), inner=(3, 18, 26)) -> Image.Image:
    w, h = size
    p = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(p)
    d.rectangle((0, 0, w - 1, h - 1), fill=(*outer, 255), outline=(72, 177, 190, 255), width=2)
    d.line((2, h - 3, w - 3, h - 3), fill=(4, 34, 43, 255), width=3)
    d.line((w - 3, 2, w - 3, h - 3), fill=(2, 25, 33, 255), width=3)
    d.rectangle((7, 7, w - 8, h - 8), fill=(*inner, 245), outline=(6, 40, 50, 255), width=2)
    return p


def main() -> None:
    for path in (*SOURCES.values(), *RUNTIME_ICONS.values()):
        if not path.exists():
            raise SystemExit(f"missing source: {path}")

    window = Image.open(SOURCES["window"]).convert("RGB")
    components = Image.open(SOURCES["components"]).convert("RGB")

    # Generated component-sheet texture becomes the desktop surface.
    base = fit(components, (1152, 864)).filter(ImageFilter.GaussianBlur(22))
    base = ImageEnhance.Brightness(base).enhance(0.44)
    base = ImageEnhance.Color(base).enhance(0.72).convert("RGBA")

    # Subtle cold vertical gradient and CRT vignette, without baking any text.
    tint = Image.new("RGBA", base.size, (0, 0, 0, 0))
    td = ImageDraw.Draw(tint)
    for y in range(864):
        k = abs(y - 420) / 440
        td.line((0, y, 1151, y), fill=(0, 18, 22, int(14 + 28 * k)))
    base = Image.alpha_composite(base, tint)

    # Blank top and bottom system strips derived from Grok's clean component plate.
    top_strip = fit(components.crop((862, 385, 1178, 418)), (1072, 48)).convert("RGBA")
    bottom_strip = fit(components.crop((458, 545, 770, 578)), (1072, 44)).convert("RGBA")
    base.alpha_composite(top_strip, (40, 30))
    base.alpha_composite(bottom_strip, (40, 798))

    # Build five empty launcher cards. The repository's existing isometric
    # app icons are placed over these cards by terminal_ui.js so they stay
    # interactive, accessible, and sharp instead of being baked into the BG.
    rail = bevel_panel((164, 664), outer=(13, 68, 81), inner=(2, 18, 25))
    base.alpha_composite(rail, (40, 116))
    for i in range(5):
        card = bevel_panel((132, 96), outer=(16, 77, 91), inner=(3, 23, 31))
        base.alpha_composite(card, (56, 148 + i * 118))

    # Candidate v2 is exceptionally clean: preserve its blank title/content/footer chrome.
    app = window.crop((223, 60, 1055, 658)).convert("RGBA")
    app = fit(app, (884, 636))
    # Add a cold shadow, then splice the application window onto the desktop.
    shadow = Image.new("RGBA", (912, 660), (0, 0, 0, 0))
    shadow.alpha_composite(Image.new("RGBA", (884, 636), (0, 0, 0, 180)), (18, 18))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    base.alpha_composite(shadow, (218, 112))
    base.alpha_composite(app, (228, 104))

    # Small generated red indicator lamps from the component board; no symbols or labels.
    lamps = components.crop((1140, 213, 1196, 271)).convert("RGBA")
    lamps = fit(lamps, (42, 42))
    base.alpha_composite(lamps, (1054, 34))

    # Scanlines and edge vignette are display-style finishing only; source remains detailed.
    fx = Image.new("RGBA", base.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(fx)
    for y in range(0, 864, 3):
        fd.line((0, y, 1151, y), fill=(0, 4, 6, 19), width=1)
    for inset in range(30):
        alpha = int((30 - inset) * 1.7)
        fd.rectangle((inset, inset, 1151 - inset, 863 - inset), outline=(0, 0, 0, alpha), width=1)
    base = Image.alpha_composite(base, fx).convert("RGB")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    base.save(OUT, "PNG", optimize=True)

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    record = {
        "kind": "composite",
        "asset": str(OUT.relative_to(ROOT)),
        "timestamp_utc": now,
        "model": "grok-imagine-image",
        "quality": "normal",
        "dimensions": [1152, 864],
        "purpose": "Text-free 4:3 PC-98 terminal UI plate for runtime-composited labels and content",
        "sources": [
            {
                "asset": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "prompt_sidecar": str(path.with_suffix(path.suffix + ".prompt.json").relative_to(ROOT)),
            }
            for path in SOURCES.values()
        ],
        "runtime_overlay_assets": [
            {
                "asset": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
            }
            for path in RUNTIME_ICONS.values()
        ],
        "composition": {
            "desktop_texture": "v4 component-board background, blurred and darkened",
            "application_window": "v2 blank window chrome",
            "launcher_cards": "five empty bevelled cards reserved for runtime controls",
            "launcher_icons": "existing repository isometric icons composited at runtime",
            "system_strips_and_lamps": "v4 blank component-board elements",
            "effects": "subtle scanlines, vignette, bevel backing and shadow",
        },
        "text_policy": "No generated writing, letters, numbers, labels, pseudo-text, logos, or watermarks retained; game text is added at runtime.",
    }
    record["response_sha256"] = sha256(OUT)
    SIDECAR.write_text(json.dumps(record, indent=2) + "\n")
    with LOG.open("a") as f:
        f.write(json.dumps(record, separators=(",", ":")) + "\n")

    print(json.dumps({
        "success": True,
        "asset": str(OUT),
        "sidecar": str(SIDECAR),
        "dimensions": [1152, 864],
        "sha256": record["response_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
