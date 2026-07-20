#!/usr/bin/env python3
"""Generate a single xAI image with project prompt provenance.

Run with Hermes' bundled Python so the installed xAI provider and OAuth
credential resolver are used. The script makes exactly one generation call,
materializes the returned bytes, writes a sibling prompt sidecar, and appends
tools/generation_log.jsonl.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODEL = "grok-imagine-image"


def load_prompt(path: Path) -> tuple[str, dict[str, Any]]:
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise SystemExit(f"Prompt file must contain a JSON object: {path}")
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise SystemExit(f"Prompt file has no non-empty 'prompt' field: {path}")
    return prompt.strip(), data


def detect_extension(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    raise RuntimeError("Returned bytes do not have a recognized PNG/JPEG/WebP signature")


def materialize_image(image_ref: str) -> bytes:
    if image_ref.startswith(("https://", "http://")):
        response = requests.get(image_ref, timeout=60)
        response.raise_for_status()
        content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0]
        if content_type and not content_type.lower().startswith("image/"):
            raise RuntimeError(f"Generated URL returned non-image MIME {content_type!r}")
        return response.content
    source = Path(image_ref).expanduser()
    if not source.is_file():
        raise RuntimeError(f"Provider returned an unreadable image reference: {image_ref}")
    return source.read_bytes()


def safe_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path.resolve())


def generate(args: argparse.Namespace) -> None:
    prompt_path = args.prompt_file.expanduser().resolve()
    prompt, prompt_document = load_prompt(prompt_path)

    output_requested = args.output.expanduser()
    if not output_requested.is_absolute():
        output_requested = ROOT / output_requested
    output_stem = output_requested.with_suffix("") if output_requested.suffix else output_requested
    for suffix in (".png", ".jpg", ".webp"):
        candidate = output_stem.with_suffix(suffix)
        if candidate.exists() and not args.force:
            raise SystemExit(f"Refusing to overwrite existing output without --force: {candidate}")

    # Pin the standard/normal model even if the user's global model picker is
    # temporarily set to the slower quality variant.
    os.environ["XAI_IMAGE_MODEL"] = MODEL
    from plugins.image_gen.xai import XAIImageGenProvider

    result = XAIImageGenProvider().generate(prompt, aspect_ratio=args.aspect_ratio)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or f"xAI generation failed: {result}")
    if result.get("model") != MODEL:
        raise RuntimeError(f"Expected model {MODEL!r}, provider used {result.get('model')!r}")

    image_ref = result.get("image")
    if not isinstance(image_ref, str) or not image_ref:
        raise RuntimeError("xAI provider succeeded without an image reference")
    raw = materialize_image(image_ref)
    extension = detect_extension(raw)
    output = output_stem.with_suffix(extension)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw)

    with Image.open(BytesIO(raw)) as image:
        image.verify()
    with Image.open(BytesIO(raw)) as image:
        dimensions = [int(image.width), int(image.height)]
        image_format = image.format

    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    public_url = result.get("public_url")
    if not isinstance(public_url, str):
        public_url = image_ref if image_ref.startswith(("https://", "http://")) else None
    record: dict[str, Any] = {
        "asset": safe_relative(output),
        "timestamp_utc": stamp,
        "provider": result.get("provider", "xai"),
        "model": result.get("model"),
        "aspect_ratio": result.get("aspect_ratio", args.aspect_ratio),
        "resolution": result.get("resolution", "1k"),
        "prompt": prompt,
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "prompt_source": safe_relative(prompt_path),
        "prompt_document": prompt_document,
        "response_sha256": hashlib.sha256(raw).hexdigest(),
        "response_bytes": len(raw),
        "response_format": image_format,
        "dimensions": dimensions,
        "source": "tools/gen_asset.py",
    }
    if public_url:
        record["public_url"] = public_url

    sidecar = output.with_suffix(output.suffix + ".prompt.json")
    sidecar.write_text(json.dumps(record, indent=2) + "\n")
    log_path = ROOT / "tools/generation_log.jsonl"
    with log_path.open("a") as handle:
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")

    print(json.dumps({
        "success": True,
        "asset": str(output.resolve()),
        "sidecar": str(sidecar.resolve()),
        "log": str(log_path.resolve()),
        "model": record["model"],
        "aspect_ratio": record["aspect_ratio"],
        "resolution": record["resolution"],
        "dimensions": dimensions,
        "response_bytes": len(raw),
        "response_sha256": record["response_sha256"],
        "prompt_sha256": record["prompt_sha256"],
        "public_url": public_url,
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Output path or stem; actual image suffix follows returned bytes")
    parser.add_argument("--aspect-ratio", choices=("landscape", "square", "portrait"),
                        default="square")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    generate(args)


if __name__ == "__main__":
    main()
