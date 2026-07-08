// src/runtime/sprites.js — character sprites drawn on the scene canvas.
//
// Each CharacterSprite owns a set of preloaded Image elements and a
// timer that ticks on the scene's render loop. When `setSpeaking(true)`
// is called, the timer starts swapping between frames at the
// configured FPS; when set to false the sprite freezes on frame 0
// (the rest pose). Drawing is delegated to the scene's render() pass,
// not here — this class is pure state.
//
// Sprites also carry an opacity that fades in/out in response to
// `# portrait:NAME` and `# portrait:none` Ink tags. scene-base calls
// setVisible()/setHidden() in response; we ease toward target at
// FADE_RATE per second. instant=true skips the fade for sprites that
// must be present from frame 0 (jailbreak thug).

class CharacterSprite {
    constructor(characterConfig, sceneId) {
        this.character = characterConfig;
        this.sceneId = sceneId;
        this.frames = [];     // HTMLCanvasElement[] (despilled)
        this.frameRate = 4;
        this.loop = true;
        this.isSpeaking = false;
        this.currentFrame = 0;
        this.elapsed = 0;     // ms since last frame advance

        // Fade-in/out state. Opacity is multiplied into the canvas
        // draw at render time. _tickOpacity() eases toward
        // targetOpacity at FADE_RATE per second.
        this.opacity = 0;
        this.targetOpacity = 0;
        this.FADE_RATE = 2.5; // 0 -> 1 in 400ms
        this._visible = false;

        this._resolveSpriteCfg();
    }

    _resolveSpriteCfg() {
        const sc = this.character.scenes || {};
        const cfg = sc[this.sceneId] || sc.default;
        if (!cfg || !cfg.frames) return;
        this.frameRate = cfg.fps || 4;
        this.loop = cfg.loop !== false;
        this._globPrefix = cfg.frames;
    }

    // Called by Scene after all preload has resolved. The runtime's
    // assets.images map holds Image objects keyed by full URL.
    //
    // Each source frame is blitted to an offscreen canvas with the
    // green-tinted "halo" pixels keyed out — sprites in this project
    // were drawn with a thin green outline (the artist used a green
    // scribble brush) that was meant to be chroma-keyed at runtime.
    // We do it here, once, instead of every draw call.
    bindFrames(urls) {
        const Rt = window.Runtime;
        for (const url of urls) {
            const img = Rt.assets.images[url];
            if (!img) continue;
            this.frames.push(this._despillGreen(img));
        }
    }

    _despillGreen(img) {
        // Pixel-level green-spill removal. The artist's green halo
        // is a continuous olive-green outline drawn on a green-
        // screen background, then composited at 50% alpha on body
        // silhouettes (R>0, G dominant, B in 20-40). When you sample
        // these source PNGs you get a clean bimodal distribution:
        //   - edge halo pixels: alpha ~128 (the 50% blended outline)
        //   - solid body pixels: alpha ~255 (real hair, face shading,
        //                          denim jacket, etc) which sometimes
        //     happen to lean green due to color compression / downscale.
        //
        // Strategy:
        //   1. Semi-transparent GREEN edge pixels (alpha 10..239, G
        //      dominant): kill the alpha entirely. They were the
        //      greenscreen outline.
        //   2. Solid GREEN body pixels (alpha >= 240, G dominant):
        //      DESATURATE in place. Pull G toward the average of R
        //      and B so the colour is no longer greenish. We can't
        //      kill these because the legitimate body shading leans
        //      green on this convicts sprite, but we MUST mute the
        //      green or else the face looks like it's translucent.
        const w = img.width;
        const h = img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
            // Pass 1: low-alpha edges → transparent.
            if (a > 0 && a < 240 && g > r * 1.2 && g > b * 1.2 && g < 220) {
                px[i + 3] = 0;
            }
        }
        // Pass 2 on a separate frame copy so pass 1's alpha kills
        // don't influence pass 2 (we want solid pixels handled, even
        // if they sit next to a halo edge). We re-read the desaturated
        // canvas after blitting it.
        const ctx2 = c.getContext('2d');
        // We can't easily run pixel ops twice on the same canvas
        // without a second buffer, so do pass 2 here against the
        // already-killed data — solid pixels are unaffected by the
        // pass-1 alpha kill, so it's safe.
        // Pass 2: greenscreen ghosting on solid pixels.
        //
        // The greenscreen outline (pass 1) is fully keyed out, but
        // the source PNG also has G-dominant tint leaking into the
        // *body* pixels — most visible on the thug's bald head
        // (the high-green halo bleeds into the dark skin shading
        // and you can see a green wash on the silhouette). Pulling
        // G toward (r+b)/2 at 70% didn't catch this because the
        // average still has G higher than both R and B after the
        // pull (e.g. (0,84,20) -> (0,32,20) still flags as
        // green-dominant).
        //
        // Strategy: only modify pixels that are *clearly* green-
        // excess (G higher than R by 20+ AND higher than B by 15+
        // — natural skin/jacket pixels don't satisfy both). Pull
        // G halfway toward max(R, B) — half-strength to avoid the
        // last-time mistake of stripping the head into transparency.
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 240) continue; // only solid pixels
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const gExcessR = g - r;
            const gExcessB = g - b;
            if (gExcessR > 20 && gExcessB > 15) {
                // 50% blend toward max(R, B). Half-strength: leaves
                // some structure (the pixel doesn't go to neutral
                // grey) but kills most of the green dominance.
                const target = Math.max(r, b);
                px[i + 1] = Math.round(g * 0.5 + target * 0.5);
            }
        }
        // Pass 3: kill solid green-dominant pixels at the silhouette
        // boundary. After pass 1 keys the half-alpha outer ring to
        // alpha 0, the next layer in is now the new edge — and those
        // solid pixels are often still green-dominant (this is the
        // "green ring around the whole sprite" the user reported).
        // We can't tell from a single pixel whether it's at the
        // boundary, so we check 4-neighbors: if any neighbor is now
        // transparent, this pixel is at the edge. Run the pass
        // iteratively (3 passes is plenty) so killing an outer pixel
        // exposes the next inner layer, which also gets killed if it's
        // green-dominant. This is bounded — interior pixels aren't
        // next to transparent so they don't get touched.
        for (let iter = 0; iter < 3; iter++) {
            let changed = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    if (px[i + 3] < 240) continue; // only solid pixels
                    const r = px[i], g = px[i + 1], b = px[i + 2];
                    // Is this pixel next to a transparent neighbor?
                    let nextToTransparent = false;
                    if (x > 0 && px[((y * w) + (x - 1)) * 4 + 3] < 5) nextToTransparent = true;
                    else if (x < w - 1 && px[((y * w) + (x + 1)) * 4 + 3] < 5) nextToTransparent = true;
                    else if (y > 0 && px[(((y - 1) * w) + x) * 4 + 3] < 5) nextToTransparent = true;
                    else if (y < h - 1 && px[(((y + 1) * w) + x) * 4 + 3] < 5) nextToTransparent = true;
                    if (!nextToTransparent) continue;
                    // Green-dominant? Same threshold as pass 1 (1.15x
                    // each channel) — slightly looser than pass 2's
                    // g-r/g-b threshold so we catch the inner ring.
                    if (g > r * 1.15 && g > b * 1.15) {
                        px[i + 3] = 0;
                        changed++;
                    }
                }
            }
            if (changed === 0) break;
        }
        ctx.putImageData(data, 0, 0);
        return c;
    }

    // Logical placement on the canvas. position: left/right/center/closeup.
    // Default feet anchor 30px above the canvas bottom — the c7c6244
    // baseline that worked for every scene (prisoner in jailbreak,
    // android in chase/corridor, etc.). The alley captain needs a
    // different anchor (cobblestone ground line, not canvas bottom)
    // so we let the character's `placementY` field override this
    // when set in story.json. Default scene-base uses canvasH - 30.
    placementY(canvasH) {
        if (this.character && typeof this.character.placementY === 'number') {
            // placementY is a fraction (0..1) of canvasH. It
            // represents where the sprite's BOTTOM edge lands on
            // the canvas. Values < 0 or > 1 are valid — the
            // editor lets you park a sprite past the edge so
            // parts of it go off-canvas (e.g. cinematic closeups
            // where the camera is "too close"). When the value
            // is out of range, the runtime draws the sprite with
            // the relevant part clipped by the canvas border
            // (and the console gets a one-shot warning so the
            // author can decide if it's intentional).
            const v = this.character.placementY;
            if ((v < 0 || v > 1) && !this._warnedOffCanvasY) {
                console.warn(
                    `[sprites] placementY=${v} on "${this.character.id || '?'}" in canvasH=${canvasH} is past the canvas edge. ` +
                    `The sprite will be drawn with the relevant part clipped. ` +
                    `If this is intentional (closeup / off-screen character), you can ignore this warning.`
                );
                this._warnedOffCanvasY = true;
            }
            return canvasH * v;
        }
        return canvasH - 30;
    }

    placementX(canvasW, position, spriteW) {
        // Continuous numeric placementX takes priority when present —
        // it stores the sprite's CENTRE X as a fraction of canvas
        // width (same convention as editor.js placementXFor). When
        // set, the editor saved it from a drag and the runtime MUST
        // honour that exact position. Falls back to the legacy named
        // position slot for characters that haven't been dragged yet.
        if (this.character && typeof this.character.placementX === 'number') {
            // Same off-canvas behaviour as placementY: values
            // < 0 or > 1 are valid (e.g. a character parked to
            // the left of the canvas for a closeup). The console
            // gets a one-shot warning.
            const v = this.character.placementX;
            if ((v < 0 || v > 1) && !this._warnedOffCanvasX) {
                console.warn(
                    `[sprites] placementX=${v} on "${this.character.id || '?'}" in canvasW=${canvasW} is past the canvas edge. ` +
                    `The sprite will be drawn with the relevant part clipped. ` +
                    `If this is intentional (closeup / off-screen character), you can ignore this warning.`
                );
                this._warnedOffCanvasX = true;
            }
            return canvasW * v;
        }
        // For 'bottomright' (jailbreak thug whose body runs to the right
        // edge of its 180px-wide source) we right-align against the
        // canvas edge with a small inset — same as the 165a370 baseline.
        if (position === 'bottomright' && spriteW) {
            return canvasW - 20 - spriteW / 2;
        }
        switch (position) {
            case 'left':     return canvasW * 0.25;
            case 'right':    return canvasW * 0.75;
            case 'bottomright': return canvasW - 20;
            case 'center':   return canvasW * 0.50;
            case 'closeup':  return canvasW * 0.50;
            default:         return canvasW * 0.50;
        }
    }

    setSpeaking(isSpeaking) {
        if (this.isSpeaking === isSpeaking) return;
        this.isSpeaking = isSpeaking;
        if (!isSpeaking) {
            // Freeze on the rest pose.
            this.currentFrame = 0;
            this.elapsed = 0;
        }
    }

    // High-level visibility helpers used by scene-base. instant=true
    // skips the fade (used for sprites that should be present from
    // frame 0, like the jailbreak thug).
    setVisible(instant = false) {
        this._visible = true;
        if (instant) {
            this.opacity = 1;
            this.targetOpacity = 1;
        } else {
            this.targetOpacity = 1;
        }
    }
    setHidden(instant = false) {
        this._visible = false;
        if (instant) {
            this.opacity = 0;
            this.targetOpacity = 0;
        } else {
            this.targetOpacity = 0;
        }
    }

    update(deltaMs) {
        if (!this.isSpeaking || this.frames.length === 0) return;
        const frameDurationMs = 1000 / this.frameRate;
        this.elapsed += deltaMs;
        while (this.elapsed >= frameDurationMs) {
            this.elapsed -= frameDurationMs;
            this.currentFrame++;
            if (this.currentFrame >= this.frames.length) {
                if (this.loop) this.currentFrame = 0;
                else this.currentFrame = this.frames.length - 1;
            }
        }
    }

    _tickOpacity(deltaSec) {
        // Ease toward target. Epsilon stop so we don't burn frames
        // chasing a tiny remaining gap.
        const diff = this.targetOpacity - this.opacity;
        if (Math.abs(diff) < 0.01) {
            this.opacity = this.targetOpacity;
            return;
        }
        const step = this.FADE_RATE * deltaSec;
        if (diff > 0) this.opacity = Math.min(this.targetOpacity, this.opacity + step);
        else this.opacity = Math.max(this.targetOpacity, this.opacity - step);
    }

    draw(ctx) {
        if (this.frames.length === 0) return;
        if (this.opacity <= 0) return;
        const img = this.frames[this.currentFrame];
        // Scale target: 85% of canvas height — matches the c7c6244
        // baseline that worked for every scene. A character config
        // can override this with `targetH` (fraction 0..1) when it
        // needs a different body height (e.g. the alley captain
        // whose feet must land on the cobblestone ground line,
        // canvasH * 0.50, but whose body should fill the upper half
        // without cropping the head).
        const W = ctx.canvas.width, H = ctx.canvas.height;
        let targetH = H * 0.85;
        if (this.character && typeof this.character.targetH === 'number') {
            const v = this.character.targetH;
            targetH = (v >= 0 && v <= 2) ? H * v : v;
        }
        let scale = targetH / img.height;
        // Width overflow guard: if the rendered sprite is wider than
        // 95% of the canvas, scale down so it fits with a small margin.
        const maxW = W * 0.95;
        if (img.width * scale > maxW) scale = maxW / img.width;
        const w = img.width * scale;
        const h = img.height * scale;
        const x = this.placementX(W, this.character.position, w);
        const y = this.placementY(H);
        // Anchor at the sprite's feet so feet stay grounded regardless
        // of which frame is active (sprite bodies vary in height).
        const drawX = x - w / 2;
        const drawY = y - h;
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.drawImage(img, drawX, drawY, w, h);
        ctx.restore();
    }
}

window.CharacterSprite = CharacterSprite;