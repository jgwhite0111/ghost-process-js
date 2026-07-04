// src/sprites.js — character sprite renderer with frame-based animation
//
// Schema (from story.json):
//   character.scenes[<sceneId>] = {
//     frames: "assets/sprites/<id>/<scene>/idle_*.png",  // glob; Phaser loads each
//     fps: 4,                                             // playback rate
//     loop: true                                          // loop the animation
//   }
//
// Phaser animation system:
//   - Each *.png frame is loaded as a separate texture
//   - We build a Phaser.Animation from the frames
//   - On speaker change, the sprite plays/stops the animation
//   - When silent, it freezes on the first frame

class CharacterSprite {
    constructor(scene, x, y, characterConfig, sceneId) {
        this.scene = scene;
        this.character = characterConfig;
        this.sceneId = sceneId;
        this.sprite = null;
        this.animKey = null;
        this.isSpeaking = false;

        const spriteCfg = this._resolveSpriteCfg();
        if (!spriteCfg || !spriteCfg.frames) {
            console.warn(`No sprite config for ${characterConfig.id} in ${sceneId}`);
            return;
        }

        // Load frames. Phaser exposes a `load.spritesheet` and `load.image`
        // but for a glob of individual PNGs we just iterate.
        this.frameKeys = [];
        // Caller (BaseStoryScene) is expected to have pre-loaded the frames
        // and stored them in scene.textures. We pull keys by enumerating.
        // Glob pattern is resolved by listing files at scene boot — see
        // BaseStoryScene.preload().
        for (const key of this._expectedFrameKeys()) {
            if (scene.textures.exists(key)) {
                this.frameKeys.push({ key, frame: undefined });
            }
        }

        if (this.frameKeys.length === 0) {
            console.warn(`No frames loaded for ${characterConfig.id} in ${sceneId}`);
            return;
        }

        // Create the sprite from the first frame.
        // Use scene.add.sprite (not add.image) — Sprite has the .play()
        // method we need for animation. Image would not.
        const firstKey = this.frameKeys[0].key;
        this.sprite = scene.add.sprite(x, y, firstKey);

        // Scale sprite so it fits naturally in a 640x480 scene.
        // The android sprite is 240x426 (source) — already proportioned for 4:3.
        // Cap height at ~85% of scene to leave room for dialogue box.
        const targetHeight = scene.scale.height * 0.85;
        const scale = targetHeight / this.sprite.height;
        this.sprite.setScale(scale);

        // Build the Phaser animation from the loaded frames.
        const animKey = `${characterConfig.id}_${sceneId}_anim`;
        this.animKey = animKey;
        if (!scene.anims.exists(animKey)) {
            const frames = this.frameKeys.map(fk => ({ key: fk.key }));
            scene.anims.create({
                key: animKey,
                frames,
                frameRate: spriteCfg.fps || 4,
                repeat: spriteCfg.loop === false ? 0 : -1
            });
        }
    }

    _resolveSpriteCfg() {
        const sc = this.character.scenes || {};
        return sc[this.sceneId] || sc.default || null;
    }

    _expectedFrameKeys() {
        // We need to know the file names ahead of time. The convention is
        // <glob base> with 2-digit numbering, 01..N. We rely on
        // BaseStoryScene preloading the frames with predictable keys.
        const spriteCfg = this._resolveSpriteCfg();
        const framesDir = spriteCfg.frames;
        // The actual frame key naming convention (set by BaseStoryScene):
        //   <characterId>_<sceneId>_frame_NN
        const keys = [];
        for (let i = 1; i <= 16; i++) {
            keys.push(`${this.character.id}_${this.sceneId}_frame_${String(i).padStart(2, '0')}`);
        }
        return keys;
    }

    setSpeaking(isSpeaking) {
        if (!this.sprite || !this.scene.anims.exists(this.animKey)) return;
        if (this.isSpeaking === isSpeaking) return;
        this.isSpeaking = isSpeaking;

        if (isSpeaking) {
            // Play the animation (loops naturally).
            this.sprite.play(this.animKey);
        } else {
            // Stop and freeze on first frame (idle pose).
            this.sprite.stop();
            this.sprite.setTexture(this.frameKeys[0].key);
        }
    }

    destroy() {
        if (this.sprite) this.sprite.destroy();
    }
}

window.CharacterSprite = CharacterSprite;