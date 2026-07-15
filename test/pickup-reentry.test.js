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

function makeContext(state = { inventory: [], consumed: [] }) {
    const timers = [];
    const window = {
        STATE: state,
        STORY: { scenes: { alley: {}, kabukicho: {} } },
    };
    const context = vm.createContext({
        window,
        console,
        setTimeout(fn, delay) {
            const timer = { fn, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            if (timer) timer.cleared = true;
        },
    });
    context.globalThis = context;
    return { context, window, timers };
}

function loadSceneClasses(state) {
    const env = makeContext(state);
    runBrowserScript(env.context, 'src/runtime/scene-base.js');
    runBrowserScript(env.context, 'src/scenes/_registry.js');
    return env;
}

function attachRunner(scene) {
    const paths = [];
    let steps = 0;
    scene.dialogueRunner = {
        story: { ChoosePathString: (pathName) => paths.push(pathName) },
        step: () => { steps += 1; },
    };
    scene._active = true;
    return { paths, stepCount: () => steps };
}

test('first pickup waits for the existing fly delay before redirecting', () => {
    for (const [sceneId, itemId, inkNode] of [
        ['alley', 'rusty_key', 'FoundKey'],
        ['kabukicho', 'datacard', 'ContactMade'],
    ]) {
        const { window, timers } = loadSceneClasses({ inventory: [], consumed: [] });
        const scene = new window.SCENE_CLASSES[sceneId](sceneId);
        const runner = attachRunner(scene);

        scene.onReady();
        scene._onItemPicked(itemId);

        assert.deepEqual(runner.paths, [], `${sceneId} redirected before the fly delay`);
        assert.equal(runner.stepCount(), 0);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].delay, 700);

        timers[0].fn();
        assert.deepEqual(runner.paths, [inkNode]);
        assert.equal(runner.stepCount(), 1);
    }
});

test('revisit immediately enters each post-pickup Ink knot', () => {
    const cases = [
        ['alley', { inventory: ['rusty_key'], consumed: [] }, 'FoundKey'],
        ['kabukicho', { inventory: [], consumed: ['datacard'] }, 'ContactMade'],
    ];

    for (const [sceneId, state, inkNode] of cases) {
        const { window, timers } = loadSceneClasses(state);
        const scene = new window.SCENE_CLASSES[sceneId](sceneId);
        const runner = attachRunner(scene);

        scene.onReady();

        assert.deepEqual(runner.paths, [inkNode]);
        assert.equal(runner.stepCount(), 1);
        assert.equal(timers.length, 0, `${sceneId} revisit should not wait`);
    }
});

test('held and consumed pickup tasks bind as completed with no hint', () => {
    for (const state of [
        { inventory: ['rusty_key'], consumed: [] },
        { inventory: [], consumed: ['rusty_key'] },
    ]) {
        const { context, window } = makeContext(state);
        runBrowserScript(context, 'src/tasks.js');

        window.TaskTracker.bind('alley', [{
            id: 'find_key',
            type: 'pickup',
            item: 'rusty_key',
            hint: 'Something glints by the bins.',
        }]);

        assert.equal(window.TaskTracker.completed.has('find_key'), true);
        assert.equal(window.TaskTracker.hasOpen(), false);
        assert.equal(window.TaskTracker.nextHint(), null);
    }
});
