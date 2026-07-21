const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const editorHtml = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
const liveStory = JSON.parse(fs.readFileSync(path.join(ROOT, 'story.json'), 'utf8'));

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
        this.disabled = false;
        this._innerHTML = '';
        this._textContent = '';
        this.listeners = new Map();
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        }
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type, fn) {
        if (this.listeners.get(type) === fn) this.listeners.delete(type);
    }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
    closest() { return null; }
    hasClass(name) {
        return this.classList.contains(name) || this.className.split(/\s+/).includes(name);
    }
    querySelector(selector) {
        if (selector === 'button') return this.find((el) => el.tagName === 'BUTTON');
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            return this.find((el) => el.hasClass(className));
        }
        const syncMatch = selector.match(/^input\[data-sync="([^"]+)"\]$/);
        if (syncMatch) {
            return this.find((el) => el.tagName === 'INPUT' && el.dataset.sync === syncMatch[1]);
        }
        return null;
    }
    querySelectorAll(selector) {
        const matches = [];
        if (selector.startsWith('.')) {
            const classNames = selector.split(',').map((part) => part.trim().slice(1).split('.')[0]);
            this.walk((el) => {
                if (classNames.some((name) => el.hasClass(name))) matches.push(el);
            });
        }
        return matches;
    }
    find(predicate) {
        for (const child of this.children) {
            if (predicate(child)) return child;
            const nested = child.find?.(predicate);
            if (nested) return nested;
        }
        return null;
    }
    walk(visitor) {
        for (const child of this.children) {
            visitor(child);
            child.walk?.(visitor);
        }
    }
    getContext() {
        return {
            fillStyle: '#000',
            imageSmoothingEnabled: false,
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

function makeStory(hitboxes) {
    return {
        scenes: {
            source: {
                id: 'source',
                kind: 'ink',
                bg: null,
                music: null,
                ink: 'ink/source.ink',
                characters: [],
                hitboxes,
                tasks: [],
            },
            destination: {
                id: 'destination', kind: 'ink', bg: null, music: null,
                ink: 'ink/destination.ink', characters: [], hitboxes: [], tasks: [],
            },
        },
        items: { rusty_key: { id: 'rusty_key', name: 'Rusty Key' } },
    };
}

async function settle() {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function loadEditor(initialStory, inkSource = '=== Start ===\n=== FoundKey ===\n') {
    const ids = [
        'bg-canvas', 'overlay', 'canvas-frame', 'right', 'left', 'center',
        'scene-list', 'item-list', 'scene-name', 'status', 'add-scene-btn',
        'add-item-btn', 'save-btn', 'reload-btn', 'viewport-size', 'custom-fields',
        'vw', 'vh', 'tool-select', 'tool-draw-hitbox', 'tool-add-sprite', 'tool-banner',
        'tool-exploration-banner', 'add-hitbox-btn',
    ];
    const elements = Object.fromEntries(ids.map((id) => [
        id,
        new FakeElement(id === 'bg-canvas' ? 'canvas' : 'div', id),
    ]));
    elements['viewport-size'].value = '1280x720';

    const findFieldControl = (selector) => {
        const match = selector.match(/^#right \.field\[data-key="([^"]+)"\] \.ctrl$/);
        if (!match) return null;
        const field = elements.right.find((el) => el.hasClass('field') && el.dataset.key === match[1]);
        return field?.find((el) => el.hasClass('ctrl')) || null;
    };
    const document = {
        querySelector(selector) {
            if (selector.startsWith('#') && !selector.includes(' ')) return elements[selector.slice(1)] || null;
            return findFieldControl(selector);
        },
        querySelectorAll() { return []; },
        getElementById(id) { return elements[id] || null; },
        createElement(tagName) { return new FakeElement(tagName); },
    };
    const window = { addEventListener() {} };
    const context = vm.createContext({
        window,
        document,
        console,
        fetch: async (url) => {
            if (url === '/api/story') return { ok: true, status: 200, json: async () => initialStory };
            if (url.startsWith('/api/list')) return { ok: true, status: 200, json: async () => [] };
            if (url.startsWith('/api/ink/')) return { ok: true, status: 200, text: async () => inkSource };
            throw new Error(`unexpected fetch: ${url}`);
        },
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
    await settle();

    return {
        elements,
        state: vm.runInContext('state', context),
        run(expression) { return vm.runInContext(expression, context); },
    };
}

function field(root, key) {
    return root.find((el) => el.hasClass('field') && el.dataset.key === key);
}

function control(root, key, tagName) {
    const owner = field(root, key);
    assert.ok(owner, `expected inspector field ${key}`);
    const found = owner.find((el) => el.tagName === tagName.toUpperCase());
    assert.ok(found, `expected ${tagName} in inspector field ${key}`);
    return found;
}

function optionValues(select) {
    return select.children.filter((child) => child.tagName === 'OPTION').map((option) => option.value);
}

test('live terminal Obelab hitboxes retain the two Phase 1 acceptance destinations', () => {
    const hitboxes = liveStory.scenes.terminal_obelab.hitboxes;
    const access = hitboxes.find((hb) => hb.label === 'Access terminal');
    const walk = hitboxes.find((hb) => hb.label === 'Walk away');
    assert.equal(access?.target, 'terminal_ui');
    assert.equal(walk?.target, 'exploration_demo');
});

test('hitbox inspector separates presentation from all legacy behavior controls', async () => {
    const hitbox = {
        x: 0.1, y: 0.2, w: 0.3, h: 0.4,
        label: 'Access terminal',
        item: 'rusty_key',
        target: 'destination',
        ink: 'FoundKey',
    };
    const env = await loadEditor(makeStory([hitbox]));
    env.state.selected = { kind: 'hitbox', ref: hitbox };
    env.run('renderRight()');
    await settle();

    const right = env.elements.right;
    assert.match(right.textContent, /Presentation/);
    assert.match(right.textContent, /Behavior/);
    assert.match(right.textContent, /Multiple legacy behaviors are populated \(item, target, ink\)/);

    const affordance = control(right, 'type', 'select');
    const item = control(right, 'item', 'select');
    const target = control(right, 'target', 'select');
    const ink = control(right, 'hitbox-ink', 'select');
    assert.deepEqual(optionValues(item), ['', 'rusty_key']);
    assert.deepEqual(optionValues(target), ['', 'source', 'destination']);
    assert.deepEqual(optionValues(ink), ['', 'Start', 'FoundKey']);

    affordance.value = 'button';
    affordance.onchange();
    assert.equal(hitbox.type, 'button');
    assert.equal(hitbox.item, 'rusty_key');
    assert.equal(hitbox.target, 'destination');
    assert.equal(hitbox.ink, 'FoundKey');
    await settle();

    assert.ok(field(right, 'item'), 'item remains visible for button presentation');
    assert.ok(field(right, 'target'), 'target remains visible for button presentation');
    assert.ok(field(right, 'hitbox-ink'), 'Ink remains visible for button presentation');
});

test('canvas labels summarize behavior and the target shortcut opens the destination', async () => {
    const hitboxes = [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.2, label: 'Access terminal', target: 'destination' },
        { x: 0.5, y: 0.2, w: 0.2, h: 0.2, label: 'Read note', ink: 'FoundKey' },
    ];
    const env = await loadEditor(makeStory(hitboxes));
    env.run('renderOverlay()');
    const labels = env.elements.overlay.children
        .map((handle) => handle.find((el) => el.hasClass('label'))?.textContent)
        .filter(Boolean);
    assert.deepEqual(labels, ['Access terminal → destination', 'Read note → Ink FoundKey']);

    env.state.selected = { kind: 'hitbox', ref: hitboxes[0] };
    env.run('renderRight()');
    await settle();
    const open = field(env.elements.right, 'target').find(
        (el) => el.tagName === 'BUTTON' && el.textContent === 'Open target scene'
    );
    assert.ok(open);
    assert.equal(open.disabled, false);
    open.onclick();
    assert.equal(env.state.sceneId, 'destination');
    assert.equal(env.state.selected, null);
});

test('missing scene, item, and Ink references remain visible as invalid dropdown values', async () => {
    const hitbox = {
        x: 0.1, y: 0.2, w: 0.3, h: 0.4,
        item: 'missing_item', target: 'missing_scene', ink: 'MissingKnot',
    };
    const env = await loadEditor(makeStory([hitbox]));
    env.state.selected = { kind: 'hitbox', ref: hitbox };
    env.run('renderRight()');
    await settle();

    for (const [key, value] of [
        ['item', 'missing_item'],
        ['target', 'missing_scene'],
        ['hitbox-ink', 'MissingKnot'],
    ]) {
        const select = control(env.elements.right, key, 'select');
        assert.equal(select.value, value);
        assert.equal(select.classList.contains('invalid-reference'), true);
        assert.match(select.textContent, /\[missing/);
    }
    assert.match(editorHtml, /select\.invalid-reference/);
    assert.match(editorHtml, /\.inspector-warning/);
});
