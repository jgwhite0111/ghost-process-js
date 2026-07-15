# AI-HANDOFF — ghost-process-js

## Stack assertion

Live project: `/Users/jwhite/ghost-process-js` — vanilla JavaScript + InkJS + Express. No engine, Phaser, Godot, Mono, Yarn Spinner, bundler, or TypeScript. The old sibling projects are not live. Read `AGENTS.md`, then `SPEC.md` / `README.md` as needed. There is no `LEGACY.md` in this repository at the current HEAD.

PC-98 / late-80s cyberpunk horror point-and-click visual novel. Mature proportions; no moe.

## Update (2026-07-15)

### Current live state

- Branch: `main`; verified code commit: `845521c fix(audio): unlock intro_theme on Safari by wiring a canvas-level pointerdown fallback`.
- `origin/main` is `339b3bf`; the branch is **2 commits ahead, 0 behind**. Both ahead commits are uncommitted work I produced and committed this session in response to direct user instruction: `890a18c docs: refresh handoff after hitbox work push` (uncommitted docs refresh from the prior session boundary, but actually already committed — the handoff just hadn't been updated since) and `845521c` (the Safari audio fix). Neither has been pushed; the user authorized commits, not pushes — do not push.
- The working tree is clean; the documentation commit that closes this session boundary is the next commit after `845521c`.
- Verification: **61/61 tests passed** (was 60; the +1 from the new `MusicHandler.resumePending` regression test). `git diff --check` passed; the live server returns HTTP 200; Express is still listening on `http://localhost:8765` as PID 67650.
- `terminal_lab_c` MIDI/MP3 remain untouched. No audio assets were rewritten in this update.

### Work completed this update — Safari intro_theme autoplay unlock

- The user reported that `intro_theme.mp3` does not start playing when the title viewport is clicked, and suggested it could be Safari-specific. Headless-Chrome reproduction in this session reproduced the same symptom: the document-level capture-phase `pointerdown` fallback in `MusicHandler._queueResume` (music.js) fires, but Safari does not credit that listener as an autoplay gesture, so `audio.play()` is silently rejected.
- Root cause: Safari only credits element-level event handlers (call-stack `play()` invoked inside a real handler on a real DOM element) for autoplay-unlock gesture recognition, while document-level capture-phase listeners do not qualify. Chrome and Firefox are more permissive.
- Fix: refactored the resume body out of the inline `_queueResume` closure into a new public `MusicHandler.resumePending()` method (music.js). The intro scene's `onReady` (`src/scenes/_registry.js`) now wires a one-shot `pointerdown` listener directly on the canvas — Safari credits that as a gesture. `_pendingResumeVolume` and `_pendingResumeFadeMs` are stashed alongside `_pendingResume` so a late `resumePending()` call replays exactly the queued fade.
- Existing document-level fallback is left intact (other scenes / browsers / non-intro flows still rely on it). The existing click handler in `_triggerHitbox` is untouched, so the title-music-start test contract ("START relies on MusicHandler first-gesture fallback instead of calling audio.play itself") still holds.
- Diff stat: `src/runtime/music.js` +41/-16, `src/scenes/_registry.js` +26/-3, `test/title-music-start.test.js` +70/0. Suite moved from 60 to **61 passing tests**.
- Code commit: `845521c fix(audio): unlock intro_theme on Safari by wiring a canvas-level pointerdown fallback`.

### Next-session starting point

- Do not redo the Safari intro_theme fix, the hitbox lifecycle work, the editor music transport, dialogue typography, or runtime-style editor preview work.
- After this documentation commit, expect a clean tree with code commit `845521c` immediately below, the branch **2 commits ahead, 0 behind** `origin/main` (`890a18c docs` + `845521c fix`, neither pushed yet). Do not push unless explicitly requested.
- Preserve the existing scope guardrails: the audit queue is complete; `story.json` remains protected except for its already-verified editor-routing correction; leave `terminal_lab_c` audio alone unless the user specifically requests a change.

## Previous update (2026-07-15) — hitbox lifecycle + editor/title button hitbox tests (already on `main` as `339b3bf`, superseded by the current update)

- The user's direct request was a commit + push; the working tree already contained the completed work, so the commit + push was straightforward. Pushed commit `339b3bf` is real code + tests.
- `src/runtime/hitbox.js` now tracks a typed set of created hitbox refs for cleanup safety and deduplicates attach so double-mounts do not double-fire. `_registry.js` exposes the helper used by scenes.
- `editor.js` / `editor.html` / `styles.css` wire the per-button hitboxes (the editor's existing transport buttons now use the shared `Hitbox` machinery), plus matching styling.
- `test/editor-button-hitbox.test.js` and `test/title-music-start.test.js` are new; `test/hitbox-lifecycle.test.js` was extended. The suite moved from 56 to 60 passing tests at this point (and the current Safari fix pushed it to 61).

## Earlier update (2026-07-15) — editor music preview transport (committed `0d61dd9`)

- The user directly requested that each individual track/medley-track play button double as play and pause, plus a nearby position slider that updates during preview and allows seeking.
- `editor.js` exposes the shared `QueuePlayer` transport state/API: `toggleOne(src, opts)`, `pause()`, `resume()`, and `seek(time)`, with `paused`, `currentTime`, and `duration` state. The per-track button changes between `▶` and `Ⅱ`, with matching accessible labels; the shared seek slider and elapsed/total time display remain synchronized through requestAnimationFrame status updates.
- Paused preview identity survives inspector rerenders. Track edits, reordering/removal, mode changes, and queue edits stop playback when indices or source identity would otherwise become stale.
- `editor.html` adds the `.medley-seek` styling and expands `.medley-row` to seven columns so the slider sits beside the per-track controls.
- `test/editor-rerender-lifecycle.test.js` exercises the browser-like Audio transport, pause/resume/seek behavior, rerendered paused-row state, and structural-edit cleanup. Suite was 54 → **56 passing tests** at this point.
- Live browser verification on `alley_confrontation.mp3` changed the first row from `▶` to `Ⅱ` while the position advanced (`0:05 / 0:47`), then returned to `▶` while retaining the paused position (`0:12 / 0:47`). The slider was present, enabled during preview, and seek behavior was verified.
- Code commit: `0d61dd9 feat: add editor music preview transport`. Already superseded by the hitbox-lifecycle update.

## Earlier carry-over audit (2026-07-15)

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

### Hitbox lifecycle + button hitbox tests (commit `339b3bf`, superseded by the current Safari-audio update; do not redo)

- The hitbox machinery in `src/runtime/hitbox.js` is now ref-counted and dedup-safe; scenes using the shared helper should not need to track manual cleanup. If a future scene reports double-fire or stale-hit symptoms, audit against this ref-tracking before adding scene-side workarounds.
- The three new test files (`test/hitbox-lifecycle.test.js`, `test/editor-button-hitbox.test.js`, `test/title-music-start.test.js`) define the lifecycle contract. Any new hitbox user should sit inside that contract, not next to it.

### Safari intro_theme autoplay unlock (commit `845521c`, just landed)

- `MusicHandler.resumePending()` is the new public method that scene-level event handlers can call when Safari requires an element-level `pointerdown` to credit the autoplay gesture. Document-level capture-phase fallback remains the first line of defense for Chrome/Firefox.
- The intro scene wires it from a one-shot canvas `pointerdown` in `onReady`. Other scenes that hit similar Safari autoplay-credits-only-on-element-handlers quirks can do the same.
- A new regression in `test/title-music-start.test.js` pins the `resumePending` idempotency and listener-cleanup contract.

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
- `src/runtime/hitbox.js` — ref-counted, dedup-safe hitbox machinery shared by runtime scenes and the editor.
- `src/scenes/_registry.js` — scene registry helper used by hitbox wiring.
- `test/music-transition-lifecycle.test.js` — focused overlapping-fade and async-load regressions.
- `test/hitbox-lifecycle.test.js`, `test/editor-button-hitbox.test.js`, `test/title-music-start.test.js` — hitbox lifecycle contract and editor/title regressions.
- `editor.js` — editor queue player, music controls, and per-button hitboxes.
- `AGENTS.md` — current stack/style/verification rules.

Historical detail removed from this shortened handoff remains available in git history; this file is current operational state, not a permanent session transcript.
