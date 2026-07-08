# LEGACY.md — historical context for `~/ghost-process-js/`

> **Read this if you arrived here from a search for "GHOST PROCESS",
> "ghost-process", or "PC-98 cyberpunk visual novel".**
>
> This is the active project. The two prior attempts that share a name
> are abandoned and kept on disk for reference only. Do **not** use
> them as a source of truth. Do **not** add `.gd`, `.tres`, or
> `.gdshader` files. Do **not** import from `~/ghost-process-98/` or
> `~/ghost-process/`. The current stack is plain JavaScript (no
> engine), InkJS, and Express.

---

## Why this file exists

This project went through three false starts before the current
`ghost-process-js/` v0.2 implementation. Each attempt left residue in
docs, comments, and AGENTS.md. Future LLMs have repeatedly
misinterpreted the residue as evidence the project is on a
particular stack (Godot, Phaser, DOM-only, etc). This file
consolidates all that history so the rest of the docs can be
Godot-mention-free and stack-asserting.

**If you are an AI agent continuing this project:**

1. Read `README.md` for the quick start.
2. Read `SPEC.md` for the architecture.
3. Read `AGENTS.md` for the rules.
4. Read `AI-HANDOFF.md` for the most recent session's state.
5. **Skip this file unless you're tempted to "look at how the
   previous attempt did it". The answer is: badly, that's why
   they're abandoned.**

---

## Timeline of attempts

### Attempt 1: `~/ghost-process-98/` — abandoned DOM-only prototype

**Stack:** Plain JavaScript, DOM-only renderer (no `<canvas>`),
`story.json`-driven, 34 scenes, point-and-click hitboxes.

**What worked:**

- 34-scene `story.json` (the most comprehensive draft of the
  narrative; the current v0.2 has 10 scenes and is a subset).
- Hitbox system (later ported to v0.2's `<canvas>` implementation).
- InkJS integration.

**What didn't:**

- DOM-only renderer. The Blade Runner-cinematic backgrounds had
  figures baked in. No real sprite compositing — characters were
  CSS-positioned image divs layered over a static background.
- Inconsistent art style across the 34 scenes (some painted, some
  pixel art, some both).
- No PC-98 dither look.

**Status:** Frozen at v0.98. On disk for archival / "show me the
34-scene outline" reference. Not portable. The narrative content
that was good is being slowly ported to v0.2's `ink/` and
`story.json` files.

**Repo:** `~/ghost-process-98/` (separate from this repo).
**Last commit hash:** not relevant — do not pull from it.

---

### Attempt 2: `~/ghost-process/` — abandoned Godot 4.7 refactor

**Stack:** Godot 4.7 Mono (C# + Ink + FluidSynth MIDI), PC-98
shader, character sprite sheets, palette-based 16-color dither.

**What worked:**

- Asset pipeline: `tools/palettes.py` + `tools/palettes_to_godot.py`
  + 5 `.tres` files under `assets/palettes/`. The 16-color
  palette + 6-lighting-8-identity-2-accent slot map survives
  intact in this repo (see `tools/palettes.py` in the current
  tree, and `assets/palettes/*.js` for the runtime form).
- PC-98 shader (Bayer dither + palette quantize). The current
  repo achieves the same look with a CSS `.scanlines` overlay
  + `image-rendering: pixelated` on the canvas — no shader
  needed for the browser.
- Character sprite sheets. The "Android" character (a
  white-bearded captain in a navy coat) was generated for this
  attempt and is now the `android` sprite in the current repo.
  Note: the user has acknowledged the captain imagery is
  visually wrong for the slot (a captain ≠ an android) but
  has not yet asked for a regeneration.
- `AGENTS.md` style bible. "Mature PC-98 cyberpunk, no moe, no
  figures baked into backgrounds" was codified in this attempt.
  The same rules carry over verbatim into the current
  `AGENTS.md`. **This is the single biggest piece of legacy
  that's worth keeping.**

**What didn't:**

- Godot 4.7 Mono + browser export. Mono WASM was painful, Inkgd
  was unmaintained, and FluidSynth could not produce audio in
  the browser.
- "Real" PC-98 shader was overkill for a 7-scene demo.

**Status:** Frozen at `git tag pre-gdscript-refactor` in the
`~/ghost-process/` repo. On disk only as a reference for the
palette slot map and the Android sprite base image. The current
repo has its own copy of `tools/palettes.py` and the Android
sprite PNGs are under `assets/sprites/android/`.

**Repo:** `~/ghost-process/` (separate from this repo).
**Tag to look at:** `pre-gdscript-refactor`.

---

### Attempt 3: `~/ghost-process-js/` v0.1 (Phaser 3 era) — abandoned

**Stack:** Phaser 3.80 + InkJS + plain JS, vendored under
`vendor/`, Express server.

**What worked:**

- Phaser 3.80 was an acceptable wrapper for the basic game loop.
- The `story.json` schema from the prototype carried over.

**What didn't:**

- Phaser's scene lifecycle, mid-transition bugs, "ran out of
  content" errors on the Ink runner, and scene-stacking quirks
  cost more debugging time than the renderer itself saved.
- The 16-color dither look via shader pipeline was more
  pipeline than the game needed.

**Status:** Frozen at the `v0.1` commits in the current repo's
git history. Use `git log --grep="phaser" --oneline` to find
them. Not loaded into the working tree.

**Repo:** This repo (`~/ghost-process-js/`). The Phaser commits
are in the git history; the current `main` is `v0.2.x` and has
**no Phaser dependency**.

---

### Current attempt: `~/ghost-process-js/` v0.2 (vanilla JS)

**Stack:** Plain JavaScript (no engine), InkJS 2.x (vendored),
WebAudio, Express. Single `<canvas>` for the game world, CSS
overlay for the scanline + pixelated look.

**Why this works:**

- The "game" is mostly text + ~30 sprites + 10 scenes. The
  rendering challenge is "show a sprite, animate it while
  speaking, draw a background". That's ~700 LOC of `<canvas>`.
- No engine means no scene lifecycle to fight.
- InkJS is sufficient for the dialogue.
- CSS is sufficient for the retro typography.
- The PC-98 look is a CSS overlay + pixel-rendering on the
  canvas — no shader needed.

**This is the active project. Continue here.**

---

## What was carried over (and where it lives now)

| Carried from | Carried over | Lives in this repo as |
|---|---|---|
| Godot v0.x | PC-98 palette + 16-color dither look | `assets/palettes/*.js` + CSS `.scanlines` + `image-rendering: pixelated` |
| Godot v0.x | Palette slot map (6 lighting + 8 identity + 2 accent) | `tools/palettes.py` + per-scene `*.js` palettes |
| Godot v0.x | Android character base image | `assets/sprites/android/*/idle_*.png` |
| Godot v0.x | Style bible (mature PC-98, no moe, no figures in BG) | `AGENTS.md` §"Style bible" |
| Godot v0.x | 3 MP3 audio tracks (pre-rendered MIDI) | `assets/audio/*.mp3` |
| v0.98 | `story.json` as single source of truth | `story.json` |
| v0.98 | Data-driven scene config (bg, music, characters, hitboxes) | `story.json` schema |
| v0.1 (Phaser) | InkJS for branching dialogue | `vendor/ink-full.js` |
| v0.1 (Phaser) | Express server | `server.js` |
| v0.1 (Phaser) | 7-scene outline (intro → … → jailbreak) | `story.json` `cold_open`, `alley`, `chase`, `corridor`, `jailbreak` |

**If you're tempted to "improve" any of the above by reverting to
the old stack:** the v0.1 Phaser commits and the Godot v0.x
project are the wrong place to look. The current v0.2 has its own
solutions to all the problems the old stacks created.

---

## What was discarded (and why)

- **Phaser 3** (scene lifecycle, scene-stacking, post-fx pipeline)
  — replaced by a vanilla-JS engine in `src/runtime/`.
- **Godot scene files, Mono, .NET, FluidSynth** — replaced by
  plain JS + WebAudio.
- **The hand-rolled DOM renderer from v0.98** — replaced by a
  single `<canvas>`.
- **The Blade Runner-cinematic style backgrounds from v0.98**
  (figures baked in) — replaced by architecture-only
  establishing shots per the style bible.

---

## "I should port this from the Godot project" — DON'T

Tempting moves that are wrong:

- **"The Godot sprite pipeline is more sophisticated, let me
  port it"** — the Godot sprite pipeline was specifically
  designed for Godot's `AnimatedSprite` node. It has no analogue
  in the v0.2 vanilla-JS engine. Use `assets/sprites/<char>/<scene>/idle_*.png`
  directly with the runtime's frame-animation in
  `src/runtime/sprites.js`.
- **"The Godot `AGENTS.md` is more thorough, let me merge it in"**
  — the current `AGENTS.md` is already the merged form. The
  rules are the same. Do not re-import.
- **"The Godot project has a richer `tools/palettes.py` — let me
  copy it over"** — it already lives here as `tools/palettes.py`.
  Same file, ported.
- **"I should regenerate Android as an actual android and not a
  captain"** — the user is aware. They've explicitly said "the
  user is fine with NO character in that position over a
  wrong-style character" for similar issues. Ask before doing
  any regeneration.

---

## Rollback is no longer supported

The previous README had a "Rollback" section pointing at
`~/ghost-process-98/` and `~/ghost-process/` as "can be picked up
at any time". That framing was wrong — the previous attempts are
abandoned, not maintained. They are not parallel projects. They
are not forks. They are not "what to switch back to if v0.2
doesn't work out". v0.2 works out. Continue here.
