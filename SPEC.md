# SPEC — GHOST//PROCESS

PC-98 cyberpunk horror visual novel. Vanilla JavaScript + InkJS + Express. No engine. No bundler.

See `AGENTS.md` for style bible and asset rules. See `AI-HANDOFF.md` for the current session's state.

## 1. Stack

- **Renderer**: Plain JavaScript, `<canvas>` 2D context. No game engine.
- **Dialogue**: InkJS 2.x with the full bundle (Compiler + Story), vendored under `vendor/ink-full.js` (no CDN).
- **Audio**: HTMLAudioElement + manual volume ramps for crossfade (see `src/runtime/music.js`). MP3 only — no MIDI playback at runtime.
- **Server**: Express (carried from v0.1). See `server.js`.
- **Build tool**: None. ES2022 script tags, no bundler, no transpile.
- **Deployment**: Static files + `node server.js` on port 8765 (binds `0.0.0.0` for Tailscale).

## 2. File layout

```
ghost-process-js/
├── SPEC.md                       # this file
├── AGENTS.md                     # agent rules (style, asset pipeline, prohibitions)
├── AI-HANDOFF.md                 # most-recent session state
├── package.json                  # inkjs + express + multer
├── server.js                     # express static + /api/* endpoints
├── index.html                    # game (loads vendored ink + runtime modules)
├── editor.html                   # browser-based scene editor
├── editor.js                     # editor logic
├── boot.js                       # engine entry point
├── story.json                    # all content (data-driven, single source of truth)
├── ink/                          # Ink source files (one .ink per scene with dialogue)
├── vendor/
│   └── ink-full.js               # vendored InkJS 2.2 (no CDN)
├── src/
│   ├── runtime/                  # the engine (~2150 LOC vanilla JS)
│   │   ├── canvas.js             # canvas DOM + asset loader + Bayer dither
│   │   ├── music.js              # crossfading bgm (string or A+B medley array)
│   │   ├── sprites.js            # character sprite with 16-frame talking anim
│   │   ├── hitbox.js             # clickable regions + cursor + label hover
│   │   ├── scene-base.js         # Scene class: bg + characters + dialogue + transitions
│   │   └── engine.js             # boot + goTo (no Phaser scene-stack)
│   ├── scenes/
│   │   └── _registry.js          # scene-id → Scene subclass map (most are empty)
│   ├── dialogue.js               # InkJS walker + typewriter presenter
│   ├── dialogue-panel.js         # DOM dialogue box + choice buttons
│   ├── inventory.js              # popup inventory UI
│   ├── tasks.js                  # per-scene task tracker (toast hints + auto-completion)
│   ├── toast.js                  # transient status messages
│   └── story.js                  # fetch story.json + preload assets + fire story-ready
├── tools/
│   ├── make_scene_loop.py        # 9 SCENES + 9 SCENES_B MIDI generators (medleys)
│   ├── gen_asset.py              # image-gen pipeline (style bible + dither)
│   ├── render-midi.sh            # FluidSynth + sc55.sf2 → MP3
│   ├── test_full_chain.py        # smoke test (renders all medleys)
│   └── vendor-deps.js            # fetch ink-full.js
├── docs/
│   ├── MUSIC_GRID.md             # per-scene music map + song shapes
│   ├── MUSIC_BSIDE_GUIDE.md      # how B-side medleys complement A-side
│   └── SC55_AB_TEST.md           # soundfont swap plan (deferred)
└── assets/                       # scene plates, sprites, audio, fonts
    ├── backgrounds/scene_*.png
    ├── sprites/<character>/<scene>/frame_NN.png
    ├── audio/*.mp3 + *.mid + sc55.sf2
    ├── items/*.png
    ├── palettes/*.js             # per-scene 16-colour palette (Bayer dither source)
    ├── portraits/<character>.png # base portrait for I2V regen
    └── fonts/{nouveau_ibm.ttf, madou-futo-maru.ttf}
```

`node_modules/` is not shipped. Only `vendor/` is needed at runtime.

## 3. Data model — `story.json`

`story.json` is the single source of truth for content. Each scene's `bg`, `music`, `characters`, `hitboxes` reference assets; `ink` (optional) references a `.ink` file in `ink/`.

```jsonc
{
  "version": 3,
  "title": "GHOST//PROCESS",
  "start": "intro",
  "next": {
    "intro": "cold_open",
    "cold_open": "alley",
    "alley": "chase",
    "chase": "kabukicho",
    "kabukicho": "corp_office",
    "corp_office": "corridor",
    "corridor": "jailbreak",
    "jailbreak": "terminal_lab",
    "terminal_lab": "ship_engine",
    "ship_engine": "alley"
  },
  "scenes": {
    "intro":        { "id": "intro", "kind": "title",  "bg": "scene_intro",
                      "music": "intro_theme.mp3",
                      "hitboxes": [{ "x":0.35, "y":0.55, "w":0.30, "h":0.08,
                                     "target":"alley", "label":"PRESS START" }] },
    "cold_open":    { "id": "cold_open", "kind": "ink", "bg": "scene_intro",
                      "music": [{"file":"cold_open.mp3"},{"file":"cold_open_b.mp3","fadeAt":51.1}],
                      "ink": "ink/cold_open.ink", "start_node": "Start" },
    "alley":        { "id": "alley", "kind": "ink", "bg": "scene_alley",
                      "music": [{"file":"alley_confrontation.mp3"},{"file":"alley_confrontation_b.mp3","fadeAt":23.8}],
                      "ink": "ink/alley.ink", "start_node": "Start",
                      "characters": [
                        { "id":"android", "speaker":"ANDROID",
                          "placementX": 0.62, "placementY": 0.97, "targetH": 0.85,
                          "scenes": { "alley": {
                            "frames": "assets/sprites/android/alley/frame_*.png",
                            "fps": 4, "loop": true } } }
                      ],
                      "hitboxes": [{ "x":0.15, "y":0.55, "w":0.10, "h":0.15,
                                     "item":"rusty_key", "label":"Search the bins" }],
                      "tasks": [
                        { "id":"pick_key", "type":"pickup", "item":"rusty_key",
                          "hint":"Try clicking on the trash in the alley." }
                      ] }
  },
  "items": {
    "rusty_key": { "id":"rusty_key", "name":"Rusty Key",
                   "description":"An old iron key, stained with verdigris...",
                   "icon": "assets/items/rusty_key.png",
                   "key": true, "pickup_message":"You found a rusty key." }
  },
  "recipes": [
    { "input": ["rusty_key", "scrap_metal"], "output": "tinkered_key" }
  ]
}
```

### 3.1 Scene kinds

`validateStory` in `server.js` accepts: `ink | choice | end | title`.

- **`title`**: title screen. Music may auto-play; click handler is the hitbox (e.g. PRESS START).
- **`ink`**: Ink-driven dialogue scene. `ink` field specifies the `.ink` file; `start_node` is the starting knot (default `Start`).
- **`choice`**: hub scene with no Ink — choices on hitboxes branch directly to other scenes.
- **`end`**: terminal scene. No transitions out.

### 3.2 Hitboxes

Normalized coordinates `(x, y, w, h ∈ [0,1])` over the scene canvas. Two action types:

- `"target": "scene_id"` — transition to that scene on click.
- `"item": "item_id"` — pick up item (added to inventory, hitbox becomes inactive).

Each hitbox is single-use by default: clicking marks it in `STATE.spentHitboxes[sceneId:label]`, so subsequent clicks no-op. Item hitboxes additionally hide their label once the item is in `STATE.inventory` or `STATE.consumed`.

### 3.3 Items + recipes

Items are looked up in `STORY.items`. `key:true` items persist; `key:false` items are consumed on use. Recipes are `{ input: [id, id], output: id }`. v1 doesn't ship UI for combining — recipes are data-only.

### 3.4 Tasks (per-scene)

`scene.tasks[]` — array of small objects `src/tasks.js` (TaskTracker) reads to surface hints and auto-complete on action. Types:

- `pickup` — completes when item enters inventory.
- `use_item` — completes when a held item is used on a hitbox.
- `goto_hitbox` — completes when a labelled hitbox is clicked.
- `trigger_dialog` — completes when Ink `# goto:<node>` fires.
- `combine` — completes when the named items are all in inventory.
- `custom` — Ink calls `EXTERNAL complete_task(id)`.

`hint` is shown in a toast when dialogue is dismissed and any task is still open; it disappears on completion.

## 4. Ink integration

### 4.1 The runner

`src/dialogue.js` — `DialogueRunner` class. Walks the compiled story once per "step", fires events:

- `onLine(text, tags, typed, total)` — fired on each typewriter tick. `typed/total` lets the UI render the partial text.
- `onChoices([{text}, ...])` — fired when the story pauses on `* [...]`. Engine renders buttons; clicking calls `runner.choose(i)`.
- `onCommand(key, args)` — fired for every Ink tag (`# speaker:NAME`, `# portrait:NAME`, `# give:ITEM_ID`, ...) and for `EXTERNAL` calls. Scene handles sprite visibility/portrait/speaker-action; engine routes `transition_next` / `return_to_alley` to `Engine.goTo`.
- `onComplete()` — story ended, no more lines or choices.

### 4.2 Tag semantics

| Tag | Effect |
|---|---|
| `# speaker:NAME` | Speaker label; sprite with `speaker === NAME` starts animating |
| `# speaker:none` | Speaker hidden; sprites freeze on frame 0 (unless scene overrides for ambient anim) |
| `# portrait:NAME` | Sets which character's sprite is visible; `none` hides all |
| `# give:ITEM_ID` | Adds item to inventory + shows pickup toast |
| `# take:ITEM_ID` | Removes item from inventory (push to `STATE.consumed`) |

Unrecognised tags pass through to the scene's `_handleCommand` for per-scene customisation.

### 4.3 External functions

Ink can call back into the game via EXTERNAL:

- `transition_next()` — looks up `STORY.next[currentSceneId]` and fires the engine transition. Sets `_suppressStep = true` so the post-transition `step()` doesn't trigger Ink "ran out of content" warnings.
- `return_to_alley()` — short-circuit to the alley scene. Used by cold_open's reset beats.
- `has(item_id)` — boolean, used by Ink conditionals like `{ has("rusty_key"): ... | -> ... }`.
- `complete_task(id)` — marks a `custom` task complete (toast hint clears).

## 5. Rendering pipeline

### 5.1 The runtime

`src/runtime/scene-base.js` — `Scene` class. Each scene:

1. Resizes the canvas to the current viewport (full for title screens; bottom strip reserved for dialogue box on gameplay).
2. Loads its background image and runs it through `Runtime.ditherImageToCanvas` against the per-scene 16-colour palette (Bayer 8×8 ordered dither). Cached as an offscreen canvas so per-frame blit is one drawImage.
3. Loads its music (string = single MP3, array = A+B medley crossfade) and starts `MusicHandler`.
4. Creates character sprites, each holding 16 preloaded `HTMLImageElement`s keyed by frame number. Animates while the sprite's `speaker` matches the current `# speaker` tag.
5. Builds the hitbox layer — DOM overlay anchored to the canvas's bounding rect for hit-testing and labels.
6. Spins up `DialogueRunner`, overrides its `onLine` / `onChoices` / `onCommand` hooks to route through the scene + DialoguePanel, then calls `DialoguePanel.attachRunner(runner)`. Tag handling (`speaker`, `portrait`, `give`, `take`, `transition_next`, `return_to_alley`) lives in the scene's `onCommand` router.
7. Starts `requestAnimationFrame` loop: clear backbuffer → draw background → draw each sprite (sprites update their own frame timers).

### 5.2 PC-98 look (Bayer dither + palette quantize)

The PC-98 look is applied **at display time, per scene load**, by `Runtime.ditherImageToCanvas` in `src/runtime/canvas.js`:

- Per-scene palette from `assets/palettes/<scene>.js` (16-colour slot map: `[0..5] lighting`, `[6..10] identity`, `[11..13] accent`, `[14] dark`, `[15] light`).
- Bayer 8×8 ordered dither over a clean-source RGB image, snapping each pixel to the nearest palette entry with the dither offset.

CSS:
- `body.no-scanlines .scanlines { display: none; }` toggles the interlace overlay.
- `<canvas image-rendering: pixelated>` keeps the dither crisp at any viewport size.

Background PNGs are shipped clean (full RGB). The runtime does the dither, so the same PNG can be re-paletted by swapping the palette JS file.

### 5.3 Sprite animation

`src/runtime/sprites.js` — `CharacterSprite`. Holds 16 preloaded `HTMLImageElement`s, a target FPS, a `loop` flag, and optional `playForward` / `playReverse` (ping-pong) flags. Idle animations in v1 loop the 16-frame sheet at 4-6 fps while the speaker is active. When the speaker changes or becomes `none`, the sprite freezes on frame 0 (scenes can override — see `_ambientAnimateScenes` in `scene-base.js` for corridor's energy ball).

### 5.4 Audio

`src/runtime/music.js` — `MusicHandler`. Single Audio instance per filename, preloaded once via `Runtime.loadAudio`. `play(filename, baseVolume, fadeMs)` ramps the new track from 0 → baseVolume; if a previous track was playing, the old one ramps to 0 in parallel (crossfade), then pauses. The same singleton persists across scene transitions.

`music` field can be:
- A string `"intro_theme.mp3"` — single track.
- An array `[{file:"a.mp3"}, {file:"b.mp3", fadeAt:<sec>}]` — A-side + B-side medley. The first track plays first; at the configured `fadeAt` (default = A's duration), it crossfades to the B-side for the second half of the loop.

MP3s are pre-rendered at build time (`tools/render-midi.sh`). MIDIs are source of truth; `.mp3` is what the browser plays.

## 6. Editor

`editor.html` + `editor.js` — browser-based scene editor. Loads `story.json`, renders the selected scene's background + sprites + hitboxes into a preview canvas, lets the user drag sprites to position them, drag-draw hitboxes, and edit scene/item metadata. Writes back via `PUT /api/story`.

Editor-specific endpoints it uses:
- `GET /api/list?dir=assets/...` — populates the bg / music / palette pickers.
- `PUT /api/story` — commits edits.

Sprite placement uses `placementX` / `placementY` as fractional coords `[0,1]` over the viewport (centre-X / bottom-edge-Y). Off-canvas values are allowed and preserved on save.

## 7. Scene graph

```
intro → cold_open → alley → chase → kabukicho → corp_office → corridor → jailbreak → terminal_lab → ship_engine → alley (loop)
```

10 scenes total. `intro` is the title screen; everything else uses A+B medley crossfade.

## 8. Subsystem docs

- `docs/MUSIC_GRID.md` — per-scene music map, song shapes, composer extensions.
- `docs/MUSIC_BSIDE_GUIDE.md` — how B-side medleys complement A-side.
- `docs/SC55_AB_TEST.md` — soundfont swap plan (currently deferred; current font `sc55.sf2` is `VintageDreamsWaves-v2`, a General MIDI stand-in).
- `assets/audio/README.md` — runtime audio files + render workflow.