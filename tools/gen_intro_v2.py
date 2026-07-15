#!/usr/bin/env python3
"""Generate the title screen background.

Output is saved as scene_intro_v{N}.png and a sibling .png.prompt.json
provenance sidecar. The runtime dither post-process (canvas.js) applies
the PC-98 16-colour Bayer dither at display time, so the source image
should be a clean painterly illustration, NOT pre-dithered.

Usage:
    python3 tools/gen_intro_v2.py                      # v11 at 16:9 (default)
    python3 tools/gen_intro_v2.py v6                   # v6 at 4:3 (legacy)
    python3 tools/gen_intro_v2.py v11 16:9             # explicit current preset
    python3 tools/gen_intro_v2.py v8 21:9              # cinematic ultrawide
"""
import argparse
import base64
import json
import sys
from datetime import datetime
from pathlib import Path

API_URL = "https://api.minimax.io/v1/image_generation"

PROMPTS = {
    # v11 — 16:9, NO BAKED TEXT. The title is composited at runtime
    # by the canvas overlay so it can never be cropped by cover-fit.
    # Bottom 25% kept visually quiet (no signage, no words) so the
    # overlay title sits cleanly on the artwork.
    "v11": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 16:9 widescreen. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER-LEFT): mid-sprint, 3/4 FROM BEHIND. YOUNG — late teens to early twenties, lean and hungry. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, splash erupting. Hands pumping.

CHASE: alley, slick wet cobblestones. Smoke pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. Sky upper-right with moonlit clouds.

THREAT (CENTER-RIGHT): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

NO TEXT, NO TITLE, NO LOGO in the image. Bottom 25% visually quiet so a title can be composited at runtime.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. NO TEXT, NO SIGNAGE, NO WORDS, NO TITLE.""",
        "aspect_ratio": "16:9",
        "framing_notes": "v11 16:9 NO baked title — the runtime composites GHOST PROCESS as canvas overlay text so it survives any cover-fit crop.",
    },
    # v10 — 3:4 PORTRAIT orientation (matches modern phone aspect),
    # protagonist CENTER, androids BACKGROUND, title COMPACT at
    # bottom-center (middle 25% of horizontal width). On a portrait
    # phone (720x1600) the source scales up to 1600 height; visible
    # window is 720 of 1200 source width = 60% (vs 25% for 16:9
    # sources). Title fits in that 60% with room to spare.
    "v10": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 3:4 portrait orientation. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER): mid-sprint, 3/4 FROM BEHIND. YOUNG — late teens to early twenties, lean and hungry. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, splash erupting. Hands pumping.

CHASE: alley, slick wet cobblestones. Smoke pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. Sky upper-right with moonlit clouds.

THREAT (BACKGROUND): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font, CENTERED at bottom-center, COMPACT (spans middle 25% of horizontal width), positioned 8% padding from bottom edge. SMALL TITLE.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner, NOT at very bottom edge, NOT spanning full width.""",
        "aspect_ratio": "3:4",
        "framing_notes": "v10 3:4 portrait. Designed for portrait-phone viewports. Title compact 25% width at bottom-center.",
    },
    # v9 — 16:9, protagonist CENTER, androids RIGHT SIDE,
    # title CENTERED at bottom but COMPACT (middle 20% of width) so
    # it survives cover-fit-CENTER on portrait phones (which shows
    # ~25% of source width). Title 5-15% padding from bottom edge.
    "v9": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 16:9 widescreen. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER): mid-sprint, 3/4 FROM BEHIND. YOUNG — late teens to early twenties, lean and hungry. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, splash erupting. Hands pumping.

CHASE: alley, slick wet cobblestones. Smoke pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. Sky upper-right with moonlit clouds.

THREAT (RIGHT SIDE): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font, CENTERED at bottom-center, SMALL (spans middle 20% of horizontal width), positioned at 5-15% from bottom edge. Compact title.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner, NOT at very bottom edge, NOT spanning full width, NOT larger than 20% width.""",
        "aspect_ratio": "16:9",
        "framing_notes": "v9 16:9 widescreen. Title COMPACT at bottom-center, middle 20% width. Survives cover-fit-CENTER on portrait phones.",
    },
    # v8 — 16:9, protagonist CENTER, androids RIGHT SIDE,
    # title CENTERED at bottom, occupying middle 40% of width so it
    # survives cover-fit on portrait phones.
    "v8": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 16:9 widescreen. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER): mid-sprint, 3/4 FROM BEHIND. YOUNG — late teens to early twenties, lean and hungry. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, splash erupting. Hands pumping.

CHASE: alley, slick wet cobblestones. Smoke pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. Sky upper-right with moonlit clouds.

THREAT (RIGHT SIDE): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font, CENTERED HORIZONTALLY at bottom-center, occupying middle 40% of horizontal width and bottom 25% of vertical height. 5% padding from BOTTOM edge.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner, NOT at very bottom edge, NOT spanning full width.""",
        "aspect_ratio": "16:9",
        "framing_notes": "v8 16:9 widescreen. Protagonist center, androids right. Title CENTERED at bottom, middle 40% of width — survives portrait crops because the title's center stays visible no matter which slice we show.",
    },
    # v7 — 16:9 widescreen, protagonist CENTER-LEFT, androids CENTER-RIGHT,
    # title BOTTOM-LEFT with safety padding from edges so portrait-phone
    # crops don't lose the logo.
    "v7": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 16:9 widescreen. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER-LEFT): mid-sprint, 3/4 FROM BEHIND. YOUNG — late teens to early twenties, lean and hungry. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, splash erupting. Hands pumping.

CHASE: alley, slick wet cobblestones. Smoke pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. Sky upper-right with moonlit clouds.

THREAT (CENTER-RIGHT): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font at BOTTOM-LEFT, LARGE, occupying bottom 30% of frame. Position with at least 10% padding from LEFT edge and 5% padding from BOTTOM edge so it survives portrait-phone crops.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner, NOT at very bottom edge.""",
        "aspect_ratio": "16:9",
        "framing_notes": "v7 16:9 widescreen. Protagonist center-left, androids center-right — wider composition. Title BOTTOM-LEFT with 10% L / 5% B padding to survive portrait crops.",
    },
    # v6 — legacy 4:3 reference (kept for A/B comparison).
    "v6": {
        "prompt": """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 4:3. WIDE COMPOSITION (landscape) — title sits at BOTTOM so the image is wider than tall. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER, upper-mid frame): mid-sprint, 3/4 FROM BEHIND, leaning into run. YOUNG — late teens to early twenties, lean and hungry, NOT grizzled. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, one kicking up splash. Hands pumping.

CHASE: alley, cobblestones slick with rain. Smoke/vapor pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. WIDE framing, sky visible at top.

THREAT (BACKGROUND, soft focus): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font at BOTTOM-CENTER, large, occupying bottom 25% of frame.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner.""",
        "aspect_ratio": "4:3",
        "framing_notes": "v6 4:3. Title BOTTOM-CENTER. Legacy reference; superseded by v7.",
    },
}


def main():
    parser = argparse.ArgumentParser(description="Generate the title screen background.")
    parser.add_argument("version", nargs="?", default="v11",
                        choices=list(PROMPTS.keys()),
                        help="Which preset version to generate (default: v11)")
    parser.add_argument("aspect_ratio", nargs="?", default=None,
                        choices=["4:3", "16:9", "21:9", "1:1", "3:4"],
                        help="Override the preset's aspect ratio")
    args = parser.parse_args()

    import httpx

    preset = PROMPTS[args.version]
    prompt = preset["prompt"]
    aspect_ratio = args.aspect_ratio or preset["aspect_ratio"]
    output = Path(__file__).parent.parent / "assets" / "backgrounds" / f"scene_intro_{args.version}.png"
    provenance = output.with_suffix(".png.prompt.json")
    log_file = Path(__file__).parent.parent / "tools" / "generation_log.jsonl"

    api_key_path = Path.home() / ".config" / "opencode" / "minimax-api-key"
    api_key = api_key_path.read_text().strip()
    if not api_key.startswith("sk-cp-"):
        print(f"WARN: API key at {api_key_path} doesn't start with sk-cp-", file=sys.stderr)

    payload = {
        "model": "image-01",
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "n": 1,
        "response_format": "base64",
        "prompt_optimizer": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    print(f"POST {API_URL}")
    print(f"  version={args.version}, aspect_ratio={aspect_ratio}, prompt={len(prompt)} chars")
    with httpx.Client(timeout=180.0) as client:
        resp = client.post(API_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    base_resp = data.get("base_resp", {}) or {}
    if base_resp.get("status_code", 0) != 0:
        raise RuntimeError(f"API error: status_code={base_resp.get('status_code')} "
                           f"status_msg={base_resp.get('status_msg', '<none>')}")

    images_b64 = (data.get("data") or {}).get("image_base64") or []
    if not images_b64:
        raise RuntimeError(f"No images in API response. Full: {data}")

    output.parent.mkdir(parents=True, exist_ok=True)
    img_bytes = base64.b64decode(images_b64[0])
    output.write_bytes(img_bytes)
    print(f"OK wrote {output} ({len(img_bytes)} bytes)")

    provenance.write_text(json.dumps({
        "preset": f"intro_{args.version}",
        "asset": str(output.relative_to(output.parents[2])),
        "timestamp_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "model": "image-01",
        "framing_notes": preset["framing_notes"],
    }, indent=2))
    print(f"OK wrote {provenance}")

    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a") as f:
        f.write(json.dumps({
            "preset": f"intro_{args.version}",
            "asset": str(output.relative_to(output.parents[2])),
            "timestamp_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "model": "image-01",
        }) + "\n")
    print(f"OK appended {log_file}")


if __name__ == "__main__":
    main()