# SPEC — GHOST//PROCESS (v3, JavaScript rebuild)

Status: scaffold v0.1
Owner: jwhite
Created: 2026-07-03
Replaces: `~/ghost-process-98/` (pre-Godot JS prototype) + `~/ghost-process/` (abandoned Godot 4.7 refactor)

---

## 1. Why this exists

The project went through two false starts:

1. **`~/ghost-process-98/`** — A data-driven JS visual novel using `story.json`, a browser editor, point-and-click hitboxes, and inventory. It shipped as 34 scenes but never got a real renderer — the engine was hand-rolled DOM manipulation, no Phaser/Pixi, no real sprite compositing, and the assets used a different art style than what we now want.

2. **`~/ghost-process/`** — A Godot 4.7 Mono project with C# + Ink + FluidSynth MIDI. Strong asset pipeline (palettes, PC-98 shader, character sprite sheets, AI-driven image generation via `tools/gen_asset.py`), mature Android sprite + idle animation, and `AGENTS.md` rules that codify "mature PC-98 cyberpunk, no moe, no figures baked into backgrounds." The Godot project got bogged down in:
   - Mono + Web export doesn't work (no stable Godot build has C# WASM)
   - Inkgd (the Ink → Godot bridge) is unmaintained (last commit 3 years ago)
   - FluidSynth is a native binary that can't run in a browser sandbox
   - The C# + Ink stack fought us at every turn

**The rebuild takes the best of both:**

| From `-98` (data-driven JS prototype) | From Godot project (asset pipeline + rules) |
|---|---|
| `story.json` as single source of truth | `AGENTS.md` rules for visual style + asset generation |
| Browser-based authoring editor | PC-98 palette system (16-color quantization shader) |
| Express static server with `PUT /api/story` | Character sprite pipeline (base + blink + mouth + talking) |
| Point-and-click hitboxes + inventory + 2-slot combine | Scene background plates without baked-in characters |
| Per-scene character sprite variants | Android sprite with idle animation, portrait, base |
| Typewriter line presentation + backlog | Madou Futo Maru pixel font for PC-98 typography |
| | 3 MP3 audio tracks (intro_theme, alley_confrontation, clinic_tension) |

**What's discarded:** the C# scripts, FluidSynth MIDI runtime, Ink stories, Mono build, Godot scene files, the old intro_v2 experiments, and the `-98` Blade Runner-cinematic style backgrounds (those had figures baked in — we want clean plates).

---

## 2. Stack

- **Runtime**: Plain JavaScript (ES2022), no TypeScript, no bundler initially
- **Renderer**: **Phaser 3.80+** (web-native 2D game framework, ~1MB minified, actively maintained)
- **Dialogue**: **InkJS** (`yantra/inkjs` npm package) — Ink runtime in pure JS, official Ink language export target, ~50KB
- **Server**: **Express** (already proven in `-98`)
- **Build tool**: None for v1 — Phaser + InkJS loaded as ES modules from local `vendor/` folder. Add Vite later only if module count grows.
- **Deployment**: Static files + `node server.js`. `package.json` `start` script → `node server.js` on port 8765.

**Why this stack:**
- Phaser is the de-facto standard for HTML5 2D point-and-click games (used by half the Itch.io adventure-game scene)
- InkJS is the official Ink runtime — Ink's other targets are C# (Unity) and InkJS (web), and we want web
- Both have years of stable releases, MIT licenses, no native binary dependencies
- No build pipeline = `npm install && npm start` → game runs

---

## 3. File layout

```
ghost-process-js/
├── SPEC.md                       # this file
├── AGENTS.md                     # agent rules (style, asset pipeline, prohibitions)
├── package.json                  # phaser, inkjs, express, multer
├── server.js                     # express static + story/locations API
├── index.html                    # game (Phaser bootstrap)
├── editor.html                   # authoring UI shell
├── editor.js                     # authoring logic
├── editor.css                    # editor styles
├── styles.css                    # game styles
├── game.js                       # Phaser scenes + engine wiring
├── story.json                    # all content (data-driven)
├── ink/                          # Ink source files (one .ink per "chapter")
│   ├── cold_open.ink
│   ├── alley.ink
│   └── ...
├── vendor/                       # phaser.min.js, ink.js — vendored, no CDN
│   ├── phaser.min.js
│   └── ink.js
└── assets/                       # scene plates, sprites, audio, fonts
    ├── scene_*.jpg|png           # 4:3 background plates, no figures
    ├── sprites/<character>/<scene>/
    │   ├── base.png
    │   ├── blink.png
    │   ├── mouth.png
    │   └── talking.webp
    ├── portraits/<character>.png
    ├── audio/*.mp3
    └── fonts/<font>.ttf          # PC-98 pixel font (Madou Futo Maru or similar)
```

**No `node_modules/` in the deliverable** — vendored deps live in `vendor/`. `node_modules/` only needed during install.

---

## 4. Data model — `story.json`

A single JSON file drives the entire game. Format inspired by `-98`'s design with one critical addition: **`ink` field per scene** so dialogue is in Ink, not in the JSON `lines[]` array.

```jsonc
{
  "version": 2,
  "title": "GHOST//PROCESS",
  "start": "intro",
  "scenes": {
    "intro": {
      "id": "intro",
      "kind": "ink",                // 'ink' | 'choice' | 'end' — replaces -98's 'lines|choice|end'
      "bg": "scene_intro",
      "music": "intro_theme.mp3",
      "ink": "ink/cold_open.ink",    // file path; Phaser + InkJS loads this scene's dialogue
      "start_node": "Start",
      "characters": [
        {
          "id": "android",
          "scenes": {
            "intro": { "base": "assets/sprites/android/intro/base.png", "blink": "...", "mouth": "...", "talking": "..." }
          }
        }
      ],
      "hitboxes": [
        { "x": 0.42, "y": 0.71, "w": 0.05, "h": 0.05, "target": "alley", "label": "Door" }
      ]
    },
    "alley": {
      "id": "alley",
      "kind": "ink",
      "bg": "scene_alley",
      "music": "alley_confrontation.mp3",
      "ink": "ink/alley.ink",
      "start_node": "Start",
      "characters": [
        {
          "id": "android",
          "speaker": "ANDROID",
          "position": "right",
          "scenes": { "alley": { "base": "assets/sprites/android/alley/base.png", "talking": "..." } }
        }
      ],
      "hitboxes": [
        { "x": 0.15, "y": 0.45, "w": 0.08, "h": 0.20, "item": "rusty_key", "label": "Search the bins" }
      ]
    }
  },
  "items": {
    "rusty_key": { "id": "rusty_key", "name": "Rusty Key", "icon": "assets/items/rusty_key.png", "key": true },
    "scrap_metal": { "id": "scrap_metal", "name": "Scrap", "icon": "assets/items/scrap.png", "key": false }
  },
  "recipes": [
    { "input": ["rusty_key", "scrap_metal"], "output": "tinkered_key" }
  ]
}
```

### 4.1 Scene kinds

- **`ink`**: Dialogue is in Ink. Game calls `story.ChoosePathString(start_node)`, walks Ink tags (`# speaker:NAME` triggers sprite mouth animation, `# portrait:NAME` shows/hides portrait, `# action:pickup item=rusty_key` adds to inventory).
- **`choice`**: Simple text choice menu (rare; most choices live inside Ink via `* choice`).
- **`end`**: Terminal scene (endings, credits).

### 4.2 Hitboxes

Hitboxes are normalized coordinates (0..1) over the background plate. Click → trigger (goto next scene, pick up item, run Ink jump, etc.). Carry over the `-98` engine untouched.

### 4.3 Items + recipes

Identical to `-98`. Drag one item onto another to combine, drag onto hitbox to use, `key:true` persists, `key:false` consumed.

---

## 5. Ink integration

**Ink scripts live in `ink/<scene>.ink`, one file per scene.** They compile to `story.json`-embedded Ink or are loaded at runtime by InkJS.

### 5.1 Why Ink over JSON-line-array

- `-98` had `lines: [{ speaker, text }]` arrays in `story.json`. Worked, but every line needed a JSON edit, and there was no way to express conditionals, branches, or variable state without polluting the JSON.
- Ink gives us variables (`~ has_key = true`), conditionals, multi-choice branches, tags, all native.
- InkJS is ~50KB and exposes a clean API for game engines (this is exactly how inkjs is used by other Phaser games).

### 5.2 Phaser ↔ InkJS bridge

Phaser scene lifecycle + Ink story walker:

```
Phaser scene "alley" loads
  → fetch('ink/alley.ink').text() → compile via new ink.Compiler(storyText)
  → story = new ink.Story(jsonCompiledStory)
  → story.ChoosePathString(start_node)        // jump to "Start"
  → register external functions (give_item, has_item, goto_scene)
  → loop:
       while story.canContinue:
         line = story.Continue()              // returns next line of dialogue
         tags = story.currentTags              // e.g. ["speaker:android", "portrait:android"]
         showLine(line, tags)                  // typewriter + speaker portrait
       if story.currentChoices.length:
         showChoices(story.currentChoices)     // clickable buttons
         onChoice(idx): story.ChooseChoiceIndex(idx)
       else:
         onDialogueComplete()                  // typically: scene transition
```

### 5.3 Tag semantics

These tags are honored by the Phaser engine — keep this list small and stable:

| Tag | Effect |
|---|---|
| `# speaker:NAME` | Triggers the named character's mouth/talking animation |
| `# portrait:NAME` | Shows the portrait; `# portrait:none` hides |
| `# action:NAME` | One-shot animation trigger (e.g. `action:attack`) |
| `# give:ITEM_ID` | Adds item to inventory |
| `# take:ITEM_ID` | Removes item |
| `# goto:SCENE_ID` | Hard scene transition |
| `# background:PLATE_ID` | Swap background mid-scene |
| `# music:MP3_FILE` | Swap music mid-scene |

Anything else is passed through to `console.log` for debugging.

### 5.4 External functions

Ink can call back into the game via `EXTERNAL`:

```
EXTERNAL has(item_id)
EXTERNAL goto(scene_id)
```

These are registered on the InkJS story at boot and return booleans/void.

---

## 6. Rendering pipeline

### 6.1 Phaser scene graph

```
Phaser.Scene "GameScene"
├── this.add.image(0, 0, 'bg.scene_alley')   // 4:3 plate, scaled to fit
├── this.add.container(0, 0, [android_sprite]) // characters sit on top
├── this.add.dom(0, 0, 'div', dialogueHTML)   // dialogue box (HTML/CSS for font)
└── this.add.dom(0, 0, 'div', inventoryHTML)  // inventory bar (HTML/CSS)
```

HTML/CSS for dialogue + inventory, not Phaser text. Reason: pixel-perfect PC-98 font rendering with a custom `.ttf` is easier in CSS (`font-smoothing: none`, `image-rendering: pixelated`) than in Phaser BitmapText.

### 6.2 PC-98 shader (Bayer dither + palette quantize)

In Phaser, apply as a post-fx `WebGLPipeline` (custom fragment shader) that:
1. Reads framebuffer
2. Bayer-dithers to nearest of 16 palette colors per scene
3. Outputs

Palette per scene defined in `assets/palettes/<scene>.json` (not Godot `.tres` — keep it portable):

```json
{
  "scene_alley": ["#0a0a14", "#1a1a2e", "#3a2e4a", "#7a3e5a", "#c44e6a", "#ff6e8a", "#ffae7a", "#ffd29a",
                  "#0e3a5e", "#1e5e8e", "#3e8ebe", "#7ebeee", "#aeceee", "#eeeeee", "#5a3a2a", "#8a5a3a"]
}
```

This replaces the Godot `shaders/pc98_viewport.gdshader` — same visual, JS-side implementation. The Godot shader source lives at `shaders/pc98_viewport.gdshader` in the old project; we port its Bayer + quantize logic verbatim.

### 6.3 Sprite animation

Phaser animation system replaces the Godot AnimatedSprite2D + chroma-keyed frames:
- One Phaser scene per "character stance" (idle, talking, blink)
- Frame-by-frame switching: when `mouth` should flap, alternate `mouth_open` ↔ `mouth_closed` every 80ms
- Talking animation: render `talking.webp` (4-frame loop from I2V) as a sprite, play forward, freeze on last frame for static pose
- Blink: 200ms `blink.png` every 3-5s (randomized)

### 6.4 Audio

Phaser's WebAudio:
- `this.load.audio('intro_theme', 'assets/audio/intro_theme.mp3')`
- `this.sound.play('intro_theme', { loop: true, volume: 0.7 })`
- One music track per scene, swap on `goto:SCENE_ID` or `music:MP3` Ink tag
- **No FluidSynth.** MP3s only. MIDI source files (`.mid`) are archived but not loaded by the runtime.

---

## 7. Editor (browser-based, ported from `-98`)

`editor.html` + `editor.js` — same Express `PUT /api/story` + `POST /api/assets` endpoints. **Reuse the existing server.js verbatim** — copy from `-98`.

### 7.1 What's new vs `-98`

- **Ink source view/edit panel**: editor lets you edit `.ink` files directly with syntax highlighting (CodeMirror or similar). Save → `PUT /api/ink/<file>.ink`. Game hot-reloads on save.
- **Palette editor**: pick 16 colors per scene, preview on the background plate (browser-side Bayer shader).
- **Hitbox visualizer**: drag rectangles on the background plate, see normalized x/y/w/h live.

### 7.2 What stays

- Scene CRUD (add/remove scenes, set bg, music, kind)
- Item CRUD (add icons, mark as key, set recipes)
- Save / load `story.json` atomically (write-temp + rename)
- Asset upload via multipart (max 8MB per file)

---

## 8. Asset strategy

### 8.1 Existing assets — what to port

**From `-98` (can port):**
- `story.json` SCENE STRUCTURE only (the 34 scene graph, dialogue text, character ids) — NOT the backgrounds or sprites
- `server.js` — copy verbatim
- `locations.json` — port
- `game.hitbox.js`, `game.inventory.js` — port as Phaser plugins (rewrite for Phaser event model)
- `SPRITE_PIPELINE.md` — port as `AGENTS.md` section
- The android character design (single pose) — re-render in new style

**From `~/ghost-process/` (can port):**
- `AGENTS.md` rules for visual style (mature PC-98 cyberpunk, no moe, etc.) — port verbatim
- The 16-color palette system (`tools/palettes.py` becomes `tools/palettes.py` in the new project, JS-serializable output)
- The PC-98 shader logic (`shaders/pc98_viewport.gdshader` → `src/pc98-shader.glsl`)
- The Madou Futo Maru font (or Nouveau_IBM.ttf)
- `tools/gen_asset.py` — port the style bible (negative prompts, per-preset style overrides) into the new repo
- The 3 MP3 audio tracks (`intro_theme.mp3`, `alley_confrontation.mp3`, `clinic_tension.mp3`)
- Android portrait (`assets/characters/android/portrait.png` from Godot project)
- The sprite-pipeline concept (per-scene base/blink/mouth/talking variants)

**What to regenerate fresh:**
- All scene background plates (`scene_alley`, `scene_intro`, `scene_terminal`, etc.) — the existing ones either have figures baked in (from `-98`) or don't match the new simpler 2-scene MVP scope
- All character sprites (android, any others) — at least one pose per character, plus talking frame
- Item icons

### 8.2 v1 minimum scene list

The prototype will ship with **2 scenes + 1 sprite + 1-2 items** to prove the pipeline end-to-end:

1. `intro` — title screen, "Press Start", music: `intro_theme.mp3`
2. `alley` — one background, one Android sprite, one hitbox, one Ink dialogue node, one item pickup

Add more scenes once the 2-scene pipeline is proven working.

### 8.3 Style bible (carry over from Godot project's AGENTS.md)

> **Mature proportions.** No moe. No anime cuteness. No big dough eyes, no tiny chins, no oversized heads on small bodies, no "kawaii" expressions. Characters must look like adults under stress. Faces have structure (jaw, cheekbones, brow ridges). Eyes are proportional to the head, not ballooned. Reference: Snatcher, Policenauts, Brandish, Rune Soldier character art.
>
> **Oppressive cyberpunk horror atmosphere.** Cold blue / cyan / deep red. Rain, neon bleed, harsh shadows. No bright primaries, no cheerful palettes. Lighting is hard and directional, not soft and diffuse.
>
> **PC-98 retro pixel art aesthetic.** Source PNGs are detailed smooth illustrations, NOT pixel art — the chunky-pixel / 16-color palette look is applied at display time by the post-fx shader (Bayer dither + palette quantization). Asking the model for "pixel art" produces blocky low-detail characters with deformed proportions, which is NOT the Snatcher look.
>
> **NO characters baked into background scenes.** Camera is across the street / overhead, looking at ARCHITECTURE not at any character focal point. Use phrases like "wide establishing shot, no people, no figures, no silhouettes, no statues, no mannequins — only buildings and weather".
>
> **Typography: PC-98 fan-translation pixel serif.** All UI text uses a variable-width pixel serif .ttf in the style of MS Serif or classic Mac OS "New York" bitmap fonts. Anti-aliasing is DISABLED, hinting is OFF, subpixel positioning is OFF, filtering is nearest-neighbor. 1-pixel hard drop shadow on dialogue text.

---

## 9. What ships in v1 (this repo, this scaffold)

A working 2-scene prototype proves the pipeline end-to-end. Specifically:

1. `npm install` succeeds, `npm start` boots Express on `:8765`
2. `index.html` boots Phaser, loads `story.json`, renders `intro` scene with title background + music
3. Click-to-start → loads `alley` scene, shows Android sprite, plays `alley_confrontation.mp3`
4. Ink dialogue runs: typewriter text, sprite mouth flapping, line-by-line advance on click
5. One hitbox on the alley plate, clicking picks up `rusty_key` item
6. Item appears in inventory bar; clicking it shows its name
7. Browser editor at `/editor.html` lets you add a new scene and save
8. `tree-shake: nothing` — total bundle <2MB including Phaser + InkJS + assets

**Out of scope for v1:**
- Save/load game state (use a single session, restart to test)
- Mobile touch input (mouse-only — Phaser's mobile support can come later)
- Localisation (single English)
- Multiple endings / complex Ink branching (single happy-path through 2 scenes)
- Audio mixing / crossfade (hard cuts on scene change)

---

## 10. Phased rollout

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0 | This SPEC + empty scaffold + `package.json` | `npm install` succeeds |
| 1 | Phaser boots, loads `story.json`, renders intro plate + plays intro music | Open `localhost:8765`, see title screen |
| 2 | Click-to-start → alley scene + Android sprite + alley music | See background, sprite, hear music |
| 3 | InkJS wired: one Ink file, one node, dialogue typewriter, mouth flap | See text appear letter-by-letter |
| 4 | Hitbox system ported from `-98` (one hitbox, one item pickup) | Click hitbox, item appears in inventory bar |
| 5 | PC-98 shader post-fx applied | Background has Bayer dither, 16-color palette visible |
| 6 | Editor at `/editor.html` — scene CRUD + story save | Add a scene in browser, refresh game, scene appears |
| 7 | Polish: ink syntax highlight in editor, hitbox visualizer, palette picker | Open editor, see new features |
| 8 | Documentation: `AGENTS.md`, `README.md`, asset pipeline notes | New agent can read these and continue |

Each phase is a `git commit` so rollback is one command.

---

## 11. Migration path from old projects

### From `~/ghost-process-98/`
- Copy `server.js` → `ghost-process-js/server.js` (verbatim)
- Copy `game.hitbox.js`, `game.inventory.js` → `ghost-process-js/src/` (rewrite for Phaser)
- Port `story.json` scene graph (background paths updated to point at new plates)
- Port `SPRITE_PIPELINE.md` content → `AGENTS.md` section

### From `~/ghost-process/`
- Port `AGENTS.md` (style bible) verbatim
- Port `tools/palettes.py` + per-scene palettes
- Port `shaders/pc98_viewport.gdshader` logic → `src/pc98-shader.glsl`
- Port the android portrait
- Port the 3 MP3 audio files
- Port `tools/gen_asset.py` style bible + negative prompts into the new repo

### Old projects
- **Keep them** as historical reference. Don't delete until the new repo has a working v1.
- Both are git-tracked. Rollback path: `cd ~/ghost-process-98 && git status` shows last working state.

---

## 12. Open questions

1. **Font**: which pixel-serif TTF do we use? Candidates: `Nouveau_IBM.ttf` (current Godot project, PC-9801 ANK ROM extract), `Madou Futo Maru Gothic` (free Japanese gothic). Decide before phase 5.
2. **Mobile / responsive**: do we want the game to work on mobile browsers (Phaser supports it natively), or desktop-only? Decision affects hitbox sizing logic.
3. **Save state**: localStorage autosave every scene transition? Skip for v1.
4. **Editor auth**: anyone with the LAN URL can edit `story.json`. Acceptable for solo project, but if we ever share the server publicly we need basic auth.
5. **Phaser 3 vs Phaser 4**: Phaser 4 is in alpha. Stick with 3.80+ stable for v1.

---

## 13. Reading list for the next agent

If you're picking up this project:

1. Read this `SPEC.md` end-to-end.
2. Read `AGENTS.md` for the style bible and asset generation rules.
3. Read `~/ghost-process-98/SPEC.md` and `~/ghost-process-98/AGENTS.md` — they explain the data-driven engine and the asset pipeline this project inherits.
4. Read `~/ghost-process/AGENTS.md` — the source of the PC-98 style bible.
5. Look at `~/ghost-process/AI-HANDOFF.md` (cautiously) for context on prior iteration history. It's verbose, ignore the parts about Godot/C#/Mono — those don't apply anymore.
6. Read `ink/cold_open.ink` and `ink/alley.ink` for the dialogue style.

DO NOT:
- Add TypeScript. Stay in plain JS.
- Add a bundler (Vite, webpack, rollup) until bundle size forces it.
- Use Phaser 4 alpha. Stick with 3.80+.
- Use a CDN for Phaser/InkJS — vendor them locally for offline play and Tailscale-only hosting.
- Add new dependencies without thinking about whether the game needs it.

---

## 14. Rollback

Both prior projects remain intact:
- `~/ghost-process-98/` — last commit unknown, was working as of 2026-07-03
- `~/ghost-process/` — at git tag `pre-gdscript-refactor` (commit `8eed992`), state before this rebuild

If the JS rebuild goes wrong, the user can `cd` into either of those and have a working game prototype.