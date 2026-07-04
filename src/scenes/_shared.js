// src/scenes/_shared.js — base scene functionality
//
// All story scenes share the same skeleton: load background, mount
// characters, start dialogue, attach hitboxes, play music. The shared
// code lives here so individual scenes just specify scene-id-specific
// quirks (intro has no dialogue, alley has a sprite, etc).

class BaseStoryScene extends Phaser.Scene {
    constructor(key) {
        super(key);
        this.backgroundImage = null;
        this.characters = [];
        this.hitboxes = null;
        this.dialogueRunner = null;
        this.dialogueEl = null;
        this.continueEl = null;
    }

    preload() {
        // Boot has already preloaded everything; nothing to do per-scene.
    }

    create() {
        const sceneConfig = window.STORY.scenes[this.scene.key];

        // Unlock the inventory button now that the first game scene
        // is rendering. The button is owned by the document (sibling
        // of the canvas) so it survives subsequent scene transitions.
        // This is the first opportunity after Boot finishes — calling
        // it earlier (during story.js load) would show the button
        // before the canvas is ready on slow mobile connections.
        if (window.Inventory && typeof window.Inventory.unlockForGameplay === 'function') {
            window.Inventory.unlockForGameplay();
        }

        // Background, scaled to fit. On some mobile WebGL implementations the
        // texture can fail to bind if the source image is huge (scene_intro
        // is 1280x960 = 1.2 megapixels). We defensively log the texture
        // state so a black-background bug doesn't go silent — and we
        // explicitly setOrigin(0.5) so the image is anchored at its center
        // (matches the position we passed; without this some Phaser versions
        // default to top-left which would render the bg off-screen on
        // certain scale modes).
        if (!this.textures.exists(sceneConfig.bg)) {
            console.warn(`[${this.scene.key}] bg texture missing: ${sceneConfig.bg}`);
        }
        this.backgroundImage = this.add.image(
            this.scale.width / 2,
            this.scale.height / 2,
            sceneConfig.bg
        ).setOrigin(0.5);
        this.backgroundImage.setDisplaySize(this.scale.width, this.scale.height);
        // Render the bg first (lowest z-index) so characters sit on top.
        this.backgroundImage.setDepth(-1000);

        // Music.
        if (sceneConfig.music) {
            this._playMusic(sceneConfig.music);
        }

        // Characters.
        for (let i = 0; i < sceneConfig.characters.length; i++) {
            const charConfig = sceneConfig.characters[i];
            const x = this._characterX(charConfig);
            const y = this.scale.height - 100;
            const sprite = new window.CharacterSprite(this, x, y, charConfig, this.scene.key);
            this.characters.push(sprite);
        }

        // Hitboxes: invisible by default; the cursor change is the affordance.
        // HitboxLayer owns hit-testing, and the debug rectangle + label
        // appear transiently when hovering a hitbox (see hitbox.js).
        this.hitboxes = new window.HitboxLayer(this, this.scene.key, sceneConfig, (hb, x, y) => {
            this._handleHitbox(hb, x, y);
        });

        // Cursor affordance: when the mouse hovers a clickable region, swap
        // to an eye cursor (drawn as an SVG data URL) and reveal a
        // transient hitbox label. Empty space falls back to default.
        // The cursor is set at the SCENE level (so it inherits into
        // the canvas), and the label DOM appears transiently via
        // HitboxLayer.setHovered().
        this.input.on('pointermove', (pointer) => {
            const hb = this.hitboxes ? this.hitboxes.hitTest(pointer.x, pointer.y) : null;
            if (hb) {
                this.input.setDefaultCursor(window.EYE_CURSOR);
                this.hitboxes.setHovered(hb);
            } else {
                this.input.setDefaultCursor('default');
                this.hitboxes && this.hitboxes.setHovered(null);
            }
        });

        // Click on the SCENE canvas (NOT the dialogue box — that has its
        // own handler below). Scene clicks always try a hitbox first;
        // during dialogue, that's the only thing they do — they do
        // NOT advance dialogue (the dialogue advance lives on the
        // dialogue-box click handler). This means a player can click
        // a hotspot to interrupt dialogue / pick up an item, but a
        // stray click on empty scene area doesn't advance text.
        this.input.on('pointerdown', (pointer) => {
            const hit = this.hitboxes && this.hitboxes.handleClick(pointer.x, pointer.y);
            // (If we later want "click empty space advances dialogue",
            // that's a separate toggle — for v1 we keep it disabled.)
            if (!hit && !this.dialogueRunner) {
                // No dialogue yet, no hitbox hit — silent no-op.
            }
        });

        // Boot dialogue if scene has Ink.
        if (sceneConfig.ink) {
            this._startDialogue(sceneConfig);
        }
    }

    _characterX(charConfig) {
        const w = this.scale.width;
        switch (charConfig.position) {
            case 'left':   return w * 0.25;
            case 'right':  return w * 0.75;
            case 'center': return w * 0.50;
            case 'closeup': return w * 0.50;
            default:        return w * 0.50;
        }
    }

    // Centralized music player with crossfade. Lives on window so it
    // survives scene transitions (intro scene's _currentMusic gets
    // destroyed when intro shuts down, but we need to fade IT out
    // while fading in the next track).
    _playMusic(filename, fadeMs = 1200) {
        const musicKey = 'music_' + filename;
        // Ensure the sound is in the cache (use Boot's preloaded asset
        // if available; otherwise fetch now).
        const ensureLoaded = (cb) => {
            if (this.cache.audio.exists(musicKey)) return cb();
            this.load.audio(musicKey, `assets/audio/${filename}`);
            this.load.once('complete', cb);
            this.load.start();
        };
        ensureLoaded(() => {
            // Capture the current music BEFORE creating the new one so
            // the fade-out tracks the right handle.
            const oldMusic = window.MUSIC_HANDLER && window.MUSIC_HANDLER.music;
            // Set initial volume via setVolume so it actually sticks.
            // (Constructing with { volume: 0 } is unreliable across
            // browsers — some Phaser versions ignore the initial
            // volume in the config object.)
            const newMusic = this.sound.add(musicKey, { loop: true });
            newMusic.setVolume(0);
            newMusic.play();
            window.MUSIC_HANDLER = {
                music: newMusic,
                filename,
                key: musicKey
            };
            // Manual volume ramp — Phaser's tween plugin doesn't
            // reliably tween Sound.volume property on its own. We
            // drive setVolume() each frame instead.
            const startTime = performance.now();
            const ramp = () => {
                const elapsed = performance.now() - startTime;
                const t = Math.min(1, elapsed / fadeMs);
                newMusic.setVolume(0.7 * t);
                if (t < 1) {
                    requestAnimationFrame(ramp);
                }
            };
            requestAnimationFrame(ramp);
            // Fade out the previous track in parallel.
            if (oldMusic && oldMusic !== newMusic) {
                const fadeStart = performance.now();
                const fadeOld = () => {
                    const elapsed = performance.now() - fadeStart;
                    const t = Math.min(1, elapsed / fadeMs);
                    oldMusic.setVolume((1 - t) * 0.7);
                    if (t < 1) {
                        requestAnimationFrame(fadeOld);
                    } else {
                        oldMusic.stop();
                        oldMusic.destroy && oldMusic.destroy();
                    }
                };
                requestAnimationFrame(fadeOld);
            }
            // Per-scene reference for shutdown() compatibility.
            this._currentMusic = newMusic;
        });
    }

    _startDialogue(sceneConfig) {
        fetch(sceneConfig.ink).then(r => r.text()).then(inkText => {
            this.dialogueRunner = new window.DialogueRunner(
                inkText,
                (line, tags, typed, full) => this._renderLine(line, tags, typed, full),
                (choices) => this._renderChoices(choices),
                (cmd, args) => this._handleCommand(cmd, args),
                () => this._onDialogueComplete()
            );
        });
    }

    _renderLine(line, tags, typed, full) {
        // Strip the "SPEAKER: " prefix from the line itself; tags drive speaker state.
        let speaker = null;
        let text = line;
        const m = line.match(/^([A-Z][A-Z0-9_ ]+):\s*/);
        if (m) {
            speaker = m[1];
            text = line.slice(m[0].length);
        }

        // Update speaker tag state.
        for (const tag of tags || []) {
            const [k, v] = tag.split(':').map(s => s.trim());
            if (k === 'speaker') {
                if (v === 'none') this._setSpeaking(null);
                else this._setSpeaking(v);
            }
        }

        // Render dialogue DOM.
        if (!this.dialogueEl) {
            this.dialogueEl = document.createElement('div');
            this.dialogueEl.className = 'dialogue-box';
            document.body.appendChild(this.dialogueEl);

            this.continueEl = document.createElement('div');
            this.continueEl.className = 'continue-indicator';
            this.continueEl.textContent = '▼';
            document.body.appendChild(this.continueEl);

            // Click on the dialogue box (or the continue indicator)
            // advances the dialogue. The DOM sits ABOVE the canvas so
            // the canvas pointerdown never sees these clicks; the user
            // needs an explicit handler here. While the typewriter is
            // mid-render, advance() snaps it to full text. Otherwise
            // advance() pulls the next line.
            const advanceDialogue = (e) => {
                if (e) e.stopPropagation();
                if (this.dialogueRunner) this.dialogueRunner.advance();
            };
            this.dialogueEl.addEventListener('pointerdown', advanceDialogue);
            this.continueEl.addEventListener('pointerdown', advanceDialogue);
        }

        const typedText = text.slice(0, typed);
        this.dialogueEl.innerHTML =
            (speaker ? `<div class="speaker">${speaker}</div>` : '') +
            `<div class="text">${typedText}</div>`;

        this.continueEl.style.display = typed >= full ? 'block' : 'none';
    }

    _renderChoices(choices) {
        // For v1, choices are Ink `*` lines that the DialogueRunner
        // treats as inline branches. By the time we hit this method,
        // the story has advanced past them via the click handler.
        // (For richer UI, render buttons here.)
    }

    _handleCommand(cmd, args) {
        switch (cmd) {
            case 'portrait': /* TODO: show portrait */ break;
            case 'give':     window.Inventory.add(args[0]); break;
            case 'take':     window.Inventory.remove(args[0]); break;
            case 'goto':     this._transitionToScene(args[0]); break;
            case 'music':    this._playMusic(args[0]); break;
            case 'background': /* TODO: swap background */ break;
            case 'return_to_alley':
                this._transitionToScene('alley');
                break;
            default:
                console.log('Unhandled Ink command:', cmd, args);
        }
    }

    _setSpeaking(charId) {
        for (const sprite of this.characters) {
            sprite.setSpeaking(sprite.character.id === charId);
        }
    }

    _onDialogueComplete() {
        this._transitionToScene(window.STORY.scenes[this.scene.key].goto || 'alley');
    }

    _handleHitbox(hb, pointerX, pointerY) {
        if (hb.target) {
            this._transitionToScene(hb.target);
        } else if (hb.item) {
            this._pickupItem(hb.item, pointerX, pointerY);
        } else if (hb.action === 'jump' && hb.targetNode) {
            this.dialogueRunner && this.dialogueRunner.story &&
                this.dialogueRunner.story.ChoosePathString(hb.targetNode);
        }
    }

    // Spawn the item icon at the click position, tween it up to the
    // inventory bar slot, then add to inventory. Makes pickup feel
    // like the object moves into the player's possession rather than
    // just appearing in the bar.
    _pickupItem(itemId, fromX, fromY) {
        const item = window.STORY.items && window.STORY.items[itemId];
        if (!item) {
            window.Inventory.add(itemId);
            return;
        }
        // Reject if already in inventory (defensive — handleClick already
        // single-uses hitboxes, but the inventory can also be filled
        // via Ink tags).
        if (window.STATE.inventory.indexOf(itemId) !== -1) return;

        // Compute the inventory button's center in canvas coordinates
        // BEFORE adding the item — the button always exists, the popup
        // is what opens later. We tween the pickup sprite toward the
        // button so it visually "pops into" the inventory UI.
        const button = document.getElementById('inventory-button');
        const buttonRect = button ? button.getBoundingClientRect() : null;
        const canvasRect = this.game.canvas.getBoundingClientRect();
        let targetX, targetY;
        if (buttonRect && canvasRect) {
            // Convert DOM coords back to canvas coords (logical space).
            const scaleX = this.scale.width / canvasRect.width;
            const scaleY = this.scale.height / canvasRect.height;
            targetX = (buttonRect.left + buttonRect.width / 2 - canvasRect.left) * scaleX;
            targetY = (buttonRect.top + buttonRect.height / 2 - canvasRect.top) * scaleY;
        } else {
            targetX = 0; targetY = 0;
        }

        // Add the item to inventory AFTER measuring the target — the
        // add() call updates the count text but doesn't reflow the
        // button position, so the target stays valid either way.
        window.Inventory.add(itemId);

        // Show a transient toast announcing the pickup. Independent
        // of the dialogue runner — never pauses, replaces, or
        // interferes with typing dialogue. If no pickup_message is
        // configured, fall back to "You found a {name}."
        if (window.Toast) {
            const msg = item.pickup_message || `You found a ${(item.name || itemId).toLowerCase()}.`;
            window.Toast.show(msg);
        }

        // Use Phaser image loading via the scene's loader.
        const scene = this;
        if (this.textures.exists(itemId)) {
            scene._spawnPickupSprite(itemId, fromX, fromY, targetX, targetY);
        } else {
            this.load.image(itemId, item.icon);
            this.load.once('complete', () => {
                scene._spawnPickupSprite(itemId, fromX, fromY, targetX, targetY);
            });
            this.load.start();
        }
    }

    _spawnPickupSprite(itemId, fromX, fromY, targetX, targetY) {
        // Inventory already has the item (added in _pickupItem). Just
        // animate the visual transition.
        const sprite = this.add.image(fromX, fromY, itemId);
        sprite.setDepth(40);
        sprite.setScale(1.0);
        // Tween: fly to inventory bar, shrink, fade out.
        this.tweens.add({
            targets: sprite,
            x: targetX,
            y: targetY,
            scale: 0.25,
            alpha: 0.0,
            duration: 600,
            ease: 'Cubic.easeIn',
            onComplete: () => sprite.destroy()
        });
    }

    _transitionToScene(sceneId) {
        if (!window.STORY.scenes[sceneId]) {
            console.error(`Cannot transition to unknown scene "${sceneId}"`);
            return;
        }
        if (!window.STATE.visited.includes(sceneId)) {
            window.STATE.visited.push(sceneId);
        }
        window.STATE.sceneId = sceneId;
        // Tear down the current scene manually so hitbox labels, dialogue
        // DOM, sprites, etc. are released even when Phaser's stop() from
        // within a running scene doesn't fire shutdown.
        if (typeof this.shutdown === 'function') this.shutdown();
        const currentKey = this.scene.key;
        if (this.scene.get(currentKey) && this.scene.isActive(currentKey)) {
            this.scene.stop(currentKey);
        }
        this.scene.start(sceneId);
    }

    shutdown() {
        // Music is now managed globally via window.MUSIC_HANDLER so
        // crossfades can span scene boundaries. Do NOT stop _currentMusic
        // here — the new scene's _playMusic will fade out the previous
        // track while fading in its own. Only clear the per-scene
        // reference so this scene doesn't try to interact with the
        // sound during teardown.
        this._currentMusic = null;
        if (this.dialogueEl) {
            this.dialogueEl.remove();
            this.dialogueEl = null;
        }
        if (this.continueEl) {
            this.continueEl.remove();
            this.continueEl = null;
        }
        if (this.hitboxes) {
            this.hitboxes.destroy();
            this.hitboxes = null;
        }
        for (const sprite of this.characters) {
            sprite.destroy();
        }
        this.characters = [];
        // Clean up DOM labels we appended.
        if (this._domLabels) {
            for (const el of this._domLabels) el.remove();
            this._domLabels = null;
        }
    }
}

window.BaseStoryScene = BaseStoryScene;