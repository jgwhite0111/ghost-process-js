const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class FakeClassList {
    constructor(element) {
        this.element = element;
    }

    add(...names) {
        names.forEach((name) => this.element._classes.add(name));
    }

    remove(...names) {
        names.forEach((name) => this.element._classes.delete(name));
    }

    contains(name) {
        return this.element._classes.has(name);
    }

    toggle(name, force) {
        const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
        if (shouldAdd) this.add(name);
        else this.remove(name);
        return shouldAdd;
    }
}

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this._classes = new Set();
        this.classList = new FakeClassList(this);
        this._textContent = '';
        this._innerHTML = '';
        this.id = '';
    }

    set className(value) {
        this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    }

    get className() {
        return [...this._classes].join(' ');
    }

    set textContent(value) {
        this._textContent = String(value);
        this._innerHTML = '';
        for (const child of this.children) child.parentElement = null;
        this.children = [];
    }

    get textContent() {
        return this._textContent + this.children.map((child) => child.textContent).join('');
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this._textContent = '';
        for (const child of this.children) child.parentElement = null;
        this.children = [];

        const elementPattern = /<(span|button)\s+([^>]*)>([^<]*)<\/\1>/g;
        let match;
        while ((match = elementPattern.exec(this._innerHTML))) {
            const child = new FakeElement(match[1]);
            const attributePattern = /([\w-]+)="([^"]*)"/g;
            let attribute;
            while ((attribute = attributePattern.exec(match[2]))) {
                if (attribute[1] === 'class') child.className = attribute[2];
                else child.setAttribute(attribute[1], attribute[2]);
            }
            child.textContent = match[3];
            this.appendChild(child);
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    get parentNode() {
        return this.parentElement;
    }

    appendChild(child) {
        if (child.parentElement) {
            const oldIndex = child.parentElement.children.indexOf(child);
            if (oldIndex !== -1) child.parentElement.children.splice(oldIndex, 1);
        }
        this.children.push(child);
        child.parentElement = this;
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
        child.parentElement = null;
        return child;
    }

    remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }

    dispatch(type, event = {}) {
        event.type = type;
        event.target ||= this;
        event.stopPropagation ||= () => {};
        event.preventDefault ||= () => {};
        for (const listener of this.listeners.get(type) || []) listener(event);
    }

    click() {
        this.dispatch('click');
    }

    matches(selector) {
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        return this.tagName === selector.toUpperCase();
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = (element) => {
            for (const child of element.children) {
                if (child.matches(selector)) matches.push(child);
                visit(child);
            }
        };
        visit(this);
        return matches;
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 30 };
    }
}

function loadInventory() {
    const body = new FakeElement('body');
    const documentListeners = new Map();
    const document = {
        body,
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        addEventListener(type, listener) {
            if (!documentListeners.has(type)) documentListeners.set(type, new Set());
            documentListeners.get(type).add(listener);
        },
        listenerCount(type) {
            return documentListeners.get(type)?.size || 0;
        },
    };
    const acquired = [];
    const window = {
        STATE: { inventory: [], consumed: [] },
        STORY: {
            items: {
                first: {
                    id: 'first',
                    name: 'First <Item>',
                    description: 'First description <unsafe>',
                    icon: 'first.png',
                },
                second: {
                    id: 'second',
                    name: 'Second Item',
                    description: 'Second description',
                    icon: 'second.png',
                },
            },
        },
        TaskTracker: {
            onItemAcquired(itemId) {
                acquired.push(itemId);
            },
        },
    };
    const context = vm.createContext({
        window,
        document,
        console,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'src/inventory.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return { inventory: window.Inventory, window, document, body, acquired };
}

function assertOneShell(env, backdrop) {
    assert.equal(env.body.querySelectorAll('.inventory-backdrop').length, 1);
    assert.equal(backdrop.querySelectorAll('.inventory-popup').length, 1);
    assert.equal(backdrop.querySelectorAll('.inventory-popup-header').length, 1);
    assert.equal(backdrop.querySelectorAll('.inv-close').length, 1);
    assert.equal(backdrop.listenerCount('click'), 1, 'current backdrop has one close listener');
    assert.equal(backdrop.querySelector('.inv-close').listenerCount('click'), 1,
        'current close button has one listener');
    assert.equal(env.document.listenerCount('keydown'), 1, 'global Escape listener is not duplicated');
}

function selectedItemId(backdrop) {
    return backdrop.querySelectorAll('.inventory-item')
        .find((slot) => slot.classList.contains('is-selected'))?.dataset.itemId;
}

test('open inventory popup refreshes contents in place across add, remove, and refresh', () => {
    const env = loadInventory();
    env.inventory.unlockForGameplay();
    const button = env.body.querySelector('#inventory-button');
    assert.ok(button);
    assert.equal(button.listenerCount('click'), 1);

    button.click();
    const backdrop = env.inventory.popup;
    const modal = backdrop.querySelector('.inventory-popup');
    const header = backdrop.querySelector('.inventory-popup-header');
    const closeButton = backdrop.querySelector('.inv-close');
    const list = backdrop.querySelector('.inventory-list');
    const description = backdrop.querySelector('.inventory-description');
    assert.equal(list.querySelector('.inventory-empty').textContent, '— nothing collected —');
    assert.equal(description.querySelector('.inventory-empty-desc').textContent,
        'Pick up items by clicking them in the scene.');
    assertOneShell(env, backdrop);

    env.inventory.add('first');
    assert.equal(env.inventory.popup, backdrop, 'add preserves backdrop identity');
    assert.equal(backdrop.querySelector('.inventory-popup'), modal, 'add preserves modal identity');
    assert.equal(backdrop.querySelector('.inventory-popup-header'), header, 'add preserves header identity');
    assert.equal(backdrop.querySelector('.inv-close'), closeButton, 'add preserves close button identity');
    assert.equal(backdrop.querySelector('.inventory-list'), list, 'add refreshes existing list contents');
    assert.equal(backdrop.querySelector('.inventory-description'), description,
        'add refreshes existing description contents');
    assert.equal(list.querySelectorAll('.inventory-item').length, 1);
    assert.equal(selectedItemId(backdrop), 'first');
    assert.equal(description.querySelector('.inventory-desc-name').textContent, 'First <Item>');
    assert.equal(description.querySelector('.inventory-desc-body').textContent,
        'First description <unsafe>');
    assert.equal(description.querySelectorAll('script').length, 0, 'item data remains plain text');
    assert.equal(button.querySelector('.inv-count').textContent, '1');
    assertOneShell(env, backdrop);

    env.inventory.add('second');
    assert.equal(env.inventory.popup, backdrop, 'second add preserves backdrop identity');
    assert.equal(list.querySelectorAll('.inventory-item').length, 2);
    assert.equal(selectedItemId(backdrop), 'first', 'existing selection survives add');
    assert.equal(description.querySelector('.inventory-desc-name').textContent, 'First <Item>');
    assert.equal(button.querySelector('.inv-count').textContent, '2');
    assert.deepEqual(env.acquired, ['first', 'second']);
    assertOneShell(env, backdrop);

    list.querySelectorAll('.inventory-item').find((slot) => slot.dataset.itemId === 'second').click();
    assert.equal(selectedItemId(backdrop), 'second');
    assert.equal(description.querySelector('.inventory-desc-name').textContent, 'Second Item');

    env.inventory.remove('second');
    assert.equal(env.inventory.popup, backdrop, 'remove preserves backdrop identity');
    assert.equal(selectedItemId(backdrop), 'first', 'removing selection falls back to first valid item');
    assert.equal(description.querySelector('.inventory-desc-name').textContent, 'First <Item>');
    assert.equal(button.querySelector('.inv-count').textContent, '1');
    assert.deepEqual(env.window.STATE.consumed, ['second']);
    assertOneShell(env, backdrop);

    env.inventory.remove('first');
    assert.equal(env.inventory.popup, backdrop, 'last remove preserves backdrop identity');
    assert.equal(list.querySelectorAll('.inventory-item').length, 0);
    assert.equal(list.querySelector('.inventory-empty').textContent, '— nothing collected —');
    assert.equal(description.querySelector('.inventory-empty-desc').textContent,
        'Pick up items by clicking them in the scene.');
    assert.equal(env.inventory._lastFocusedItem, null, 'empty inventory clears stale selection');
    assert.equal(button.querySelector('.inv-count').textContent, '0');
    assertOneShell(env, backdrop);

    env.window.STATE.inventory.push('second');
    env.inventory.refresh();
    assert.equal(env.inventory.popup, backdrop, 'refresh preserves backdrop identity');
    assert.equal(selectedItemId(backdrop), 'second');
    assert.equal(description.querySelector('.inventory-desc-name').textContent, 'Second Item');
    assert.equal(button.querySelector('.inv-count').textContent, '1');
    assertOneShell(env, backdrop);

    closeButton.click();
    assert.equal(env.inventory.popup, null);
    assert.equal(env.body.querySelectorAll('.inventory-backdrop').length, 0);

    button.click();
    const reopenedBackdrop = env.inventory.popup;
    assert.notEqual(reopenedBackdrop, backdrop, 'reopen creates a fresh shell only after close');
    assert.equal(selectedItemId(reopenedBackdrop), 'second');
    assertOneShell(env, reopenedBackdrop);
});
