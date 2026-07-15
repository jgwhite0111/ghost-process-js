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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject, settled: false };
}

async function flushMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function loadStoryPreloader(story) {
    const calls = [];
    const loads = new Map();
    const events = [];
    const warnings = [];

    function load(kind, src) {
        calls.push({ kind, src });
        const key = `${kind}:${src}`;
        if (!loads.has(key)) loads.set(key, deferred());
        return loads.get(key).promise;
    }

    const window = {
        Runtime: {
            loadImage: (src) => load('image', src),
            loadAudio: (src) => load('audio', src),
        },
        dispatchEvent(event) {
            events.push(event.type);
        },
    };
    const context = vm.createContext({
        window,
        document: { body: { innerHTML: '' } },
        console: {
            ...console,
            warn: (...args) => warnings.push(args),
        },
        CustomEvent: class CustomEvent {
            constructor(type) { this.type = type; }
        },
        fetch: async () => ({
            ok: true,
            json: async () => story,
        }),
    });
    context.globalThis = context;

    runBrowserScript(context, 'src/story.js');
    await flushMicrotasks();

    function settleWhere(predicate, failureSrc = null) {
        for (const [key, loadState] of loads) {
            if (loadState.settled || !predicate(key)) continue;
            loadState.settled = true;
            if (failureSrc && key.includes(failureSrc)) {
                loadState.reject(new Error(`mock failure: ${key}`));
            } else {
                loadState.resolve({ key });
            }
        }
    }

    return { window, calls, loads, events, warnings, settleWhere };
}

function sceneWithAssets(name, music, withFrames = false) {
    return {
        bg: `bg_${name}`,
        music,
        characters: withFrames ? [{
            scenes: {
                [name]: { frames: `assets/sprites/${name}/frame_*.png` },
            },
        }] : [],
    };
}

function callSources(calls) {
    return calls.map(({ src }) => src);
}

test('story-ready fires immediately while the critical promise contains only every start-scene asset', async () => {
    const story = {
        start: 'start',
        next: { start: 'later' },
        scenes: {
            start: sceneWithAssets('start', [
                { file: 'start_a.mp3' },
                { file: 'start_b.mp3', fadeAt: 4 },
            ], true),
            later: sceneWithAssets('later', [
                { file: 'later_a.mp3' },
                { file: 'later_b.mp3' },
            ], true),
        },
    };
    const env = await loadStoryPreloader(story);

    assert.deepEqual(env.events, ['story-ready']);
    assert.equal(typeof env.window.STORY_BG_PROMISE?.then, 'function');
    assert.equal(typeof env.window.STORY_BACKGROUND_PRELOAD_PROMISE?.then, 'function');

    const initialSources = callSources(env.calls);
    assert.equal(initialSources.length, 19, 'start bg + two tracks + sixteen frames');
    assert.ok(initialSources.includes('assets/backgrounds/bg_start.png'));
    assert.ok(initialSources.includes('assets/audio/start_a.mp3'));
    assert.ok(initialSources.includes('assets/audio/start_b.mp3'));
    for (let i = 1; i <= 16; i += 1) {
        assert.ok(initialSources.includes(`assets/sprites/start/frame_${String(i).padStart(2, '0')}.png`));
    }
    assert.equal(initialSources.some((src) => src.includes('later')), false);

    let criticalResolved = false;
    env.window.STORY_BG_PROMISE.then(() => { criticalResolved = true; });
    await flushMicrotasks();
    assert.equal(criticalResolved, false, 'story-ready does not imply critical assets have finished');

    env.settleWhere((key) => key.includes('start'));
    await env.window.STORY_BG_PROMISE;
    await flushMicrotasks();

    assert.equal(criticalResolved, true);
    assert.equal(callSources(env.calls).some((src) => src.includes('later')), true);

    env.settleWhere((key) => key.includes('later'));
    await env.window.STORY_BACKGROUND_PRELOAD_PROMISE;
});

test('remaining scenes preload after critical completion in next-chain order, one complete scene at a time', async () => {
    const story = {
        start: 'start',
        next: {
            start: 'next_two',
            next_two: 'next_one',
            next_one: 'start',
        },
        scenes: {
            start: sceneWithAssets('start', 'start.mp3'),
            fallback: sceneWithAssets('fallback', [
                { file: 'fallback_a.mp3' },
                { file: 'fallback_b.mp3' },
            ]),
            next_one: sceneWithAssets('next_one', [
                { file: 'next_one_a.mp3' },
                { file: 'next_one_b.mp3' },
            ]),
            next_two: sceneWithAssets('next_two', [
                { file: 'next_two_a.mp3' },
                { file: 'next_two_b.mp3' },
                { file: 'next_two_c.mp3' },
            ], true),
        },
    };
    const env = await loadStoryPreloader(story);

    assert.deepEqual(callSources(env.calls), [
        'assets/backgrounds/bg_start.png',
        'assets/audio/start.mp3',
    ]);

    env.settleWhere((key) => key.includes('start'));
    await env.window.STORY_BG_PROMISE;
    await flushMicrotasks();

    const nextTwoSources = callSources(env.calls).filter((src) => src.includes('next_two'));
    assert.equal(nextTwoSources.length, 20, 'next scene bg + all three music entries + sixteen frames');
    assert.deepEqual(nextTwoSources.filter((src) => src.includes('audio/')), [
        'assets/audio/next_two_a.mp3',
        'assets/audio/next_two_b.mp3',
        'assets/audio/next_two_c.mp3',
    ]);
    assert.equal(callSources(env.calls).some((src) => src.includes('next_one')), false);
    assert.equal(callSources(env.calls).some((src) => src.includes('fallback')), false);

    env.settleWhere((key) => key.includes('next_two'), 'next_two_b.mp3');
    await flushMicrotasks();
    assert.equal(env.warnings.length, 1, 'a failed background asset is handled and diagnosed');

    const nextOneSources = callSources(env.calls).filter((src) => src.includes('next_one'));
    assert.deepEqual(nextOneSources, [
        'assets/backgrounds/bg_next_one.png',
        'assets/audio/next_one_a.mp3',
        'assets/audio/next_one_b.mp3',
    ]);
    assert.equal(callSources(env.calls).some((src) => src.includes('fallback')), false);

    env.settleWhere((key) => key.includes('next_one'));
    await flushMicrotasks();

    assert.deepEqual(callSources(env.calls).filter((src) => src.includes('fallback')), [
        'assets/backgrounds/bg_fallback.png',
        'assets/audio/fallback_a.mp3',
        'assets/audio/fallback_b.mp3',
    ]);

    env.settleWhere((key) => key.includes('fallback'));
    await env.window.STORY_BACKGROUND_PRELOAD_PROMISE;
});

test('Engine starts the title after the critical promise without waiting for background preloading', async () => {
    const critical = deferred();
    const background = deferred();
    const starts = [];
    const state = { inventory: [], consumed: [], visited: ['intro'] };
    const canvas = { getContext: () => ({}) };
    const window = {
        STORY: { start: 'intro', scenes: { intro: {} } },
        STATE: state,
        STORY_BG_PROMISE: critical.promise,
        STORY_BACKGROUND_PRELOAD_PROMISE: background.promise,
        Runtime: { createGameCanvas: () => canvas },
        DialoguePanel: { show() {}, clear() {} },
        SCENE_CLASSES: {
            intro: class {
                async start(options) { starts.push(options.sceneId); }
                shutdown() {}
            },
        },
        addEventListener() {},
    };
    const context = vm.createContext({ window, STATE: state, console });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/engine.js');

    const bootPromise = window.Engine.boot();
    await flushMicrotasks();
    assert.deepEqual(starts, []);

    critical.resolve();
    await bootPromise;
    await flushMicrotasks();
    assert.deepEqual(starts, ['intro']);

    let backgroundResolved = false;
    background.promise.then(() => { backgroundResolved = true; });
    await flushMicrotasks();
    assert.equal(backgroundResolved, false);
    background.resolve();
});

test('concurrent loadImage calls share one Image and failed loads can be retried', async () => {
    const images = [];
    class MockImage {
        constructor() {
            images.push(this);
        }
        set src(value) { this._src = value; }
        get src() { return this._src; }
        succeed() { this.onload(); }
        fail() { this.onerror(new Error('mock image failure')); }
    }

    const window = {};
    const context = vm.createContext({
        window,
        console,
        Image: MockImage,
        Audio: class MockAudio {},
        document: {},
    });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/canvas.js');

    const first = window.Runtime.loadImage('shared.png');
    const second = window.Runtime.loadImage('shared.png');
    assert.strictEqual(first, second);
    assert.equal(images.length, 1);

    images[0].succeed();
    const [firstImage, secondImage] = await Promise.all([first, second]);
    assert.strictEqual(firstImage, images[0]);
    assert.strictEqual(secondImage, images[0]);
    assert.strictEqual(window.Runtime.assets.images['shared.png'], images[0]);
    assert.strictEqual(await window.Runtime.loadImage('shared.png'), images[0]);
    assert.equal(images.length, 1, 'resolved cache remains unchanged');

    const failed = window.Runtime.loadImage('retry.png');
    const rejection = assert.rejects(failed, /Failed to load image: retry\.png/);
    assert.equal(images.length, 2);
    images[1].fail();
    await rejection;

    const retry = window.Runtime.loadImage('retry.png');
    const concurrentRetry = window.Runtime.loadImage('retry.png');
    assert.strictEqual(retry, concurrentRetry);
    assert.equal(images.length, 3, 'failure clears only the in-flight entry');
    images[2].succeed();
    assert.strictEqual(await retry, images[2]);
    assert.strictEqual(window.Runtime.assets.images['retry.png'], images[2]);
});
