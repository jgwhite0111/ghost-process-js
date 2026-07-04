// src/story.js — fetch + cache story.json, expose as window.STORY
//
// Single source of truth for content. Loaded at boot before Phaser starts.
// Hitboxes, sprites, dialogue all read from this object.

(async () => {
    'use strict';

    let story = null;
    try {
        const res = await fetch('story.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        story = await res.json();
    } catch (err) {
        showFatal(`Could not load story.json (${err.message}). Run \`npm start\` from the project root.`);
        return;
    }
    if (!story || !story.scenes || !story.start) {
        showFatal('story.json is missing required fields (version, title, start, scenes).');
        return;
    }
    if (!story.scenes[story.start]) {
        showFatal(`story.start references missing scene "${story.start}".`);
        return;
    }

    window.STORY = story;
    window.STATE = {
        sceneId: story.start,
        inventory: [],
        consumed: [],
        spentHitboxes: {},
        visited: [story.start]
    };

    // Notify any listener that story is ready (Phaser boot waits on this).
    window.dispatchEvent(new CustomEvent('story-ready'));

    // The inventory button is unlocked for gameplay from the intro
    // scene's create() — NOT here — so it doesn't appear during the
    // Boot scene's preload phase on mobile (where it would visually
    // collide with the "Loading…" Phaser text).

    function showFatal(msg) {
        document.body.innerHTML = `
            <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
                        background:#0a0a0a;color:#cfcfcf;font-family:monospace;padding:2em;text-align:center">
                <div>
                    <div style="color:#d4a045;letter-spacing:0.2em;margin-bottom:1em">GHOST//PROCESS</div>
                    <div style="font-size:1.2em">${msg}</div>
                </div>
            </div>`;
    }
})();