# chase/ — android chase sprite

```
chase/
├── idle_01.png .. idle_16.png   runtime: 180×320 RGBA. What the engine loads.
└── raw/                        historical v0.14 I2V source for this character.
```

## idle_*.png

16 sprite frames at **180×320 RGBA**: `idle_01.png` .. `idle_16.png`. This
is what `story.json` references and what the runtime loads.

## raw/

| File | Purpose |
|---|---|
| `i2v_clip_android_chase.mp4` | v0.14-era I2V source. Black background. **Not** the current sprite — the current chase animation was regenerated later (post-v0.14) and the source MP4 was not retained. Kept as a historical reference for the v0.14 generation. |
| `transparent_sprites/frame_00.png` .. `frame_15.png` | 16 chroma-keyed PNGs at source resolution (768×1364), derived from the v0.14 black-BG MP4 via `tools/key_sprite.py --bg black`. Provides a clean v0.14 baseline if anyone wants to compare generations. |

To regenerate the `transparent_sprites/` from the MP4:

```
python3 tools/key_sprite.py \
    --src raw/i2v_clip_android_chase.mp4 \
    --out raw/transparent_sprites/ \
    --bg black \
    --start 1 --end 141 --keyframes 16
```

## Why no processed/ subdir?

The other scene dirs follow different conventions:
- `corridor/` uses `idle_*.png` at the root (where the strip lives today) plus `raw/` and an empty `processed/` left over from `sprite_extractor.py` — see `corridor/README.md`.
- `alley/`, `jailbreak/` use `idle_*.png` at the root with no `raw/` because no green-screen source was retained for those characters.

This inconsistency is real and called out in `assets/sprites/SPRITE_PIPELINE.md`. Don't move files into or out of subdirs without updating that doc + the relevant `story.json` references.
