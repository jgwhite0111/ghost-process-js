# SPEC — GHOST//PROCESS (v0.2, vanilla-JS rebuild)

Status: v0.2 in progress — Phaser removed, vanilla-JS engine ships.
Owner: jwhite
Created: 2026-07-04
Replaces: `~/ghost-process-98/` (pre-Godot JS prototype) + `~/ghost-process/` (abandoned Godot 4.7 refactor)

---

## 1. Why this exists

The project went through three false starts:

1. **`~/ghost-process-98/`** — pre-Godot JS prototype. `story.json`-driven, point-and-click hitboxes, DOM-only renderer, 34 scenes but no real sprite compositing and an inconsistent art style.

2. **`~/ghost-process/`** — Godot 4.7 Mono project with C# + Ink + FluidSynth MIDI. Strong asset pipeline (palettes, PC-98 shader, character sprite sheets), mature Android sprite + idle animation, and `AGENTS.md` rules that codify "mature PC-98 cyberpunk, no moe, no figures baked into backgrounds." Bogged down in Mono WASM, Inkgd unmaintained, FluidSynth unbrowserable.

3. **`~/ghost-process-js/` v0.1 (Phaser 3 era)** — initially built on Phaser 3 + InkJS + plain JS. Phaser's scene lifecycle, mid-transition bugs, "ran out of content" errors on the Ink runner mid-transition, and scene-stacking quirks were costing more time than the renderer itself saved. **v0.2 dropped Phaser**; everything UI/sprite/dialogue is now plain JavaScript.

What we kept:

| Carried over | From |
|---|---|
| `story.json` as single source of truth | v0.1 |
| InkJS for branching dialogue | v0.1 |
| PC-98 palette + dither look (CSS overlay + pixelated canvas) | Godot `AGENTS.md` |
| 16-frame idle sprites per character | Godot sprite pipeline |
| 7 scenes: intro → cold_open → alley → chase → corridor → jailbreak → eidolon_return | v0.98 + v0.1 |
| 3 MP3 audio tracks (pre-rendered via FluidSynth from the Godot project) | Godot |
| Madou Futo Maru + Nouveau IBM typography | Godot |
| Data-driven scene config (bg, music, characters, hitboxes) | v0.98 |

What we discarded:

- Phaser 3 (scene lifecycle, scene-stacking, post-fx pipeline) — replaced by a vanilla-JS engine in `src/runtime/`
- Godot scene files, Mono, .NET, FluidSynth
- The hand-rolled DOM renderer from v0.98 (we now use a single `<canvas>`)
- The Blade Runner-cinematic style backgrounds from v0.98 (figures baked in)

---

## 2. Stack

- **Renderer**: Plain JavaScript, `<canvas>` 2D context. No game engine.
- **Dialogue**: InkJS 2.x with the full bundle (Compiler + Story).
- **Audio**: HTMLAudioElement + manual volume ramps (crossfade via `requestAnimationFrame`).
- **Server**: Express (carried over from v0.1).
- **Build tool**: None. ES2022 script tags, no bundler.
- **Deployment**: Static files + `node server.js` on port 8765.

Why this stack:

- No engine means no scene lifecycle to fight. The bugs we hit ("ran out of content", scene stacking, mid-transition orphans) were all Phaser plumbing.
- The "game" is mostly text + ~30 sprites + 7 scenes. The rendering challenge is "show a sprite, animate it while speaking, draw a background". That's ~300 lines of `<canvas>`.
- InkJS is sufficient for the dialogue. CSS is sufficient for the retro typography. The PC-98 look is a CSS overlay + pixel-rendering on the canvas — no shader needed.

---

## 3. File layout

```
ghost-process-js/
├── SPEC.md                       # this file
├── AGENTS.md                     # agent rules (style, asset pipeline, prohibitions)
├── README.md                     # quick-start + rollback
├── package.json                  # inkjs + express + multer (no phaser)
├── server.js                     # express static + /api/story + /api/ink + /api/assets
├── index.html                    # game (loads vendored ink + runtime modules)
├── boot.js                       # engine entry point
├── story.json                    # all content (data-driven)
├── ink/                          # Ink source files (one .ink per scene with dialogue)
│   ├── cold_open.ink
│   ├── alley.ink
│   ├── chase.ink
│   ├── corridor.ink
│   ├── jailbreak.ink
│   └── eidolon_return.ink
├── vendor/
│   └── ink-full.js               # vendored InkJS 2.2 (no CDN)
├── src/
│   ├── runtime/                  # the engine (~700 LOC, vanilla JS)
│   │   ├── canvas.js             # canvas DOM creation, asset loader, page→canvas coords
│   │   ├── music.js              # crossfading bgm
│   │   ├── sprites.js            # character sprite with manual frame animation
│   │   ├── hitbox.js             # clickable regions + cursor + label hover
│   │   ├── scene-base.js         # Scene class: bg + characters + dialogue + transitions
│   │   └── engine.js             # boot + goTo (replaces Phaser scene-stack)
│   ├── scenes/
│   │   └── _registry.js          # scene-id → Scene subclass map (most are empty)
│   ├── dialogue.js               # InkJS walker + typewriter presenter
│   ├── dialogue-panel.js         # DOM dialogue box + choice buttons
│   ├── inventory.js              # popup inventory UI
│   ├── toast.js                  # transient status messages
│   └── story.js                  # fetch story.json + preload assets + fire story-ready
├── tools/
│   └── vendor-deps.js            # fetch ink-full.js (no CDN)
└── assets/                       # scene plates, sprites, audio, fonts
    ├── backgrounds/scene_*.png
    ├── sprites/<character>/<scene>/idle_NN.png
    ├── audio/*.mp3
    ├── items/*.png
    └── fonts/{nouveau_ibm.ttf, madou-futo-maru.ttf}
```

`node_modules/` is not shipped. Only `vendor/` is needed at runtime.

---

## 4. Data model — `story.json`

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
    "chase": "corridor",
    "corridor": "jailbreak",
    "jailbreak": "eidolon_return",
    "eidolon_return": "alley"
  },
  "scenes": {
    "intro":        { "id": "intro", "kind": "title",  "bg": "scene_intro",
                      "music": "intro_theme.mp3",
                      "hitboxes": [{ "x":0.35, "y":0.55, "w":0.30, "h":0.08,
                                     "target":"alley", "label":"PRESS START" }] },
    "cold_open":    { "id": "cold_open", "kind": "ink", "bg": "scene_intro",
                      "music": "intro_theme.mp3", "ink": "ink/cold_open.ink",
                      "start_node": "Start" },
    "alley":        { "id": "alley", "kind": "ink", "bg": "scene_alley",
                      "music": "alley_confrontation.mp3", "ink": "ink/alley.ink",
                      "start_node": "Start",
                      "characters": [
                        { "id":"android", "speaker":"ANDROID", "position":"right",
                          "scenes": { "alley": {
                            "frames": "assets/sprites/android/alley/idle_*.png",
                            "fps": 4, "loop": true } } }
                      ],
                      "hitboxes": [{ "x":0.15, "y":0.55, "w":0.10, "h":0.15,
                                     "item":"rusty_key", "label":"Search the bins" }] }
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

### 4.1 Scene kinds

- **`title`**: title screen. Music may auto-play, but the click handler is just for the hitbox.
- **`ink`**: Ink-driven dialogue scene. `ink` field specifies the `.ink` file; `start_node` is the starting knot (default `Start`). The dialogue runner is invoked as soon as the scene loads.

### 4.2 Hitboxes

Normalized coordinates `(x, y, w, h ∈ [0,1])` over the scene canvas. Three action types:

- `"target": "scene_id"` — transition to that scene on click.
- `"item": "item_id"` — pick up item (added to inventory, hitbox becomes inactive).
- A hitbox with both item and target: the player must click it twice (first to pick up, then to use) — but v1 doesn't use this case.

Each hitbox is single-use by default. Single-use state lives in `STATE.spentHitboxes`. Once `key` in `STATE.inventory` (or `STATE.consumed`), the hitbox is dead and no cursor/label is shown on hover.

### 4.3 Items + recipes

Items are looked up in `STORY.items`. `key:true` items persist; `key:false` items are consumed on use. Recipes (item combine) are stored as `{ input: [id, id], output: id }` rows. **v1 doesn't ship UI for combining** — recipes are data-only, awaiting an inventory swap panel.

---

## 5. Ink integration

### 5.1 Why Ink

`story.json` JSON-line-arrays would force every line through a JSON edit. Ink gives us variables, conditionals, multi-choice branches, and tags natively. InkJS is ~50KB.

### 5.2 The runner (no Phaser)

`src/dialogue.js` — `DialogueRunner` class. Walks the compiled story once per "step", fires events:

- `onLine(text, tags, typed, total)` — fired on each typewriter tick (and once at start). `typed/total` lets the UI render the partial text.
- `onChoices([{text}, ...])` — fired when the story pauses on `* [Choose something]`. Engine renders buttons; clicking one calls `runner.choose(i)`.
- `onCommand(key, args)` — fired for every Ink tag (`# speaker:NAME`, `# portrait:NAME`, `# give:ITEM_ID`, ...) and for `EXTERNAL` calls. Engine decides whether the command is a scene transition, an inventory mutation, an audio swap, or just data the runner ignores.
- `onComplete()` — story ended, no more lines or choices.

### 5.3 Tag semantics

These Ink tags drive game state. The list is small and stable:

| Tag | Effect |
|---|---|
| `# speaker:NAME` | Speaker label; sprite with `speaker === NAME` starts animating |
| `# speaker:none` | Speaker hidden; all sprites freeze on frame 0 |
| `# portrait:NAME` | Sets which character's sprite is visible; `none` hides all |
| `# give:ITEM_ID` | Adds item to inventory + shows pickup toast |
| `# take:ITEM_ID` | Removes item from inventory |

Unrecognized tags are passed through to `console.log` for debugging. v1 doesn't use `# goto`, `# background`, or `# music`; transition happens via the `EXTERNAL transition_next()` binding at end-of-scene, which looks up `STORY.next[currentSceneId]` and routes through `Engine.goTo`.

### 5.4 External functions

Ink can call back into the game via EXTERNAL:

```
EXTERNAL transition_next()
EXTERNAL return_to_alley()
EXTERNAL has(item_id)
```

- `transition_next()` — looks up `STORY.next[currentSceneId]` and fires the engine transition. Sets `_suppressStep = true` so the post-transition `step()` doesn't trigger Ink "ran out of content" warnings.
- `return_to_alley()` — short-circuit to the alley scene. Used by cold_open and any future scene that wants a hard reset.
- `has(item_id)` — boolean, used by Ink conditionals like `{ has("rusty_key"): ... }`.

### 5.5 Choices as buttons

`* [Some choice]` in Ink → `currentChoices.length > 0` after `Continue()` walks past all preceding lines. The runner fires `onChoices`, the engine renders the buttons, on click the engine calls `runner.choose(index)`. The Ink file does NOT need to know which scene choice X leads to — the scene graph is in `story.json`, and `transition_next()` from the choice's path looks up the destination scene.

---

## 6. Rendering pipeline

### 6.1 The runtime

`src/runtime/scene-base.js` — `Scene` class. Each scene:

1. Loads its background image (cover-fit on the 640×480 internal canvas, scaled via CSS `object-fit: contain`).
2. Loads its music and crossfades via `MusicHandler`.
3. Creates character sprites, each holding a set of preloaded Image elements keyed by frame number.
4. Builds the hitbox layer — a DOM overlay anchored to the canvas's bounding rect for hit-testing and labels.
5. Spins up `DialogueRunner` and attaches to `DialoguePanel` (the DOM dialogue box).
6. Starts `requestAnimationFrame` loop: clear backbuffer → draw background → draw each sprite (sprites update their own frame timers).

### 6.2 PC-98 shader (Bayer dither + palette quantize)

**v0.2 ships without a custom GLSL pipeline.** The PC-98 look is achieved with:

1. CSS overlay `.scanlines` on the body — a 1px-on/1px-off repeating gradient with `mix-blend-mode: multiply`. This is the signature interlace look. `body.no-scanlines .scanlines { display: none; }` toggles it.
2. `<canvas image-rendering: pixelated>` — nearest-neighbor scaling so 640×480 stays crisp at any viewport size.
3. Background plates are pre-quantized to the 16-color palette at generation time (this happens in the Godot `gen_asset.py` pipeline; in v0.2 we run it offline and ship the PNGs as-is).

Adding a GPU shader for live Bayer dither is a v0.3+ optimization. The visual fidelity is identical at the source-asset level; what changes is what happens when the player resizes the window or zooms.

### 6.3 Sprite animation

A `CharacterSprite` is a thin state class: 16 preloaded `HTMLImageElement`s, a target FPS, and a flag `isSpeaking`. The scene's `requestAnimationFrame` loop calls `sprite.update(deltaMs)` which advances the frame index when the elapsed time crosses `1000/fps`. Drawing is delegated to `sprite.draw(ctx)` which calls `ctx.drawImage` with the current frame, centered on the canvas-relative anchor.

Idle animations in v0.2 loop the 16-frame sheet at 4-6 fps while the speaker is active. When the speaker changes or becomes `none`, the sprite freezes on frame 0.

### 6.4 Audio

`src/runtime/music.js` — `MusicHandler`. Single Audio instance per filename, preloaded once via `Runtime.loadAudio`. On `play(filename, baseVolume, fadeMs)` the handler ramps the new track from 0 → baseVolume; if a previous track was playing, it ramps the previous one to 0 in parallel (crossfade), then pauses it. The same singleton persists across scene transitions so crossfades can span boundaries.

MP3s are pre-rendered at build time (see `tools/render-midi.sh` from the Godot project). MIDIs are source of truth; `.mp3` is what the browser plays.

---

## 7. Editor

Out of scope for v0.2. v1 had `editor.html` + `editor.js` for browser-based scene CRUD + Ink source editing. Removing Phaser does not change the editor's server endpoints (it used `PUT /api/story` and `PUT /api/ink/<file>` only); a v0.3 step would re-port the editor with no engine dependency.

---

## 8. Asset strategy

### 8.1 What already exists (carried over)

- 7 scene background PNGs in `assets/backgrounds/` (pre-rendered during the v0.1 era).
- 64 sprite frames under `assets/sprites/<characterId>/<sceneId>/idle_NN.png` (16 frames × 4 character/scene combinations).
- 3 MP3 tracks: `intro_theme.mp3`, `alley_confrontation.mp3`, `clinic_tension.mp3`.
- 2 fonts: `nouveau_ibm.ttf` (UI/dialogue), `madou-futo-maru.ttf` (titles, "PRESS START").
- 7 item icons in `assets/items/`.

### 8.2 Style bible (carried over from Godot `AGENTS.md`)

> **Mature proportions.** No moe. No anime cuteness. No big dough eyes, no tiny chins, no oversized heads on small bodies, no "kawaii" expressions. Characters must look like adults under stress. Reference: Snatcher, Policenauts, Brandish, Rune Soldier.

> **Oppressive cyberpunk horror atmosphere.** Cold blue / cyan / deep red. Rain, neon bleed, harsh shadows. No bright primaries.

> **PC-98 retro look.** Source PNGs are detailed smooth illustrations, not pixel art. The chunky-pixel / 16-color palette look is applied at display time (CSS scanlines + pixelated rendering + pre-quantized plates).

> **NO characters baked into background scenes.** The camera is across the street, looking at architecture not at any character focal point.

> **Typography: PC-98 fan-translation pixel serif.** All UI text uses a variable-width pixel serif `.ttf` in the style of MS Serif / classic Mac OS "New York" bitmap fonts. Anti-aliasing OFF, hinting OFF, subpixel positioning OFF, 1px hard drop shadow on dialogue text.

---

## 9. What ships in v0.2

| Criterion | Status | Notes |
|---|---|---|
| `npm install` succeeds | ✓ | express + multer + inkjs only |
| `npm start` boots Express on `:8765` | ✓ | |
| `index.html` boots, loads `story.json`, renders `intro` | ✓ | vanilla-JS engine |
| Click-to-start → cold_open Ink scene → alley | ✓ | scene graph in `story.json` |
| Ink dialogue with typewriter + speaker label | ✓ | `src/dialogue.js` + `dialogue-panel.js` |
| Choices render as actual buttons that branch Ink | ✓ | `_renderChoices` in `dialogue-panel.js` |
| One hitbox on the alley plate picking up `rusty_key` | ✓ | hitbox layer |
| Inventory popup (INV button top-right) | ✓ | `src/inventory.js` |
| Crossfade music on scene transitions | ✓ | `src/runtime/music.js` |
| No game engine, no `phaser.min.js` | ✓ | vanilla JS |
| Total bundle <2MB | ✓ | ink-full.js (~600KB) + JS (~30KB) + assets |

Out of scope for v0.2 (carry from v1): save/load, mobile touch, localisation, multi-ending, item combine UI, editor.

---

## 10. Phased rollout (v0.2 → v0.3 → v1)

| Phase | Deliverable | Acceptance |
|---|---|---|
| v0.2 | Phaser removal, vanilla-JS engine, all 7 scenes play through | Open `localhost:8765`, intro→eidolon_return→alley loop, choices visible |
| v0.3 | Editor (`editor.html`) re-ported to be engine-free | Add a scene in browser, refresh game, scene appears |
| v0.4 | Bayer-dither pixel shader (live palette quant on canvas) | Resize window, dither is consistent |
| v1.0 | Save/load, mobile touch, item combine UI, multiple endings | Full game loop playable |

Each phase is a `git commit` so rollback is one command.

---

## 11. Migration path from old projects

### From `~/ghost-process-98/`

- `server.js` — already ported, kept verbatim.
- `game.hitbox.js`, `game.inventory.js` — ported as `src/runtime/hitbox.js` and `src/inventory.js` (no engine deps).
- `story.json` SCENE STRUCTURE ported; backgrounds and sprite art regenerated.

### From `~/ghost-process/` (Godot)

- `AGENTS.md` rules ported to this repo's `AGENTS.md`.
- 3 MP3 audio tracks pre-rendered via `tools/render-midi.sh` (FluidSynth → MP3).
- 7 background plates regenerated via `gen_asset.py` (one per scene).
- Android + Thug character sprites: base image regenerated, talking animation extracted as 16-frame PNG sequences (`idle_01.png` ... `idle_16.png`).

### Old projects

- **Keep them.** Rollback path: `cd ~/ghost-process-98 && cd ~/ghost-process && git status`.

---

## 12. Open questions

1. **Live Bayer dither shader**: implement in v0.4 or skip entirely? The DOM scanline overlay + pre-quantized plates look right; a real-time shader would let source PNGs ship in true color.
2. **Ink macro / diverging choices**: the chase.ink currently has 3 branches (Run/Stay/Raise hand) that all converge on `transition_next()` (corridor). v1.5 could route them to different scenes. The cleanest is `EXTERNAL transition_next(target_id)` taking an arg.
3. **Item combine UI**: drag-and-drop on the inventory popup, or button-based ("Combine rusty_key + scrap_metal → tinkered_key" via a small modal)? v1 will use the latter.
4. **Mobile**: 4:3 internal resolution looks small on a phone. Should the canvas upscale via `image-rendering: pixelated` (preserving pixel-grid feel) or stretch fluidly (using CSS `width: 100vw`)?

---

## 13. Reading list for the next agent

1. `AGENTS.md` (style bible, asset rules) — **read first**.
2. `src/runtime/scene-base.js` — the Scene class. This is the cleanest API surface; everything else slots into it.
3. `src/dialogue.js` + `src/dialogue-panel.js` — the Ink↔DOM bridge.
4. `src/runtime/engine.js` — boot + goTo. Where scene transitions actually happen.
5. `story.json` + `ink/*.ink` — the actual content.
6. `~/ghost-process/AGENTS.md` — original visual-style rules with rationale.

## 14. Rollback

```bash
# Look at the v0.1 / Phaser-era commits:
cd ~/ghost-process-js && git log --oneline

# Diff working tree against the last Phaser-era commit:
git diff <commit-sha> -- src/

# Full revert to a known-good Phaser version:
git reset --hard <commit-sha>
```

Or to compare any two implementations: `git checkout <commit-sha> -- src/`.
