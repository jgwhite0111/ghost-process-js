# AI-HANDOFF — ghost-process-js

## Stack assertion

Live project: `/Users/jwhite/ghost-process-js` — vanilla JavaScript + InkJS + Express. No engine, Phaser, Godot, Mono, Yarn Spinner, bundler, or TypeScript. The old sibling projects are not live. Read `AGENTS.md`, then `SPEC.md` / `README.md` as needed. There is no `LEGACY.md` in this repository at the current HEAD.

PC-98 / late-80s cyberpunk horror point-and-click visual novel. Mature proportions; no moe.

## Update (2026-07-15)

### Current live state

- Branch: `main`; code baseline: `ab0ca13 feat: match editor preview to runtime rendering`.
- This update is the documentation boundary on top of code commits `c1b8d6e` and `ab0ca13`; the user explicitly authorized committing and pushing all changes in this session.
- Before this handoff commit, the branch was **83 commits ahead of `origin/main`**, 0 behind; after this documentation commit and the requested push, `origin/main` should be synchronized.
- The working tree contained only this handoff update after the two code commits; the intended final state is clean.
- Verification: **54/54 tests passed**; `node --check editor.js` passed; `git diff --check` passed; the live editor returned HTTP 200; browser console was clean.
- Express is listening on `http://localhost:8765` as PID 67650.
- `terminal_lab_c` MIDI/MP3 remain untouched. No story data was changed by the editor-preview or dialogue-typography work.

### Work completed this update

- The user directly requested larger PC-98-style dialogue speech on laptops and PCs. `c1b8d6e` adds a responsive desktop-only typography block: 30px speech, 24px speaker, and 22px continue indicator for viewports at least 1024×600; smaller/mobile viewports retain their existing sizing.
- The user directly requested that the editor show scene images with the selected palette and runtime post-processing. `ab0ca13` makes the editor use the runtime palette resolution, source-resolution Bayer dither, sprite green-despill processing, scanlines, and title overlay; palette changes re-render immediately; stale asynchronous previews are revision-guarded.
- The live editor verified 16-color selected-palette output, palette switching/restoration, sprite processed-frame caching, exact scanline CSS, title overlay rendering, and rapid palette-change correctness.

### Next-session starting point

- Do not redo the dialogue typography or editor runtime-preview work; both are committed and verified above.
- This handoff is intended to be pushed with its documentation commit; a fresh session should confirm `git status --short` is empty and `git rev-list --left-right --count origin/main...HEAD` is `0 0`.

## Previous update (2026-07-15)

### Live carry-over audit

- Branch: `main`; latest code commit: `7b85309 fix: complete audited runtime and editor remediation`.
- Local branch after this handoff commit: **81 commits ahead of `origin/main`**, 0 behind.
- Working tree: **clean after this handoff commit**.
- All 15 audit fixes are parent-verified and committed in `7b85309` together with the post-queue `cold_open → alley` music-transition fix. Current verification is **54/54 tests passed**; all 9 Ink files compile; the focused Python tooling tests pass; `git diff --check` passes; and the live server returns HTTP 200.
- The pre-existing editor-authored `story.json` changes remain protected; audit changes to that file are limited to the verified `intro → cold_open` route correction and removal of the unsupported top-level recipes block.
- `terminal_lab_c` MIDI/MP3 remain untouched. Nothing was pushed.
- Express is still listening on `http://localhost:8765` as PID 67650.

The completed audit-remediation batch, its regression suite, current documentation corrections, and the verified post-queue music-lifecycle fix landed together in `7b85309`. This documentation commit records the resulting clean session boundary.

Always ground a new audit in the live tree first:

```bash
cd /Users/jwhite/ghost-process-js
git status --short
git diff --numstat
git log -5 --oneline
```

### Carry-over cleanup completed

- Re-audited the handoff and standing project docs against live code/data.
- Replaced stale current-state A+B medley claims with the live ordered A→B→C→D→E configuration; retained the old B-side guide only as explicitly superseded historical provenance.
- Corrected the `SPEC.md` PRESS START example to `cold_open` and aligned its task-schema reference with `src/tasks.js`.

### Post-queue playtest fix: `cold_open → alley` music leak

- The user directly reported that entering alley could leave cold-open music playing alongside alley music.
- Root cause: one direction-wide outgoing-ramp generation let a newer fade cancel an older medley fade before its pause callback; async scene music requests could also resolve out of order.
- `src/runtime/music.js` now tracks outgoing ramp generations per Audio element and invalidates stale scene-level play/medley requests after awaited loads or playback starts.
- Added `test/music-transition-lifecycle.test.js` with focused regressions for the overlapping cold-open-medley → alley transition and out-of-order scene audio loads.
- Parent verification: `npm test` passed **54/54**. The exact live-browser reproduction ended with `cold_open.mp3` and `cold_open_b.mp3` paused at volume 0 and `alley_confrontation.mp3` as the sole playing track at volume 0.7.
- These changes are committed in `7b85309`.

### Earlier audio follow-up (`0e3fb47`)

The user approved the exact follow-up previously proposed: ship the verified `terminal_lab_e` drum fix and the `jailbreak_d` drum + lead fix, while leaving `terminal_lab_c` audio alone.

#### `terminal_lab_e`

- Replaced nested drum tuples whose third value was incorrectly treated as a velocity delta. `schedule_drums()` actually consumes raw velocity, so negative/zero values muted kick and snare.
- Builder now emits flat `(tick, NOTE, absolute_velocity)` drum events.
- Re-rendered `assets/audio/terminal_lab_e.mid` and `.mp3`.
- Post-render drum audit: **KICK 56 / SNARE 28 / HAT 96 / velocity-0 events 0**.
- Render duration: 59.73s. Body RMS average measured -37.1dB.

#### `jailbreak_d`

- Fixed the same raw-drum-velocity bug using flat absolute-velocity drum events.
- Replaced the single 60-beat held A5, which attenuated toward silence in FluidSynth, with short irregular breathing phrases and rests.
- Broke the bass drone into audible cells rather than one continuous decaying note.
- Re-rendered `assets/audio/jailbreak_d.mid` and `.mp3`.
- Post-render drum audit: **KICK 16 / SNARE 16 / RIDE 32 / velocity-0 events 0**.
- Post-render channel note-ons: **lead 11 / bass 9 / pad 8 / drums 64**; combined melodic longest empty run is 1 bar.
- Render duration: 66.99s. Body RMS average measured -51.7dB; this remains a deliberately quiet dread track, but the lead is now made of recurring short phrases rather than one fading held note.

#### `terminal_lab_c`

- Its MIDI and MP3 were intentionally not changed in the final commit.
- Only a source comment was added to document that the 4-bar lead gaps are intentional glitch structure and should not be filled without user feedback.
- Do **not** infer that `terminal_lab_c` needs a melody fill from the old audit text. The user did not request one, and the abandoned rewrite/revert cycle left its rendered assets clean.

### Verification performed

```text
python3 -m py_compile tools/make_scene_loop.py     PASS
git diff --check                                  PASS
python3 tools/make_scene_loop.py terminal_lab_e   PASS; MID+MP3 regenerated
python3 tools/make_scene_loop.py jailbreak_d      PASS; MID+MP3 regenerated
GET http://127.0.0.1:8765/                        HTTP 200
```

The final commit contains exactly five changed files:

- `tools/make_scene_loop.py`
- `assets/audio/terminal_lab_e.mid`
- `assets/audio/terminal_lab_e.mp3`
- `assets/audio/jailbreak_d.mid`
- `assets/audio/jailbreak_d.mp3`

### Immediately preceding audio batch (`29bdec0`)

This was already committed before the latest follow-up. Do not rediscover or restage it.

- Fixed raw drum-velocity bugs in `jailbreak_c`, `jailbreak_e`, `terminal_lab_c`, and `ship_engine_c`.
- Replaced inaudible held-note patterns in `terminal_lab_d` and `ship_engine_d` with breathing motifs.
- Reworked repetitive `corridor_c` bars 16–23.
- Replaced `chase_b`'s single-pitch repeated lead with rotating motifs.
- Regenerated the corresponding MIDI/MP3 assets.
- `46b38ae` immediately before that fixed the same held-note attenuation class in `kabukicho_d`.

Recent history:

```text
ab0ca13 feat: match editor preview to runtime rendering
c1b8d6e feat: enlarge desktop dialogue typography
295d101 docs: record committed audit remediation batch
7b85309 fix: complete audited runtime and editor remediation
169d2d0 docs: refresh handoff for next session
```

## Current music/runtime state

Scene graph:

`intro → cold_open → alley → chase → kabukicho → corp_office → corridor → jailbreak → terminal_lab → ship_engine → alley`

- 10 scenes total.
- `intro` uses one MP3.
- All 9 gameplay scenes now use **five-track A→B→C→D→E medleys**.
- `story.json` wires 46 MP3s: `intro_theme.mp3` plus 45 medley tracks.
- 48 MP3s and 47 MIDIs are tracked on disk.
- Unwired audio pairs: `clinic_tension.{mid,mp3}` and `smoky_club_intro.{mid,mp3}`.
- `intro_theme.mp3` is the one runtime MP3 without a MIDI counterpart.

`fadeAt` is stored on the **destination entry** and means “crossfade into this track after the previous/current track has played this many seconds.” Current `story.json` values:

| Scene | Tracks | Destination-entry `fadeAt` values (B / C / D / E) |
|---|---|---|
| cold_open | A→B→C→D→E | 51.1 / 82.3 / 52.8 / 82.3 |
| alley | A→B→C→D→E | 23.8 / 41.7 / 50.5 / 41.7 |
| chase | A→B→C→D→E | 31.6 / 45.0 / 36.0 / 36.0 |
| corridor | A→B→C→D→E | 93 / 95 / 63 / 95 |
| jailbreak | A→B→C→D→E | 35.1 / 42.9 / 62.0 / 45.1 |
| kabukicho | A→B→C→D→E | 31.4 / 61.1 / 50.4 / 61.1 |
| corp_office | A→B→C→D→E | 37.3 / 42 / 50 / 22 |
| terminal_lab | A→B→C→D→E | 50.6 / 54.7 / 57.6 / 54.7 |
| ship_engine | A→B→C→D→E | 51.7 / 72.0 / 46.0 / 72.0 |

Runtime implementation is `src/runtime/music.js`; the editor's queue player intentionally auditions tracks sequentially rather than rehearsing runtime crossfade timing.

## Current editor/runtime state

- `editor.html` loads the registered palette scripts plus `src/runtime/canvas.js` and `src/runtime/sprites.js` before `editor.js`, so the editor shares the runtime processing implementations rather than maintaining approximations.
- `editor.js` processes background plates at source resolution before `Runtime.coverRect()`; sprite frames use `CharacterSprite._despillGreen()`; the title overlay and exact 2px multiply scanline pass are visible in the preview.
- Palette changes call `renderPreview()` immediately. A monotonic preview revision prevents a slower earlier palette/scene request from painting over the latest selection.
- Editor handles remain above the visual post-process layer. The editor preview is intentionally a placement/development view; it does not replace the runtime's dialogue interaction layer.

## Active carry-over

### Completed audit-remediation queue

1. `AUDIT-FIX-TODO.md` is complete: all fixes 1–15 are verified. Do not continue implementing the queue or invent further work from superseded audit wording.
2. The completed audit batch plus the verified `cold_open → alley` music-lifecycle fix are committed in `7b85309`; the later dialogue-typography and editor-preview commits are `c1b8d6e` and `ab0ca13`.
3. Preserve the verified scope: no audio rewrites, asset generation, or unnecessary consolidation of historical one-off preview helpers.
4. Keep the protected `story.json` editor changes byte-for-byte except for the already-verified `intro → cold_open` route correction and removal of the unsupported top-level recipes block.

### Audio feedback guardrails

- If the user gives listening feedback on `terminal_lab_e` or `jailbreak_d`, act on that feedback rather than defending the metrics.
- Leave `terminal_lab_c` audio unchanged unless the user specifically says it still sounds wrong.

### Audit/listen candidates, not confirmed defects

- `jailbreak_c` still contains intentional one-bar gaps after its drum repair.
- `kabukicho_c/e` and other sparse D/E sections may warrant listening in a real playthrough, but no current user instruction says to rewrite them.
- Full five-track medley fade timing still deserves an eventual end-to-end playthrough.

Do not upgrade these parking-lot items into active work without fresh user direction.

### Deferred / someday

- Replace the VintageDreams GM stand-in `assets/audio/sc55.sf2` only through the deferred A/B workflow in `docs/SC55_AB_TEST.md`.
- Editor sidebar could eventually list every sprite in a scene rather than only the selected sprite.

## Audio diagnostic rules that matter

For “silent,” “spartan,” or “repetitive” complaints, use all four layers before declaring a track intentional:

1. MIDI per-bar/channel density.
2. MP3 RMS windows.
3. FFT band/dominant-frequency analysis.
4. Monotony/pattern repetition analysis.

Important composer behavior:

- `schedule_note_sequence()` advances a cursor through notes inside one phrase. Notes meant to sound in parallel must be separate phrases at the same start tick.
- `schedule_drums()` consumes flat `(tick, note, raw_velocity)` events. Velocity 0 is silent; do not pass bass/lead-style deltas.
- Long held sax/lead notes can attenuate to near-silence in FluidSynth. Prefer short breathing motifs with rests.
- MIDI note counts do not prove rendered audio is audible.

## Key commands/files

```bash
npm start
python3 tools/test_full_chain.py
python3 tools/make_scene_loop.py --list
python3 tools/make_scene_loop.py <track>
python3 tools/make_scene_loop.py <track> --no-render
./tools/render-midi.sh assets/audio/<track>.mid
```

- `story.json` — scene and music wiring; single source of truth.
- `tools/make_scene_loop.py` — 44 renderable track configurations; `story.json` owns the nine five-track queue definitions.
- `tools/render-midi.sh` — FluidSynth render pipeline.
- `tools/test_full_chain.py` — broad render/smoke test.
- `src/runtime/music.js` — runtime crossfades and stale play-request invalidation.
- `test/music-transition-lifecycle.test.js` — focused overlapping-fade and async-load regressions.
- `editor.js` — editor queue player and music controls.
- `AGENTS.md` — current stack/style/verification rules.

Historical detail removed from this shortened handoff remains available in git history; this file is current operational state, not a permanent session transcript.
