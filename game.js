// game.js — Phaser boot + scene registration
//
// Waits for story.json to load (via src/story.js), then starts Phaser
// with a config that fits a 4:3 PC-98 aspect ratio inside the window.

(function () {
    'use strict';

    // Eye cursor as a data URL — used by every scene's HitboxLayer
    // hover affordance. Drawn as a stroked SVG so it scales to any
    // cursor size and doesn't require an external asset file. Hot
    // spot (0, 0) is the top-left so the eye "looks at" the cursor
    // position. 32x32 px on screen.
    const EYE_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
        '<path d="M2 16 Q16 4 30 16 Q16 28 2 16 Z" fill="white" stroke="black" stroke-width="1.5"/>' +
        '<circle cx="16" cy="16" r="5" fill="black"/>' +
        '<circle cx="17" cy="14" r="1.5" fill="white"/>' +
        '</svg>';
    window.EYE_CURSOR = "url('data:image/svg+xml;utf8," + EYE_SVG + "') 0 0, default";

    function start() {
        const PC98Pipeline = window.PC98Pipeline;
        const config = {
            type: Phaser.WEBGL,
            parent: 'game',
            backgroundColor: '#0a0a14',
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
                width: 640,
                height: 480
            },
            pixelArt: true,
            roundPixels: false,
            pipeline: PC98Pipeline ? { 'PC98Pipeline': PC98Pipeline } : undefined,
            scene: []  // populated below
        };

        const game = new Phaser.Game(config);
        window.game = game; // DEBUG: expose for console inspection

        // Register scenes after Phaser boots.
        game.scene.add('Boot', window.BootScene);
        game.scene.add('Intro', window.IntroScene);
        game.scene.add('Alley', window.AlleyScene);

        game.scene.start('Boot');
    }

    if (window.STORY) {
        start();
    } else {
        window.addEventListener('story-ready', start, { once: true });
    }
})();