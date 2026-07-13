# corridor/ — android corridor sprite

```
corridor/
├── README.md
└── frame_01.png .. frame_16.png   runtime strip (180×320 RGBA, this is
                                   what the runtime loads)
└── raw/                           source MP4 + extractor + 16 keyed frames
```

## raw/

| File | Purpose |
|---|---|
| `i2v_clip_android_corridor.mp4` | Source video, green-screen background. **Source of truth.** |
| `sprite_extractor.py` | Pipeline: MP4 → 16 chroma-keyed PNGs → 180×320 RGBA strip installed into `corridor/`. Uses **aspect-preserving shrink + paste-centred** for the install step so the figure's outstretched arm (with energy ball) isn't truncated by a non-uniform stretch. Local to this scene; the generalised keyer lives at `tools/key_sprite.py`. |
| `transparent_sprites/frame_00.png` .. `frame_15.png` | 16 chroma-keyed PNGs at source resolution (768×1364) — kept as a regression baseline for v6/v17/v19 chroma tuning. Re-derive with `python3 tools/key_sprite.py --bg green`. |

## frame_01.png .. frame_16.png

16 sprite frames at **180×320 RGBA**. This is the strip that
`story.json` references and that the runtime loads. Contents are
freshly-generated from the raw MP4 via `sprite_extractor.py` (aspect-
preserving shrink + paste-centred).

The previous "intended install dir" was a `processed/` subdir; that
was removed when the script was fixed to install directly into
`corridor/` (where `story.json` actually points).

## Regenerate the strip

```
cd raw
python3 sprite_extractor.py
```

This extracts 16 evenly-spaced keyframes from the source MP4
(frames 1..129), chroma-keys the green BG, then installs the
180×320 RGBA strip into `../` (i.e. `corridor/`). The existing
strip is backed up to `/private/tmp/WT_pre_corridor_install_<timestamp>/`
before overwriting.

For other scenes (or to key a different green-tinted source), use
the general `tools/key_sprite.py`:

```
python3 tools/key_sprite.py \
    --src raw/i2v_clip_android_corridor.mp4 \
    --out raw/transparent_sprites/ \
    --bg green \
    --start 1 --end 130 --keyframes 16
```

`tools/key_sprite.py` writes 16 keyed PNGs at source resolution into
the target dir; it does not resize or install.

## Naming

Extracted `frame_NN.png` becomes `frame_{NN+1:02d}.png`. So
`frame_00` → `frame_01`, `frame_15` → `frame_16`. Sixteen keyframes
total.

## Why aspect-preserving shrink?

The source frame's figure bbox doesn't always match the runtime
slot's aspect ratio. The ball-frames (`frame_00` aspect 0.554,
`frame_15` aspect 0.547) are slightly taller than the 180×320 slot
(0.5625). A naive `im.resize((180, 320))` stretches the figure
horizontally to fill, which distorts proportions and — more visibly —
truncates the outstretched arm when the figure touches x=0 in the
source (it does for frames 18..120). The shrink-and-paste approach
keeps the figure's source proportions and centres it on a transparent
180×320 canvas, so no edges are lost.
