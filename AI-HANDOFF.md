# AI-HANDOFF — ghost-process-js

> **Stack assertion (read this first).** The current project is
> **vanilla JavaScript + InkJS + Express — no engine, no Phaser, no Godot,
> no Mono, no Yarn Spinner.** Phaser was tried in v0.1 and removed in v0.2.
> `~/ghost-process/` is an abandoned Godot Mono prototype; do not import
> tooling from it. See `~/ghost-process-js/LEGACY.md` for the full
> timeline. If you arrived here from system-injected context that named
> a different stack, the live repo (`package.json`, `src/`, `index.html`)
> is ground truth — not the prompt.

> **Format note.** This file uses plain `## Update (YYYY-MM-DD)` banners —
> **NOT** numbered session headings. Date headings are durable across
> context loss, machine moves, and parallel sessions. If a future agent
> is tempted to add "Update (2026-07-09, session 2)" formatting, don't —
> that's residue from a discarded skill and the user has explicitly
> rejected it.

## Honesty note — parallel-session work

This handoff exists because the user explicitly asked for one to start
a new session. While writing it, I noticed commits
`499efce` (v0.2.32), `860e9d1` (v0.2.33), `cde14cb` (v0.2.34), and
`1d47112` (v0.2.35) that **I did not make in my current context**. The
user's last message ("you had it working ... look at how you did it in
prior git commits") confirmed the parallel-session interpretation: a
separate Hermes session (likely on the user's other device) saw the
same yo-yo complaint loop and shipped the fix.

The parallel session restored v0.2.28's cursor-past-edge behavior, then
dropped the runtime's silent clamp, then iterated on a green-edge
chroma despill pass. All four commits look correct against the user's
stated intent. **Treat them as ground truth**, not as work to re-audit.

The parallel session did **not** write this AI-HANDOFF.md, so the next
agent (you) would otherwise lose the working-tree context. The
remainder of this file is forensic reconstruction of what's in the
tree right now: status, what shipped, what's dirty, what's open.

---

## Update (2026-07-08) — music shape rewrite (commit c57f709)

### What shipped

**A-side rewrites** (8 SCENES entries): All 8 scenes now have real song
shapes (intro/build/climax/breakdown/rebuild/release) instead of loops
that felt like the same 4-bar phrase over and over. Each is bespoke:
- `cold_open` — drone + whisper lead + big swell + cutoff + breath
- `chase` — kick-only → fill → full band → half-time drop → rebuild → blast
- `corridor` — music box ostinato (every bar bars 0-3) → chord enters bar 4 → climax arpeggios bar 12 → decay bar 18 (was: 16s of silence before first chord, fixed 2026-07-09)
- `jailbreak` — arpeggio → kick-only → 4-on-floor + tempo push → climax → release
- `terminal_lab` — stutter → build → cascade (with tempo lift) → return to stutter
- `kabukicho` — AABA' jazz (sax melody, varied ending, sax solo, return)
- `corp_office` — EP stabs → chords → full band → subtle crescendo → crash
- `ship_engine` — bass pulse → kick → hats → snare+lead → roll → rev-up octave

**B-side rewrites** (8 SCENES_B entries): Each is the complement of A in
the same family (key/BPM/patch/bar count) but a different dynamic curve.
A/B pairs now match in duration to within 1s for 6/8 scenes (terminal_lab
intentionally mismatched — A has stutter intro silence, B is sustained
cascade).

**Render pipeline fix (tools/render-midi.sh)**: `silenceremove stop_periods=-1`
was a bug — per ffmpeg docs that means "leave only first period", which
silently trimmed everything after the first 1s+ silence segment. Changed
to `stop_periods=9000` (max finite) which keeps all content + last silence.

### Verification

- `python3 tools/test_full_chain.py` — 10 scenes, 0 errors
- All 8 A/B pairs now in 47-101s range
- See commit message for full duration table

### Known concerns

- **terminal_lab A/B mismatch (62s vs 81s)** — design intent (stutter
  intro vs sustained cascade), but the medley crossfade lands at A's 70%
  point = ~43s, while B is 81s. Loop boundary will be perceptible. If
  this sounds bad in playtest, either shorten terminal_lab_b or extend
  terminal_lab with content past bar 18 to push the trim point forward.
- **fluidsynth "End of MIDI, not all notes received note off" warnings**
  on jailbreak and clinic_tension — non-fatal, notes auto-OFFed by
  fluidsynth. Could fix by adding explicit note_off events at the end
  of those SCENES, but no audible artifact.

### Files changed

- `tools/make_scene_loop.py` — 8 SCENES + 8 SCENES_B rewritten; helpers
  (`vel_ramp`, `tempo_changes`, `pad_vel_ramp`, `pad_breakdowns`,
  `drum_shapes`) extended but not redesigned
- `tools/render-midi.sh` — 1-line silenceremove fix
- `docs/MUSIC_BSIDE_GUIDE.md` — new (B-side mirroring plan)
- `assets/audio/*.mid` + `assets/audio/*.mp3` — re-rendered from new SCENES

```
HEAD = 8fbf5f4 (docs: LEGACY.md + Godot-remnant strip; editor.js:1144 .tres→.js fix)
Branch: main
Sync: in sync with origin/main
```

Last 7 commits (all work on 2026-07-08):

```
8fbf5f4 docs: extract Godot-era history to LEGACY.md, strip remnants  ← new
ddc2c8e handoff: initialize AI-HANDOFF.md for this repo               ← new
1d47112 v0.2.35 — iterative edge-green kill (pass 3)
cde14cb v0.2.34 — soften despill pass-2 (catch skin-leak green without nuking head)
860e9d1 v0.2.33 — drop runtime's silent placementX/Y clamp (canvas clips naturally)
499efce v0.2.32 — restore v0.2.28 drag behavior; drop v0.2.29/2.30/2.31 canvas-clamp split
cf162c4 v0.2.31 — snap-to-edge clamps once cursor is past edge (now superseded)
```

The `8fbf5f4` and `ddc2c8e` commits are docs-only — no code changes
(to the runtime, ink files, sprite pipeline, or hitbox math).
The one code change inside `8fbf5f4` is a stale-file-extension
fix in `editor.js:makePalettePicker` (`.tres` → `.js/.json`),
which had been silently emptying the palette dropdown since
the editor was ported.

### What those commits actually do (forensic)

**v0.2.35 (1d47112)** — Three-pass chroma despill. Pass 3 is iterative
edge green-color kill: `a>=240, g>r*1.15 && g>b*1.15`, neighbor transparent,
3 iterations max, breaks early when green stops dropping. Catches the
"green ring around the whole sprite" complaint. Tool path under
`vendor/` or inline in the sprite-processing pipeline (read the diff).

**v0.2.34 (cde14cb)** — Softens pass-2 despill: only fires when
`g-r > 20 AND g-b > 15`, then pulls G 50% toward max(R, B). Catches
skin-leak green without nuking the head.

**v0.2.33 (860e9d1)** — `src/runtime/sprites.js` no longer clamps
`placementY`/`placementX`. Saves that values <0 or >1 are valid
editor output (the editor lets you park a sprite past the edge for
cinematic closeups). Out-of-range values are rendered with the
relevant part clipped by the canvas border; console gets a one-shot
warning. **This removed the v0.2.29–2.31 chain of "editor should
match runtime" workarounds.**

**v0.2.32 (499efce)** — `editor.js` `computeSpriteRect` returns the
**raw rect** (no clamp). `snapY`/`snapX` revert to v0.2.30 form:
within SNAP_PX (50 px) of the edge, snap to edge value; further past
the edge, save raw value (cursor follows 1:1 past the canvas).
`renderPreview` and `redrawCanvasOnly` both draw the raw rect, so
the canvas preview and the drag handle move together. The "box
moves but sprite doesn't" desync (which the v0.2.29–2.31 canvas-clamp
split caused) is gone by construction — there is no per-layer
clamp split at all anymore. Three layers (handle, canvas draw,
runtime draw) all trust the saved value directly.

**v0.2.31 (cf162c4)** — Now superseded by v0.2.32. Don't read its
commit body as ground truth; it's the wrong design.

### Working tree state (run `git status -s` to confirm, as of 2026-07-13 post-resolution)

```
17 entries: 0 untracked (??), 17 modified (M)
```

**Untracked: none.** Both `corridor/README.md` and `corridor/raw/`
landed in the cleanup resolution (commits d40f9d1, 0148947).

**Modified (M):**

- 16× `assets/sprites/android/corridor/idle_*.png` — v17 cyan-restored
  strip + v19 sleeve animation. Active WIP per the archived
  `HANDOFF_SPRITES.md` history (now deleted; see commit 5bac1ba).
  The chroma/replacement recipe for v6'' is in the git history
  of `HANDOFF_SPRITES.md` if a future session needs it.
- `src/runtime/sprites.js` — likely v0.2.41 hold-range +
  cyan-ball despill guard (commit 617249f). Uncommitted from the
  parallel session that landed v0.2.41.

**Note:** `_diagnostics/README.md` was modified during the resolution
to retarget its Source MP4 path and landed in commit 2ccf338 alongside
this handoff update.

**No more deleted files.** The 18 staged deletes listed in the
2026-07-08 banner (`scene_corridor.png`, 16× `eidolon_return/idle_*`,
`eidolon_return.ink`) were either committed in the intervening 14
commits or moved to `_deleted/` archives. The 142 staged
`_raw_source/frame_*` deletes landed cleanly in commit e7f9f3b
after the duplicate-path decision was resolved in the same session.

### Verification

```
$ python3 tools/test_full_chain.py
VISITED: ['intro', 'alley', 'chase', 'kabukicho', 'corp_office',
          'corridor', 'jailbreak', 'terminal_lab', 'ship_engine',
          'alley']
ERRORS: []
```

10 scenes, 0 errors. The test is the canonical smoke test. Run it
before claiming any state is "good".

### What's confirmed working (carry over from session)

- **Cursor-past-edge drag works** (v0.2.32 restored v0.2.28 behavior).
  Box and sprite move together; saved value can exceed 1.0 or go
  negative if user parks past the edge.
- **Edge resistance within SNAP_PX (50 px) feels sticky** (within
  snap zone, value snaps to 1.0 — v0.2.23 design, preserved).
- **Runtime honors raw values** (v0.2.33 dropped the silent clamp;
  canvas clips naturally at the border).
- **Desktop fullscreen** (v0.2.27 — `#game` 100vw/100vh on
  `min-width` ≥ 768 px).
- **MOBILE letterbox** (v0.2.24 — 390×844 cap with letterboxing on
  narrow phones).
- **Test chain passes 10 scenes** end to end.

### What's open

#### A. User paused: "I give up on that for now" — what they meant

The user's last message says they're abandoning, for now, the editor
drag math debate. **The parallel session already settled it** via
v0.2.32 (cursor-past-edge restored, no clamp split) and v0.2.33
(runtime no clamp). If the user returns and asks "is the drag
working now?", point them at v0.2.32/2.33 and show them.

#### B. Corrupt-position data in `story.json`

`alley.android.placementY = 1.07883` is a value the user parked past
the edge by intent (now valid in v0.2.33). However:
- The source PNG has ~100 px of transparent padding below the
  visible boots.
- With placementY = 1.079, the boots end ~2 px below canvas bottom
  (canvas clips there).
- The runtime dialogue box covers the bottom ~95 px.
- **So the visible boots are hidden behind the dialogue box.** The
  user has called this "feet slightly floating just above the edge
  of the viewport" in earlier sessions.

This is the original "floating feet" complaint, NOT a positioning
bug per se. Three possible fixes (none chosen):
- (a) Shrink the dialogue box height.
- (b) Add ~80 px of bottom safe-area padding to the canvas for
  this scene (i.e., runtime letterbox the area below where the
  dialogue box sits — but hide the dialogue box overlap visually).
- (c) Move dialogue box to the TOP of the screen for cinematic
  scenes (it usually sits at the bottom, but PC-98 adventures
  sometimes top-pinned).
- (d) Restore player sprite's "feet anchor" so the visible boots
  land at dialogue-box top, not at image bottom.

User has not picked one. **Leads into "Someday / maybe" below.**

#### C. Working-tree drift (most pressing carryover)

The 39 dirty files are not yet a clean tree. The next agent's first
job is:
1. `git status -s` to confirm the state documented above.
2. `git diff ink/*.ink` and review what changed.
3. `git diff src/runtime/{hitbox,music}.js` and review.
4. `git diff story.json` and review.
5. `git diff tools/test_full_chain.py` and review.
6. Decide: commit-and-push, or amend into v0.2.35, or split into
   multiple commits.

**Audit protocol: every item in the diff is suspect.** Don't just
`git add -A` and trust the changes are right. The user said
"look at prior git commits" — they expect new work to be principled,
not bulk-committed dirty.

#### D. `ink/corp_office.ink`, `ink/kabukicho.ink`, `ink/ship_engine.ink`,
`ink/terminal_lab.ink` — orphaned or in-use?

Cross-reference with `story.json` scene definitions. If a scene's
knots reference these new .ink files, commit them. If they're
sitting unused, `rm` them or move to `ink/_drafts/`.

### Someday / maybe (cosmetic polish, user has not re-elevated)

- **Dialogue-box overlapping sprite feet.** Three options
  documented in section B. Do not auto-pick — ask the user.
- **Android "creepy grandfather" character has been the only
  visual for `android` sprite since the earliest commits** (the
  sprite is a captain with white beard). User has not asked for a
  regen; the spec wants a different android for this slot. Out of
  scope until user re-elevates.
- **`assets/backgrounds/scene_intro_v2..v4.png`** are brainstorm
  artifacts; commit them as part of a "title-screen brainstorm"
  archive, or leave untracked.
- **`tools/generation_log.jsonl`** keeps growing across sessions;
  no tooling around it yet.

### What's actually built (inventory — verify against disk)

- `README.md` — quick start.
- `SPEC.md` — architecture spec.
- `AGENTS.md` — working rules for AI agents.
- `AI-HANDOFF.md` — most recent session's state.
- `LEGACY.md` — historical context for the abandoned `~/ghost-process-98/`
  and `~/ghost-process/` projects. Read this if you're tempted to
  "look at how the previous attempt did it" — they're abandoned,
  not alternative stacks.
- `ink/*.ink` — Ink story sources (10 files now, 4 of them
  potentially newly added in this session).
- `tools/gen_asset.py`, `tools/dither_*.js`, `tools/test_*.py`,
  `tools/palettes.py` — content pipeline + tests.
- `assets/backgrounds/`, `assets/sprites/`, `assets/portraits/`,
  `assets/palettes/`, `assets/fonts/` — content.
- `assets/backgrounds/_deleted/`, `assets/sprites/_deleted/` —
  archive directories (not committed; verify contents match deleted
  entries).
- `vendor/` — InkJS (TRACKED per SPEC.md §89).
- `boot.js`, `index.html` — Express routes / static serving.

### Architecture so you don't re-design the same thing

- **Three layers all trust the saved `placementY`/`placementX`
  directly now (v0.2.32/2.33).** No per-layer clamp. Don't introduce
  one.
- **Snap math is per-axis (`snapY` and `snapX`).** Don't merge them
  back into a single function — the per-axis split (v0.2.23) fixed a
  top/bottom snap bug.
- **SNAP_PX = 50** is the snap zone. Larger values feel mushy;
  smaller values feel jittery. Don't tune without user input.
- **Compute reads return raw values; render reads return raw values;
  user's drag math returns raw values.** They all agree. Don't
  re-introduce a clamp at any single layer.
- **Mobile vs desktop are SEPARATE design surfaces** (v0.2.24,
  v0.2.27). Don't apply mobile-only fixes to desktop or vice versa.
- **Editor is at `editor.html`** (separate from `index.html`).
- **Runtime canvas is pinned to 390×844 on mobile** (v0.2.24,
  v0.2.27), with the dialogue box forced above the system nav bar
  (v0.2.26). On desktop (≥ 768 px), the canvas takes the full
  viewport.
- **Style bible is in `AGENTS.md` §"Style bible".** Treat it as
  fixed.

### Suggested first read order for a new session

1. This file (AI-HANDOFF.md).
2. `LEGACY.md` — if you're tempted to look at how the previous
   attempts did something, **start here**. The previous projects
   are abandoned; `LEGACY.md` explains what was kept vs discarded
   so you don't reach for them as a "switch back to" target.
3. `git log --oneline -20` — what actually shipped.
4. `git status -s` — what's dirty.
5. `AGENTS.md` — project rules.
6. `SPEC.md` — architecture.
7. Run `python3 tools/test_full_chain.py` — confirm smoke test
   passes (this catches drift between the runtime contract and
   what the test exercises).
8. Read `~/.hermes/skills/ghost-process-js-rebuild/SKILL.md`
   for the procedural TL;DR of the latest 8 versions.

### External setup (machines that need this)

- Node + npm (`npm start` boots Express on :8765).
- Python 3.11 (no pip module; use `pip→python3.11` or `uv`).
- Playwright (`/usr/bin/python3` must have `playwright`; the test
  scripts assume it does).
- `~/.hermes/state.db` — FTS5 corruption has hit past sessions.
  If `session_search` returns "database disk image is malformed",
  see `references/state-db-recovery.md` in the handoff-carryover-
  cleanup skill.

---

## Update (2026-07-13) — dead-asset cleanup session (continued)

The 2026-07-13 banner above said a user decision was needed on
the corridor sprite source path. **The user has made that decision.**

### Resolution (commits e7f9f3b, d40f9d1, 5bac1ba, 0148947)

User reasoning: *"we have the original mp4 which there are derided
from, correct? and the sprite_extractor script already does the
green screen correct? so we dont need those 141 pngs."*

Verified true:
- `_raw_source/frame_001..141.png` and `corridor/raw/frame_001..141.png`
  are byte-identical (MD5 verified on frame_001, 050, 141).
- `corridor/raw/sprite_extractor.py` documents the full pipeline:
  MP4 → 141 decomposed frames → 16 chroma-keyed PNGs → 180×320
  RGBA sprite strip.
- Both `_raw_source/i2v_clip_android_corridor.mp4` and
  `corridor/raw/i2v_clip_android_corridor.mp4` are byte-identical.

### What landed

| Commit | What | Net |
|---|---|---|
| `e7f9f3b` | `git rm -r assets/sprites/android/_raw_source/` (the duplicate copy) | -120 MB |
| `d40f9d1` | Commit `corridor/raw/` as the canonical source, **after stripping the 141 redundant `frame_001..141.png` files** (kept only MP4 + extractor + 16 `transparent_sprites/frame_00..15.png`) | 140 MB → 21 MB |
| `5bac1ba` | Delete `HANDOFF_SPRITES.md` (laser-taper debug parking lot, parked per user) and update `_diagnostics/README.md` to point at `corridor/raw/` | -19 KB doc |
| `0148947` | Commit `corridor/README.md` (was untracked) with the new source-of-truth layout description | +1 doc |

### On-disk impact

Before this resolution: 260 MB of redundant sprite raw material.
After: 21 MB (just the 819 KB MP4 + 20 MB of 16 chroma-keyed
intermediates + 6 KB extractor script).

### Final reference state

```
$ grep -rn '_raw_source' . --include='*.{js,json,py,md,ink,sh}' \
    | grep -v node_modules
# (no hits)
$ grep -rn 'HANDOFF_SPRITES' . --include='*.{js,json,py,md,ink,sh}' \
    | grep -v node_modules
# (no hits)
```

The `_raw_source/` path and `HANDOFF_SPRITES.md` are gone from
the repo. All references have been retargeted to
`corridor/raw/i2v_clip_android_corridor.mp4`.

### Verification

```
$ python3 tools/test_full_chain.py
VISITED: ['intro', 'alley', 'chase', 'kabukicho', 'corp_office', 'corridor',
         'jailbreak', 'terminal_lab', 'ship_engine', 'alley']
ERRORS: []
```

10 scenes, 0 errors. No runtime code was touched — only
`assets/sprites/android/` and `HANDOFF_SPRITES.md`.

### State after this session (post-resolution)

```
HEAD = 0148947 (sprites: commit corridor/README.md)
Branch: main
Sync: ahead of origin/main by 17 commits (was 7 pre-session: 22273d6, bb794b2, 53203c0, ca27844, f80a2a2, 244eed9; +10 this session: 5 first-batch + 4 resolution + 1 handoff-count-fixup). origin/main is at 617249f (v0.2.41).
Working tree: 17 dirty, 0 untracked
  - 16× corridor/idle_*.png — v17/v19 WIP
  - src/runtime/sprites.js — v0.2.41 hold-range + despill (617249f)
  - _diagnostics/README.md — modified during the resolution to retarget
    Source MP4 path; landed in the next commit alongside this handoff update
  All transparent_sprites/ PNGs and the MP4/extractor are tracked.
  Cleaned up via the resolution commits above.
```

---

## Update (2026-07-13) — dead-asset cleanup session

User directive: *"get rid of any useless shit in the project, im fed up
of you leaving youre shite around like a toddler"*. Six deliberate
audits, four commits, two skipped, one rollback.

### Commits landed

```
03387e0  tools: remove obsolete bass-iteration intermediates
2b7620e  sprites: archive .scratch/ brainstorm dir to _deleted/.scratch_archive/
dded4b9  sprites: commit android_scene_sprite_sources_20260711 diagnostic reference
4b2b3e2  audio: drop unbound smoky_club_intro.mp3
```

### Audit + decision table

| Item | Verdict | Reason |
|---|---|---|
| `tools/preview_bass_fix.py`, `swap_slap_to_fingered.py`, `swap_synth_bass_to_slap.py` | **DELETED (03387e0)** | Old handoff §"Walking bassline pass" called them obsolete intermediates. Zero importers. |
| `assets/sprites/android/.scratch/` (v7/v8/v9/v10/v12 + REJECTED v11 silhouette) | **ARCHIVED to `_deleted/.scratch_archive/` (2b7620e)** | Zero references in code/json/md/ink. Path rename keeps contents recoverable if v19 needs an earlier strip as fallback. |
| `assets/sprites/android/_diagnostics/android_scene_sprite_sources_20260711.png` | **COMMITTED (dded4b9)** | Diagnostic reference for v6/v17/v19 audit trail; matches existing two PNGs in the same dir. |
| `assets/audio/smoky_club_intro.mp3` (2.7 MB) | **DELETED (4b2b3e2)** | Generated but never wired. Grep across `story.json`, `ink/`, `src/`, `tools/` returns zero references. The `.mid` source is still committed (07ee831) so re-render is trivial. |
| `ink/corp_office.ink`, `kabukicho.ink`, `ship_engine.ink`, `terminal_lab.ink` | **NOT TOUCHED — already committed in 2d5d641** | Old handoff §"Untracked" was stale info; verified with a script that walks `story.json` and confirms all four are referenced by scene definitions. |

### | Item | Why skipped | What next session should do |
|---|---|---|
| 16× `assets/sprites/android/corridor/idle_*.png` modified | Active WIP — v17 cyan-restored strip + v19 sleeve animation. Originally documented in the now-deleted `HANDOFF_SPRITES.md` (5bac1ba); recipe recoverable from git history. | Read `git diff` on each; v6 baseline + v17/v19 work is in flight |
| `src/runtime/sprites.js` modified | Likely v0.2.41 hold-range + cyan-ball despill guard per 617249f | Verify intent against current sprite playback |

(The original banner also listed `corridor/README.md`, `corridor/raw/`,
and `_raw_source/` as "skipped — user decision needed." All three were
resolved in the same session — see the "Update (2026-07-13) — dead-asset
cleanup session (continued)" banner above for the resolution log.)

### Headline decision the next session needs from the user

**Resolved in the same session.** The corridor sprite source path was
duplicated and the docs disagreed. The user picked: keep `corridor/raw/`
as canonical, drop `_raw_source/` as a duplicate, drop the 141 redundant
`frame_001..141.png` PNGs as regenerable from the MP4 + extractor, and
delete `HANDOFF_SPRITES.md` as a parked debug doc.

Net result: `_raw_source/` removed, `HANDOFF_SPRITES.md` deleted,
`corridor/raw/` trimmed from 140 MB to 21 MB and committed. The 141
staged deletes landed cleanly in commit e7f9f3b.

### Verification

```
$ python3 tools/test_full_chain.py
VISITED: ['intro', 'alley', 'chase', 'kabukicho', 'corp_office', 'corridor',
         'jailbreak', 'terminal_lab', 'ship_engine', 'alley']
ERRORS: []
```

10 scenes, 0 errors. Smoke test still passes after the cleanup. No
runtime code was touched (only `tools/`, `assets/sprites/android/`,
and `assets/audio/`).

### State after this session

```
HEAD = 4b2b3e2 (audio: drop unbound smoky_club_intro.mp3)
Branch: main
Sync: ahead of origin/main by 10 commits (was 6, +4 from cleanup)
Working tree: 19 dirty (16 corridor sprite WIP + src/runtime/sprites.js + 2 untracked at corridor/)
```

---

## Verification commands (canonical, all sessions use these)

```bash
# 1. Boot the server
cd ~/ghost-process-js && npm start &  # Express on :8765

# 2. Smoke test (10 scenes, 0 errors expected)
python3 tools/test_full_chain.py

# 3. Inspect dirty state
git status -s

# 4. Recent commits
git log --oneline -15
```

---

## Update (2026-07-09) — corridor intro fix (commit pending)

User feedback after c57f709: *"the corridor music seems very intermittent and
takes a long while to start - i wonder if that didn't quite come out as planned?
try and fix that scene"*.

### Root cause

`corridor` A-side's original intro was:
- bar 0: 4 music-box notes (~1s of audio)
- bars 1-3: silence (12 seconds of nothing)
- bar 4: motif repeats (4 more notes)
- bars 5-5: silence (4 seconds)
- bar 6: chord enters

So from t=0 to t=16 the listener heard 1s of music → 12s silence → 1s music →
4s silence → chord. **16 seconds before the chord enters, 16+ seconds of
intermittent content.** RMS profile (before fix) confirmed:
```
t=0s:  -44 dB   ← first note
t=2-14s: -93 dB  ← dead air
t=16s: -29 dB   ← chord
t=18-22s: -93 dB  ← another silence
t=24-32s: -31 dB  ← pad builds
```

### What changed in `tools/make_scene_loop.py` SCENES["corridor"]

1. **`pad_chords`** moved earlier:
   - Cm at bar 6 → **bar 4** (12s chord-earlier)
   - Ab at bar 14 → **bar 12**
2. **`pad_breakdowns`** shifted:
   - `[(12, 13), (20, 23)]` → **`[(10, 11), (18, 23)]`**
3. **`lead_pattern` bars 0-3** restructured:
   - **was:** 1 motif at bar 0, 1 motif at bar 4 (12s gap)
   - **now:** motif plays at bars 0, 1, 2, 3 (every bar, 4s spacing)
4. **`bass_pattern`** shrunk drone to bars 0-3 (was 0-5), motion bars 4-11
   (was 6-13), Ab bars 12-19 (was 14-21), rest bars 20-21 (was 22-23).
5. **Climax section** shifted back 2 bars (peak note at bar 11, climax
   arpeggios bars 12-17, decay bars 18-23).

### Resulting RMS profile (after fix)

```
t=0s:  -44 dB   ← first note
t=4s:  -32 dB   ← motif every bar now
t=8s:  -30 dB
t=12s: -30 dB
t=16s+: continuous pad + climax
```

The 16-second opening silence is gone. Music-box ostinato now plays every
4 seconds from the start. Chord enters at t=16 (4 bars in) instead of t=24
(6 bars in). Loop length unchanged: A=101s, B=101s.

### Verification

- `python3 tools/test_full_chain.py` — 10 scenes, 0 errors
- `corridor` MP3 activity profile: first silence gap reduced from 12s to 3s
  (the natural rest between music-box motifs); chord enters 8s earlier
- A/B pair still matches perfectly (101s / 101s)

### Files changed

- `tools/make_scene_loop.py` — SCENES["corridor"] pad_chords, pad_breakdowns,
  lead_pattern (intro + climax shift), bass_pattern
- `assets/audio/corridor.mid` + `assets/audio/corridor.mp3` — regenerated

### NOT changed

- **corridor_b (B-side)**: the user's complaint was about corridor (A-side,
  played first in the medley). corridor_b already had continuous celesta
  motifs every 2 bars + active bass pulses, so no fix needed there.
- **other 7 SCENES entries**: untouched. The c57f709 shape rewrites already
  produce reasonable intros for those scenes.
- **render pipeline**: the silenceremove fix from c57f709 is still working
  (corridor renders at 101s, matching its WAV length).

## Update (2026-07-10) — corridor android sprite laser taper (HANDOFF ONLY, no fix shipped)

User feedback across this session (truncated): every frame too transparent,
the laser not actually fading, then I reverted everything.

### State of working tree (as of session end)

**`~/ghost-process-js/assets/sprites/android/corridor/` matches HEAD
exactly.** All 16 idle frames are at commit `a0edca5` ("pre-phaser-removal
snapshot").

**HEAD is NOT a usable state.** Visual inspection of HEAD shows every frame
with cyan-tinted uniform (not dark navy). The user's verdict on HEAD after
I revert-reverted: *"youll have reverted all the chrome key so now it will
just be a green block over the scene"*. Treat HEAD as the broken baseline;
do not assume `git checkout HEAD` is a recovery.

### Where the actually-good sprites live

The most recent user-accepted chroma is **`/tmp/regen/v6/`** (clean chroma,
60-65% opaque on idle_01-idle_14, hard-cut laser on idle_15/16). See
`HANDOFF_SPRITES.md` next to this file for the full forensic breakdown and
fix plan.

The laser taper itself: a linear alpha fade from x=140 to x=180 applied to
ALL opaque pixels in that region (not just cyan — energy bursts have
multi-color afterglow). Code + parameters are in `HANDOFF_SPRITES.md`.

### What NOT to do on next session pickup

- Do not assume HEAD is the last good state. HEAD is broken cyan-uniform.
- Do not re-key idle_01..idle_14 with a different chroma function. v6 is the
  baseline; copy untouched.
- Do not apply a cyan-only taper (`is_laser = g > 150 AND r < g + 20`). It
  misses orange/yellow/white afterglow. Use the all-colors taper.
- Do not run the taper at source resolution (768×1364). The taper ranges
  (x=140, x=180) assume final 180×320 size. Apply taper AFTER resize.
- Do not commit anything until the user has visually verified in-game.

### Files written this session

- **`~/ghost-process-js/HANDOFF_SPRITES.md`** (new, ~12 KB) — the
  structured handoff with ground-truth transparency table, the v6 baseline
  ground truth, the taper function, and the verification steps. Read this
  before doing anything to the sprites.

### Files NOT touched this session

- All sprite PNGs in `assets/sprites/android/corridor/` (16 files, all at HEAD)
- `story.json` (scene config untouched)
- `src/runtime/sprites.js` (runtime keyer untouched)

## Deferred (not active, just parked for later)

- **SC-55mkII soundfont A/B test** — see `docs/SC55_AB_TEST.md`. Current
  build uses VintageDreamsWaves-v2 as a stand-in for the SC-55 tone;
  user is happy with the current sound and wants to defer the
  font-swap experiment. When the user is ready, drop a real
  SC-55 soundfont at `assets/audio/sc55.sf2` and re-run
  `tools/render-midi.sh` to render fresh MP3s for A/B comparison.

## Walking bassline pass (sessions after 1e303b8)

### What changed

Six scenes previously had a one-note hammered bass (Synth Bass 2)
that the user described as "constant thrum" — overpowering, like
tapping one piano key.

Rewrote ch 1 in those six scenes as a real walking bassline:

| Scene             | Chord progression                              | Bars |
|-------------------|------------------------------------------------|------|
| terminal_lab      | Cmaj7  → Em7                                  | 32   |
| ship_engine       | Dm7    → Am11                                 | 32   |
| alley_confrontation | F#dim7 → C7b9 → A#dim7 → F7b9               | 16   |
| clinic_tension    | Am7    → F#dim7 → A#dim7                      | 24   |
| cold_open         | Dm7    → Dm(maj7) → Gm9 → D                   | 46   |
| ship_engine_b     | Dm7    → F#dim7 → G#dim7                      | 24   |

Pattern (4-bar phrase rotation):
- bar 0/4/8/12: root - fifth - seventh - root
- bar 1/5/9/13: root - third - fifth - octave
- bar 2/6/10/14: root - fifth - seventh - octave
- bar 3/7/11/15: root - third - fifth - seventh - 8th-walk-up

### Bass patch

User A/B'd 11 candidate patches via `tools/bass_patch_sampler.py`.
Winner: **Fretless Bass (program 35)** — smooth, vocal-like, no
percussive attack. Picked (34) too punchy, Contrabass (43) too big,
Voice (87) too eerie. Slap Bass (36,37) and Synth Bass (38,39) rejected
as too buzzy/twangy. Fingered (33) was the previous default but had
a residual ring that bothered the user.

All 6 target scenes now use Fretless Bass on ch 1.

### Files changed

- 6x `assets/audio/{scene}.mid` (bassline rewrite + patch swap)
- 6x `assets/audio/{scene}.mp3` (regenerated)
- 8 new tools in `tools/`:
  - `apply_bass_patch.py` — swap ch 1 patch (used in last turn)
  - `bass_patch_sampler.py` — render A/B of all 11 bass candidates
  - `compose_walking_bass.py` — the actual composition (chord-aware)
  - `mix_minus_preview.py` — render with one channel muted
  - `preview_bass_fix.py` — earlier thinned-pulse preview (obsolete)
  - `render_walking_bass_preview.py` — bass-only/full-mix preview
  - `swap_slap_to_fingered.py` — intermediate patch swap (obsolete)
  - `swap_synth_bass_to_slap.py` — intermediate patch swap (obsolete)

### NOT changed

Other 14 scenes with ch 1 untouched (alf_tv, chase, chase_b, cold_open_b,
corp_office, corp_office_b, corridor, corridor_b, jailbreak, jailbreak_b,
kabukicho, kabukicho_b, smoky_club_intro, terminal_lab_b). Some of those
have walking basslines already; some still have a Synth Bass 2 pattern.
The user noted the symptom exists across the project but only asked to
fix the 6 most prominent. Future pass can apply walking bass to the
others if desired.
