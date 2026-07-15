// Per-scene preview snapshot for the editor music player.
//
// Regression test for: "playlist updates with the tracks for the
// selected scene, but still shows the track highlighted as playing
// with its play button in the playing state, when it is actually
// not that track playing".
//
// Audio playback stays global (one soundscape), but the inspector's
// row highlight + play/pause icon must reflect the preview owned by
// the scene the inspector is currently mounted for, never another
// scene's running preview.

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
            chase: {
                id: 'chase',
                bg: null,
                music: [{ file: 'chase_a.mp3' }, { file: 'chase_b.mp3' }],
                characters: [],
                hitboxes: [],
                tasks: [],
            },
            intro: {
                id: 'intro',
                bg: null,
                music: 'intro_theme.mp3',
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
                    ? ['alley_a.mp3', 'alley_b.mp3', 'chase_a.mp3', 'chase_b.mp3', 'intro_theme.mp3']
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
        `main().catch(err =>`,
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

function switchToScene(env, sceneId) {
    env.run(`switchScene(${JSON.stringify(sceneId)})`);
}

function lastMedleyList(env) {
    return env.createdElements.filter((el) => el.className === 'medley-list').at(-1);
}

// The exact bug from the user's report: play a tune in scene
// A, switch to scene B, confirm scene B's inspector does NOT
// light up any row as playing. Both medleys have the same row
// count, so without per-scene state row 1 (file == A_b.mp3)
// would falsely paint row 1 (B_b.mp3) as playing.
test('switching scenes after a preview does not falsely highlight rows in the new scene', async () => {
    const env = await loadEditor();
    // Switch to chase first so switching to alley is a real change.
    switchToScene(env, 'chase');
    await settle();
    // Start a preview of chase_b.mp3 by clicking chase's row 2 play button.
    let list = lastMedleyList(env);
    let row1 = list.children[1];
    assert.equal(row1.children[1].value, 'chase_b.mp3');
    row1.children[5].onclick();
    await settle();
    // Sanity: chase's row 1 IS playing.
    list = lastMedleyList(env);
    row1 = list.children[1];
    assert.equal(row1.children[1].value, 'chase_b.mp3');
    assert.equal(row1.classList.values.has('playing'), true,
        'chase row 1 should be playing while audio is owned by chase');

    // Switch to alley — alley has the same row count (2) so without
    // per-scene state, row 1 (alley_b.mp3, a DIFFERENT file) would
    // falsely paint as playing.
    switchToScene(env, 'alley');
    await settle();
    list = lastMedleyList(env);
    assert.equal(env.run('state.sceneId'), 'alley');
    const alleyRow0 = list.children[0];
    const alleyRow1 = list.children[1];
    assert.equal(alleyRow0.children[1].value, 'alley_a.mp3');
    assert.equal(alleyRow1.children[1].value, 'alley_b.mp3');
    assert.equal(alleyRow0.classList.values.has('playing'), false,
        'alley row 0 must NOT be highlighted as playing — audio belongs to chase, not alley');
    assert.equal(alleyRow1.classList.values.has('playing'), false,
        'alley row 1 must NOT be highlighted as playing — different scene, different file');

    // The inspector for alley should also report idle progress.
    const alleySnapshot = env.run('QueuePlayer._snapshotForScene("alley")');
    assert.equal(alleySnapshot.mode, 'idle',
        'alley inspector should render an idle snapshot, not the chase-owned preview');

    // But chase's stored snapshot is preserved — switching back
    // to chase should still show row 1 as playing.
    switchToScene(env, 'chase');
    await settle();
    list = lastMedleyList(env);
    const chaseRow1 = list.children[1];
    assert.equal(chaseRow1.children[1].value, 'chase_b.mp3');
    assert.equal(chaseRow1.classList.values.has('playing'), true,
        'switching back to chase should restore its row 1 highlight');
});

// Pressing Stop while the active preview belongs to scene A
// from scene B's inspector wipes both: that's the expected
// behaviour for the explicit Stop button (audio is global).
// This guards against accidentally tying Stop to sceneB
// instead of the global state.
test('Stop button while inspecting another scene clears the active preview', async () => {
    const env = await loadEditor();
    // Start a preview of alley_a.mp3 (owned by alley).
    env.run('QueuePlayer.toggleOne("assets/audio/alley_a.mp3", { medleyIndex: 0, sceneId: "alley" })');
    await settle();
    assert.equal(env.run('QueuePlayer._state().mode'), 'one');
    assert.equal(env.run('QueuePlayer._state().file'), 'alley_a.mp3');

    // Switch to chase. Stop button is the global stop — it
    // should clear the active preview regardless of which
    // inspector is mounted.
    switchToScene(env, 'chase');
    await settle();
    const stopBtn = env.createdElements
        .filter((el) => el.tagName === 'BUTTON' && el.textContent === '⏹ Stop')
        .at(-1);
    assert.ok(stopBtn, 'chase inspector must own a Stop button');
    stopBtn.onclick();
    await settle();
    assert.equal(env.run('QueuePlayer._state().mode'), 'idle',
        'explicit Stop from any inspector clears the global preview');
});

// Single-mode (non-medley) preview stored per scene — intro
// uses a single-track shape. Switching away and back must
// restore the single-track play button as Pause/I-play.
test('single-track preview state survives scene navigation', async () => {
    const env = await loadEditor();
    // intro is single-track. Switch to intro, click single-track Play.
    switchToScene(env, 'intro');
    await settle();
    // Sanity: switchScene actually moved us to intro.
    assert.equal(env.run('state.sceneId'), 'intro');

    // The single-track Play button has own text exactly "▶ Play".
    // Use direct _textContent lookup (FakeElement getter concatenates
    // children; we want only the button's own text).
    const startCount = env.createdElements.length;
    const singlePlayBtn = env.createdElements
        .filter((el) => el.tagName === 'BUTTON' && el._textContent === '▶ Play')
        .find((el) => env.createdElements.indexOf(el) >= startCount - 30);
    assert.ok(singlePlayBtn, 'intro inspector must own a single-track play button');
    singlePlayBtn.onclick();
    await settle();
    assert.equal(env.run('QueuePlayer._state().mode'), 'one',
        'click on single-track Play should start a "one" preview');
    assert.equal(env.run('QueuePlayer._state().file'), 'intro_theme.mp3');

    // Navigate away to chase, back to intro, and confirm the
    // single-track play button still shows as playing (the Pause
    // label) rather than reset to idle.
    switchToScene(env, 'chase');
    await settle();
    switchToScene(env, 'intro');
    await settle();

    // The most recently created ▶ Play / Ⅱ Pause button belongs
    // to the re-mounted intro inspector.
    const persistedBtn = env.createdElements
        .filter((el) => el.tagName === 'BUTTON' && /^(▶ Play|Ⅱ Pause)$/.test(el._textContent || ''))
        .at(-1);
    assert.ok(persistedBtn, 'intro inspector must re-mount its single-track play button');
    assert.equal(persistedBtn._textContent, 'Ⅱ Pause',
        'returning to intro must restore the single-track pause label');
});

// Subscriptions are disposed when the inspector rerenders for
// another scene, but if the global preview belongs to the same
// scene as before, the new mount re-registers and immediately
// receives the live snapshot for that scene.
test('mounting inspector for the scene that owns the preview gets the live snapshot immediately', async () => {
    const env = await loadEditor();
    switchToScene(env, 'chase');
    await settle();
    let list = lastMedleyList(env);
    let row1 = list.children[1];
    row1.children[5].onclick(); // start chase_b.mp3
    await settle();

    // Force a rerender (e.g., user toggled a checkbox on the
    // scene, no scene switch). The new inspector for chase
    // must still light row 1 as playing.
    env.run('renderRight()');
    await settle();
    list = lastMedleyList(env);
    row1 = list.children[1];
    assert.equal(row1.children[1].value, 'chase_b.mp3');
    assert.equal(row1.classList.values.has('playing'), true);
});
