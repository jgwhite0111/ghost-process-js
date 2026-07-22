# GHOST//PROCESS

PC-98 cyberpunk horror visual novel. **Plain JavaScript** (no game
engine) + InkJS + WebAudio. Web-native.

## Quick start

From the repository root:

```bash
npm install                  # one-time
npm run vendor               # fetch InkJS into vendor/ (no CDN)
npm start                    # boots Express on 127.0.0.1:8765
```

Then open:
- **Game**: http://127.0.0.1:8765/index.html
- **Exploration demo**: http://127.0.0.1:8765/index.html?scene=exploration_demo
- **Editor**: http://127.0.0.1:8765/editor.html — newcomer guide: [`EDITOR-MANUAL.md`](EDITOR-MANUAL.md)
- **Asset desk**: http://127.0.0.1:8765/asset-generator.html

By default the server is local-only (`127.0.0.1`). To serve over Tailscale/LAN, opt into a non-loopback bind and provide a secret of at least 16 non-whitespace characters:

```bash
HOST=0.0.0.0 EDITOR_TOKEN='replace-with-a-long-random-secret' npm start
```

Static files and GET APIs remain readable over that bind. Mutation APIs reject cross-origin browser requests and require the exact token on non-loopback configurations. Open the editor through the server's Tailscale/LAN address; the first save prompts for the token, keeps it only in that tab's `sessionStorage`, and retries once.

## What's in this repo

```
SPEC.md            ← architecture, data model, subsystem map
AGENTS.md          ← style bible, asset rules
story.json         ← all scenes, items, and tasks (single source of truth)
ink/               ← Ink dialogue source (one .ink per scene)
src/               ← game engine (vanilla JS)
  dialogue.js      ← InkJS walker + typewriter presenter
  dialogue-panel.js← DOM dialogue box + choice buttons
  inventory.js     ← popup inventory UI
  tasks.js         ← per-scene task tracker (pickup/use_item/goto_hitbox/goto_dialog/custom)
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
EDITOR-MANUAL.md   ← step-by-step guide for scene authors
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
8. Each gameplay scene's ordered A→B→C→D→E medley crossfades using the destination-entry `fadeAt` timing in `story.json`