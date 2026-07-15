const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    toggle(name, force) {
        const add = force === undefined ? !this.values.has(name) : force;
        if (add) this.values.add(name);
        else this.values.delete(name);
        return add;
    }
    contains(name) { return this.values.has(name); }
}

class FakeElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.classList = new FakeClassList();
        this.className = '';
        this.clientWidth = 1400;
        this.clientHeight = 900;
        this.value = '';
        this.checked = false;
        this._innerHTML = '';
        this._textContent = '';
        this.listeners = new Map();
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    remove() {}
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type, fn) {
        if (this.listeners.get(type) === fn) this.listeners.delete(type);
    }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
    closest() { return null; }
    querySelector(selector) {
        if (selector === 'button') return this._find((el) => el.tagName === 'BUTTON');
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            return this._find((el) => el.className.split(/\s+/).includes(className));
        }
        return null;
    }
    querySelectorAll() { return []; }
    _find(predicate) {
        for (const child of this.children) {
            if (predicate(child)) return child;
            const nested = child._find?.(predicate);
            if (nested) return nested;
        }
        return null;
    }
    getContext() {
        return {
            fillStyle: '#000',
            fillRect() {},
            clearRect() {},
            drawImage() {},
        };
    }
    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
        this._textContent = '';
        if (this._innerHTML.includes('<button')) this.appendChild(new FakeElement('button'));
    }
    get innerHTML() { return this._innerHTML; }
    set textContent(value) { this._textContent = String(value); }
    get textContent() {
        return this._textContent + this._innerHTML + this.children.map((child) => child.textContent).join('');
    }
}

function makeStory() {
    const sprite = {
        id: 'android',
        speaker: 'ANDROID',
        placementX: 0.25,
        placementY: 0.9,
        targetH: 0.8,
        scenes: { alley: {} },
    };
    const hitbox = { x: 0.1, y: 0.2, w: 0.3, h: 0.4, item: 'rusty_key', label: 'key' };
    const item = { id: 'rusty_key', name: 'Rusty Key' };
    return {
        story: {
            scenes: {
                alley: { id: 'alley', characters: [sprite], hitboxes: [hitbox], tasks: [] },
                corridor: { id: 'corridor', characters: [], hitboxes: [], tasks: [] },
            },
            items: { rusty_key: item },
        },
        sprite,
        hitbox,
        item,
    };
}

async function loadEditor(initialStory) {
    const ids = [
        'bg-canvas', 'overlay', 'canvas-frame', 'right', 'left', 'center',
        'scene-list', 'item-list', 'scene-name', 'status', 'add-scene-btn',
        'add-item-btn', 'save-btn', 'reload-btn', 'viewport-size', 'custom-fields',
        'vw', 'vh', 'tool-select', 'tool-draw-hitbox', 'tool-add-sprite', 'tool-banner',
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === 'bg-canvas' ? 'canvas' : 'div', id)]));
    elements['viewport-size'].value = '1280x720';

    const document = {
        querySelector(selector) {
            if (selector.startsWith('#') && !selector.includes(' ')) return elements[selector.slice(1)] || null;
            return null;
        },
        querySelectorAll() { return []; },
        getElementById(id) { return elements[id] || null; },
        createElement(tagName) { return new FakeElement(tagName); },
    };
    const storyRef = { current: initialStory };
    const window = { addEventListener() {} };
    const context = vm.createContext({
        window,
        document,
        console,
        fetch: async (url) => ({
            ok: true,
            json: async () => url.startsWith('/api/list') ? [] : storyRef.current,
        }),
        Image: class {},
        Audio: class {},
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        confirm: () => true,
        prompt: () => null,
        alert() {},
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'editor.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    return {
        context,
        elements,
        storyRef,
        state: vm.runInContext('state', context),
        run(expression) { return vm.runInContext(expression, context); },
    };
}

function makeDrag(targetKind, ref) {
    const handle = new FakeElement('div');
    const move = targetKind === 'sprite' ? 'onSpriteDragMove' : 'onHitboxDragMove';
    const end = targetKind === 'sprite' ? 'onSpriteDragEnd' : 'onHitboxDragEnd';
    return { targetKind, ref, handle, move, end };
}

test('scene changes clear sprite/hitbox selection and active drag without touching old objects', async () => {
    for (const kind of ['sprite', 'hitbox']) {
        const fixture = makeStory();
        const env = await loadEditor(fixture.story);
        const ref = fixture[kind];
        const before = structuredClone(ref);
        const drag = makeDrag(kind, ref);
        env.state.selected = { kind, ref };
        env.state.drag = drag;

        assert.equal(env.run('switchScene("corridor", { render: false })'), true);
        assert.equal(env.state.sceneId, 'corridor');
        assert.equal(env.state.selected, null);
        assert.equal(env.state.drag, null);
        assert.deepEqual(ref, before);

        env.state.selected = { kind, ref };
        env.run('renderRight()');
        assert.equal(env.state.selected, null, 'inspector rejects an old-scene exact reference');
        assert.equal(env.elements.right.textContent.includes(kind === 'sprite' ? 'Sprite —' : 'Hitbox —'), false);
        assert.deepEqual(ref, before, 'rendering the new inspector cannot mutate the old object');
    }
});

test('invalid and same-scene switches preserve valid current selection', async () => {
    const fixture = makeStory();
    const env = await loadEditor(fixture.story);
    const selection = { kind: 'sprite', ref: fixture.sprite };
    env.state.selected = selection;

    assert.equal(env.run('switchScene("missing", { render: false })'), false);
    assert.equal(env.state.sceneId, 'alley');
    assert.equal(env.state.selected, selection);

    assert.equal(env.run('switchScene("alley", { render: false })'), true);
    assert.equal(env.state.selected, selection);
    env.run('renderRight()');
    assert.equal(env.state.selected, selection, 'same-scene inspector rerender preserves the exact member ref');
});

test('inspector and reload reject refs outside the current story by exact identity', async () => {
    const fixture = makeStory();
    const env = await loadEditor(fixture.story);

    env.state.selected = { kind: 'sprite', ref: { ...fixture.sprite } };
    env.run('renderRight()');
    assert.equal(env.state.selected, null, 'lookalike sprite is not accepted by id/value');

    env.state.selected = { kind: 'item', ref: fixture.item };
    env.run('renderRight()');
    assert.equal(env.state.selected.ref, fixture.item, 'exact item ref remains valid');

    const replacement = makeStory();
    env.storyRef.current = replacement.story;
    env.state.selected = { kind: 'item', ref: fixture.item };
    env.state.drag = makeDrag('hitbox', fixture.hitbox);
    await env.run('loadStory()');

    assert.equal(env.state.story, replacement.story);
    assert.equal(env.state.selected, null);
    assert.equal(env.state.drag, null);
    env.run('renderRight()');
    assert.equal(env.elements.right.textContent.includes('Item —'), false);
});
