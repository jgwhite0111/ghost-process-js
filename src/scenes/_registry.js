// src/scenes/_registry.js — scene-class registry. Each scene is a thin
// subclass of window.Scene (in src/runtime/scene-base.js) that
// optionally overrides onReady to do scene-specific setup. All the
// shared logic — bg, sprites, hitboxes, dialogue, music — lives in
// Scene, so most scenes have empty bodies.

window.SCENE_CLASSES = window.SCENE_CLASSES || {};

// Cold open is a pure Ink scene (no sprites). It works without any
// overrides; this entry exists so the Engine can find it by name.
window.SCENE_CLASSES.cold_open = class extends window.Scene {};
window.SCENE_CLASSES.alley = class extends window.Scene {
    onReady() {
        // The android is invisible until the player finds the rusty
        // key. After the fly-to-INV animation runs, redirect the Ink
        // runner from the "waiting" Start knot into FoundKey, where
        // the android fade-in + dialogue beat lives.
        this._onItemPicked = (itemId) => {
            if (itemId !== 'rusty_key') return;
            if (!this.dialogueRunner) return;
            // 700ms is the addWithFly duration; redirect Ink right
            // after the icon lands.
            setTimeout(() => {
                try {
                    this.dialogueRunner.story.ChoosePathString('FoundKey');
                    this.dialogueRunner.step();
                } catch (e) {
                    console.warn('[alley] redirect to FoundKey failed', e);
                }
            }, 700);
        };
    }
};
window.SCENE_CLASSES.chase = class extends window.Scene {};
// Kabukicho mirror of the alley pickup flow: the vendor hitbox flies
// a datacard into the inventory, then redirects Ink from the
// "waiting" Start knot into ContactMade, where the android fades in
// and the ContactMade branch fires.
window.SCENE_CLASSES.kabukicho = class extends window.Scene {
    onReady() {
        this._onItemPicked = (itemId) => {
            if (itemId !== 'datacard') return;
            if (!this.dialogueRunner) return;
            setTimeout(() => {
                try {
                    this.dialogueRunner.story.ChoosePathString('ContactMade');
                    this.dialogueRunner.step();
                } catch (e) {
                    console.warn('[kabukicho] redirect to ContactMade failed', e);
                }
            }, 700);
        };
    }
};
// Corp office extends chase — its hitbox (if any) advances Ink via
// transition_next like alley does. Empty subclass for now.
// window.SCENE_CLASSES.corp_office = class extends window.Scene {};
window.SCENE_CLASSES.corridor = class extends window.Scene {};
window.SCENE_CLASSES.jailbreak = class extends window.Scene {};
window.SCENE_CLASSES.terminal_lab = class extends window.Scene {};
window.SCENE_CLASSES.ship_engine = class extends window.Scene {};
window.SCENE_CLASSES.eidolon_return = class extends window.Scene {};

// Intro is a special case: it has no Ink and no dialogue. The hitbox
// takes you straight to alley. We extend Scene to (a) hide the inventory
// button on the title screen and (b) give the salientdream intro theme
// time to play before navigating away.
window.SCENE_CLASSES.intro = class extends window.Scene {
    onReady() {
        // Title screen — no inventory button until gameplay starts.
        if (window.Inventory && window.Inventory.setVisible) {
            window.Inventory.setVisible(false);
        }

        // Try to start the intro theme at page-load. Most browsers
        // will block this because there's no user gesture yet — the
        // play() promise rejects and MusicHandler queues a one-shot
        // resume-on-pointerdown listener that fires the moment the
        // player clicks anywhere on the page. Either path lands
        // music playing in 1 gesture, instead of "click PRESS START,
        // then wait 1.4s for navigation".
        try { window.MusicHandler.play('intro_theme.mp3', 0.7, 800); }
        catch (e) { /* will be retried on first gesture */ }

        // Override _triggerHitbox so the PRESS START click gives the
        // intro theme time to actually play before navigation kicks
        // off the next scene's track and crossfades the title theme
        // out.
        //
        // Old behaviour (broken): clicked PRESS START → music
        // resumed → setTimeout 1.4s → navigate. Player heard at most
        // ~2.5s of the salientdream intro theme before it was
        // crossfaded away.
        //
        // New behaviour: the music is playing (or queued to resume
        // on this very click) when PRESS START is hit. On click, hide
        // PRESS START and start a 5-second timer to navigate. This
        // gives the intro theme 5 full seconds of clean un-interrupted
        // playback before the crossfade into the alley music begins.
        // Attentive listeners hear the theme; impatient players feel
        // the 5s delay is too long and can hit the music handler's
        // fast-skip via console (not exposed in the UI yet).
        const origTrigger = this._triggerHitbox.bind(this);
        const music = window.MusicHandler;
        let navigated = false;
        // Capture the actual PRESS START hitbox on first invocation
        // so we can re-trigger navigation later with the right
        // target. The intro scene only has one hitbox (PRESS START
        // → target: "alley") so capturing it once is enough.
        let pressStartHb = null;
        const navigateAfterDelay = () => {
            if (navigated) return;
            navigated = true;
            setTimeout(() => {
                if (window.__activeScene?.sceneId === 'intro' && pressStartHb) {
                    origTrigger(pressStartHb, 0, 0);
                }
            }, 5000);
        };
        this._triggerHitbox = (hb, pageX, pageY) => {
            pressStartHb = hb || pressStartHb;
            // Resume the intro theme at full volume immediately. This
            // is the user gesture that unlocks audio if the boot-time
            // play() was blocked, and it falls through to a no-op if
            // music is already playing.
            const introAudio = music._pendingResume || music.music;
            if (introAudio && introAudio.paused) {
                try { introAudio.play().catch(() => {}); } catch (e) {}
            }
            if (introAudio) introAudio.volume = 0.7;
            // Hide PRESS START so it can't be re-pressed.
            const ov = this.hitboxLayer?.overlay;
            if (ov) ov.style.display = 'none';
            // Schedule navigation after the title-tune listen window.
            navigateAfterDelay();
        };
    }
};