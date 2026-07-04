# GHOST//PROCESS (JS rebuild)

PC-98 cyberpunk horror visual novel. **Phaser 3 + InkJS + plain JavaScript**, web-native.

This is the third attempt at this project:
1. ~~`~/ghost-process-98/`~~ — pre-Godot JS prototype, kept as historical
2. ~~`~/ghost-process/`~~ — Godot 4.7 Mono project, abandoned at tag `pre-gdscript-refactor`
3. **This repo (`~/ghost-process-js/`)** — current

See [`SPEC.md`](./SPEC.md) for the architecture and [`AGENTS.md`](./AGENTS.md) for working rules.

---

## Quick start

```bash
cd /Users/jwhite/ghost-process-js
npm install                  # one-time
npm run vendor               # fetch Phaser + InkJS into vendor/ (no CDN)
npm start                    # boots Express on :8765
```

Then open:
- **Game**:   http://localhost:8765/index.html
- **Editor**: http://localhost:8765/editor.html

For Tailscale access, the server binds `0.0.0.0:8765` so your Tailscale IP works too.

---

## What's in this repo

```
SPEC.md          ← architecture, data model, migration path
AGENTS.md        ← style bible, asset rules, v1 scope
story.json       ← all scenes, items, recipes (single source of truth)
ink/             ← Ink dialogue source (one .ink per scene)
src/             ← game engine (Phaser scenes, dialogue runner, sprites, etc.)
assets/          ← backgrounds, sprites, audio, fonts, palettes
tools/           ← vendor-deps.js (and future gen_asset.py port)
vendor/          ← phaser.min.js + ink.js (populated by `npm run vendor`)
server.js        ← Express: static + /api/story + /api/ink/<path> + /api/assets
index.html       ← game entry
editor.html      ← authoring UI
```

---

## v1 acceptance criteria (from SPEC.md §9)

1. `npm install` succeeds, `npm start` boots Express on `:8765`
2. `index.html` boots Phaser, loads `story.json`, renders `intro` scene with title background + music
3. Click-to-start → loads `alley` scene, shows Android sprite, plays `alley_confrontation.mp3`
4. Ink dialogue runs: typewriter text, sprite mouth flapping, line-by-line advance on click
5. One hitbox on the alley plate, clicking picks up `rusty_key` item
6. Item appears in inventory bar; clicking it shows its name
7. Browser editor at `/editor.html` lets you add a new scene and save
8. Total bundle <2MB

Currently **none** of these are verified yet — the scaffold is in place but assets
(backgrounds, sprite frames, MP3s, fonts) haven't been ported or generated. See
[§11 Migration path](./SPEC.md#11-migration-path-from-old-projects) in SPEC.md for what
needs to move over from the old projects.

---

## Rollback

The two prior projects remain on disk and can be picked up at any time:

```bash
cd ~/ghost-process-98    # JS prototype with 34-scene story.json (different stack)
cd ~/ghost-process       # Godot project; git tag pre-gdscript-refactor at 8eed992
```

Neither needs to be deleted until this rebuild proves itself.