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

function loadRuntime() {
    const events = [];
    const timers = [];
    let flyComplete = null;
    const window = {
        STORY: {
            scenes: {
                action_test: { kind: 'ink', hitboxes: [] },
                destination: { kind: 'ink', hitboxes: [] },
            },
            items: {
                rusty_key: { pickup_message: 'You found a rusty key.' },
            },
        },
        STATE: { inventory: [], consumed: [], spentHitboxes: {} },
        TaskTracker: {
            onHitboxClicked(hitbox) {
                events.push(`task:${hitbox.label}`);
            },
        },
        Inventory: {
            addWithFly(item, pageX, pageY, label, onComplete) {
                events.push(`inventory:${item}:${pageX}:${pageY}:${label}`);
                flyComplete = onComplete;
            },
        },
        Toast: {
            show(message) {
                events.push(`toast:${message}`);
            },
        },
        DialoguePanel: {
            show() {
                events.push('dialogue:show');
            },
        },
        Engine: {
            goTo(sceneId) {
                events.push(`goto:${sceneId}`);
            },
        },
    };
    const warnings = [];
    const context = vm.createContext({
        window,
        console: { ...console, warn: (...args) => warnings.push(args) },
        setTimeout(fn, delay) {
            const timer = { fn, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeout() {},
    });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/actions.js');
    runBrowserScript(context, 'src/runtime/scene-base.js');
    return {
        window,
        events,
        timers,
        warnings,
        getFlyComplete: () => flyComplete,
    };
}

test('legacy item hitbox runs giveItem through the real Scene activation path', () => {
    const env = loadRuntime();
    const scene = new env.window.Scene('action_test');
    scene.hitboxLayer = {
        refresh() {
            env.events.push('hitboxes:refresh');
        },
    };
    scene._refreshTaskHint = () => env.events.push('task:refresh-hint');
    scene._onItemPicked = (itemId) => env.events.push(`picked:${itemId}`);

    const hitbox = {
        label: 'Search bins',
        item: 'rusty_key',
        target: 'destination',
        ink: 'Inspect',
    };
    scene._triggerHitbox(hitbox, 120, 240);

    assert.deepEqual(env.events, [
        'task:Search bins',
        'inventory:rusty_key:120:240:rusty key',
        'picked:rusty_key',
    ], 'task notification and pickup hook retain their pre-fly timing');
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].delay, 350);
    assert.equal(typeof env.getFlyComplete(), 'function');

    env.getFlyComplete()();
    assert.deepEqual(env.events.slice(-2), ['hitboxes:refresh', 'task:refresh-hint']);
    env.timers[0].fn();
    assert.equal(env.events.at(-1), 'toast:You found a rusty key.');
    assert.equal(env.events.some((event) => event.startsWith('goto:')), false,
        'legacy item retains precedence over target and ink');
});

test('legacy target hitbox runs goToScene and suppresses the old dialogue runner', () => {
    const env = loadRuntime();
    const scene = new env.window.Scene('action_test');
    scene.dialogueRunner = { _suppressStep: false };

    scene._triggerHitbox({ label: 'Exit', target: 'destination', ink: 'Ignored' }, 0, 0);

    assert.deepEqual(env.events, ['task:Exit', 'goto:destination']);
    assert.equal(scene.dialogueRunner._suppressStep, true);
});

test('legacy Ink hotspot runs openInk through the exploration activation path', () => {
    const env = loadRuntime();
    const scene = new env.window.Scene('action_test');
    scene.dialogueRunner = {
        story: {
            ChoosePathString(knot) {
                env.events.push(`ink:${knot}`);
            },
        },
        step() {
            env.events.push('ink:step');
        },
    };

    scene._activateExplorationHotspot({ label: 'Inspect', ink: 'InspectTerminal' }, 10, 20);

    assert.deepEqual(env.events, [
        'task:Inspect',
        'ink:InspectTerminal',
        'ink:step',
        'dialogue:show',
    ]);
});

test('typed actions validate payloads, execute in order, and stop after transitions', () => {
    const env = loadRuntime();
    const executor = env.window.ActionExecutor;
    const scene = new env.window.Scene('action_test');
    scene.dialogueRunner = {
        story: { ChoosePathString: (knot) => env.events.push(`ink:${knot}`) },
        step: () => env.events.push('ink:step'),
    };

    assert.equal(executor.validateAction({ type: 'giveItem', item: '' }),
        'action giveItem.item must be a non-empty string');
    assert.equal(executor.validateAction({ type: 'goToScene' }),
        'action goToScene.scene must be a non-empty string');
    assert.equal(executor.validateAction({ type: 'openInk', knot: 12 }),
        'action openInk.knot must be a non-empty string');
    assert.equal(executor.validateAction({ type: 'setView', view: '' }),
        'action setView.view must be a non-empty string');
    assert.equal(executor.validateAction({ type: 'unknown' }),
        'unsupported action type "unknown"');

    const result = executor.execute([
        { type: 'openInk', knot: 'First' },
        { type: 'goToScene', scene: 'destination' },
        { type: 'giveItem', item: 'rusty_key' },
    ], { scene, pageX: 1, pageY: 2 });

    assert.deepEqual(env.events, [
        'ink:First',
        'ink:step',
        'dialogue:show',
        'goto:destination',
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.transitioned, true);
    assert.equal(result.index, 1);
});

test('setView and overlay-owned openInk reuse the typed executor without the global dialogue panel', () => {
    const env = loadRuntime();
    const scene = new env.window.Scene('action_test');
    scene.overlayLayer = {
        setView(view) { env.events.push(`view:${view}`); return view === 'details'; },
        hasInkContent() { return true; },
        openInk(knot) { env.events.push(`overlay-ink:${knot}`); return true; },
    };
    const result = env.window.ActionExecutor.execute([
        { type: 'setView', view: 'details' },
        { type: 'openInk', knot: 'sysinfo' },
    ], { scene });
    assert.equal(result.ok, true);
    assert.deepEqual(env.events, ['view:details', 'overlay-ink:sysinfo']);
});

test('legacy normalization preserves item then target then Ink precedence', () => {
    const env = loadRuntime();
    const normalize = env.window.ActionExecutor.normalizeLegacyHitbox;

    assert.equal(JSON.stringify(normalize({ item: 'key', target: 'next', ink: 'Knot' })),
        '[{"type":"giveItem","item":"key"}]');
    assert.equal(JSON.stringify(normalize({ target: 'next', ink: 'Knot' })),
        '[{"type":"goToScene","scene":"next"}]');
    assert.equal(JSON.stringify(normalize({ ink: 'Knot' })),
        '[{"type":"openInk","knot":"Knot"}]');
    assert.equal(JSON.stringify(normalize({})), '[]');
});
