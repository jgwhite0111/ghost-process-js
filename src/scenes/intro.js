// src/scenes/intro.js — title screen. "Press Start" hitbox transitions to first scene.

window.IntroScene = class IntroScene extends window.BaseStoryScene {
    constructor() {
        super('intro');
    }
};

// (Behavior is identical to base — `intro` is just a scene whose
//  hitbox uses `target` to transition to `alley`. No special logic.)