// src/story.js — fetch + cache story.json, then start the asset
// preload, then fire `story-ready` so the Engine can boot.
//
// story-ready fires only after EVERY asset referenced by story.json
// has been preloaded. Each scene's bg image, audio, and 16-frame
// sprite sheets are added to the preload batch up-front. Total preload
// is bounded by the
// number of scenes x assets; with ~7 scenes it's a few seconds.

(async () => {
    'use strict';

    // 1. Load story.json.
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

    // 2. Preload every asset referenced by story.json. We do this
    //    BEFORE announcing story-ready so the first scene's start()
    //    doesn't have to wait — but we still keep this behind a
    //    promise so the Engine can boot the moment preloading
    //    finishes.
    const preloadPromises = [];
    for (const [sceneId, scene] of Object.entries(story.scenes)) {
        if (scene.bg) {
            preloadPromises.push(
                window.Runtime.loadImage(`assets/backgrounds/${scene.bg}.png`)
                    .catch((e) => console.warn(`bg preload failed: ${scene.bg}`, e))
            );
        }
        if (scene.music) {
            // music can be a string (single track) OR a list of
            // {file: ..., fadeAt?: ..., volume?: ...} entries — preload
            // each unique file so the runtime doesn't stall on first play.
            const tracks = Array.isArray(scene.music)
                ? scene.music
                : (typeof scene.music === 'string'
                    ? [{ file: scene.music }]
                    : [scene.music]);
            tracks.forEach((t) => {
                if (t && t.file) {
                    preloadPromises.push(
                        window.Runtime.loadAudio(`assets/audio/${t.file}`)
                            .catch((e) => console.warn(`audio preload failed: ${t.file}`, e))
                    );
                }
            });
        }
        for (const char of scene.characters || []) {
            const sprites = (char.scenes || {})[sceneId] || {};
            if (sprites.frames) {
                const m = sprites.frames.match(/^(.+\/)([^/]+)_\*\.png$/);
                if (m) {
                    const dir = m[1], prefix = m[2];
                    for (let i = 1; i <= 16; i++) {
                        const num = String(i).padStart(2, '0');
                        preloadPromises.push(
                            window.Runtime.loadImage(`${dir}${prefix}_${num}.png`)
                                .catch(() => null)
                        );
                    }
                }
            }
        }
    }
    window.STORY_BG_PROMISE = Promise.all(preloadPromises);

    // 3. Fire story-ready.
    window.dispatchEvent(new CustomEvent('story-ready'));

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
