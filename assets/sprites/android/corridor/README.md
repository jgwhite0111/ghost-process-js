# corridor/ — android corridor sprite

```
corridor/
├── raw/           source: MP4 + extractor script (regenerate the strip from these)
└── processed/     runtime: idle_01.png .. idle_16.png that the engine loads
```

## raw/

| File | Purpose |
|---|---|
| `i2v_clip_android_corridor.mp4` | Source video, green-screen background. **Source of truth.** |
| `sprite_extractor.py` | Pipeline: MP4 → 141 decomposed frames → 16 chroma-keyed PNGs → 180×320 RGBA strip |
| `transparent_sprites/frame_00.png` .. `frame_15.png` | 16 chroma-keyed PNGs at source resolution — kept as a regression baseline for v6/v17/v19 chroma tuning |

The 141 `frame_001.png .. frame_141.png` MP4-decomposition intermediates are
**not** committed — they're a transient by-product of `sprite_extractor.py`
and regenerable from the MP4 in seconds. Same for any larger
`frame_001..frame_NNN.png` set: just run the extractor to recompose.

## processed/

16 sprite frames at **180×320 RGBA**: `idle_01.png` .. `idle_16.png`. This is
what `story.json` references and what the runtime loads. Do not hand-edit
these; regenerate via `sprite_extractor.py` instead.

## Regenerate the strip

```
cd assets/sprites/android/corridor/raw
python3 sprite_extractor.py
```

Existing `processed/` frames are backed up to
`/private/tmp/WT_pre_corridor_install_<timestamp>/` before being overwritten.

## Naming

Extracted `frame_NN.png` becomes `idle_{NN+1:02d}.png`. So `frame_00` →
`idle_01`, `frame_15` → `idle_16`. Sixteen keyframes total.