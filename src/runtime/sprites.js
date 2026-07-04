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
    placementY(canvasH) {
        return canvasH - 100;
    }

    placementX(canvasW, position) {
        switch (position) {
            case 'left':   return canvasW * 0.25;
            case 'right':  return canvasW * 0.75;
            case 'center': return canvasW * 0.50;
            case 'closeup':return canvasW * 0.50;
            default:       return canvasW * 0.50;
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
        const x = this.placementX(ctx.canvas.width, this.character.position);
        const y = this.placementY(ctx.canvas.height);
        // Scale to ~85% of canvas height, like the Phaser version.
        const targetH = ctx.canvas.height * 0.85;
        const scale = targetH / img.height;
        const w = img.width * scale;
        const h = img.height * scale;
        // Anchor at the sprite's feet so feet stay grounded regardless
        // of which frame is active (the sprite bodies vary in height).
        const drawX = x - w / 2;
        const drawY = y - h;
        ctx.drawImage(img, drawX, drawY, w, h);
    }
}

window.CharacterSprite = CharacterSprite;
