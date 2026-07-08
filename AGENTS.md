# AGENTS.md — GHOST//PROCESS (JS rebuild)

> Working rules for AI agents and humans continuing this project. Read this before touching anything; this is the second false-start of this project (after `~/ghost-process-98/` and `~/ghost-process/`). Decisions below are deliberate.

## Project intent

PC-98 / late-80s cyberpunk horror visual novel. Point-and-click adventure. Dialogue-driven. Browser-first deployment.

**Stack** (committed, not up for debate):
- Phaser 3.80+ for rendering
- InkJS for dialogue
- Plain JavaScript (no TypeScript)
- Express server for static + story.json + asset upload
- No build pipeline until forced; Phaser + InkJS vendored under `vendor/`

See `SPEC.md` for full architecture.

## Style bible — MANDATORY for all asset generation

These rules are non-negotiable. They came from `~/ghost-process/AGENTS.md` after multiple costly iteration cycles. Treat them as fixed.

1. **Mature proportions.** No moe. No anime cuteness. No big dough eyes, no tiny chins, no oversized heads, no "kawaii" expressions. Characters look like adults under stress. Faces have structure (jaw, cheekbones, brow ridges). Eyes proportional to head.
   - Reference: Snatcher, Policenauts, Brandish, Rune Soldier character art.

2. **Oppressive cyberpunk horror atmosphere.** Cold blue / cyan / deep red. Rain, neon bleed, harsh shadows. No bright primaries, no cheerful palettes. Lighting is hard and directional, not soft and diffuse.

3. **PC-98 retro pixel art aesthetic at DISPLAY time, not source time.** Source PNGs are detailed smooth illustrations — the chunky-pixel / 16-color palette look is applied at display time by the post-fx shader (Bayer dither + palette quantization). Asking the model for "pixel art" produces blocky low-detail characters with deformed proportions.

4. **Typography: PC-98 fan-translation pixel serif.** All UI text uses a variable-width pixel serif .ttf (Madou Futo Maru Gothic, Nouveau IBM, or equivalent). Anti-aliasing DISABLED, hinting OFF, subpixel positioning OFF, nearest-neighbor filtering. Dialogue text carries a stark 1-pixel hard drop shadow.

5. **NO characters baked into background scenes.** Camera is across the street / overhead, looking at ARCHITECTURE not at any character focal point. Use phrases like "wide establishing shot, no people, no figures, no silhouettes, no statues, no mannequins — only buildings and weather".

## Asset regeneration — script discipline

All image generation goes through `tools/gen_asset.py` (porting from `~/ghost-process/`). The script bakes in:
- The style bible above (negative prompts, character description)
- Per-preset style overrides
- Post-processing (Bayer dither, palette quantize)
- Sidecar `.prompt.json` + `tools/generation_log.jsonl` provenance

**Never** call image-gen APIs ad-hoc. Every regen writes provenance.

## Character consistency — image-to-video

For character animations: use image-to-video (I2V), not text-to-video.
1. Generate base portrait once (`assets/portraits/<name>.png`)
2. For each animation (idle, talk, blink), feed the portrait as `first_frame_image` to the I2V API
3. Regenerating base invalidates all animations — re-do all of them

## Audio policy

- **MP3 only at runtime.** No FluidSynth, no MIDI playback. The `.mid` source files are archived but not loaded.
- One MP3 per scene for music. Swap on scene transition. Hard cut, no crossfade (out of scope for v1).
- Sample-rate 44.1 kHz, mono or stereo OK. Volume ~0.7 default.
- Three tracks carried over from `~/ghost-process/`: `intro_theme.mp3`, `alley_confrontation.mp3`, `clinic_tension.mp3`.

## Code architecture

- **Single source of truth: `story.json`.** Every scene, item, recipe, hitbox lives there. Engine code reads it; editor writes it.
- **Phaser scenes map 1:1 to story scenes.** When user enters `alley`, a Phaser scene boots, loads that scene's config from `story.json`, mounts the dialogue runner, plays music, attaches hitboxes.
- **No global state outside `game.js`.** Each Phaser scene owns its own state. Cross-scene state (inventory, visited) lives in `story.state` object initialized at boot.
- **No new dependencies without discussion.** Phaser + InkJS + Express + Multer is the ceiling.

## Known failure modes — DO NOT REPEAT

- **Don't generate "clean" BGs and trust them.** The image model puts figures back in despite instructions. Verify each generation with vision before committing.
- **Don't trust the model's first answer on talking animations.** Talking animations must include explicit mouth movement in the prompt. Missing mouth motion = static sprite that looks wrong.
- **Don't add a new character sprite just because the scene wants one.** If a character can't be generated to match the mature PC-98 style, leave it out — no character is better than wrong-style character.
- **Don't bypass Ink tag semantics.** `# speaker` controls mouth animation, `# portrait` controls portrait visibility. Don't repurpose.
- **Don't ship static-frame fallbacks for failed animations.** Better to leave a documented gap.
- **Don't add a bundler (Vite/webpack) until bundle size forces it.** Vendor deps locally.

## v1 scope — DO NOT exceed

The v1 prototype ships with **2 scenes + 1 sprite + 1-2 items**. Don't add:
- More scenes until the 2-scene pipeline is proven
- More characters until the Android sprite is finalized
- Save/load, mobile, localisation, complex branching, audio crossfade
- TypeScript, bundlers, Phaser 4

Read `SPEC.md` §9 for v1 acceptance criteria.

## Session-end checks

Run before claiming any task is done so the next chat picks up cleanly:

```bash
pkill -f "node server.js" 2>/dev/null
cd /Users/jwhite/ghost-process-js
npm start &   # verify server boots
git status    # expect clean (or intentional uncommitted)
```

If you ran a regen through `tools/gen_asset.py`, also verify:
- Sidecar `.prompt.json` exists next to the asset
- `tools/generation_log.jsonl` got an append

## Reading order for new agents

1. `SPEC.md` (this directory)
2. `AGENTS.md` (this file)
3. `story.json` (data model)
4. `ink/*.ink` (dialogue style)
5. `~/ghost-process-98/SPEC.md` and `~/ghost-process-98/AGENTS.md` (inherited design rules)
6. `~/ghost-process/AGENTS.md` (style bible origin)