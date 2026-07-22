const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach(name => this.values.add(name)); }
    contains(name) { return this.values.has(name); }
}
class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.dataset = {};
        this.classList = new FakeClassList();
        this.listeners = {};
        this.hidden = false;
        this.textContent = '';
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this[name] = String(value); }
}
class FakeInkStory {
    constructor() { this.ResetState(); }
    ResetState() { this.path = 'root'; this.lines = [{ text: 'SYSTEM READY', tags: ['heading'] }, { text: 'nominal', tags: ['ok'] }]; this.index = 0; this.currentTags = []; this.choiceMode = true; }
    get canContinue() { return this.index < this.lines.length; }
    Continue() { const line = this.lines[this.index++]; this.currentTags = line.tags; return line.text; }
    get currentChoices() { return !this.canContinue && this.choiceMode ? [{ text: 'Inspect', index: 0 }] : []; }
    ChooseChoiceIndex(index) { assert.equal(index, 0); this.choiceMode = false; this.lines = [{ text: 'INSPECTED', tags: ['warn'] }]; this.index = 0; }
    ChoosePathString(knot) {
        if (knot === 'missing') throw new Error('missing knot');
        this.path = knot; this.lines = [{ text: `OPEN ${knot}`, tags: ['heading'] }]; this.index = 0; this.choiceMode = false;
    }
}
function loadRuntime() {
    const document = { createElement: tag => new FakeElement(tag) };
    const context = vm.createContext({ console, document, window: null });
    context.window = context;
    context.addEventListener = () => {};
    context.removeEventListener = () => {};
    context.inkjs = { Compiler: class { Compile() { return new FakeInkStory(); } } };
    vm.runInContext(fs.readFileSync('src/runtime/actions.js', 'utf8'), context, { filename: 'actions.js' });
    vm.runInContext(fs.readFileSync('src/runtime/overlay.js', 'utf8'), context, { filename: 'overlay.js' });
    return { context, document };
}
function mountLayer(context, overlay) {
    const host = new FakeElement('div');
    const canvas = { width: 100, height: 100, parentElement: host };
    const scene = { sceneId: 'room', overlayLayer: null };
    const sceneConfig = { bgFit: 'cover', overlay };
    const layer = new context.OverlayRuntime.OverlayLayer({ canvas, scene, sceneConfig });
    scene.overlayLayer = layer;
    layer.mount();
    return layer;
}

function config() {
    return {
        designWidth: 100, designHeight: 100, views: ['overview', 'details'], initialView: 'overview',
        elements: [
            { id: 'overview-only', type: 'text', x: 0, y: 0, w: .2, h: .1, text: 'Overview', visibleIn: ['overview'] },
            { id: 'details-only', type: 'text', x: .2, y: 0, w: .2, h: .1, text: 'Details', visibleIn: ['details'], activeIn: ['details'] },
            { id: 'lines', type: 'container', x: 0, y: .2, w: 1, h: .3, content: { source: 'inkLines', tagStyles: { heading: 'heading', ok: 'success', warn: 'warning' } } },
            { id: 'choices', type: 'container', x: 0, y: .6, w: 1, h: .3, content: { source: 'inkChoices', controlPreset: 'terminal-command' }, events: { choiceSelected: { actions: [{ type: 'setView', view: 'overview' }] } } },
        ],
    };
}

test('scene-local view changes apply visibleIn and activeIn without rebuilding nodes', () => {
    const { context } = loadRuntime();
    const layer = mountLayer(context, config());
    const overview = layer.nodes.get('overview-only');
    const details = layer.nodes.get('details-only');
    assert.equal(layer.activeView, 'overview');
    assert.equal(overview.hidden, false);
    assert.equal(details.hidden, true);
    assert.equal(layer.setView('details'), true);
    assert.strictEqual(layer.nodes.get('overview-only'), overview, 'setView preserves authored DOM identity');
    assert.equal(overview.hidden, true);
    assert.equal(details.hidden, false);
    assert.equal(details.dataset.active, 'true');
    assert.equal(layer.setView('missing'), false);
    assert.equal(layer.activeView, 'details', 'invalid view mutates nothing');
});

test('generic Ink bindings render all lines, explicit tag presets, choices, and choiceSelected actions', async () => {
    const { context } = loadRuntime();
    const layer = mountLayer(context, config());
    assert.equal(layer.hasInkContent(), true);
    assert.deepEqual({ ...layer.bindInk('source') }, { handled: true, ok: true });
    assert.deepEqual({ ...layer.startInk() }, { handled: true, ok: true });

    const lines = layer.nodes.get('lines');
    const choices = layer.nodes.get('choices');
    assert.deepEqual(lines.children.map(node => node.textContent), ['SYSTEM READY', 'nominal']);
    assert.equal(lines.children[0].classList.contains('overlay-tag-heading'), true);
    assert.equal(lines.children[1].classList.contains('overlay-tag-success'), true);
    assert.equal(choices.children.length, 1);
    assert.equal(choices.children[0].tagName, 'BUTTON');
    assert.equal(choices.children[0].dataset.controlPreset, 'terminal-command');

    layer.setView('details');
    await choices.children[0].listeners.click[0]({ stopPropagation() {} });
    assert.equal(layer.activeView, 'overview');
    assert.deepEqual(lines.children.map(node => node.textContent), ['INSPECTED']);
    assert.equal(lines.children[0].classList.contains('overlay-tag-warning'), true);

    assert.deepEqual({ ...layer.openInk('sysinfo') }, { handled: true, ok: true });
    assert.deepEqual(lines.children.map(node => node.textContent), ['OPEN sysinfo']);
    const missing = layer.openInk('missing');
    assert.equal(missing.handled, true);
    assert.equal(missing.ok, false, 'missing knot reports failure without throwing');
});
