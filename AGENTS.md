# AGENTS.md — GHOST//PROCESS

Stack: **vanilla JavaScript + InkJS + Express.** No engine. No Phaser. No Godot. No Mono. No Yarn Spinner. No bundler. No TypeScript.

If your session prompt mentions any of those as the current stack, it's stale — ignore it.

`~/ghost-process/` and `~/ghost-process-98/` are unrelated dead projects. Don't touch them.

## Project intent

PC-98 / late-80s cyberpunk horror visual novel. Point-and-click adventure. Dialogue-driven. Browser-first deployment.

## Style bible — MANDATORY for all asset generation

1. **Mature proportions.** No moe. No anime cuteness. No big dough eyes, no tiny chins, no oversized heads, no "kawaii" expressions. Characters look like adults under stress. Faces have structure (jaw, cheekbones, brow ridges). Eyes proportional to head.
   - Reference: Snatcher, Policenauts, Brandish, Rune Soldier character art.

2. **Oppressive cyberpunk horror atmosphere.** Cold blue / cyan / deep red. Rain, neon bleed, harsh shadows. No bright primaries, no cheerful palettes. Lighting is hard and directional, not soft and diffuse.

3. **PC-98 retro pixel art aesthetic at DISPLAY time, not source time.** Source PNGs are detailed smooth illustrations — the chunky-pixel / 16-color palette look is applied at display time by the runtime (Bayer dither + palette quantization, see `src/runtime/canvas.js` `ditherImageToCanvas`). Asking the model for "pixel art" produces blocky low-detail characters with deformed proportions.

4. **Typography: PC-98 fan-translation pixel serif.** All UI text uses a variable-width pixel serif .ttf (Madou Futo Maru Gothic, Nouveau IBM, or equivalent). Anti-aliasing DISABLED, hinting OFF, subpixel positioning OFF, nearest-neighbor filtering. Dialogue text carries a stark 1-pixel hard drop shadow.

5. **NO characters baked into background scenes.** Camera is across the street / overhead, looking at ARCHITECTURE not at any character focal point. Use phrases like "wide establishing shot, no people, no figures, no silhouettes, no statues, no mannequins — only buildings and weather".

## Asset regeneration — script discipline

All image generation goes through `tools/gen_asset.py`. The script bakes in:
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
- `story.json` `music` field is a string (single MP3) or an ordered array of track objects (medley). Arrays are not limited to two tracks; the current 9 gameplay scenes each use A→B→C→D→E. A destination entry's optional `fadeAt` schedules the crossfade into that entry after the current track has played that many seconds. Crossfade is wired in `src/runtime/music.js`.
- Sample-rate 44.1 kHz, mono or stereo OK. Volume ~0.7 default.

## Code architecture

- **Single source of truth: `story.json`.** Every scene, item, task, and hitbox lives there. Engine code reads it; editor writes it.
- **Engine scenes map 1:1 to story scenes.** When the player enters `alley`, the runtime's scene loader boots, reads that scene's config from `story.json`, mounts the dialogue runner, plays music, attaches hitboxes. Implementation lives in `src/runtime/` (vanilla JS).
- **No global state outside `boot.js` + `src/runtime/` modules.** Each scene owns its own state via closure; cross-scene state (inventory, visited, consumed) lives in `window.STATE` initialised at boot.
- **No new dependencies without discussion.** InkJS + Express + Multer is the ceiling.

## Known failure modes — DO NOT REPEAT

- **Don't generate "clean" BGs and trust them.** The image model puts figures back in despite instructions. Verify each generation with vision before committing.
- **Don't trust the model's first answer on talking animations.** Talking animations must include explicit mouth movement in the prompt. Missing mouth motion = static sprite that looks wrong.
- **Don't add a new character sprite just because the scene wants one.** If a character can't be generated to match the mature PC-98 style, leave it out — no character is better than wrong-style character.
- **Don't bypass Ink tag semantics.** `# speaker` controls mouth animation, `# portrait` controls portrait visibility. Don't repurpose.
- **Don't ship static-frame fallbacks for failed animations.** Better to leave a documented gap.
- **Don't add a bundler (Vite/webpack) until bundle size forces it.** Vendor deps locally.

## Session-end checks

Run before claiming any task is done so the next chat picks up cleanly:

```bash
pkill -f "node server.js" 2>/dev/null
cd "$(git rev-parse --show-toplevel)"
npm start &   # verify server boots
git status    # expect clean (or intentional uncommitted)
```

If you ran a regen through `tools/gen_asset.py`, also verify:
- Sidecar `.prompt.json` exists next to the asset
- `tools/generation_log.jsonl` got an append

## Reading order for new agents

1. `SPEC.md` — architecture, file layout, data model
2. `AGENTS.md` — this file
3. `AI-HANDOFF.md` — most recent session's state
4. `story.json` — scene wiring
5. `ink/*.ink` — dialogue style