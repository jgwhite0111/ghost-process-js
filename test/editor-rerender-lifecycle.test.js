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

function makeAudio(src) {
    return {
        src,
        paused: true,
        currentTime: 0,
        duration: 120,
        playCalls: 0,
        pauseCalls: 0,
        play() {
            this.playCalls += 1;
            this.paused = false;
            this.onplay?.();
            return Promise.resolve();
        },
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
            this.onpause?.();
        },
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

    const createdElements = [];
    const document = {
        querySelector(selector) {
            if (selector.startsWith('#') && !selector.includes(' ')) return elements[selector.slice(1)] || null;
            return null;
        },
        querySelectorAll() { return []; },
        getElementById(id) { return elements[id] || null; },
        createElement(tagName) {
            const element = new FakeElement(tagName);
            createdElements.push(element);
            return element;
        },
    };
    const requests = [];
    const audioInstances = [];
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
            constructor(src) {
                Object.assign(this, makeAudio(src));
                audioInstances.push(this);
            }
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
        audioInstances,
        elements,
        createdElements,
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

test('individual music preview toggles pause/resume and seeks current audio', async () => {
    const env = await loadEditor();
    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    await settle();
    assert.equal(env.audioInstances.at(-1).paused, false);
    assert.equal(env.run('QueuePlayer._state().paused'), false);

    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    assert.equal(env.audioInstances.at(-1).paused, true);
    assert.equal(env.run('QueuePlayer._state().paused'), true);

    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    env.run('QueuePlayer.seek(37.5)');
    assert.equal(env.audioInstances.at(-1).currentTime, 37.5);
    assert.equal(env.run('QueuePlayer._state().currentTime'), 37.5);
});

test('paused row state survives inspector rerender and structural edits stop it', async () => {
    const env = await loadEditor();
    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0 })');
    env.run('renderRight()');
    await settle();

    const list = env.createdElements.filter((el) => el.className === 'medley-list').at(-1);
    const firstRow = list.children[0];
    assert.equal(firstRow.classList.values.has('playing'), true);
    assert.equal(firstRow.children[5].textContent, '▶');

    firstRow.children[5].onclick();
    firstRow.children[4].onclick();
    assert.equal(env.run('QueuePlayer._state().mode'), 'idle');
});

test('listDir deduplicates concurrent requests', async () => {
    const env = await loadEditor();
    await env.run('Promise.all([listDir("assets/items"), listDir("assets/items"), listDir("assets/items")])');
    assert.equal(
        env.requests.filter((url) => url === '/api/list?dir=assets%2Fitems').length,
        1,
    );
});
