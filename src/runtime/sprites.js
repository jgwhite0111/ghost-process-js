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
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 240) continue; // only solid pixels
            const r = px[i], g = px[i + 1], b = px[i + 2];
            if (g > r * 1.15 && g > b * 1.15 && g < 210) {
                // Desaturate: pull G toward the average of R and B.
                // 70% blend toward (r+b)/2 keeps some structure but
                // removes the green cast.
                const mid = (r + b) / 2;
                px[i + 1] = Math.round(g * 0.3 + mid * 0.7);
            }
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
            const v = this.character.placementY;
            // placementY is a fraction (0..1) of canvasH.
            if (v >= 0 && v <= 1) return canvasH * v;
            return v; // raw pixel value
        }
        return canvasH - 30;
    }

    placementX(canvasW, position, spriteW) {
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