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
        // key. First pickup waits for the fly-to-INV animation; re-entry
        // with the key already held/consumed goes straight to FoundKey.
        this._bindPickupRedirect('rusty_key', 'FoundKey');
    }
};
window.SCENE_CLASSES.chase = class extends window.Scene {};
// Kabukicho mirror of the alley pickup flow: the vendor hitbox flies
// a datacard into the inventory, then redirects Ink from the
// "waiting" Start knot into ContactMade, where the android fades in
// and the ContactMade branch fires.
window.SCENE_CLASSES.kabukicho = class extends window.Scene {
    onReady() {
        this._bindPickupRedirect('datacard', 'ContactMade');
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

        // NOTE: we do NOT call MusicHandler.play() here. Scene.start()
        // (the base class) already kicked off the intro theme on
        // scene load (scene-base.js:99-102), which is what triggers
        // the page-load autoplay attempt. Calling it again from
        // onReady would duplicate the play() and, in browsers where
        // autoplay is permitted, stomp audio.volume to 0 mid-ramp
        // (MusicHandler._playOne unconditionally sets volume=0 at
        // music.js:233 before the second ramp). Instead, onReady
        // just overrides _triggerHitbox below — the autoplay-or-
        // resume-on-first-click path is already wired by the base
        // class plus MusicHandler._queueResume.

        // Override _triggerHitbox so the PRESS START click gives the
        // intro theme time to actually play before navigation kicks
        // off the next scene's track and crossfades the title theme
        // out.
        //
        // Page-load autoplay: by the time this scene's onReady fires,
        // Scene.start() has already attempted audio.play() on the
        // intro theme. If the browser allowed autoplay, music is
        // playing now (5s listen clock starts on PRESS START click).
        // If the browser blocked it, MusicHandler._queueResume has
        // registered a one-shot document-level pointerdown listener
        // (music.js:281-283) that resumes the audio on the first
        // click anywhere — so even a click on the title-screen
        // background or the PRESS START label itself unlocks it.
        //
        // On PRESS START click: leave playback initiation to the base scene's
        // load-time attempt / MusicHandler's first-gesture fallback, set the
        // intended volume, hide the control, and start a 5s timer to navigate.
        // This gives the intro theme 5 full seconds of clean
        // un-interrupted playback before the crossfade into the
        // alley music begins.
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
            // Do not call play() here. Scene.start() already attempted it on
            // title load, and MusicHandler owns the standards-compliant
            // capture-phase first-gesture retry when autoplay is blocked.
            const introAudio = music._pendingResume || music.music;
            if (introAudio) introAudio.volume = 0.7;
            // Hide PRESS START so it can't be re-pressed.
            const ov = this.hitboxLayer?.overlay;
            if (ov) ov.style.display = 'none';
            // Schedule navigation after the title-tune listen window.
            navigateAfterDelay();
        };
    }
};