const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeStyle {
    constructor() {
        this._cssText = '';
    }

    set cssText(value) {
        this._cssText = value;
        const opacity = /(?:^|;)opacity:([^;]+)/.exec(value);
        if (opacity) this.opacity = opacity[1];
    }

    get cssText() {
        return this._cssText;
    }
}

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = new FakeStyle();
        this.rect = { left: 0, top: 0, width: 0, height: 0 };
    }

    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }

    remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.children.indexOf(this);
        if (index !== -1) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event = {}) {
        event.type = type;
        event.stopPropagation ||= () => {};
        event.preventDefault ||= () => {};
        for (const listener of this.listeners.get(type) || []) listener(event);
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    getBoundingClientRect() {
        return this.rect;
    }
}

function createWindowEventTarget(properties) {
    const listeners = new Map();
    return Object.assign(properties, {
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatchEvent(event) {
            for (const listener of listeners.get(event.type) || []) listener(event);
        },
        listenerCount(type) {
            return listeners.get(type)?.size || 0;
        },
    });
}

function loadHitboxLayer({ inventory = [], consumed = [] } = {}) {
    const parent = new FakeElement('main');
    parent.rect = { left: 20, top: 30, width: 900, height: 700 };
    const canvas = new FakeElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.rect = { left: 120, top: 80, width: 640, height: 480 };
    parent.appendChild(canvas);

    const window = createWindowEventTarget({
        STATE: { inventory, consumed, spentHitboxes: {} },
        Runtime: {
            pageToCanvasCoords(_canvas, clientX, clientY) {
                return { x: clientX, y: clientY };
            },
        },
    });
    const document = {
        createElement(tagName) {
            return new FakeElement(tagName);
        },
    };
    const context = vm.createContext({
        window,
        document,
        localStorage: {},
        console,
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'src/runtime/hitbox.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return { HitboxLayer: window.HitboxLayer, canvas, parent, window };
}

function opacities(layer) {
    return Object.values(layer._labels).map((label) => label.style.opacity);
}

test('overlay tracks canvas resize events and destroy removes its retained listener', () => {
    const env = loadHitboxLayer();
    const layer = new env.HitboxLayer({
        canvas: env.canvas,
        sceneId: 'alley',
        sceneConfig: { kind: 'ink', hitboxes: [] },
    });

    assert.deepEqual(
        [layer.overlay.style.left, layer.overlay.style.top,
            layer.overlay.style.width, layer.overlay.style.height],
        ['100px', '50px', '640px', '480px'],
        'constructor synchronizes initial overlay bounds',
    );
    assert.equal(env.window.listenerCount('game:canvas-resized'), 1);

    env.parent.rect = { left: 10, top: 20, width: 500, height: 400 };
    env.canvas.rect = { left: 70, top: 90, width: 320, height: 240 };
    env.window.dispatchEvent({ type: 'game:canvas-resized' });
    assert.deepEqual(
        [layer.overlay.style.left, layer.overlay.style.top,
            layer.overlay.style.width, layer.overlay.style.height],
        ['60px', '70px', '320px', '240px'],
        'resize event re-synchronizes against current canvas and parent rects',
    );

    const detachedOverlay = layer.overlay;
    layer.destroy();
    assert.equal(env.window.listenerCount('game:inventory-changed'), 0);
    assert.equal(env.window.listenerCount('game:canvas-resized'), 0);
    assert.equal(detachedOverlay.parentElement, null);
    assert.equal(env.parent.children.includes(detachedOverlay), false);

    env.canvas.rect = { left: 1, top: 2, width: 3, height: 4 };
    assert.doesNotThrow(() => env.window.dispatchEvent({ type: 'game:canvas-resized' }));
    assert.equal(detachedOverlay.style.width, '320px', 'detached overlay is no longer synchronized');
});

test('button hitbox is a semantic control with hand cursor and no item label visuals', () => {
    const env = loadHitboxLayer();
    const triggers = [];
    const buttonHitbox = {
        x: 0.35, y: 0.55, w: 0.3, h: 0.08,
        type: 'button', label: 'PRESS START', target: 'cold_open',
    };
    const layer = new env.HitboxLayer({
        canvas: env.canvas,
        sceneId: 'intro',
        sceneConfig: { kind: 'title', hitboxes: [buttonHitbox] },
        onTrigger: (hb) => triggers.push(hb),
    });

    const control = layer._hitboxEls[0];
    assert.equal(control.tagName, 'BUTTON');
    assert.equal(control.type, 'button');
    assert.equal(control.className, 'hitbox hitbox-button');
    assert.equal(control.textContent, 'PRESS START');
    assert.match(control.style.cssText, /cursor:url\('data:image\/svg\+xml;utf8,<svg[^;]+pointer/);
    assert.equal(control.style.cssText.includes(env.window.EYE_CURSOR), false);
    assert.equal(Object.keys(layer._labels).length, 0, 'button does not create an eye/item label');

    control.dispatch('pointerenter');
    assert.equal(env.canvas.style.cursor, env.window.HAND_CURSOR);
    control.dispatch('click');
    assert.deepEqual(triggers, [buttonHitbox]);

    const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
    assert.match(css, /\.hitbox:not\(\.hitbox-button\):hover\s*\{/);
    const buttonRule = css.match(/\.hitbox-button\s*\{([^}]*)\}/s)?.[1] || '';
    const buttonHoverRule = css.match(/\.hitbox-button:hover,[^{]*\{([^}]*)\}/s)?.[1] || '';
    assert.doesNotMatch(buttonRule, /dashed/);
    assert.doesNotMatch(buttonHoverRule, /dashed/);

    layer.destroy();
});

test('repeatable hitboxes can be activated more than once without a spent-state lockout', () => {
    const env = loadHitboxLayer();
    const triggers = [];
    const walkaway = {
        x: 0.02, y: 0.45, w: 0.1, h: 0.3,
        label: 'Walk away', target: 'exploration_demo', repeatable: true,
    };
    const layer = new env.HitboxLayer({
        canvas: env.canvas,
        sceneId: 'terminal_obelab',
        sceneConfig: { kind: 'ink', hitboxes: [walkaway] },
        onTrigger: (hb) => triggers.push(hb),
    });

    layer._hitboxEls[0].dispatch('pointerdown', { clientX: 130, clientY: 300 });
    layer._hitboxEls[0].dispatch('pointerdown', { clientX: 130, clientY: 300 });
    assert.deepEqual(triggers, [walkaway, walkaway]);
    assert.deepEqual(env.window.STATE.spentHitboxes, {});
    layer.destroy();
});

test('ink item labels return to inventory-aware baseline after both hover exit paths', () => {
    const env = loadHitboxLayer({ inventory: ['held_item'], consumed: ['used_item'] });
    const hitboxes = [
        { x: 0.05, y: 0.05, w: 0.1, h: 0.1, item: 'required_item' },
        { x: 0.25, y: 0.05, w: 0.1, h: 0.1, target: 'inspect_terminal' },
        { x: 0.45, y: 0.05, w: 0.1, h: 0.1, item: 'held_item' },
        { x: 0.65, y: 0.05, w: 0.1, h: 0.1, item: 'used_item' },
    ];
    const layer = new env.HitboxLayer({
        canvas: env.canvas,
        sceneId: 'terminal_lab',
        sceneConfig: { kind: 'ink', hitboxes },
    });

    assert.deepEqual(opacities(layer), ['1', '0', '0', '0'], 'initial item baseline reflects state');

    layer._hitboxEls[1].dispatch('pointerenter');
    assert.deepEqual(opacities(layer), ['0', '1', '0', '0'], 'hover-enter behavior still isolates its label');
    layer._hitboxEls[1].dispatch('pointerleave');
    assert.deepEqual(opacities(layer), ['1', '0', '0', '0'], 'DOM pointerleave restores required item');

    layer._hitboxEls[1].dispatch('pointerenter');
    env.canvas.dispatch('pointermove', { clientX: 639, clientY: 479 });
    assert.deepEqual(opacities(layer), ['1', '0', '0', '0'], 'outside canvas move restores required item');

    env.window.STATE.inventory.push('required_item');
    layer.refresh();
    assert.deepEqual(opacities(layer), ['0', '0', '0', '0'], 'refresh still hides newly collected items');
    layer.destroy();
});

test('title labels and pulse marker return to their visible baseline after hover exit', () => {
    const env = loadHitboxLayer();
    const layer = new env.HitboxLayer({
        canvas: env.canvas,
        sceneId: 'intro',
        sceneConfig: {
            kind: 'title',
            hitboxes: [
                { x: 0.2, y: 0.4, w: 0.2, h: 0.1, target: 'start', label: 'PRESS START' },
                { x: 0.6, y: 0.4, w: 0.2, h: 0.1, target: 'options', label: 'OPTIONS' },
            ],
        },
    });

    assert.deepEqual(opacities(layer), ['1', '1']);
    assert.equal(layer._labels[0].hasAttribute('title-screen'), true);
    assert.equal(layer._labels[1].hasAttribute('title-screen'), true);

    layer._hitboxEls[0].dispatch('pointerenter');
    assert.deepEqual(opacities(layer), ['1', '0']);
    layer._hitboxEls[0].dispatch('pointerleave');
    assert.deepEqual(opacities(layer), ['1', '1']);
    assert.equal(layer._labels[0].hasAttribute('title-screen'), true, 'title pulse marker is preserved');
    layer.destroy();
});
