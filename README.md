# GHOST//PROCESS (JS rebuild)

PC-98 cyberpunk horror visual novel. **Plain JavaScript** (no game
engine) + InkJS + WebAudio. Web-native.

---
## Quick start

```bash
cd /Users/jwhite/ghost-process-js
npm install                  # one-time
npm run vendor               # fetch InkJS into vendor/ (no CDN)
npm start                    # boots Express on :8765
```

Then open:
- **Game**: http://localhost:8765/index.html

For Tailscale access, the server binds `0.0.0.0:8765` so your Tailscale IP works too.

---

## What's in this repo

```
SPEC.md            ← architecture, data model, migration path
AGENTS.md          ← style bible, asset rules, v1 scope
story.json         ← all scenes, items, recipes (single source of truth)
ink/               ← Ink dialogue source (one .ink per scene)
src/               ← game engine (vanilla JS, no Phaser)
src/runtime/       ← custom engine: canvas, sprites, hitboxes, scene base
assets/            ← backgrounds, sprites, audio, fonts
tools/             ← vendor-deps.js (and future gen_asset.py port)
vendor/            ← ink-full.js (populated by `npm run vendor`)
server.js          ← Express: static + /api/story + /api/ink/<path>
boot.js            ← engine entry point
index.html         ← game entry
```

The 16-color palette / Bayer dither / scanline look is applied as a
DOM CSS overlay (`.scanlines` in `styles.css`); the canvas uses
`image-rendering: pixelated` for crispness at any size.

---

## v1 acceptance criteria

1. `npm install` succeeds, `npm start` boots Express on `:8765`
2. `index.html` boots, loads `story.json`, renders `intro` scene with title background + music
3. Click-to-start → loads `cold_open` Ink scene, then `alley`
4. Ink dialogue runs: typewriter text, sprite animation when speaking, line-by-line advance on click
5. One hitbox on the alley plate, clicking picks up `rusty_key` item
6. Item appears in inventory popup (INV button top-right)
7. Choices render as actual buttons that branch the Ink story

---

## Historical context

Two prior attempts at this project (`~/ghost-process-98/` and
`~/ghost-process/`) are abandoned and live on disk as reference
material. They are **not** alternative stacks, **not** parallel
projects, and **not** "what to switch back to". See
[`LEGACY.md`](./LEGACY.md) for the full timeline and what was
kept vs discarded. The Phaser 3 era of this repo is also in
the git history (`git log --grep="phaser"`) for comparison.
