# corridor/ — android corridor sprite

```
corridor/
├── README.md
├── idle_01.png .. idle_16.png   runtime strip (corridor dir root)
├── raw/                         source MP4 + extractor + 16 keyed frames
└── processed/                   intended install dir; currently empty
                                 (the v17/v19 WIP strip lives at the dir root)
```

## raw/

| File | Purpose |
|---|---|
| `i2v_clip_android_corridor.mp4` | Source video, green-screen background. **Source of truth.** |
| `sprite_extractor.py` | Pipeline: MP4 → 16 chroma-keyed PNGs → 180×320 RGBA strip installed into `processed/`. Local to this scene; the generalised equivalent lives at `tools/key_sprite.py`. |
| `transparent_sprites/frame_00.png` .. `frame_15.png` | 16 chroma-keyed PNGs at source resolution (768×1364) — kept as a regression baseline for v6/v17/v19 chroma tuning. Re-derive with `python3 tools/key_sprite.py --bg green`. |

## idle_01.png .. idle_16.png

16 sprite frames at **180×320 RGBA**. This is the strip that
`story.json` references and that the runtime loads. The current contents
are the v17/v19 working set (uncommitted), not yet the output of a fresh
`sprite_extractor.py` run.

The directory contains a `processed/` subdir but it's empty — it would be
the install target if `sprite_extractor.py` were run; until then, the
runtime strip stays at the corridor dir root for clarity. **Do not move
the strip into `processed/` without updating `story.json`** — see
`assets/sprites/SPRITE_PIPELINE.md` for the wider reasoning.

## Regenerate the strip

The local `sprite_extractor.py` produces a new strip in `processed/` (with
a backup to `/private/tmp/WT_pre_corridor_install_<timestamp>/`):

```
cd raw
python3 sprite_extractor.py
```

This is the corridor-specific pipeline. For other scenes (or to key a
different green-tinted source), use the general `tools/key_sprite.py`:

```
python3 tools/key_sprite.py \
    --src raw/i2v_clip_android_corridor.mp4 \
    --out raw/transparent_sprites/ \
    --bg green \
    --start 1 --end 130 --keyframes 16
```

`tools/key_sprite.py` writes 16 keyed PNGs at source resolution into the
target dir; it does not resize or install.

## Naming

Extracted `frame_NN.png` becomes `idle_{NN+1:02d}.png`. So `frame_00` →
`idle_01`, `frame_15` → `idle_16`. Sixteen keyframes total.
