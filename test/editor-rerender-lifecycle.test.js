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
    getContext() { return { fillRect() {}, clearRect() {}, drawImage() {} }; }
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
    return {
        scenes: {
            alley: {
                id: 'alley',
                bg: null,
                music: [{ file: 'alley_a.mp3' }, { file: 'alley_b.mp3' }],
                characters: [],
                hitboxes: [],
                tasks: [],
            },
        },
        items: {},
    };
}

async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

async function loadEditor() {
    const ids = [
        'bg-canvas', 'overlay', 'canvas-frame', 'right', 'left', 'center',
        'scene-list', 'item-list', 'scene-name', 'status', 'add-scene-btn',
        'add-item-btn', 'save-btn', 'reload-btn', 'viewport-size', 'custom-fields',
        'vw', 'vh', 'tool-select', 'tool-draw-hitbox', 'tool-add-sprite', 'tool-banner',
    ];
    const elements = Object.fromEntries(ids.map((id) => [
        id,
        new FakeElement(id === 'bg-canvas' ? 'canvas' : 'div', id),
    ]));
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
    const requests = [];
    const context = vm.createContext({
        window: { addEventListener() {} },
        document,
        console,
        fetch: async (url) => {
            requests.push(url);
            return {
                ok: true,
                json: async () => url.startsWith('/api/list')
                    ? ['alley_a.mp3', 'alley_b.mp3']
                    : makeStory(),
            };
        },
        Image: class {},
        Audio: class {
            constructor(src) { this.src = src; }
            play() { return Promise.resolve(); }
            pause() {}
        },
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
    const source = fs.readFileSync(filename, 'utf8').replace(
        'main().catch(err =>',
        `const __originalOnStatus = QueuePlayer.onStatus;
let __activeQueueListeners = 0;
QueuePlayer.onStatus = (fn) => {
  __activeQueueListeners += 1;
  const unsubscribe = __originalOnStatus(fn);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    __activeQueueListeners -= 1;
    unsubscribe();
  };
};
main().catch(err =>`,
    );
    vm.runInContext(source, context, { filename });
    await settle();
    return {
        requests,
        run(expression) { return vm.runInContext(expression, context); },
    };
}

test('repeated inspector renders retain one QueuePlayer listener and one request per directory', async () => {
    const env = await loadEditor();
    assert.equal(env.run('__activeQueueListeners'), 1, 'initial inspector owns one listener');

    for (let i = 0; i < 8; i += 1) env.run('renderRight()');
    await settle();

    assert.equal(env.run('__activeQueueListeners'), 1, 'only the latest music editor remains subscribed');
    for (const directory of ['assets/backgrounds', 'assets/palettes', 'assets/audio']) {
        const encoded = encodeURIComponent(directory);
        assert.equal(
            env.requests.filter((url) => url === `/api/list?dir=${encoded}`).length,
            1,
            `${directory} is listed only once across rerenders`,
        );
    }

    env.run('QueuePlayer.playOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    assert.equal(env.run('QueuePlayer._state().file'), 'alley_a.mp3');
});

test('listDir deduplicates concurrent requests', async () => {
    const env = await loadEditor();
    await env.run('Promise.all([listDir("assets/items"), listDir("assets/items"), listDir("assets/items")])');
    assert.equal(
        env.requests.filter((url) => url === '/api/list?dir=assets%2Fitems').length,
        1,
    );
});
