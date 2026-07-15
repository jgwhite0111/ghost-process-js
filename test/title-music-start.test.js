const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function runBrowserScript(context, relativePath) {
    const filename = path.join(ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

test('title music is attempted during Scene.start and START does not initiate another play', async () => {
    const story = JSON.parse(fs.readFileSync(path.join(ROOT, 'story.json'), 'utf8'));
    // Background loading is orthogonal here; isolate Scene.start's music phase.
    delete story.scenes.intro.bg;
    let resolveMusic;
    let directAudioPlayCalls = 0;
    const events = [];
    const timers = [];
    const pendingAudio = {
        paused: true,
        volume: 0,
        play() {
            directAudioPlayCalls += 1;
            return Promise.resolve();
        },
    };
    const musicHandler = {
        music: null,
        _pendingResume: pendingAudio,
        play(track) {
            events.push(`music:${track}`);
            return new Promise((resolve) => { resolveMusic = resolve; });
        },
    };
    const window = {
        STORY: story,
        STATE: { inventory: [], consumed: [], spentHitboxes: {} },
        Runtime: { loadImage: async () => null },
        MusicHandler: musicHandler,
        Inventory: { setVisible() {}, unlockForGameplay() {} },
        HitboxLayer: class {
            constructor(options) {
                this.options = options;
                this.overlay = { style: {} };
                events.push('hitboxes');
            }
            destroy() {}
        },
        dispatchEvent() {},
    };
    const canvas = {
        parentElement: { clientWidth: 640, clientHeight: 480 },
        style: {},
        getContext: () => ({}),
        addEventListener() {},
        removeEventListener() {},
    };
    const context = vm.createContext({
        window,
        console,
        CustomEvent: class {},
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout(fn, delay) {
            const timer = { fn, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeout() {},
    });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/scene-base.js');
    runBrowserScript(context, 'src/scenes/_registry.js');

    const scene = new window.SCENE_CLASSES.intro('intro');
    const startPromise = scene.start({ canvas, sceneId: 'intro' });

    assert.deepEqual(events, [`music:${story.scenes.intro.music}`],
        'music play is attempted before hitboxes/onReady and without a gesture');
    resolveMusic();
    await startPromise;
    assert.deepEqual(events, [`music:${story.scenes.intro.music}`, 'hitboxes']);

    const startHitbox = story.scenes.intro.hitboxes.find((hb) => hb.type === 'button');
    scene._triggerHitbox(startHitbox, 0, 0);
    assert.equal(directAudioPlayCalls, 0,
        'START relies on MusicHandler first-gesture fallback instead of calling audio.play itself');
    assert.equal(pendingAudio.volume, 0.7);
    assert.equal(timers.at(-1).delay, 5000);
});

// Regression: MusicHandler exposes a public resumePending() for browsers
// (notably Safari) where document-capture-phase listeners are NOT credited
// as autoplay gestures, but element-level handlers ARE. Scene.onReady wires
// a one-shot canvas pointerdown that calls resumePending(); verify the
// method is idempotent, clears the pending state, invokes audio.play() with
// the stashed fade params, and swallows play() rejections.
test('MusicHandler.resumePending is idempotent, replays the queued fade, and swallows play() rejections', async () => {
    const documentListeners = { pointerdown: 0, keydown: 0 };
    const documentEmitter = {
        addEventListener(type) { documentListeners[type] += 1; },
        removeEventListener(type) { documentListeners[type] -= 1; },
    };
    const window = {
        document: documentEmitter,
        addEventListener() {},
        removeEventListener() {},
    };
    let playCalls = 0;
    const audio = {
        play() {
            playCalls += 1;
            return Promise.reject(new Error('still blocked'));
        },
    };
    const context = vm.createContext({
        window,
        document: documentEmitter,
        console,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout() { return 0; },
        clearTimeout() {},
    });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/music.js');
    const handler = window.MusicHandler;
    handler._pendingResume = audio;
    handler._pendingResumeVolume = 0.42;
    handler._pendingResumeFadeMs = 800;

    // First call: clears pending state and dispatches audio.play()
    handler.resumePending();
    assert.equal(handler._pendingResume, null, 'first resumePending clears _pendingResume');
    assert.equal(handler._pendingResumeVolume, null, 'first resumePending clears stashed volume');
    assert.equal(handler._pendingResumeFadeMs, null, 'first resumePending clears stashed fade');
    assert.equal(playCalls, 1, 'first resumePending dispatches audio.play()');

    // Subsequent calls with nothing queued are safe no-ops.
    handler.resumePending();
    handler.resumePending();
    await new Promise((r) => setImmediate(r));
    assert.equal(playCalls, 1, 'further resumePending() calls are no-ops');

    // _queueResume registers a document-level pointerdown + keydown
    // listener (one each); resumePending() must clear them so the
    // manual fallback doesn't double-fire alongside its own success.
    // _queueResume itself sets this._pendingResume, so pre-populating
    // it to the same value would otherwise hit the early-return
    // guard `if (this._pendingResume === audio) return`.
    const freshAudio = { play() { return Promise.resolve(); } };
    handler.resumePending(); // ensure pending state is cleared
    handler._queueResume(freshAudio, 0.5, 600);
    assert.equal(documentListeners.pointerdown, 1, '_queueResume registered pointerdown');
    assert.equal(documentListeners.keydown, 1, '_queueResume registered keydown');
    handler.resumePending();
    assert.equal(documentListeners.pointerdown, 0, 'resumePending cleared pointerdown listener');
    assert.equal(documentListeners.keydown, 0, 'resumePending cleared keydown listener');
});
