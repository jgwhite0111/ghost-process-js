// src/scenes/_registry.js — scene-class registry. Each scene is a thin
// subclass of window.Scene (in src/runtime/scene-base.js) that
// optionally overrides onReady to do scene-specific setup. All the
// shared logic — bg, sprites, hitboxes, dialogue, music — lives in
// Scene, so most scenes have empty bodies.

window.SCENE_CLASSES = window.SCENE_CLASSES || {};

// Cold open is a pure Ink scene (no sprites). It works without any
// overrides; this entry exists so the Engine can find it by name.
window.SCENE_CLASSES.cold_open = class extends window.Scene {};
window.SCENE_CLASSES.alley = class extends window.Scene {};
window.SCENE_CLASSES.chase = class extends window.Scene {};
window.SCENE_CLASSES.corridor = class extends window.Scene {};
window.SCENE_CLASSES.jailbreak = class extends window.Scene {};
window.SCENE_CLASSES.eidolon_return = class extends window.Scene {};

// Intro is a special case: it has no Ink and no dialogue. The hitbox
// takes you to the cold open. We extend Scene with an onReady that
// just attaches the hitbox action — but since that's all defined in
// the scene config, even intro is an empty class.
window.SCENE_CLASSES.intro = class extends window.Scene {
    onReady() {
        // On first frame we want the inventory button hidden — the
        // intro is a title screen, not a gameplay scene. The button
        // stays dormant until unlockForGameplay() is called by a
        // non-title scene.
    }
};
