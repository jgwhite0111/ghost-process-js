# AI-HANDOFF — ghost-process-js

## Stack

Vanilla JavaScript + InkJS + Express. No engine. No Phaser. No Godot. No Mono. No Yarn Spinner. No bundler.

PC-98 / late-80s cyberpunk horror visual novel, point-and-click, mature (no moe). See `README.md` and `AGENTS.md`.

## State

```
HEAD:    0613acf handoff: name the project type (PC-98 cyberpunk horror VN)
Branch:  main, 52 commits ahead of origin/main
Tree:    clean (modulo this audit's MD edits)
Server:  http://localhost:8765 (node server.js)
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

## Key files

- `tools/make_scene_loop.py` — 9 SCENES + 9 SCENES_B (medleys)
- `tools/render-midi.sh` — FluidSynth + sc55.sf2
- `tools/test_full_chain.py` — smoke test
- `tools/gen_asset.py` — image-gen pipeline (style bible + Bayer dither)
- `assets/audio/sc55.sf2` — General MIDI stand-in (not a real SC-55 ROM)
- `story.json` — scene wiring (single source of truth)
- `src/runtime/scene-base.js` — Scene class
- `src/runtime/music.js` — crossfade; reads `music` as string or array
- `editor.html` / `editor.js` — browser scene editor (PUT /api/story)

## Open items

- terminal_lab A/B duration mismatch (62s vs 81s) — design intent but loop boundary audible.
- Walking-bass pass on remaining scenes (user undecided).
- `sc55.sf2` is a VintageDreams GM stand-in, not a real SC-55 ROM — see `docs/SC55_AB_TEST.md` for the deferred swap plan.