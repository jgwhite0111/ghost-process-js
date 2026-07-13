# AI-HANDOFF — ghost-process-js

## Stack

Vanilla JavaScript + InkJS + Express. No engine. No Phaser. No Godot. No Mono. No Yarn Spinner. No bundler.

PC-98 / late-80s cyberpunk horror visual novel, point-and-click, mature (no moe). See `README.md` and `AGENTS.md`.

## State

```
HEAD:    9c83959 docs: update AI-HANDOFF for new session
Branch:  main, 59 commits ahead of origin/main
Tree:    dirty — see "Recent work" below (chase A+B+C+D+E medley experiment, uncommitted)
Server:  http://localhost:8765 (node server.js, PID from prior session)
Python:  3.11.6 (no pip module; use `pip→python3.11` or `uv`)
```

## What's running

```bash
npm start                    # Express on :8765
python3 tools/test_full_chain.py   # renders all medleys + smoke test
./tools/render-midi.sh <file.mid>  # render one MIDI to MP3 (or no args for all)
python3 tools/make_scene_loop.py <scene> [--no-render]  # compose + render (or MIDI-only)
python3 tools/make_scene_loop.py --list  # show all scenes
```

## Scene graph

`intro → cold_open → alley → chase → kabukicho → corp_office → corridor → jailbreak → terminal_lab → ship_engine → alley (loop)`

10 scenes. 9 use A+B medley crossfade. **chase is the 5-track experiment** (A+B+C+D+E). `intro` is single track.

## Music map

`music` is a string for solo (`intro`) or `[{file, fadeAt?}, ...]` for medleys. `fadeAt` is the seconds into the *current* track's playback before the next track crossfades in.

| scene        | music                                                                      | fadeAt |
|--------------|----------------------------------------------------------------------------|--------|
| intro        | `intro_theme.mp3` (solo)                                                   | —      |
| cold_open    | `cold_open.mp3` → `cold_open_b.mp3`                                        | 51.1   |
| alley        | `alley_confrontation.mp3` → `alley_confrontation_b.mp3`                    | 23.8   |
| **chase**    | `chase.mp3` → `chase_b.mp3` → `chase_c.mp3` → `chase_d.mp3` → `chase_e.mp3` | 31.6 / 45 / 36 / 36 |
| corridor     | `corridor.mp3` → `corridor_b.mp3`                                          | 60.5   |
| jailbreak    | `jailbreak.mp3` → `jailbreak_b.mp3`                                        | 35.1   |
| kabukicho    | `kabukicho.mp3` → `kabukicho_b.mp3`                                        | 31.4   |
| **corp_office**  | `corp_office.mp3` → `corp_office_b.mp3` → `corp_office_c.mp3` → `corp_office_d.mp3` → `corp_office_e.mp3` | 37.3 / 42 / 50 / 22 |
| terminal_lab | `terminal_lab.mp3` → `terminal_lab_b.mp3`                                  | 50.6   |
| ship_engine  | `ship_engine.mp3` → `ship_engine_b.mp3`                                    | 51.7   |

26 MP3s wired into `story.json` (intro_theme + 25 medley tracks across 9 scenes × up to 5 tracks each). 27 MIDIs on disk. `clinic_tension.mid` / `.mp3` are orphaned (not in `story.json` `next`).

## Recent work

### 2026-07-13: corp_office 5-track medley, B REPLACED

The old corp_office B ("E.Piano moves from stabs to arpeggios") was the user's flagged as "too repetitive and not much of a complement to A" — the old B was just A with arpeggios substituted, which kept the same character. Replaced with a phase-based narrative arc: A=daytime build, B=after-hours solo, C=paranoia/glitch, D=cliff-hanger silence, E=recovery/loop seam. New B/C/D/E all designed as different *phases*, not just different textures (per `docs/MUSIC_BSIDE_GUIDE.md`).

| Track | Bars × BPM | Character |
|---|---|---|
| `corp_office` (A) | 20 @ 92 | EP stabs → full band crescendo (existing) |
| `corp_office_b` (B) — REPLACED | 20 @ 92 | After-hours solo: EP arpeggios only with halo pad swell, NO bass, NO drums. 5-chord cycle with extensions (m9, 6) ending on deceptive Dmaj7. |
| `corp_office_c` (C) | 20 @ 92 | Paranoia / surveillance glitch: bass returns with chromatic b2 approach on beat 4 of odd bars; kit has brush-snr ghost hits on 16th offbeats; pad shifts to sharp 11ths (F#m7#11 → Bm7#11 → D7#11 → G7b9 → Cmaj7); EP plays one b6 passing dissonance per 4-bar phrase. KICK MISSING on bar 16 = glitch event. |
| `corp_office_d` (D) | 8 @ 92 | Cliff-hanger: 2 dim7 stabs (F# dim7 → B dim7) on bars 0-2, then COMPLETE SILENCE for the held C#6 EP note on bars 3-7. Vibrato on the held note causes micro-silences (trembling). 23.2s rendered. |
| `corp_office_e` (E) | 20 @ 92→96 | Recovery: bars 0-3 hold C#6 anchor from D; bars 4-7 EP arpeggio returns; bars 8-11 bass+kit enter; bars 16-19 = A's exact opening (stabs only, kick 1+3, snare 2+4) for invisible loop seam. Slight tempo lift 92→96 = "end of shift". |

Per-track peak levels (FFmpeg EBU R128): A=existing → B=-25.9dB (intimate quiet) → C=-17.3dB (band returns, uneasy) → D=-16.6dB (dim7 stabs only) → E=-30.6dB→build. The drop into B is intentional — B is the "alone in the empty office" beat.

Total corp_office scene duration ~2:31 (up from ~1:30 with old A+B). E's last 4 bars = A's bars 0-3 = invisible loop seam.

Smoke test passed: A→B→C→D→E crossfades all complete cleanly via `window.MusicHandler._crossfadeToNext()`; readyState=4 on all tracks.

Files touched:
- `tools/make_scene_loop.py` — `SCENES_B["corp_office_b"]` rewritten + new `["corp_office_c"]` / `["corp_office_d"]` / `["corp_office_e"]` with pattern builders
- `tools/make_scene_loop.py` MEDLEYS dict — `corp_office` now lists 5 tracks
- `story.json` — corp_office.music extended to 5 entries (fadeAt 37.3 / 42 / 50 / 22)
- New assets: `corp_office_c.mp3` (55.5s) / `corp_office_d.mp3` (23.2s) / `corp_office_e.mp3` (44.0s) + `.mid` sources; `corp_office_b.mp3` / `.mid` overwritten in place (new design)

### 2026-07-13: chase 5-track medley experiment (committed as `310784b`)

The chase scene got too repetitive at 2 tracks (A+B), and stretching songs longer made them feel slow/padded. New design: 5-track A+B+C+D+E with a narrative arc instead of pure duration-extension.

| Track | Bars × BPM | Character |
|---|---|---|
| `chase` (A) | 24 @ 132→144 | 4-on-floor chase begins, half-time drop at bar 16 |
| `chase_b` (B) | 24 @ 132 | Same key, busier bass, low pulse — "accelerate" |
| `chase_c` (C) | 24 @ 132→148 | Ride bell dominant, tom fills every 2 bars, high saw scream — "closer" |
| `chase_d` (D) | 16 @ 88 | D-minor pivot, dim7 pad chain, single held saw w/ heavy vibrato, heartbeat kit — "caught glimpse" |
| `chase_e` (E) | 20 @ 88→132 | Half-time lift, kit comes back bar-by-bar, full blast — "recovery / loop seam" |

Distinguishing principle (vs the failed "stretch songs longer" pass): each track adds *new material* with a different role; the total time comes from more tracks each ~49s, not slower tempos. E-minor song family throughout (per `docs/MUSIC_BSIDE_GUIDE.md`).

Total chase scene duration ~3:13 (up from ~1:20 with A+B). Peak levels measured per track via FFmpeg EBU R128: A=-12.6dB → B=-7dB → C=-6dB (peak aggression) → D=-16.6dB (lull, held note) → E=-14dB→-4dB (recovery). The 10dB drop at D is intentional — scare moment.

Runtime smoke test: medley crossfades A→B→C→D→E all complete cleanly (verified via `window.MusicHandler._crossfadeToNext()` in browser console).

Files touched:
- `tools/make_scene_loop.py` — added `SCENES_B["chase_c"]`, `["chase_d"]`, `["chase_e"]` with pattern builders
- `story.json` — chase.music array now has 5 entries (fadeAt 31.6 / 45.0 / 36.0 / 36.0)
- New assets: `chase_c.mp3`, `chase_d.mp3`, `chase_e.mp3` + `.mid` sources

### 2026-07-13: editor "+ Sprite" placeholder handle fix (committed as `1ecef7e`)

`+ Sprite` button added a metadata entry but no canvas handle when the sprite had no PNGs yet — invisible/unreachable after first click. Fix in `editor.html` + `editor.js`: `computeSpriteRect` returns a dashed placeholder rect with `.no-frames` class when no image cached.

## Key files

- `tools/make_scene_loop.py` — 9 SCENES + 14 SCENES_B (medleys; chase & corp_office have 5-track medleys)
- `tools/render-midi.sh` — FluidSynth + sc55.sf2 (silenceremove trailing-trim)
- `tools/test_full_chain.py` — smoke test
- `tools/gen_asset.py` — image-gen pipeline (style bible + Bayer dither)
- `tools/key_sprite.py` — sprite frame extraction
- `assets/audio/sc55.sf2` — General MIDI stand-in (not a real SC-55 ROM)
- `story.json` — scene wiring (single source of truth)
- `src/runtime/scene-base.js` — Scene class (dead callback fields already cleaned)
- `src/runtime/music.js` — crossfade with 3+ track medley support (lines 179-191)
- `editor.html` / `editor.js` — browser scene editor (PUT /api/story)

## Open items

- chase 5-track medley is experimental — check after a real playthrough whether C/D/E land tonally, or whether the fadeAt values need re-tuning (C-D and D-E happen at strict times; D's 16-bar / 49s runtime might want different dwell).
- terminal_lab A/B duration mismatch (62s vs 81s) — design intent but loop boundary audible.
- `sc55.sf2` is a VintageDreams GM stand-in, not a real SC-55 ROM — see `docs/SC55_AB_TEST.md` for the deferred swap plan.
- Editor sidebar: only shows currently-selected sprite's metadata, not a list of all sprites in the scene. Different UX gap — now less critical after the placeholder-handle fix, but a sidebar list would still be nicer for scenes with 3+ sprites.
- `git push` the 59 local commits to `origin/main` — pending user go-ahead.
