# assets/sprites/ — sprite pipeline

This doc is the source-of-truth for where sprite source material lives, what
subdirs mean, and how to regenerate runtime sprites. Read this before
adding a new character or moving any sprite files.

## Standard layout (target)

```
<scene>/                          # one per game scene with a sprite
├── raw/                          # source-of-truth material (committed)
│   ├── i2v_clip_<scene>_<char>.mp4     # video source (if available)
│   ├── transparent_sprites/            # keyed RGBA at source resolution
│   │   └── frame_NN.png
│   └── README.md                       # documents this scene's pipeline
└── frame_NN.png                   # 16 runtime frames (committed)
```

`<scene>/frame_NN.png` files are what `story.json` references; the runtime
loads them directly.

## Why is it like this?

MiniMax-Image has no alpha-channel output, so sprites are generated on a
green BG and chroma-keyed post-hoc. The proper pipeline preserves the
**green-BG source** so the sprite can be re-keyed later if the keying is
wrong, or upgraded if a better key algorithm is invented.

The full pipeline:
1. MiniMax-Image I2V → MP4 with green BG (or black BG for older runs)
2. `tools/key_sprite.py` → 16 evenly-spaced keyframes → transparent PNGs at
   source resolution (saved to `raw/transparent_sprites/`)
3. Resize from source to runtime size (e.g. 768×1364 → 180×320) → `frame_NN.png`
   at the scene dir root

Step 3 is currently done by hand or by the corridor-specific
`assets/sprites/android/corridor/raw/sprite_extractor.py`. No general
"resize + install" tool exists yet.

## What the dirs actually look like today

As of 2026-07-13, **the standard layout is not yet enforced**. Reality:

| Scene | Status | Notes |
|---|---|---|
| `corridor/` | **Working.** `raw/` (MP4 + extractor + transparent_sprites) + `frame_*.png` at root (the runtime strip). `sprite_extractor.py` installs directly into `corridor/` (no `processed/` subdir); uses aspect-preserving shrink + paste-centred so the ball-frames keep their arm. |
| `chase/` | **Historical reference.** Has `frame_*.png` at root + `raw/` containing the v0.14-era MP4 (black BG) + `transparent_sprites/`. The current chase animation is a different generation; no source for it. |
| `alley/` | **No source.** 16 idle PNGs at root, all no provenance. |
| `jailbreak/` | **No source.** 16 idle PNGs at root, all no provenance. |
| `eidolon_return/` | **Deleted.** Source MP4 lives at `~/ghost-process-98/.wip-android-sprite/i2v_clip_android_eidolon_return.mp4` (cross-project; not in this repo). |

This document exists to call out the inconsistency, not to justify it.
When a new sprite is generated, follow the standard layout above.

## Re-keying a sprite

```bash
# Green-bg MP4 (current MiniMax-Image convention):
python3 tools/key_sprite.py \
    --src raw/i2v_clip_<scene>_<char>.mp4 \
    --out raw/transparent_sprites/ \
    --bg green \
    --start 1 --end 130 --keyframes 16

# Black-bg MP4 (older generations):
python3 tools/key_sprite.py \
    --src raw/i2v_clip_<scene>_<char>.mp4 \
    --out raw/transparent_sprites/ \
    --bg black \
    --start 1 --end 141 --keyframes 16
```

Both modes write 16 keyed PNGs at source resolution. To upgrade the
runtime `frame_*.png` strip, resize those source frames to the runtime
resolution and overwrite. The current `corridor/raw/sprite_extractor.py`
shows the resize+install shape; it has not been generalised.

## Common pitfalls

- **Don't move `frame_*.png` into a `processed/` subdir without updating
  `story.json`.** `story.json` references them at the scene root by
  filename; the engine does not search subdirs.
- **Don't delete a `raw/transparent_sprites/` directory even if it looks
  unused.** It's the only recovery path if the runtime strip ever gets
  corrupted and you need to start over.
- **Don't hand-edit `frame_*.png`.** They were rendered from the source.
  Fix the source and regenerate.

## What needs work next

1. Move the corridor `frame_*.png` strip into a consistent location
   (either into `corridor/processed/` AND update `story.json` references,
   or remove the empty `processed/` dir). Do NOT do this without
   coordinating with the v17/v19 WIP work in progress.
2. Find or generate green-bg I2V sources for alley and jailbreak.
   Without a source, the runtime strip is unrecoverable.
3. Generalise the resize/install step from `sprite_extractor.py` into a
   second tool, so a full regenerate of any sprite is one command.
