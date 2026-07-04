// src/runtime/scene-base.js — base scene class.
//
// A scene owns:
//   - a background image (drawn full-canvas)
//   - one or more character sprites (drawn on top, animated while speaking)
//   - optional hitboxes (clickable regions that trigger scene transitions)
//   - a dialogue runner (driven by Ink, provides speaker + line events)
//   - a music track (crossfaded via the music handler)
//
// The scene's render loop ticks via requestAnimationFrame. Each frame:
//   1. clear backbuffer to black
//   2. draw background (cover-fit)
//   3. update + draw each character sprite
//   4. update dialogue UI (text, choices) via dialogueRunner
//
// Pointer events on the canvas: hitbox layer handles them BEFORE the
// dialogue advance handler fires. If a hitbox triggers a transition,
// the scene stops itself and the engine advances to the next scene.
//
// "Transition" is intentional and explicit: when transition_next() is
// called from Ink (via the EXTERNAL binding DialogueRunner exposes),
// the engine looks up `STORY.next[currentSceneId]` and starts that
// scene. No scene-stacking, no scene.stop()/start() juggling.

class Scene {
    constructor(sceneId) {
        this.sceneId = sceneId;
        this.sceneConfig = window.STORY.scenes[sceneId];
        this.canvas = null;
        this.ctx = null;
        this.bgImage = null;
        this.characters = [];      // CharacterSprite[]
        this.hitboxLayer = null;
        this.dialogueRunner = null;
        this.music = null;
        this._rafId = null;
        this._lastFrameTime = 0;
        this._onPointerDown = (e) => this._handlePointerDown(e);
        this._active = false;
    }

    async start({ canvas, sceneId }) {
        this.sceneId = sceneId || this.sceneId;
        this.sceneConfig = window.STORY.scenes[this.sceneId];
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        // Background.
        const bgKey = this.sceneConfig.bg;
        if (bgKey) {
            try {
                this.bgImage = await window.Runtime.loadImage(`assets/backgrounds/${bgKey}.png`);
            } catch (e) {
                console.warn(`Scene ${this.sceneId}: bg load failed:`, e);
            }
        }
        // Music.
        if (this.sceneConfig.music) {
            try { await window.MusicHandler.play(this.sceneConfig.music); }
            catch (e) { console.warn(`Scene ${this.sceneId}: music load failed:`, e); }
        }
        // Characters.
        for (const charCfg of this.sceneConfig.characters || []) {
            const sprite = new window.CharacterSprite(charCfg, this.sceneId);
            // Preload the 16 frame images.
            const cfg = (charCfg.scenes || {})[this.sceneId] || {};
            const framesGlob = cfg.frames || '';
            const m = framesGlob.match(/^(.+\/)([^/]+)_\*\.png$/);
            if (m) {
                const dir = m[1], prefix = m[2];
                const urls = [];
                for (let i = 1; i <= 16; i++) {
                    const num = String(i).padStart(2, '0');
                    urls.push(`${dir}${prefix}_${num}.png`);
                }
                await Promise.all(urls.map((u) => window.Runtime.loadImage(u).catch(() => null)));
                sprite.bindFrames(urls);
            }
            this.characters.push(sprite);
        }
        // Hitboxes.
        this.hitboxLayer = new window.HitboxLayer({
            canvas: this.canvas,
            sceneId: this.sceneId,
            sceneConfig: this.sceneConfig,
            onTrigger: (hb) => this._triggerHitbox(hb)
        });
        // Ink.
        if (this.sceneConfig.ink) {
            await this._startDialogue();
            if (window.DialoguePanel) window.DialoguePanel.show();
        } else {
            if (window.DialoguePanel) window.DialoguePanel.hide();
        }
        // Wire pointerdown on canvas (NOT on hitbox — hitbox layer has its own).
        this.canvas.addEventListener('pointerdown', this._onPointerDown);
        // Kick off the render loop.
        this._active = true;
        this._lastFrameTime = performance.now();
        this._rafId = requestAnimationFrame((t) => this._tick(t));
        // Scene-specific hook.
        if (typeof this.onReady === 'function') this.onReady();
        // First-time inventory unlock: only when we hit a real game scene
        // (intro doesn't unlock — its hitbox is the title button). The
        // first time a non-title scene creates, flip the inventory flag.
        if (this.sceneConfig.kind !== 'title' && !window.__inventoryUnlocked) {
            window.Inventory.unlockForGameplay();
            window.__inventoryUnlocked = true;
        }
    }

    async _startDialogue() {
        // Cold open is a pure text scene — no speaker tracking, no
        // character sprites. Most scenes use Ink-driven dialogue,
        // which is loaded once and stepped per pointerdown.
        if (!this.sceneConfig.ink) return;
        const inkSource = await (await fetch(this.sceneConfig.ink)).text();
        try {
        const runner = new window.DialogueRunner(inkSource, {
            onLine: (text) => this._handleDialogueLine(text),
            onSpeaker: (sp) => this._handleSpeaker(sp),
            onAction: (act) => this._handleAction(act),
            onGive: (itemId) => this._handleGive(itemId),
            onPortrait: (portrait) => this._handlePortrait(portrait),
            onTags: (tags) => this._handleTags(tags),
            onCommand: (cmd) => this._handleCommand(cmd)
        });
        runner._sceneId = this.sceneId;
        // EXTERNAL bindings are set up by the DialogueRunner constructor;
        // their callbacks fire onCommand hooks that this scene's
        // onCommand router (below) turns into Engine.goTo() calls.
        // Panel handles text/speaker/choices; scene handles sprite
        // visibility/portrait/speaker-action via its own onXxx hooks.
        runner.onLine = (text, tags, typed, total) => {
            // Scene hook (custom per-scene behaviour).
            this._handleDialogueLine(text);
            // DOM panel renders the typewritter effect.
            if (window.DialoguePanel) {
                window.DialoguePanel.setText(typed === total ? text : text.slice(0, typed));
                window.DialoguePanel.setHasMore(typed === total);
            }
        };
        runner.onChoices = (choices) => {
            this._handleChoices(choices);
            if (window.DialoguePanel) window.DialoguePanel.setChoices(choices, runner);
        };
        // Ink tags. Several are handled by the scene directly (portrait,
        // speaker toggle, give); the panel handles the speaker label.
        runner.onCommand = (key, args) => {
            if (key === 'speaker') {
                const sp = (args[0] || '').toLowerCase();
                if (window.DialoguePanel) {
                    window.DialoguePanel.setSpeaker(sp === 'none' ? '' : (args[0] || ''));
                }
                this._handleSpeaker(sp);
                return;
            }
            if (key === 'portrait') {
                this._handlePortrait(args[0] || '');
                return;
            }
            if (key === 'give') {
                this._handleGive(args[0]);
                return;
            }
            if (key === 'take') {
                window.STATE.consumed = window.STATE.consumed || [];
                window.STATE.consumed.push(args[0]);
                window.Inventory.remove(args[0]);
                return;
            }
            if (key === 'transition_next') {
                const next = args[0];
                if (next && window.Engine) window.Engine.goTo(next);
                return;
            }
            if (key === 'return_to_alley') {
                if (window.Engine) window.Engine.goTo('alley');
                return;
            }
            // Pass-through: scene custom override.
            this._handleCommand({ name: key, args });
        };
        runner.start();
        if (window.DialoguePanel) window.DialoguePanel.attachRunner(runner);
        // Stash for late use (e.g. line-number tracking).
        runner._sceneRef = this;
        this.dialogueRunner = runner;
        } catch (err) {
            console.error('[scene-base] DialogueRunner failed:', err);
        }
    }

    _handleChoices(choices) {
        // Default scene behaviour: choices are handled by the panel. This
        // hook lets a scene override or extend (e.g. analytics).
    }

    _externals(runner) {
        // No-op. The DialogueRunner constructor already binds
        // transition_next/return_to_alley/has, and they call
        // onCommand/onDone hooks that the scene-base.js onCommand
        // router (set up in _startDialogue) handles. Re-binding from
        // here would throw "Function ... has already been bound"
        // inside InkJS.
    }

    _triggerHitbox(hb) {
        // The scene's own logic can override _handleHitbox to dispatch
        // non-transition hitboxes (item pickups, inventory checks).
        if (hb.item) {
            window.Inventory.add(hb.item);
            const item = window.STORY.items[hb.item];
            if (item && item.pickup_message) window.Toast.show(item.pickup_message);
            return;
        }
        if (hb.target) {
            this._transition(hb.target);
        }
    }

    _transition(targetScene) {
        // Mark dialog runner dirty so its pending _step() (if any) gets
        // skipped when the next scene spins up. This mirrors the
        // _suppressStep pattern that the Phaser version needed.
        if (this.dialogueRunner) this.dialogueRunner._suppressStep = true;
        window.Engine.goTo(targetScene);
    }

    _handlePointerDown(e) {
        // Hitbox layer handled its own pointerdown before this fires
        // (it stops propagation on success). If we get here, we're
        // either in empty space OR there's a hitbox that has no action
        // to perform. In either case: advance dialogue / dismiss.
        if (this.dialogueRunner) {
            this.dialogueRunner.step();
            // After stepping, if there's now text, render it; if there
            // are choices, the dialogue runner already rendered them.
            this._renderDialogueState();
        }
    }

    _renderDialogueState() {
        const runner = this.dialogueRunner;
        if (!runner || !runner.currentLine) return;
        // Visible on top of scene canvas; the .dialogue-box DOM
        // element is owned by DialogueRunner / DialoguePanel.
    }

    _handleDialogueLine(text) {
        // DialogueRunner owns its DOM; this is just a hook for scenes
        // that want to do per-line work (none in v1).
    }

    _handleSpeaker(speaker) {
        // Switch sprites on/off based on speaker. NONE / empty =
        // no animation (frame 0 frozen).
        for (const c of this.characters) c.setSpeaking(c.character.speaker === speaker);
    }

    _handleAction(action) { /* no-op in v1 */ }
    _handleGive(itemId) { window.Inventory.add(itemId); }
    _handlePortrait(portrait) {
        // Find the character whose portrait name matches, set visible.
        // v1 implementation: toggle sprite opacity.
        for (const c of this.characters) {
            c._visible = (portrait === c.character.id);
        }
    }
    _handleTags(tags) { /* no-op in v1 */ }
    _handleCommand(cmd) {
        if (cmd.name === 'goto' && cmd.target) {
            const r = this.dialogueRunner;
            // Before redirecting, suppress next step so the now-empty
            // story doesn't fire "ran out of content" warnings.
            if (r) r._suppressStep = true;
            // Redirect — Inky InkRunner supports a direct path bind.
            // The simplest cross-runtime way is to set r._currentTags
            // = {} and then step from the new path. InkJS exposes
            // r.ResetPath(...) but requires the source compiler, so we
            // spin up a fresh runner next time this scene opens.
            window.Engine.goTo(cmd.target);
        }
    }

    _drawBackground() {
        if (!this.bgImage) return;
        const rect = window.Runtime.coverRect(
            this.bgImage.width, this.bgImage.height,
            this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.bgImage, rect.x, rect.y, rect.w, rect.h);
    }

    _tick(now) {
        if (!this._active) return;
        const delta = Math.min(100, now - this._lastFrameTime);
        this._lastFrameTime = now;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this._drawBackground();
        for (const c of this.characters) {
            c.update(delta);
            if (c._visible !== false) c.draw(this.ctx);
        }
        this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    shutdown() {
        this._active = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this.hitboxLayer) this.hitboxLayer.destroy();
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        // Tell the dialogue runner to stop producing line events.
        if (this.dialogueRunner) this.dialogueRunner.stop();
        // Characters fade out by virtue of canvas being clear next frame.
    }
}

window.Scene = Scene;
