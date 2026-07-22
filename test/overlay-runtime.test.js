const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach(name => this.values.add(name)); }
}
class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
        this.style = {}; this.dataset = {}; this.classList = new FakeClassList();
        this.listeners = new Map(); this.attributes = new Map(); this.clientWidth = 0; this.clientHeight = 0;
    }
    appendChild(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(x => x !== child);
        this.children.push(child); child.parentElement = this; return child;
    }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    dispatch(type, event = {}) { event.stopPropagation ||= () => {}; for (const fn of this.listeners.get(type) || []) fn(event); }
    setAttribute(name, value) { this.attributes.set(name, value); }
}
function eventWindow(properties) {
    const listeners = new Map();
    return Object.assign(properties, {
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
        count(type) { return listeners.get(type)?.size || 0; },
    });
}
function loadRuntime() {
    const parent = new FakeElement('main');
    const canvas = new FakeElement('canvas'); canvas.width = 1000; canvas.height = 600; parent.appendChild(canvas);
    const calls = [];
    const window = eventWindow({
        Runtime: { containRect(sw, sh, dw, dh) { const scale = Math.min(dw / sw, dh / sh); return { x: (dw - sw * scale) / 2, y: (dh - sh * scale) / 2, w: sw * scale, h: sh * scale }; } },
        ActionExecutor: { execute(actions, context) { calls.push({ actions, context }); } },
    });
    const document = { createElement(tag) { return new FakeElement(tag); } };
    const context = vm.createContext({ window, document, console }); context.globalThis = context;
    const file = path.join(ROOT, 'src/runtime/overlay.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { window, parent, canvas, calls };
}

test('generic overlay constructs nested elements, uses contain-stage geometry, and dispatches typed actions', () => {
    const env = loadRuntime();
    const scene = { sceneId: 'room' };
    const actions = [{ type: 'goToScene', scene: 'exit' }];
    const sceneConfig = {
        bgFit: 'contain',
        overlay: { designWidth: 1152, designHeight: 864, elements: [
            { id: 'child', type: 'text', parent: 'panel', x: .1, y: .2, w: .8, h: .2, text: 'READY' },
            { id: 'panel', type: 'container', x: .1, y: .1, w: .8, h: .8, clip: true },
            { id: 'go', type: 'hotspot', x: .4, y: .7, w: .2, h: .1, label: 'Go', presentation: 'control', events: { activate: { actions } } },
        ] },
    };
    const layer = new env.window.OverlayRuntime.OverlayLayer({ canvas: env.canvas, scene, sceneConfig });
    layer.mount();

    assert.equal(env.parent.children.includes(layer.root), true);
    assert.deepEqual([layer.stage.style.left, layer.stage.style.top, layer.stage.style.width, layer.stage.style.height], ['100px', '0px', '800px', '600px']);
    assert.equal(layer.nodes.get('child').parentElement, layer.nodes.get('panel'), 'parent order is independent of flat-array order');
    assert.equal(layer.nodes.get('child').textContent, 'READY');
    assert.equal(layer.nodes.get('child').style.left, '10%');
    assert.equal(layer.nodes.get('panel').style.overflow, 'hidden');
    assert.equal(layer.nodes.get('go').tagName, 'BUTTON');
    assert.equal(layer.nodes.get('go').attributes.get('aria-label'), 'Go');

    layer.nodes.get('go').dispatch('click', { pageX: 31, pageY: 47 });
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].actions, actions);
    assert.equal(env.calls[0].context.scene, scene);
    assert.deepEqual([env.calls[0].context.pageX, env.calls[0].context.pageY], [31, 47]);
    assert.equal(env.window.count('game:canvas-resized'), 1);

    const root = layer.root;
    layer.destroy();
    assert.equal(env.window.count('game:canvas-resized'), 0);
    assert.equal(root.parentElement, null);
});

test('overlay resize relayout is deterministic for cover and contain scenes', () => {
    const env = loadRuntime();
    const config = { bgFit: 'cover', overlay: { designWidth: 4, designHeight: 3, elements: [] } };
    const layer = new env.window.OverlayRuntime.OverlayLayer({ canvas: env.canvas, scene: { sceneId: 'x' }, sceneConfig: config });
    layer.mount();
    assert.equal(layer.stage.style.width, '1000px');
    config.bgFit = 'contain'; env.canvas.width = 400; env.canvas.height = 400;
    env.window.dispatchEvent({ type: 'game:canvas-resized' });
    assert.deepEqual([layer.stage.style.left, layer.stage.style.top, layer.stage.style.width, layer.stage.style.height], ['0px', '50px', '400px', '300px']);
    layer.destroy();
});
