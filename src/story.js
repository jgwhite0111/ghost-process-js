// src/story.js — fetch + cache story.json, start the startup-critical
// preload, then fire `story-ready` so the Engine can boot.
//
// Only the start scene blocks Engine startup. Remaining scenes preload
// afterward, one scene at a time in narrative next-chain order, so the
// browser never receives an all-game burst of image and audio requests.

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

    function safelyPreload(load, warning) {
        try {
            return Promise.resolve(load()).catch((err) => {
                if (warning) console.warn(warning, err);
                return null;
            });
        } catch (err) {
            if (warning) console.warn(warning, err);
            return Promise.resolve(null);
        }
    }

    function musicEntries(music) {
        if (!music) return [];
        if (Array.isArray(music)) return music;
        if (typeof music === 'string') return [{ file: music }];
        return [music];
    }

    function preloadSceneAssets(sceneId) {
        const scene = story.scenes[sceneId];
        if (!scene) return Promise.resolve([]);

        const preloads = [];
        if (scene.bg) {
            preloads.push(safelyPreload(
                () => window.Runtime.loadImage(`assets/backgrounds/${scene.bg}.png`),
                `bg preload failed: ${scene.bg}`
            ));
        }

        for (const track of musicEntries(scene.music)) {
            if (!track || !track.file) continue;
            preloads.push(safelyPreload(
                () => window.Runtime.loadAudio(`assets/audio/${track.file}`),
                `audio preload failed: ${track.file}`
            ));
        }

        for (const char of scene.characters || []) {
            const sprites = (char.scenes || {})[sceneId] || {};
            if (!sprites.frames) continue;
            const match = sprites.frames.match(/^(.+\/)([^/]+)_\*\.png$/);
            if (!match) continue;
            const dir = match[1], prefix = match[2];
            for (let i = 1; i <= 16; i++) {
                const num = String(i).padStart(2, '0');
                preloads.push(safelyPreload(
                    () => window.Runtime.loadImage(`${dir}${prefix}_${num}.png`)
                ));
            }
        }

        return Promise.all(preloads);
    }

    function backgroundSceneOrder() {
        const ordered = [];
        const seen = new Set([story.start]);
        let sceneId = story.next && story.next[story.start];

        // Follow the declared narrative chain first. Stop at loops and
        // malformed/missing targets, then append any disconnected scenes in
        // story order so diagnostics still cover every configured scene.
        while (sceneId && story.scenes[sceneId] && !seen.has(sceneId)) {
            seen.add(sceneId);
            ordered.push(sceneId);
            sceneId = story.next && story.next[sceneId];
        }
        for (const remainingId of Object.keys(story.scenes)) {
            if (seen.has(remainingId)) continue;
            seen.add(remainingId);
            ordered.push(remainingId);
        }
        return ordered;
    }

    // 2. Start only the start scene's critical preload. Engine retains the
    //    STORY_BG_PROMISE compatibility name, but it no longer represents an
    //    all-game barrier.
    window.STORY_BG_PROMISE = preloadSceneAssets(story.start);

    // Remaining scenes begin only after the critical stage and are bounded
    // to one complete scene at a time. This aggregate promise is diagnostic;
    // Engine deliberately does not await it. Every asset rejection is caught
    // inside its scene stage, and this final catch prevents unexpected staging
    // errors from becoming unhandled rejections.
    window.STORY_BACKGROUND_PRELOAD_PROMISE = window.STORY_BG_PROMISE
        .then(async () => {
            for (const sceneId of backgroundSceneOrder()) {
                await preloadSceneAssets(sceneId);
            }
        })
        .catch((err) => {
            console.warn('background scene preload failed', err);
        });

    // 3. Announce that STORY is available. Engine independently waits for the
    //    critical start-scene promise before entering the title scene.
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
