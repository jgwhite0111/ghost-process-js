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
