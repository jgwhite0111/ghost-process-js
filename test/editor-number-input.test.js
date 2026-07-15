const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.classList = { add() {}, remove() {}, toggle() {} };
        this._value = '';
    }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
    removeEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getContext() {
        return {
            fillRect() {},
            clearRect() {},
            drawImage() {},
        };
    }
}

function loadMakeNumberInput() {
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, new FakeElement(id === 'bg-canvas' ? 'canvas' : 'div'));
        return elements.get(id);
    };
    const document = {
        querySelector(selector) {
            const match = /^#([A-Za-z0-9_-]+)$/.exec(selector);
            return match ? getElement(match[1]) : null;
        },
        querySelectorAll() { return []; },
        getElementById: getElement,
        createElement(tagName) { return new FakeElement(tagName); },
    };
    const context = vm.createContext({
        window: { addEventListener() {} },
        document,
        console,
        // Keep editor startup suspended after all production functions have
        // been defined; this test only exercises makeNumberInput.
        fetch: () => new Promise(() => {}),
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

    return (model) => {
        context.__numericModel = model;
        return vm.runInContext(
            'makeNumberInput(__numericModel.value, value => { __numericModel.value = value; __numericModel.calls++; })',
            context,
        );
    };
}

test('actual editor makeNumberInput updates immediately only for finite numeric input', () => {
    const makeInput = loadMakeNumberInput();
    const model = { value: 7.5, calls: 0 };
    const input = makeInput(model);

    for (const [raw, expected] of [['-2.75', -2.75], ['0', 0], ['1e2', 100]]) {
        input.value = raw;
        input.oninput();
        assert.equal(model.value, expected, `${raw} updates the model`);
    }
    assert.equal(model.calls, 3);

    for (const raw of ['', '   ', 'not-a-number', '12oops', '1e', NaN, Infinity, -Infinity]) {
        const before = model.value;
        input.value = raw;
        input.oninput();
        assert.equal(model.value, before, `${String(raw)} preserves the model`);
    }
    assert.equal(model.calls, 3, 'invalid input never calls the model callback');
});
