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
        this.exploration = null;
        this.hitboxLayer = null;
        this.dialogueRunner = null;
        this.music = null;
        this._rafId = null;
        this._lastFrameTime = 0;
        this._onPointerDown = (e) => this._handlePointerDown(e);
        this._active = false;
        this._pickupRedirectTimer = null;

        // Scenes where the character is supposed to already be in
        // place when the scene opens — fade-in is skipped and the
        // matching portrait tag snaps opacity to 1 instantly.
        this._skipFadeInScenes = new Set([
            'jailbreak',  // thug is already in the cell
        ]);

        // Scenes where the character's ambient animation should
        // keep ticking across narration lines (i.e. `# speaker:none`
        // does NOT freeze the sprite). Used for corridor's energy
        // ball effect — the user wants the glow to stay visible
        // continuously, not stop and restart with each line.
        this._ambientAnimateScenes = new Set([
            'corridor',
        ]);

        // Scenes where the talking animation should keep running
        // even after the dialogue hands control back to the player
        // (i.e. when choice buttons appear). Default behaviour is
        // to freeze the speaker so their mouth isn't moving under a
        // static text box. Alley opts OUT of this — the user wants
        // the android to keep talking in the background until the
        // player picks an option and the scene transitions.
        this._keepAnimatingAtChoices = new Set([
            'alley',
        ]);
    }

    async start({ canvas, sceneId }) {
        this.sceneId = sceneId || this.sceneId;
        this.sceneConfig = window.STORY.scenes[this.sceneId];
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        // Resize the canvas to match the current viewport BEFORE we
        // draw anything, so background coverRect and sprite placement
        // use the right dimensions. Title screens get the full
        // viewport; gameplay scenes reserve a strip at the bottom for
        // the dialogue box.
        this._configureCanvasLayout();
        // Background.
        const bgKey = this.sceneConfig.bg;
        if (bgKey) {
            try {
                this.bgImage = await window.Runtime.loadImage(`assets/backgrounds/${bgKey}.png`);
                // PC-98 dither post-process: snap the clean source to
                // a 16-colour scene palette with Bayer 8x8 dithering, so
                // every scene renders the retro look at draw time rather
                // than baking dither into the source PNG. Cached as an
                // offscreen canvas so per-frame blit is just one
                // drawImage call.
                if (this.sceneConfig.bgDither !== false && this.bgImage) {
                    this._ditherBg();
                }
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
            onTrigger: (hb, clientX, clientY) => this._triggerHitbox(hb, clientX, clientY)
        });
        if (this.sceneConfig.kind === 'exploration') {
            const playerId = this.sceneConfig.exploration?.playerId || 'player';
            const playerSprite = this.characters.find((sprite) =>
                sprite.character && sprite.character.id === playerId
            ) || this.characters[0];
            if (playerSprite && window.ExplorationController) {
                this.exploration = new window.ExplorationController({
                    scene: this,
                    sprite: playerSprite,
                    config: this.sceneConfig.exploration,
                });
            }
        }
        // Ink.
        if (this.sceneConfig.ink) {
            await this._startDialogue();
            if (window.DialoguePanel) window.DialoguePanel.show();
        } else {
            if (window.DialoguePanel) window.DialoguePanel.hide();
        }
        // Wire scene-task tracking + dialogue dismiss behaviour.
        // TaskTracker is a singleton; every scene binds fresh on
        // start. If the scene declares `tasks`, the panel's dismiss
        // hook will surface the next-open hint via Toast, otherwise
        // the box just hides on the click.
        if (window.TaskTracker) {
            window.TaskTracker.bind(this.sceneId, this.sceneConfig.tasks || []);
            // If a hint is available right now (no Ink has run, or the
            // tasks are pre-resolved by inventory), fire it once so
            // the player gets oriented.
            const initialHint = window.TaskTracker.nextHint();
            if (initialHint) window.Toast.show(initialHint, { kind: 'info' });
        }
        if (window.DialoguePanel) {
            window.DialoguePanel.setDismissHook(() => {
                this._onDialogueDismissed();
            });
        }
        // Wire pointerdown on canvas (NOT on hitbox — hitbox layer has its own).
        this.canvas.addEventListener('pointerdown', this._onPointerDown);
        // Kick off the render loop.
        this._active = true;
        this._lastFrameTime = performance.now();
        // Expose for debug probing from Playwright / devtools.
        window.__activeScene = this;
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
            onCommand: (cmd) => this._handleCommand(cmd)
        });
        runner._sceneId = this.sceneId;
        // EXTERNAL bindings are set up by the DialogueRunner constructor;
        // their callbacks fire the runner's onCommand hook, which the
        // overrides below route into the scene's _handle* methods
        // (speaker, portrait, give, take, transition_next,
        // return_to_alley) plus the DialoguePanel.
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
                    // Capitalize the first letter so the yellow speaker
                    // label reads "Android" / "Thug", not "android" / "thug".
                    // Narrator (speaker:none) shows no label.
                    const raw = args[0] || '';
                    const display = sp === 'none'
                        ? ''
                        : raw.charAt(0).toUpperCase() + raw.slice(1);
                    window.DialoguePanel.setSpeaker(display);
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
        // When choices appear on screen, the speaker has finished their
        // line and is now waiting for the player to pick. Default scene
        // behaviour: freeze all character animations so a still-mouth
        // character isn't still flapping his jaw under a static text
        // box. The corridor scene overrides this via
        // _ambientAnimateScenes because its energy-ball glow should
        // keep going through narrator-only lines. Alley overrides via
        // _keepAnimatingAtChoices because the user wants the android
        // to keep talking until they pick a choice and the scene
        // transitions.
        if (this._keepAnimatingAtChoices.has(this.sceneId)) return;
        const ambientAnimate = this._ambientAnimateScenes &&
            this._ambientAnimateScenes.has(this.sceneId);
        if (!ambientAnimate) {
            for (const c of this.characters) {
                c.setSpeaking(false);
            }
        }
    }

    // Resize the canvas to match the current viewport, reserving
    // space at the bottom for the dialogue box on gameplay scenes.
    // Title screens (intro) fill the full viewport — there's no
    // dialogue box overlapping the scene, so the background can
    // reach the screen edge. Mobile portrait, landscape desktop,
    // and orientation changes all funnel through here.
    // Layout: the canvas fills the WHOLE viewport. The dialogue box
    // is a DOM overlay sitting on top of the canvas bottom (semi-
    // transparent so the scene shows through behind the text). The
    // user explicitly chose this over the "carve-out" approach where
    // the canvas is height-clipped to leave a clean strip for the
    // dialog box — the carve-out left a black bar wherever the box
    // was taller than the carve-out, and sprites placed at the
    // canvas bottom looked disembodied because their feet sat inside
    // the overlap zone.
    _configureCanvasLayout() {
        if (!this.canvas) return;
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const w = parent.clientWidth || 640;
        const h = parent.clientHeight || 480;
        if (this.canvas.width !== w) this.canvas.width = w;
        if (this.canvas.height !== h) this.canvas.height = h;
        // CSS stretches the canvas to the full viewport so the scene
        // image renders behind the dialogue box. Hitbox layer is
        // already absolute-positioned with the same parent coords.
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        // Notify any listeners (e.g. hitboxes, sprites) that depend
        // on the canvas pixel size.
        window.dispatchEvent(new CustomEvent('game:canvas-resized', {
            detail: { width: w, height: h }
        }));
    }

    _externals(runner) {
        // No-op. The DialogueRunner constructor already binds
        // transition_next/return_to_alley/has, and they call
        // onCommand/onDone hooks that the scene-base.js onCommand
        // router (set up in _startDialogue) handles. Re-binding from
        // here would throw "Function ... has already been bound"
        // inside InkJS.
    }

    _triggerHitbox(hb, pageX, pageY, fromExploration = false) {
        if (this.exploration && !fromExploration) {
            this.exploration.handleHotspot(hb, pageX, pageY);
            return;
        }
        // Notify the task tracker BEFORE the action runs so it can
        // mark use_item / goto_hitbox tasks as completed even if the
        // hitbox itself consumes the click without transitioning
        // (e.g. wrong item on door → no-op but the player's still
        // expected to have "tried").
        if (window.TaskTracker) window.TaskTracker.onHitboxClicked(hb);
        if (hb.item) {
            const label = hb.item.replace(/_/g, ' ');
            window.Inventory.addWithFly(hb.item, pageX, pageY, label, () => {
                // Once the fly finishes (and add() has been called),
                // refresh the hitbox layer so the now-consumed item's
                // label disappears.
                if (this.hitboxLayer && this.hitboxLayer.refresh) this.hitboxLayer.refresh();
                // Tasks may now be satisfied (pickup). If the dialogue
                // box is currently hidden, re-show the next hint so the
                // player sees updated progress.
                this._refreshTaskHint();
            });
            const item = window.STORY.items[hb.item];
            if (item && item.pickup_message) {
                // Slightly delayed so the toast doesn't fight the fly.
                setTimeout(() => window.Toast.show(item.pickup_message), 350);
            }
            // Scenes can hook into pickup-time to advance the story
            // (e.g. the alley uses this to redirect Ink to the
            // android fade-in beat after the key is committed).
            if (this._onItemPicked) this._onItemPicked(hb.item);
            return;
        }
        if (hb.target) {
            this._transition(hb.target);
            return;
        }
        // Hitbox-local Ink knot jump. Kind='exploration' scenes get this
        // via _activateExplorationHotspot above; for kind='ink' scenes
        // (terminal-style multi-view UIs) hitboxes need to advance Ink
        // without a full scene swap. Used by terminal_obelab desktop
        // icons to open their app view, then the app's back choice
        // returns to the desktop knot — same scene, different knot, BG
        // swapped via the # image: tag in _handleCommand.
        if (hb.ink && this.dialogueRunner) {
            try {
                this.dialogueRunner.story.ChoosePathString(hb.ink);
                this.dialogueRunner.step();
                if (window.DialoguePanel) window.DialoguePanel.show();
            } catch (e) {
                console.warn(`[${this.sceneId}] hitbox ink ${hb.ink} failed`, e);
            }
            return;
        }
    }

    _activateExplorationHotspot(hb, pageX, pageY) {
        if (hb.ink && this.dialogueRunner) {
            if (window.TaskTracker) window.TaskTracker.onHitboxClicked(hb);
            try {
                this.dialogueRunner.story.ChoosePathString(hb.ink);
                this.dialogueRunner.step();
                if (window.DialoguePanel) window.DialoguePanel.show();
            } catch (e) {
                console.warn(`[${this.sceneId}] hotspot Ink path ${hb.ink} failed`, e);
            }
            return;
        }
        this._triggerHitbox(hb, pageX, pageY, true);
    }

    // Configure an item-gated Ink scene. A first-time pickup keeps the
    // fly-to-inventory delay before entering the post-pickup knot; scene
    // re-entry with an already held/consumed item enters it immediately.
    _bindPickupRedirect(itemId, inkNode, delayMs = 700) {
        const redirect = () => {
            this._pickupRedirectTimer = null;
            if (!this._active || !this.dialogueRunner) return;
            try {
                this.dialogueRunner.story.ChoosePathString(inkNode);
                this.dialogueRunner.step();
            } catch (e) {
                console.warn(`[${this.sceneId}] redirect to ${inkNode} failed`, e);
            }
        };

        const inventory = window.STATE?.inventory || [];
        const consumed = window.STATE?.consumed || [];
        if (inventory.includes(itemId) || consumed.includes(itemId)) {
            redirect();
            return;
        }

        this._onItemPicked = (pickedItemId) => {
            if (pickedItemId !== itemId || !this.dialogueRunner) return;
            this._pickupRedirectTimer = setTimeout(redirect, delayMs);
        };
    }

    // Called by the dialogue panel after the player clicks the (now-
    // exhausted) dialogue box. Surfaces the next unresolved task hint
    // via Toast. If no tasks are defined, the box just hides silently.
    _onDialogueDismissed() {
        if (!window.TaskTracker) return;
        // Re-show the box when Ink emits new content (e.g. via a
        // # goto redirect from a hitbox trigger). Setting a hook on
        // the runner's onLine + onChoices does this from the other
        // side; this method only fires AFTER dismissal.
        const hint = window.TaskTracker.nextHint();
        if (hint) window.Toast.show(hint, { kind: 'info' });
    }

    // Re-evaluate task completion after a hitbox event and, if the
    // dialogue box is hidden, surface any updated hint.
    _refreshTaskHint() {
        if (!window.TaskTracker) return;
        if (!window.DialoguePanel) return;
        if (window.DialoguePanel.hasMoreDialogue()) return; // box still up — text/choices are the hint
        // If the dialogue is dismissed and we just made progress,
        // push the next hint so the player sees it immediately.
        if (window.TaskTracker.hasOpen()) {
            const hint = window.TaskTracker.nextHint();
            if (hint) window.Toast.show(hint, { kind: 'info' });
        }
    }

    _transition(targetScene) {
        // Mark dialog runner dirty so its pending _step() (if any) gets
        // skipped when the next scene spins up. The scene's `_suppressStep`
        // flag prevents the old runner from claiming a "ran out of
        // content" warning mid-transition.
        if (this.dialogueRunner) this.dialogueRunner._suppressStep = true;
        window.Engine.goTo(targetScene);
    }

    _handlePointerDown(e) {
        if (this.exploration) {
            const point = window.Runtime.pageToCanvasCoords(this.canvas, e.clientX, e.clientY);
            this.exploration.handleCanvasPoint(
                point.x / (window.Runtime.INTERNAL_W || 640),
                point.y / (window.Runtime.INTERNAL_H || 480),
                e.clientX,
                e.clientY,
            );
            return;
        }
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
        // no animation (frame 0 frozen). Speaker names flow as the
        // Ink tag value (case varies in story.json — 'ANDROID' vs
        // 'android' in alley.ink), so we lowercase both sides.
        const sp = (speaker || '').toLowerCase();
        // For scenes that want a continuous ambient animation (e.g.
        // corridor's glowing energy ball), `# speaker:none` lines
        // don't freeze the sprite — the animation keeps ticking
        // through narration. Only a tag naming a DIFFERENT speaker
        // than the sprite would stop it.
        const ambientAnimate = this._ambientAnimateScenes.has(this.sceneId);
        for (const c of this.characters) {
            const charSp = (c.character.speaker || '').toLowerCase();
            // alley: keep the android talking through the entire scene
            // including the Run narration beat that fires right before
            // the scene transition. Without this, `# speaker:none`
            // freezes the mouth anim for the half-second before
            // transition_next() tears the scene down, which reads as
            // a visible freeze-frame on the user's last action.
            if (this._keepAnimatingAtChoices.has(this.sceneId) && sp === 'none') {
                if (!c.isSpeaking) c.setSpeaking(true);
                continue;
            }
            if (ambientAnimate && sp === 'none') {
                // Keep animating.
                if (!c.isSpeaking) c.setSpeaking(true);
                continue;
            }
            c.setSpeaking(charSp === sp);
        }
    }

    _handleGive(itemId) { window.Inventory.add(itemId); }
    _handlePortrait(portrait) {
        // Find the character whose portrait name matches; fade that
        // one in, fade everyone else out. v1 implementation:
        // opacity fade-in/out per Ink # portrait:NAME / # portrait:none.
        //
        // Skip-fade scenes: where the narrative expects the character
        // to already be present when the scene opens (e.g. the
        // jailbreak cell with the thug waiting). For those we snap to
        // opacity=1 instantly on the matching character.
        const skipFade = this._skipFadeInScenes.has(this.sceneId);
        const want = (portrait || '').toLowerCase();
        for (const c of this.characters) {
            const id = (c.character.id || '').toLowerCase();
            if (id === want) {
                c.setVisible(skipFade);
            } else {
                c.setHidden(false);
            }
        }
    }
    _handleCommand(cmd) {
        if (cmd.name === 'goto' && cmd.target) {
            const r = this.dialogueRunner;
            // Before redirecting, suppress next step so the now-empty
            // story doesn't fire "ran out of content" warnings.
            if (r) r._suppressStep = true;
            // Goto fires a goto_dialog task completion (matching
            // `ink_node`) so the task tracker can drop that hint and
            // surface the next one if the box is hidden.
            if (window.TaskTracker) window.TaskTracker.onInkNodeReached(cmd.target);
            // Redirect — Inky InkRunner supports a direct path bind.
            // The simplest cross-runtime way is to set r._currentTags
            // = {} and then step from the new path. InkJS exposes
            // r.ResetPath(...) but requires the source compiler, so we
            // spin up a fresh runner next time this scene opens.
            window.Engine.goTo(cmd.target);
            return;
        }
        // # image:KEY — swap the scene background to assets/backgrounds/KEY.png,
        // re-applying the scene's palette dither so the new BG matches
        // the existing visual treatment. Used by terminal-style scenes
        // where a single scene renders multiple "windows" via BG swap
        // (desktop / log / email / map / sys each as their own PNG, the
        // current knot picks which one to show). Returning to the
        // desktop just sets `# image:scene_..._desktop` again — same
        // image, the runtime dither canvas is cached so the swap is
        // effectively instant.
        if (cmd.name === 'image' && cmd.args && cmd.args[0]) {
            this._swapBackgroundImage(cmd.args[0]);
        }
    }

    async _swapBackgroundImage(bgKey) {
        try {
            const newBg = await window.Runtime.loadImage(
                `assets/backgrounds/${bgKey}.png`);
            this.bgImage = newBg;
            if (this.sceneConfig.bgDither !== false) {
                this._ditherBg();
            }
        } catch (e) {
            console.warn(`Scene ${this.sceneId}: bg swap to ${bgKey} failed:`, e);
        }
    }

    _drawBackground() {
        if (!this.bgImage) return;
        // Letterbox fill colour — match the palette's BG_deep slot so
        // any pillarbox bars on the title screen blend with the
        // dithered plate rather than showing as solid black.
        const palette = window.Runtime.resolvePalette(this.sceneConfig.bgPalette);
        const letterbox = palette && palette[0]
            ? `rgb(${palette[0][0]},${palette[0][1]},${palette[0][2]})`
            : '#000';
        // Title screens and gameplay: cover-fit (zoom to fill canvas,
        // no letterbox) anchored CENTER. The GHOST PROCESS logo is
        // drawn as canvas overlay text by _drawTitleOverlay() AFTER
        // the source, so it's never cropped by cover-fit.
        const rect = window.Runtime.coverRect(
            this.bgImage.width, this.bgImage.height,
            this.canvas.width, this.canvas.height,
            'center');
        if (this._ditheredBg) {
            this.ctx.fillStyle = letterbox;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(this._ditheredBg, rect.x, rect.y, rect.w, rect.h);
            return;
        }
        // Fallback: raw image.
        this.ctx.fillStyle = letterbox;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.bgImage, rect.x, rect.y, rect.w, rect.h);
    }

    // Draw the GHOST PROCESS logo as canvas overlay text in
    // MadouFutoMaru pixel font with a 1px hard drop shadow. Rendered
    // AFTER the background so it floats over the artwork and is never
    // cropped by cover-fit (regardless of source aspect vs viewport
    // aspect). Only fires for `kind: 'title'` scenes.
    //
    // Override via sceneConfig.titleText / titleFont / titleColor /
    // titleShadow.
    _drawTitleOverlay() {
        if (!this.sceneConfig || this.sceneConfig.kind !== 'title') return;
        const text = this.sceneConfig.titleText || 'GHOST PROCESS';
        const fontFamily = this.sceneConfig.titleFont || '"MadouFutoMaru", monospace';
        const color = this.sceneConfig.titleColor || '#ff2030';
        const shadow = this.sceneConfig.titleShadow !== undefined
            ? this.sceneConfig.titleShadow
            : '#000000';
        const fontSizePct = this.sceneConfig.titleSizePct ?? 0.10;
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        // Font sized off the smaller axis so the title stays proportional
        // on both landscape and portrait viewports.
        const fontSize = Math.round(Math.min(W, H) * fontSizePct);
        ctx.save();
        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.imageSmoothingEnabled = false;
        const x = W / 2;
        // Sit the baseline 8% above the bottom edge so the title floats
        // above the PRESS START hitbox (which lives at y=0.55 of the
        // canvas per the intro scene config).
        const y = H - Math.round(H * 0.08);
        // 1px hard drop shadow, drawn first.
        if (shadow) {
            ctx.fillStyle = shadow;
            ctx.fillText(text, x + 1, y + 1);
        }
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // Snap the loaded bgImage into a 16-colour PC-98 dither on an
    // offscreen canvas. Stored as this._ditheredBg and blitted by
    // _drawBackground every frame. Equivalent scene revisits share the
    // immutable processed canvas through Runtime's source/parameter cache.
    //
    // The offscreen is sized at the SOURCE image's resolution (not the
    // canvas). The canvas-side aspect fit (cover for gameplay, contain
    // for title) happens in _drawBackground at draw time. This means
    // we don't re-dither on every canvas resize — only on first load.
    _ditherBg() {
        const palette = window.Runtime.resolvePalette(this.sceneConfig.bgPalette);
        const width = this.bgImage.width;
        const height = this.bgImage.height;
        const bgColor = palette[0] || [0, 0, 0];
        const ditherStrength = this.sceneConfig.bgDitherStrength ?? 1.0;
        const anchor = this.sceneConfig.bgAnchor || 'center';
        try {
            this._ditheredBg = window.Runtime.getProcessedCanvas(this.bgImage, {
                operation: 'background-dither',
                version: 1,
                width,
                height,
                parameters: { palette, bgColor, ditherStrength, anchor },
            }, () => {
                const off = document.createElement('canvas');
                off.width = width;
                off.height = height;
                window.Runtime.ditherImageToCanvas(this.bgImage, off, palette, {
                    // Letterbox fill comes from the palette's BG_deep slot so
                    // any pillarbox bars match the dithered plate rather than
                    // showing as solid black.
                    bgColor,
                    ditherStrength,
                    anchor,
                });
                return off;
            });
        } catch (e) {
            console.warn(`Scene ${this.sceneId}: bg dither failed:`, e);
            // Fall back to the raw image — _drawBackground will pick it up.
            this._ditheredBg = null;
        }
    }

    _tick(now) {
        if (!this._active) return;
        const delta = Math.min(100, now - this._lastFrameTime);
        this._lastFrameTime = now;
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this._drawBackground();
        // GHOST PROCESS logo (canvas overlay — never cropped by cover-fit).
        this._drawTitleOverlay();
        const deltaSec = delta / 1000;
        if (this.exploration) this.exploration.update(delta);
        const drawCharacters = this.exploration
            ? [...this.characters].sort((a, b) =>
                (a.character?.placementY || 0) - (b.character?.placementY || 0)
            )
            : this.characters;
        for (const c of drawCharacters) {
            c.update(delta);
            c._tickOpacity(deltaSec);
            if (c.opacity > 0) c.draw(this.ctx);
        }
        this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    shutdown() {
        this._active = false;
        if (this._pickupRedirectTimer !== null) {
            clearTimeout(this._pickupRedirectTimer);
            this._pickupRedirectTimer = null;
        }
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this.hitboxLayer) this.hitboxLayer.destroy();
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        // Tell the dialogue runner to stop producing line events.
        if (this.dialogueRunner) this.dialogueRunner.stop();
        // CharacterSprite objects are per-start state. Scene instances are
        // cached by the engine, so release them here instead of appending a
        // duplicate set the next time this scene starts.
        this.characters = [];
        this.exploration = null;
    }
}

window.Scene = Scene;
