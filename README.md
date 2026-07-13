# GHOST//PROCESS

PC-98 cyberpunk horror visual novel. **Plain JavaScript** (no game
engine) + InkJS + WebAudio. Web-native.

## Quick start

```bash
cd /Users/jwhite/ghost-process-js
npm install                  # one-time
npm run vendor               # fetch InkJS into vendor/ (no CDN)
npm start                    # boots Express on :8765
```

Then open:
- **Game**: http://localhost:8765/index.html
- **Editor**: http://localhost:8765/editor.html

For Tailscale access, the server binds `0.0.0.0:8765` so your Tailscale IP works too.

## What's in this repo

```
SPEC.md            ← architecture, data model, subsystem map
AGENTS.md          ← style bible, asset rules
story.json         ← all scenes, items, recipes (single source of truth)
ink/               ← Ink dialogue source (one .ink per scene)
src/               ← game engine (vanilla JS)
  dialogue.js      ← InkJS walker + typewriter presenter
  dialogue-panel.js← DOM dialogue box + choice buttons
  inventory.js     ← popup inventory UI
  tasks.js         ← per-scene task tracker (pickup/use/goto/trigger_dialog)
  toast.js         ← transient status messages
  story.js         ← fetch story.json + preload assets
  scenes/_registry.js
  runtime/         ← custom engine: canvas, sprites, hitboxes, music, scene base, engine
assets/            ← backgrounds, sprites, audio, fonts, palettes, items, portraits
  audio/           ← MP3s + source MIDIs + sc55.sf2
  palettes/        ← per-scene 16-colour palettes
  backgrounds/     ← scene_*.png (pre-rendered scenes)
  sprites/         ← <character>/<scene>/frame_NN.png (16-frame talking anims)
  items/           ← inventory icons
  fonts/           ← Madou Futo Maru + Nouveau IBM
tools/             ← make_scene_loop.py, gen_asset.py, render-midi.sh, test_full_chain.py
vendor/            ← ink-full.js (populated by `npm run vendor`)
server.js          ← Express: static + /api/story + /api/ink + /api/assets + /api/list
boot.js            ← engine entry point
index.html         ← game entry
editor.html        ← scene editor (browser-based)
editor.js          ← editor logic
```

The 16-color palette / Bayer dither look is applied at runtime by the
canvas renderer (`src/runtime/canvas.js` `ditherImageToCanvas`) — not
baked into the source PNGs. CSS uses `image-rendering: pixelated` for
crispness at any size.

## Server endpoints

```
GET  /api/story         read story.json
PUT  /api/story         validate + atomic-write story.json
GET  /api/ink/<path>    read .ink file (path under ink/)
PUT  /api/ink/<path>    atomic-write .ink file
POST /api/assets        multipart upload, saves under assets/
GET  /api/list?dir=...  list filenames in a directory (relative to ROOT)
```

## v1 acceptance criteria

1. `npm install` succeeds, `npm start` boots Express on `:8765`
2. `index.html` boots, loads `story.json`, renders `intro` scene with title background + music
3. Click-to-start → loads `cold_open` Ink scene, then `alley` → chase → kabukicho → corp_office → corridor → jailbreak → terminal_lab → ship_engine → alley (loop)
4. Ink dialogue runs: typewriter text, sprite animation when speaking, line-by-line advance on click
5. Hitboxes on each scene plate, clicking picks up items
6. Items appear in inventory popup (INV button top-right)
7. Choices render as actual buttons that branch the Ink story
8. A+B medleys crossfade on the seam at scene-loop boundary