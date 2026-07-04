// src/runtime/sprites.js — character sprites drawn on the scene canvas.
//
// Each CharacterSprite owns a set of preloaded Image elements and a
// timer that ticks on the scene's render loop. When `setSpeaking(true)`
// is called, the timer starts swapping between frames at the
// configured FPS; when set to false the sprite freezes on frame 0
// (the rest pose). Drawing is delegated to the scene's render() pass,
// not here — this class is pure state.

class CharacterSprite {
    constructor(characterConfig, sceneId) {
        this.character = characterConfig;
        this.sceneId = sceneId;
        this.frames = [];     // HTMLImageElement[]
        this.frameRate = 4;
        this.loop = true;
        this.isSpeaking = false;
        this.currentFrame = 0;
        this.elapsed = 0;     // ms since last frame advance

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
    bindFrames(urls) {
        const Rt = window.Runtime;
        for (const url of urls) {
            const img = Rt.assets.images[url];
            if (img) this.frames.push(img);
        }
    }

    // Logical placement on the canvas. position: left/right/center/closeup.
    // Feet anchor ~30px above the canvas bottom so the sprite sits on
    // the implied ground line without touching the edge. The 30px gap
    // also leaves room for the dialogue box when it slides up. The
    // sprite is rendered with drawY = (this y) - h, so its bottom edge
    // lands here — anchoring feet on the visible "floor".
    placementY(canvasH) {
        return canvasH - 30;
    }

    placementX(canvasW, position, spriteW) {
        // For most positions we centre on a fixed slot (25%, 50%, 75%
        // of canvas width). For 'bottomright' we right-align the
        // sprite against the canvas edge with a small inset — useful
        // when a sprite's source image has its character drawn
        // flush to the right edge (e.g. the thug in jailbreak whose
        // body silhouette runs all the way to x=180 of the 180px-wide
        // source). Centring that sprite at 75% still leaves a tight
        // ~45px margin to the canvas edge; aligning its right edge
        // to canvasW-20 makes the bottom-right anchor explicit and
        // gives the character a small visible inset.
        if (position === 'bottomright' && spriteW) {
            return canvasW - 20 - spriteW / 2;
        }
        switch (position) {
            case 'left':     return canvasW * 0.25;
            case 'right':    return canvasW * 0.75;
            case 'bottomright': return canvasW - 20;   // without spriteW
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

    draw(ctx) {
        if (this.frames.length === 0) return;
        const img = this.frames[this.currentFrame];
        // Scale to ~85% of canvas height, like the Phaser version.
        const targetH = ctx.canvas.height * 0.85;
        const scale = targetH / img.height;
        const w = img.width * scale;
        const h = img.height * scale;
        // Pass w so 'bottomright' can right-align against the canvas edge.
        const x = this.placementX(ctx.canvas.width, this.character.position, w);
        const y = this.placementY(ctx.canvas.height);
        // Anchor at the sprite's feet so feet stay grounded regardless
        // of which frame is active (the sprite bodies vary in height).
        const drawX = x - w / 2;
        const drawY = y - h;
        ctx.drawImage(img, drawX, drawY, w, h);
    }
}

window.CharacterSprite = CharacterSprite;
