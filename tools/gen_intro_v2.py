#!/usr/bin/env python3
"""Generate the new intro source image with the framing fix.

The current scene_intro.png was generated with a prompt that let the model
add a literal hover-platform/floating slab under the protagonist's feet —
they would clearly spot him from the plaza below. New prompt pins the
protagonist to a solid concrete rooftop so he's anchored and at a distance
where androids can't detect him.

Output is saved as scene_intro_v2.png so the existing scene_intro.png is
preserved for A/B comparison until the user approves the new version.

The dithering post-process will be applied at runtime (see canvas.js /
post-process pipeline — to be wired in a follow-up), so the source image
should be a clean painterly illustration, NOT pre-dithered.
"""
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx

API_URL = "https://api.minimax.io/v1/image_generation"

PROMPT = """Clean line-art, sharp ink, brush-painted flat coloring with hard shadows. SMOOTH painterly source — NO pixel art, NO 8-bit, NO dither (applied later).

PC-98 title screen, 4:3. WIDE COMPOSITION (landscape) — title sits at BOTTOM so the image is wider than tall. STORY: teenage runaway hunted through backstreet at night.

PROTAGONIST (CENTER, upper-mid frame): mid-sprint, 3/4 FROM BEHIND, leaning into run. YOUNG — late teens to early twenties, lean and hungry, NOT grizzled. Messy unwashed hair. Cheap thrift-store windbreaker two sizes too big, frayed cuffs caught in wind. Cheap sneakers pounding wet cobblestone, one kicking up splash. Hands pumping.

CHASE: alley, cobblestones slick with rain. Smoke/vapor pouring from a drain. Puddles reflecting his silhouette. Walls closing in — TRAP. WIDE framing, sky visible at top.

THREAT (BACKGROUND, soft focus): TWO patrolling androids in ceremonial navy coats and red sashes, half a block back. Red eye-glow. Chasing.

ONLY text 'GHOST PROCESS' in dripping red horror font at BOTTOM-CENTER, large, occupying bottom 25% of frame.

Style: Snatcher late-80s PC-98 mature cyberpunk, no anime no moe. Sharp ink, hard shadows. Palette: deep blue, cyan, blood red, gold.

Avoid: cartoon, kawaii, chibi, child, 3D render, photorealistic, CGI, smooth gradient, watermark, signature, frame border, pixel art, 8-bit, mosaic dither, scanlines, floating, hovering, hover-platform. NOT an old operative. NOT a rooftop birdwatcher. Title NOT in corner."""

OUTPUT = Path(__file__).parent.parent / "assets" / "backgrounds" / "scene_intro_v6.png"
PROVENANCE = OUTPUT.with_suffix(".png.prompt.json")
LOG_FILE = Path(__file__).parent.parent / "tools" / "generation_log.jsonl"


def main():
    api_key_path = Path.home() / ".config" / "opencode" / "minimax-api-key"
    api_key = api_key_path.read_text().strip()
    if not api_key.startswith("sk-cp-"):
        print(f"WARN: API key at {api_key_path} doesn't start with sk-cp-", file=sys.stderr)

    payload = {
        "model": "image-01",
        "prompt": PROMPT,
        "aspect_ratio": "4:3",
        "n": 1,
        "response_format": "base64",
        "prompt_optimizer": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    print(f"POST {API_URL}")
    print(f"  prompt: {len(PROMPT)} chars, aspect_ratio=4:3")
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

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    img_bytes = base64.b64decode(images_b64[0])
    OUTPUT.write_bytes(img_bytes)
    print(f"OK wrote {OUTPUT} ({len(img_bytes)} bytes)")

    # Provenance sidecar
    PROVENANCE.write_text(json.dumps({
        "preset": "intro_v2 (override)",
        "asset": str(OUTPUT.relative_to(OUTPUT.parents[2])),
        "timestamp_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prompt": PROMPT,
        "aspect_ratio": "4:3",
        "model": "image-01",
        "framing_notes": "Solid concrete rooftop, no hover-platform. Clean painterly source (no baked dither) — runtime post-process applies the PC-98 dither.",
    }, indent=2))
    print(f"OK wrote {PROVENANCE}")

    # Append-only log
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a") as f:
        f.write(json.dumps({
            "preset": "intro_v2 (override)",
            "asset": str(OUTPUT.relative_to(OUTPUT.parents[2])),
            "timestamp_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "prompt": PROMPT,
            "aspect_ratio": "4:3",
            "model": "image-01",
        }) + "\n")
    print(f"OK appended {LOG_FILE}")


if __name__ == "__main__":
    main()