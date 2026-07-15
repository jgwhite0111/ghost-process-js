const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_TASK_TYPES = [
    'pickup',
    'use_item',
    'goto_hitbox',
    'goto_dialog',
    'custom',
];

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
        this.placeholder = '';
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
    return {
        scenes: {
            alley: {
                id: 'alley',
                characters: [],
                hitboxes: [],
                tasks: [],
            },
        },
        items: {},
    };
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
    const context = vm.createContext({
        window: { addEventListener() {} },
        document,
        console,
        fetch: async (url) => ({
            ok: true,
            json: async () => url.startsWith('/api/list') ? [] : makeStory(),
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
        makeTaskRow(task) {
            context.__task = task;
            return vm.runInContext('makeTaskRow(__task, 0, [__task], () => {})', context);
        },
    };
}

function descendants(element) {
    return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function findInput(row, placeholder) {
    return descendants(row).find((el) => el.tagName === 'INPUT' && el.placeholder === placeholder);
}

function typeSelect(row) {
    return row.children[0].children[0];
}

function loadRuntimeTaskTracker(task) {
    const window = { STATE: { inventory: [], consumed: [] } };
    const context = vm.createContext({ window, console });
    context.globalThis = context;
    const filename = path.join(ROOT, 'src/tasks.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    const tracker = window.TaskTracker;
    tracker.bind('alley', task ? [task] : []);
    return tracker;
}

function runRuntimeTask(task, trigger) {
    const tracker = loadRuntimeTaskTracker(task);
    trigger(tracker);
    return tracker.completed.has(task.id);
}

test('task type choices exactly match the runtime schema', async () => {
    const env = await loadEditor();
    const row = env.makeTaskRow({ id: 'task', type: 'pickup', hint: 'hint' });

    assert.deepEqual(
        typeSelect(row).children.map((option) => option.value),
        RUNTIME_TASK_TYPES,
    );
});

test('goto_dialog authors ink_node', async () => {
    const env = await loadEditor();
    const task = { id: 'dialog', type: 'goto_dialog', hint: 'Continue' };
    const row = env.makeTaskRow(task);
    const input = findInput(row, 'Ink knot name (# goto:...)');

    assert.ok(input, 'goto_dialog exposes its runtime ink_node field');
    input.value = 'DoorUnlocked';
    input.oninput();
    assert.equal(task.ink_node, 'DoorUnlocked');
    assert.equal(runRuntimeTask(task, (tracker) => tracker.onInkNodeReached('DoorUnlocked')), true);
});

test('every editor-supported task shape completes through the actual runtime path', async () => {
    const env = await loadEditor();
    const cases = [
        {
            type: 'pickup',
            placeholder: 'item id to pick up',
            field: 'item',
            value: 'rusty_key',
            trigger: (tracker) => tracker.onItemAcquired('rusty_key'),
        },
        {
            type: 'use_item',
            placeholder: 'item id to use',
            field: 'item',
            value: 'rusty_key',
            trigger: (tracker) => tracker.onHitboxClicked({ item_required: 'rusty_key' }),
        },
        {
            type: 'goto_hitbox',
            placeholder: 'hitbox target scene id',
            field: 'target',
            value: 'corridor',
            trigger: (tracker) => tracker.onHitboxClicked({ target: 'corridor' }),
        },
        {
            type: 'goto_dialog',
            placeholder: 'Ink knot name (# goto:...)',
            field: 'ink_node',
            value: 'DoorUnlocked',
            trigger: (tracker) => tracker.onInkNodeReached('DoorUnlocked'),
        },
        {
            type: 'custom',
            trigger: (tracker) => tracker.complete('task_custom'),
        },
    ];

    for (const taskCase of cases) {
        const task = { id: `task_${taskCase.type}`, type: taskCase.type, hint: 'hint' };
        const row = env.makeTaskRow(task);
        if (taskCase.placeholder) {
            const input = findInput(row, taskCase.placeholder);
            assert.ok(input, `${taskCase.type} exposes ${taskCase.field}`);
            input.value = taskCase.value;
            input.oninput();
            assert.equal(task[taskCase.field], taskCase.value);
        }
        assert.equal(
            runRuntimeTask(task, taskCase.trigger),
            true,
            `${taskCase.type} editor output completes through TaskTracker`,
        );
    }
});

test('actual TaskTracker exposes no item-combination API', () => {
    const tracker = loadRuntimeTaskTracker({
        id: 'legacy_combine',
        type: 'combine',
        items: ['rusty_key', 'scrap_metal'],
        result: 'tinkered_key',
    });

    assert.equal(tracker.onItemsCombined, undefined);
    assert.equal(tracker.completed.has('legacy_combine'), false);
});

test('use_item cannot author unsupported on_hitbox', async () => {
    const env = await loadEditor();
    const task = { id: 'use', type: 'use_item', hint: 'Use it' };
    const row = env.makeTaskRow(task);
    const itemInput = findInput(row, 'item id to use');
    const placeholders = descendants(row)
        .filter((el) => el.tagName === 'INPUT')
        .map((input) => input.placeholder);

    assert.ok(itemInput);
    assert.equal(placeholders.includes('hitbox label / target'), false);
    assert.equal(placeholders.includes('on_hitbox'), false);
    itemInput.value = 'rusty_key';
    itemInput.oninput();
    assert.equal(runRuntimeTask(task, (tracker) => tracker.onHitboxClicked({ item_required: 'rusty_key' })), true);
});

test('type changes remove orphaned task fields while preserving id and hint', async () => {
    const env = await loadEditor();
    const expectedFields = {
        pickup: ['item'],
        use_item: ['item'],
        goto_hitbox: ['target'],
        goto_dialog: ['ink_node'],
        custom: [],
    };

    for (const [type, specificFields] of Object.entries(expectedFields)) {
        const task = {
            id: `to_${type}`,
            type: 'trigger_dialog',
            hint: 'Keep this hint',
            item: 'rusty_key',
            items: ['rusty_key', 'scrap_metal'],
            result: 'tinkered_key',
            target: 'corridor',
            ink_node: 'LegacyNode',
            on_hitbox: 'legacy-door',
        };
        const row = env.makeTaskRow(task);
        const select = typeSelect(row);
        select.value = type;
        select.onchange();

        assert.equal(task.id, `to_${type}`);
        assert.equal(task.type, type);
        assert.equal(task.hint, 'Keep this hint');
        assert.deepEqual(
            Object.keys(task).sort(),
            ['id', 'type', 'hint', ...specificFields].sort(),
            `${type} retains only its runtime fields`,
        );
        assert.equal('on_hitbox' in task, false, `${type} removes legacy on_hitbox`);
        assert.equal('items' in task, false, `${type} removes legacy combination items`);
        assert.equal('result' in task, false, `${type} removes legacy combination result`);
    }
});
