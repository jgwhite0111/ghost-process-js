const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClassList {
    add() {}
    remove() {}
    toggle() {}
}

class FakeElement {
    constructor(tagName = 'div', id = '', document = null) {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.ownerDocument = document;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.classList = new FakeClassList();
        this.className = '';
        this.value = '';
        this._innerHTML = '';
        this._textContent = '';
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    addEventListener() {}
    removeEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getContext() { return { fillRect() {}, clearRect() {}, drawImage() {} }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
        this._textContent = '';
        for (const match of this._innerHTML.matchAll(/\bid=["']([^"']+)["']/g)) {
            this.ownerDocument?._registerInjectedId(match[1]);
        }
    }
    get innerHTML() { return this._innerHTML; }
    set textContent(value) { this._textContent = String(value); }
    get textContent() {
        return this._textContent + this.children.map((child) => child.textContent).join('');
    }
}

function response(status, body = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        statusText: status === 401 ? 'Unauthorized' : '',
        json: async () => body,
    };
}

function loadEditor({ promptValues = [], withSessionStorage = false } = {}) {
    const ids = [
        'bg-canvas', 'overlay', 'canvas-frame', 'right', 'left', 'center',
        'scene-list', 'item-list', 'scene-name', 'status', 'add-scene-btn',
        'add-item-btn', 'save-btn', 'reload-btn', 'viewport-size', 'custom-fields',
        'vw', 'vh', 'tool-select', 'tool-draw-hitbox', 'tool-add-sprite', 'tool-banner',
    ];
    const elements = new Map();
    const injectedIds = new Set();
    const document = {
        querySelector(selector) {
            const match = /^#([A-Za-z0-9_-]+)$/.exec(selector);
            return match ? elements.get(match[1]) || null : null;
        },
        querySelectorAll() { return []; },
        getElementById(id) {
            if (injectedIds.has(id) && !elements.has(id)) return { id, injected: true };
            return elements.get(id) || null;
        },
        createElement(tagName) { return new FakeElement(tagName, '', document); },
        _registerInjectedId(id) { injectedIds.add(id); },
    };
    for (const id of ids) {
        elements.set(id, new FakeElement(id === 'bg-canvas' ? 'canvas' : 'div', id, document));
    }
    elements.get('viewport-size').value = '1280x720';

    const alerts = [];
    const fetchCalls = [];
    const mutationResponses = [];
    let promptCalls = 0;
    const storage = new Map();
    const contextObject = {
        window: { addEventListener() {} },
        document,
        console,
        fetch: async (url, options = {}) => {
            if (!options.method) return new Promise(() => {}); // suspend main() after definitions
            fetchCalls.push({ url, options });
            return mutationResponses.shift() || response(500, { error: 'missing test response' });
        },
        Image: class {},
        Audio: class {},
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        confirm: () => true,
        prompt: () => {
            promptCalls += 1;
            return promptValues.length ? promptValues.shift() : null;
        },
        alert: (message) => alerts.push(message),
    };
    if (withSessionStorage) {
        contextObject.sessionStorage = {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
        };
    }
    const context = vm.createContext(contextObject);
    context.globalThis = context;
    const filename = path.join(ROOT, 'editor.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

    return {
        alerts,
        document,
        elements,
        fetchCalls,
        mutationResponses,
        storage,
        get promptCalls() { return promptCalls; },
        run(expression) { return vm.runInContext(expression, context); },
    };
}

test('malicious scene id is rendered as literal heading text without creating an injected element', () => {
    const env = loadEditor();
    const maliciousId = '<img id="pwned" src=x onerror=alert(1)>';
    env.run(`state.story = { scenes: {}, items: {} }; state.sceneId = ${JSON.stringify(maliciousId)}; renderRight();`);

    const right = env.elements.get('right');
    assert.equal(right.children[0].children[0].tagName, 'H2');
    assert.equal(right.children[0].children[0].textContent, `Scene — ${maliciousId}`);
    assert.equal(env.document.getElementById('pwned'), null);
});

test('add-scene handler rejects ids outside the canonical lower-snake rule', () => {
    const invalidIds = ['BadScene', 'bad-scene', 'bad scene', '_bad_scene', '9scene', '<img id="pwned">'];
    const env = loadEditor({ promptValues: [...invalidIds] });
    env.run('state.story = { scenes: {}, items: {} };');

    for (const invalidId of invalidIds) {
        env.run('document.getElementById("add-scene-btn").onclick()');
        assert.equal(env.run(`Object.prototype.hasOwnProperty.call(state.story.scenes, ${JSON.stringify(invalidId)})`), false);
    }
    assert.equal(env.alerts.length, invalidIds.length);
    assert.match(env.alerts[0], /\^\[a-z\]\[a-z0-9_\]\*\$/);
});

test('saveStory sends an existing session token without prompting', async () => {
    const token = 'existing-editor-token-456';
    const env = loadEditor({ withSessionStorage: true });
    env.storage.set('ghost-process-editor-token', token);
    env.run('state.story = { start: "intro", scenes: {} };');
    env.mutationResponses.push(response(200, { ok: true }));

    assert.equal(await env.run('saveStory()'), true);
    assert.equal(env.promptCalls, 0);
    assert.equal(env.fetchCalls.length, 1);
    assert.equal(env.fetchCalls[0].options.headers['X-Editor-Token'], token);
});

test('saveStory prompts after 401, stores the token in sessionStorage, and retries with it', async () => {
    const token = 'correct-editor-token-123';
    const env = loadEditor({ promptValues: [token], withSessionStorage: true });
    env.run('state.story = { start: "intro", scenes: {} };');
    env.mutationResponses.push(response(401, { error: 'Missing or invalid editor token' }), response(200, { ok: true }));

    assert.equal(await env.run('saveStory()'), true);
    assert.equal(env.promptCalls, 1);
    assert.equal(env.fetchCalls.length, 2);
    assert.equal(env.fetchCalls[0].options.headers['X-Editor-Token'], undefined);
    assert.equal(env.fetchCalls[1].options.headers['X-Editor-Token'], token);
    assert.equal(env.storage.get('ghost-process-editor-token'), token);
});

test('saveStory retries only once after 401 and does not prompt again for the retry failure', async () => {
    const token = 'correct-editor-token-123';
    const env = loadEditor({ promptValues: [token], withSessionStorage: true });
    env.run('state.story = { start: "intro", scenes: {} };');
    env.mutationResponses.push(
        response(401, { error: 'Missing or invalid editor token' }),
        response(401, { error: 'Missing or invalid editor token' }),
        response(200, { ok: true }),
    );

    assert.equal(await env.run('saveStory()'), false);
    assert.equal(env.promptCalls, 1);
    assert.equal(env.fetchCalls.length, 2);
    assert.equal(env.fetchCalls[1].options.headers['X-Editor-Token'], token);
});

test('cancelling the token prompt returns the original 401 without retrying', async () => {
    const env = loadEditor({ promptValues: [null] });
    const original = response(401, { error: 'Missing or invalid editor token' });
    env.mutationResponses.push(original);

    const returned = await env.run('mutationFetch("/api/story", { method: "PUT", headers: {} })');
    assert.strictEqual(returned, original);
    assert.equal(env.promptCalls, 1);
    assert.equal(env.fetchCalls.length, 1);
});
