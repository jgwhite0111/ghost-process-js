// src/runtime/engine.js — owns the canvas, scene transitions, and the
// active Scene instance.
//
//   - boot() once at startup (loads story.json, opens canvas, starts intro)
//   - goTo(sceneId) to transition (shuts down old scene, starts new one)
//   - the canvas + ctx live on the engine as static fields so any
//     scene can read them
//
// Scene transitions are explicit: when transition_next() fires from
// Ink (via the dialogue panel's onCommand), we call goTo(target) and
// that scene starts fresh. There is no scene-stacking — only one
// scene runs at a time.

const ENGINE_STATE = {
    canvas: null,
    ctx: null,
    current: null,    // active Scene instance
    bootStarted: false
};

async function boot() {
    if (ENGINE_STATE.bootStarted) return;
    ENGINE_STATE.bootStarted = true;
    // Wait until STORY is loaded (story.js does this asynchronously).
    await new Promise((resolve) => {
        if (window.STORY) return resolve();
        window.addEventListener('story-ready', () => resolve(), { once: true });
    });
    // Create canvas.
    ENGINE_STATE.canvas = window.Runtime.createGameCanvas();
    ENGINE_STATE.ctx = ENGINE_STATE.canvas.getContext('2d');
    // Dialogue panel is owned by the body — created once.
    if (!window.__dialoguePanel) {
        window.DialoguePanel.show();
        window.__dialoguePanel = true;
    }
    // Wait only for the start scene's background, complete medley, and sprite
    // frames. Remaining scene stages continue opportunistically in parallel
    // with play and Scene.start retains its on-demand fallback.
    const search = window.location && typeof window.location.search === 'string'
        ? window.location.search
        : '';
    const requestedMatch = search.match(/[?&]scene=([^&]+)/);
    const requestedScene = requestedMatch
        ? decodeURIComponent(requestedMatch[1].replace(/\+/g, ' '))
        : null;
    const startSceneId = requestedScene && window.STORY.scenes[requestedScene]
        ? requestedScene
        : window.STORY.start;
    await window.STORY_BG_PROMISE;
    goTo(startSceneId);
}

let sceneInstances = {};

function getScene(sceneId) {
    if (sceneInstances[sceneId]) return sceneInstances[sceneId];
    // All v2 scenes are bare subclasses of Scene. The Scene class
    // itself takes a sceneId in its constructor — so any class with no
    // constructor that just declares `extends Scene` works.
    const Class = window.SCENE_CLASSES[sceneId] || window.Scene;
    const inst = new Class(sceneId);
    sceneInstances[sceneId] = inst;
    return inst;
}

async function goTo(sceneId) {
    // Shutdown previous.
    if (ENGINE_STATE.current) {
        ENGINE_STATE.current.shutdown();
        ENGINE_STATE.current = null;
    }
    if (!sceneId) return;
    // Reset the dialogue panel between scenes so the previous scene's
    // text/speaker/choice buttons don't linger on screen.
    if (window.DialoguePanel) window.DialoguePanel.clear();
    STATE.visited = STATE.visited || [];
    if (STATE.visited[STATE.visited.length - 1] !== sceneId) {
        STATE.visited.push(sceneId);
    }
    STATE.sceneId = sceneId;
    const scene = getScene(sceneId);
    ENGINE_STATE.current = scene;
    await scene.start({ canvas: ENGINE_STATE.canvas, sceneId });
}

window.Engine = {
    boot,
    goTo,
    _state: ENGINE_STATE,
    register(sceneId, classRef) {
        window.SCENE_CLASSES = window.SCENE_CLASSES || {};
        window.SCENE_CLASSES[sceneId] = classRef;
    }
};
