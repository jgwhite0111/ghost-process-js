# AI-HANDOFF — ghost-process-js

## Stack

Vanilla JavaScript + InkJS + Express. No engine. No Phaser. No Godot. No Mono. No Yarn Spinner. No bundler.

PC-98 / late-80s cyberpunk horror visual novel, point-and-click, mature (no moe). See `README.md` and `AGENTS.md`.

## State

```
HEAD:    7540f4b scene-base: remove dead DialogueRunner callback fields
Branch:  main, 57 commits ahead of origin/main
Tree:    dirty — editor.html + editor.js modified (placeholder handle for no-frames sprites, uncommitted)
Server:  http://localhost:8765 (node server.js, PID 67650 from prior session)
Python:  3.11.6 (no pip module; use `pip→python3.11` or `uv`)
```

## What's running

```bash
npm start                    # Express on :8765
python3 tools/test_full_chain.py   # renders all medleys + smoke test
```

## Scene graph

`intro → cold_open → alley → chase → kabukicho → corp_office → corridor → jailbreak → terminal_lab → ship_engine → alley (loop)`

10 scenes. 9 use A+B medley crossfade. `intro` is single track.

## Music map

`music` is a string for solo (`intro`) or `[{file, fadeAt?}, ...]` for A+B medleys. `fadeAt` is the seconds-into-A where the crossfade to B-side kicks in.

| scene        | music                                                      | fadeAt |
|--------------|------------------------------------------------------------|--------|
| intro        | `intro_theme.mp3` (solo)                                   | —      |
| cold_open    | `cold_open.mp3` → `cold_open_b.mp3`                        | 51.1   |
| alley        | `alley_confrontation.mp3` → `alley_confrontation_b.mp3`    | 23.8   |
| chase        | `chase.mp3` → `chase_b.mp3`                                | 31.6   |
| corridor     | `corridor.mp3` → `corridor_b.mp3`                          | 60.5   |
| jailbreak    | `jailbreak.mp3` → `jailbreak_b.mp3`                        | 35.1   |
| kabukicho    | `kabukicho.mp3` → `kabukicho_b.mp3`                        | 31.4   |
| corp_office  | `corp_office.mp3` → `corp_office_b.mp3`                    | 37.3   |
| terminal_lab | `terminal_lab.mp3` → `terminal_lab_b.mp3`                  | 50.6   |
| ship_engine  | `ship_engine.mp3` → `ship_engine_b.mp3`                    | 51.7   |

19 MP3s wired into `story.json` (intro_theme + 18 medley halves). 20 MIDIs on disk. `clinic_tension.mid` / `.mp3` are orphaned (not in `story.json` `next`).

## Recent work (audit + editor bug)

Doc audit + dead-code cleanup (commits `d7f887f` → `7540f4b`, 5 commits):
- Deleted `LEGACY.md`, `tools/MIDI_STEM_LABELS.md` (phantom refs).
- Rewrote `AGENTS.md`, `README.md`, `SPEC.md`, `AI-HANDOFF.md`, `assets/audio/README.md`, `assets/sprites/SPRITE_PIPELINE.md`, `docs/MUSIC_GRID.md`. Verified claims against live code/assets.
- Stripped Phaser references and "legacy" wording from all source comments.
- Fixed bug in `src/runtime/scene-base.js`: constructor was passing 6 callback fields (`onLine`, `onSpeaker`, `onAction`, `onGive`, `onPortrait`, `onTags`, `onCommand`) to `DialogueRunner`, but runner only stores 4 — others silently dropped, then overwritten anyway. Deleted dead fields + 2 no-op methods (`_handleAction`, `_handleTags`). No behavior change.
- Fixed `index.html` stale claims: "~700 LOC" → "~2150 LOC"; wrong palette slot map; phantom `tools/palettes.py` reference.

Editor bug fix (uncommitted, on disk now):
- `+ Sprite` button added a metadata entry to the sidebar but no handle on canvas (no PNGs yet), so once user clicked elsewhere the new sprite became invisible/unreachable.
- Fix: `computeSpriteRect` returns a placeholder rect (default targetH × 0.5 wide, `noFrames: true` flag) instead of `null` when no image cached. `renderOverlay` adds `.no-frames` class, label becomes `<id> (no frames)`, skips the play button. CSS: dashed grey + diagonal-stripe fill + grey grip. Selected state still goes orange via source order.
- Result: every character in a scene has a clickable handle. Existing real sprites render unchanged.

## Key files

- `tools/make_scene_loop.py` — 9 SCENES + 9 SCENES_B (medleys)
- `tools/render-midi.sh` — FluidSynth + sc55.sf2
- `tools/test_full_chain.py` — smoke test
- `tools/gen_asset.py` — image-gen pipeline (style bible + Bayer dither)
- `tools/key_sprite.py` — sprite frame extraction
- `assets/audio/sc55.sf2` — General MIDI stand-in (not a real SC-55 ROM)
- `story.json` — scene wiring (single source of truth)
- `src/runtime/scene-base.js` — Scene class (cleanup applied)
- `src/runtime/music.js` — crossfade; reads `music` as string or array
- `editor.html` / `editor.js` — browser scene editor (PUT /api/story)

## Open items

- terminal_lab A/B duration mismatch (62s vs 81s) — design intent but loop boundary audible.
- `sc55.sf2` is a VintageDreams GM stand-in, not a real SC-55 ROM — see `docs/SC55_AB_TEST.md` for the deferred swap plan.
- Editor sidebar: only shows currently-selected sprite's metadata, not a list of all sprites in the scene. Different UX gap from this session's fix — user can re-click via handle now but a sidebar list would be nicer for scenes with 3+ sprites. Not done.