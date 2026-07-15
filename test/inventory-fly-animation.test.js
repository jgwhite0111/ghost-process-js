// test/inventory-fly-animation.test.js
//
// Pins the "pickup flies to inventory" animation contract in src/inventory.js:
//   - addWithFly() spawns a .inv-fly <img> at the origin coords
//   - the icon's inline left/top/transform/opacity update over ~700ms
//   - the arc produces a visible peak above the line from origin to target
//   - when the animation finishes the icon is removed, the item lands in
//     STATE.inventory, the onComplete callback fires, and the popup list
//     shows the new item
//   - calling addWithFly for an item already in inventory is a no-op
//   - calling addWithFly with no INV button (pre-gameplay) falls back to
//     an instant add
//   - calling addWithFly for an unknown item id falls back to an instant
//     add so a misconfigured story item doesn't strand the player
//
// These guard against the .inv-fly CSS being removed again, the inline
// style fields being renamed, and the arc math regressing toward a flat
// line that doesn't visually communicate "going into inventory."

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// --- Minimal DOM mock ----------------------------------------------------
//
// Reused shape: a stack of FakeElement, FakeClassList, FakeDocument. Kept
// inline because the test only needs a tiny subset of what the popup test
// uses — appendChild, querySelector, className, style, getBoundingClientRect.

class FakeClassList {
    constructor(element) { this.element = element; this._set = new Set(); }
    add(...names) { names.forEach((n) => this._set.add(n)); }
    remove(...names) { names.forEach((n) => this._set.delete(n)); }
    contains(name) { return this._set.has(name); }
    toggle(name, force) {
        const shouldAdd = force === undefined ? !this._set.has(name) : Boolean(force);
        if (shouldAdd) this._set.add(name); else this._set.delete(name);
        return shouldAdd;
    }
}

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this._classes = new Set();
        this.classList = new FakeClassList(this);
        this.style = {};
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this._textContent = '';
        this._innerHTML = '';
        this.id = '';
    }
    set className(value) {
        this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
        // Keep classList's backing set in sync so classList.contains()
        // agrees with className after direct property assignment (the
        // pattern inventory.js uses when constructing the flying icon).
        this.classList._set = new Set(this._classes);
    }
    get className() { return [...this._classes].join(' '); }
    set textContent(value) { this._textContent = String(value); this.children = []; }
    get textContent() { return this._textContent; }
    set innerHTML(value) {
        this._innerHTML = String(value);
        this._textContent = '';
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        // Parse the limited subset that inventory.js emits: <span> and
        // <button> elements with simple attribute strings. Mirrors the
        // parser in inventory-popup-refresh.test.js — only the popup's
        // inventory header and INV-button markup goes through here.
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
    get innerHTML() { return this._innerHTML; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    // Reflect common HTML attributes as direct properties so code that
    // uses the .src / .alt / .id / .type idioms (e.g. img.src = url) is
    // captured in the same attributes bag as setAttribute(name, value).
    set src(value) { this.attributes.set('src', String(value)); }
    get src() { return this.attributes.get('src'); }
    set alt(value) { this.attributes.set('alt', String(value)); }
    get alt() { return this.attributes.get('alt'); }
    get parentNode() { return this.parentElement; }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    appendChild(child) {
        if (child.parentElement) {
            const i = child.parentElement.children.indexOf(child);
            if (i !== -1) child.parentElement.children.splice(i, 1);
        }
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    removeChild(child) {
        const i = this.children.indexOf(child);
        if (i !== -1) this.children.splice(i, 1);
        child.parentElement = null;
        return child;
    }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    matches(selector) {
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        return this.tagName === selector.toUpperCase();
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
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
        // The INV button sits top-right; tests use this for the target.
        return { left: 1000, top: 12, width: 80, height: 28 };
    }
}

// --- Inventory loader with a controllable rAF queue -----------------------
//
// We drain one frame at a time so the test can assert the arc's mid-flight
// style values without racing the runtime.

function loadInventoryWithRaf() {
    // A monotonic clock advances by 100ms each call so the animation's
    // `(now - start) / duration` math progresses normally across frames.
    // (Returning the same value every frame would make the first frame
    // already past t=1 and the icon would disappear instantly.)
    const rafQueue = [];
    let clockMs = 0;
    const nextNow = () => { clockMs += 100; return clockMs; };
    const body = new FakeElement('body');
    const document = {
        body,
        createElement: (tag) => new FakeElement(tag),
        addEventListener: () => {},
        listenerCount: () => 0,
    };
    const window = {
        STATE: { inventory: [], consumed: [] },
        STORY: {
            items: {
                rusty_key: {
                    id: 'rusty_key',
                    name: 'Rusty Key',
                    description: 'A rusted iron key.',
                    icon: 'assets/items/rusty_key.png',
                },
                battery: {
                    id: 'battery',
                    name: 'Battery',
                    description: 'A drained cell.',
                    icon: 'assets/items/battery.png',
                },
            },
        },
        TaskTracker: { onItemAcquired: () => {} },
    };
    const context = vm.createContext({
        window,
        document,
        console,
        performance: { now: nextNow },
        requestAnimationFrame: (cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        },
    });
    context.globalThis = context;
    const filename = path.join(ROOT, 'src/inventory.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return {
        inventory: window.Inventory,
        window,
        document,
        body,
        // Advance the vm-context clock by 100ms and return the new value.
        // Tests must call this when draining rAF frames so the animation's
        // `(now - start) / duration` math sees consistent timestamps.
        tickNow: () => context.performance.now(),
        drainFrames: (n) => {
            for (let i = 0; i < n && rafQueue.length > 0; i++) {
                const next = rafQueue.shift();
                next(context.performance.now());
            }
        },
    };
}

// --- Tests ---------------------------------------------------------------

test('addWithFly spawns a .inv-fly <img> at origin and animates toward the INV button', () => {
    const env = loadInventoryWithRaf();
    env.inventory.unlockForGameplay();
    const completeFired = [];
    env.inventory.addWithFly('rusty_key', 200, 300, 'rusty key', () => completeFired.push(true));

    // Mid-flight: one icon exists in the DOM, has .inv-fly class, and has
    // started animating.
    let flies = env.body.querySelectorAll('.inv-fly');
    assert.equal(flies.length, 1, 'a flying icon was spawned');
    const icon = flies[0];
    assert.equal(icon.tagName, 'IMG', 'spawned element is an <img>');
    assert.equal(icon.getAttribute('src'), 'assets/items/rusty_key.png',
        'spawned icon uses item.icon');
    assert.ok(!icon.parentElement || icon.parentElement === env.body,
        'spawned icon is appended to document.body');
    assert.equal(icon.style.left, '200px', 'spawned at origin X');
    assert.equal(icon.style.top, '300px', 'spawned at origin Y');
    assert.equal(icon.style.opacity, '1', 'starts at full opacity');
    assert.match(icon.style.transform, /scale\(1\)/, 'starts at scale 1');

    assert.equal(env.window.STATE.inventory.length, 0,
        'item is not yet committed to inventory');
    assert.equal(completeFired.length, 0, 'onComplete has not fired yet');

    // Drain enough frames to cover the full 1500ms duration. The loop
    // schedules one rAF per frame at performance.now() ticks of 100ms;
    // 18 frames covers 1500ms comfortably (18 * 100ms = 1800ms window).
    env.drainFrames(18);

    assert.equal(env.body.querySelectorAll('.inv-fly').length, 0,
        'icon was removed when animation finished');
    assert.deepEqual(env.window.STATE.inventory, ['rusty_key'],
        'item committed to inventory after animation');
    assert.equal(completeFired.length, 1, 'onComplete fired exactly once');
});

test('arc visibly peaks above the origin→target line on the way to the button', () => {
    const env = loadInventoryWithRaf();
    env.inventory.unlockForGameplay();
    env.inventory.addWithFly('battery', 200, 400, 'battery', () => {});

    // Drain one frame (~100ms in, t≈0.14). The arc term is
    //   sin(t*π) * arcHeight  subtracted from the linear y
    // so the icon should sit higher (smaller y) than the linear
    // interpolation between (200,400) and (1040,26) — i.e. visibly
    // arcing upward, not sliding in a straight line.
    env.drainFrames(1);
    const icon = env.body.querySelector('.inv-fly');
    assert.ok(icon, 'icon still present mid-flight');

    const x = parseFloat(icon.style.left);
    const y = parseFloat(icon.style.top);
    // Target center: left=1000, top=12, width=80/2=40, height=28/2=14
    //   → tx=1040, ty=26
    const tx = 1040, ty = 26;
    const tLinear = (x - 200) / (tx - 200); // x-progress
    // Linear y at this x-progress (no arc)
    const yLinear = 400 + (ty - 400) * tLinear;
    assert.ok(y < yLinear,
        `arc is above the linear path (got y=${y}, expected less than ${yLinear})`);
    // Scale should be > 1 early in the animation (0-50% phase).
    const scaleMatch = icon.style.transform.match(/scale\(([\d.]+)\)/);
    assert.ok(scaleMatch, 'transform contains a scale()');
    const scale = parseFloat(scaleMatch[1]);
    assert.ok(scale > 1.0, `early-phase scale grows before shrinking (got ${scale})`);

    // Drain to completion so we don't leak icons into other tests.
    env.drainFrames(15);
    assert.equal(env.body.querySelectorAll('.inv-fly').length, 0);
});

test('addWithFly on an already-owned item is a no-op (no animation, immediate onComplete)', () => {
    const env = loadInventoryWithRaf();
    env.inventory.unlockForGameplay();
    env.window.STATE.inventory.push('rusty_key');
    const completeFired = [];
    env.inventory.addWithFly('rusty_key', 200, 300, 'rusty key', () => completeFired.push(true));

    assert.equal(env.body.querySelectorAll('.inv-fly').length, 0,
        'no flying icon spawned for already-owned item');
    assert.equal(completeFired.length, 1,
        'onComplete fires immediately so callers can still chain work');
    assert.deepEqual(env.window.STATE.inventory, ['rusty_key'],
        'inventory unchanged');
});

test('addWithFly with no INV button (pre-gameplay) falls back to an instant add', () => {
    const env = loadInventoryWithRaf();
    // Deliberately skip unlockForGameplay() — the button is null.
    const completeFired = [];
    env.inventory.addWithFly('rusty_key', 200, 300, 'rusty key', () => completeFired.push(true));

    assert.equal(env.body.querySelectorAll('.inv-fly').length, 0,
        'no icon without a target button');
    assert.deepEqual(env.window.STATE.inventory, ['rusty_key'],
        'item was committed immediately');
    assert.equal(completeFired.length, 1);
});

test('addWithFly for an unknown item id falls back to an instant add (no stranded pickup)', () => {
    const env = loadInventoryWithRaf();
    env.inventory.unlockForGameplay();
    const completeFired = [];
    // 'not_in_story' is not in window.STORY.items — the runtime should
    // still commit so a misconfigured hitbox does not leave the player
    // clicking an item that disappears without feedback.
    env.inventory.addWithFly('not_in_story', 200, 300, 'mystery', () => completeFired.push(true));

    assert.equal(env.body.querySelectorAll('.inv-fly').length, 0,
        'unknown item id does not spawn an icon with no source');
    assert.deepEqual(env.window.STATE.inventory, ['not_in_story'],
        'item id is still recorded in STATE.inventory');
    assert.equal(completeFired.length, 1);
});

test('opening the inventory popup after a fly-to-inventory shows the newly picked-up icon', () => {
    const env = loadInventoryWithRaf();
    env.inventory.unlockForGameplay();

    env.inventory.addWithFly('rusty_key', 200, 300, 'rusty key', () => {});
    env.drainFrames(18);
    assert.deepEqual(env.window.STATE.inventory, ['rusty_key']);

    env.inventory._togglePopup();
    const list = env.inventory.popup.querySelector('.inventory-list');
    const slots = list.querySelectorAll('.inventory-item');
    assert.equal(slots.length, 1, 'popup list contains the new item');
    const slot = slots[0];
    assert.equal(slot.dataset.itemId, 'rusty_key');
    const img = slot.querySelector('img');
    assert.ok(img, 'popup slot has an <img>');
    assert.equal(img.getAttribute('src'), 'assets/items/rusty_key.png',
        'popup slot uses the same icon as the flying animation');
});
