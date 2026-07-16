#!/usr/bin/env python3
"""Generate versioned exploration assets through the authenticated MiniMax image API."""
import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
API_URL = "https://api.minimax.io/v1/image_generation"
PROMPTS = {
    "background": (
        "Side-elevation room plate for a mature 1990s point-and-click cyberpunk horror game. The camera is exactly "
        "parallel to a long back wall, like a theatre set viewed from the side: NO vanishing-point tunnel, NO central "
        "perspective corridor, NO first-person view, NO isometric view. Show a wide rectangular computer laboratory "
        "from left to right, built to induce out-of-body experiences. Back wall equipment: reclining medical induction "
        "couch, EEG crown, old CRT monitors with abstract waveforms and no readable text, oscilloscopes, signal "
        "amplifiers, copper induction coils, sensory-deprivation pod and Faraday mesh. Put all major machinery along "
        "the back wall. Keep the entire lower 40 percent as a continuous clear horizontal floor strip for a character "
        "to walk left/right and slightly toward/away from camera; no object blocks its center. Include a clear near "
        "floor edge and a back floor edge so the walk plane has depth. Foreground occluders may touch only the extreme "
        "left and right borders. Standing eye-level, fixed medium-wide zoom, important content inside a centered 4:3 "
        "safe crop. Oppressive cyan and dim red practical light, hard shadows, stained concrete, steel and beige "
        "computer plastic. Smooth detailed source illustration for later palette quantization and Bayer dithering, "
        "not chunky pixel art. No people, figures, silhouettes, androids, mannequins, statues, protagonist, text, "
        "labels, logos, UI, close-up, fisheye, cheerful colours or cute anime styling."
    ),
    "sprite_sheet": (
        "Eight-panel horizontal walk-cycle reference sheet for one adult human protagonist in a mature cyberpunk "
        "horror point-and-click adventure. Same character repeated in every panel, strict side profile facing right: "
        "late-thirties investigator, realistic angular face, short practical black hair, dark graphite field jacket "
        "with restrained oxblood collar, narrow black utility trousers, flat worn boots, clinical gloves and a small "
        "neural-interface jack behind one ear. Human, not an android, no weapon. Panels show a clear loop: neutral "
        "standing rest, right step, passing pose, left step, opposite contact, passing pose, returning step, rest. "
        "Full body head to boots in every panel, identical scale, identical feet baseline, no cropping, generous panel "
        "spacing. Flat saturated chroma-magenta background everywhere, no gradient, no floor, no cast shadow. Smooth "
        "detailed cel-painted source art for later runtime palette quantization and Bayer dithering, not pixel art. "
        "No extra characters, no duplicate limbs, no front or three-quarter view, no text, borders, UI, big anime eyes, "
        "oversized head, moe or cheerful styling."
    ),
}
OUTPUTS = {
    "background": ROOT / "assets/backgrounds/scene_obe_lab_v2.png",
    "sprite_sheet": ROOT / "assets/sprites/protagonist/obe_lab/walk_sheet_v1.png",
}
ASPECTS = {"background": "4:3", "sprite_sheet": "16:9"}


def generate(kind: str) -> None:
    key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not key:
        key_path = Path.home() / ".config/opencode/minimax-api-key"
        if key_path.exists():
            key = key_path.read_text().strip()
    if not key:
        raise SystemExit("MINIMAX_API_KEY is not available; refusing to generate without credentials")
    prompt = PROMPTS[kind]
    if len(prompt) > 1500:
        raise SystemExit(f"{kind} prompt is {len(prompt)} chars; MiniMax limit is 1500")
    payload = {
        "model": "image-01",
        "prompt": prompt,
        "aspect_ratio": ASPECTS[kind],
        "n": 1,
        "response_format": "base64",
        "prompt_optimizer": True,
    }
    print(f"Generating {kind}: {len(prompt)} prompt chars, aspect={ASPECTS[kind]}")
    with httpx.Client(timeout=180.0) as client:
        response = client.post(API_URL, json=payload, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })
    response.raise_for_status()
    data = response.json()
    base_resp = data.get("base_resp", {}) or {}
    if base_resp.get("status_code", 0) != 0:
        raise RuntimeError(f"MiniMax API error: {base_resp}")
    encoded = (data.get("data") or {}).get("image_base64") or []
    if not encoded:
        raise RuntimeError(f"MiniMax returned no image data: {data}")
    output = OUTPUTS[kind]
    output.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(BytesIO(base64.b64decode(encoded[0]))).convert("RGB")
    image.save(output, format="PNG")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    record = {
        "asset": str(output.relative_to(ROOT)),
        "kind": kind,
        "timestamp_utc": stamp,
        "provider": "minimax",
        "model": "image-01",
        "aspect_ratio": ASPECTS[kind],
        "prompt": prompt,
        "source": "tools/gen_exploration_assets.py",
    }
    sidecar = output.with_suffix(output.suffix + ".prompt.json")
    sidecar.write_text(json.dumps(record, indent=2) + "\n")
    log = ROOT / "tools/generation_log.jsonl"
    with log.open("a") as handle:
        handle.write(json.dumps(record) + "\n")
    print(f"WROTE {output} {image.size}")
    print(f"WROTE {sidecar}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=sorted(PROMPTS))
    generate(parser.parse_args().kind)
