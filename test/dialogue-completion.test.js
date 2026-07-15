const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const inkjs = require('inkjs/full');

const ROOT = path.resolve(__dirname, '..');

function makeClock() {
    let nextId = 1;
    const timeouts = new Map();
    const intervals = new Map();

    return {
        setTimeout(fn) {
            const id = nextId++;
            timeouts.set(id, fn);
            return id;
        },
        clearTimeout(id) {
            timeouts.delete(id);
        },
        setInterval(fn) {
            const id = nextId++;
            intervals.set(id, fn);
            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        runIntervalsToIdle() {
            let ticks = 0;
            while (intervals.size > 0) {
                for (const [id, fn] of [...intervals]) {
                    if (intervals.has(id)) fn();
                }
                ticks += 1;
                assert.ok(ticks < 1000, 'typewriter interval did not settle');
            }
        },
        runTimeoutsToIdle() {
            let ticks = 0;
            while (timeouts.size > 0) {
                const pending = [...timeouts.entries()];
                timeouts.clear();
                for (const [, fn] of pending) fn();
                ticks += 1;
                assert.ok(ticks < 1000, 'completion timeout did not settle');
            }
        },
        pendingTimeouts() {
            return timeouts.size;
        },
    };
}

function loadDialogueRunner() {
    const clock = makeClock();
    const window = {
        STATE: { inventory: [], consumed: [] },
        STORY: { next: {} },
    };
    const context = vm.createContext({
        window,
        console,
        inkjs,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'src/dialogue.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return { DialogueRunner: window.DialogueRunner, clock };
}

function finishNaturally(clock) {
    clock.runIntervalsToIdle();
    clock.runTimeoutsToIdle();
}

test('natural final-line typing completes once and notifies every listener', () => {
    const { DialogueRunner, clock } = loadDialogueRunner();
    let callbackCount = 0;
    let listenerCount = 0;
    const runner = new DialogueRunner('Final line.\n-> END', {
        onComplete: () => { callbackCount += 1; },
    });
    runner.onComplete(() => { listenerCount += 1; });

    runner.start();
    assert.equal(callbackCount, 0);
    assert.equal(clock.pendingTimeouts(), 1);

    finishNaturally(clock);

    assert.equal(callbackCount, 1);
    assert.equal(listenerCount, 1);
});

test('snap-finishing the final line cancels delayed duplicate completion', () => {
    const { DialogueRunner, clock } = loadDialogueRunner();
    let completions = 0;
    const runner = new DialogueRunner('Final line.\n-> END', {
        onComplete: () => { completions += 1; },
    });

    runner.start();
    assert.equal(clock.pendingTimeouts(), 1);
    runner.advance();

    assert.equal(completions, 1);
    assert.equal(clock.pendingTimeouts(), 0);
    clock.runTimeoutsToIdle();
    assert.equal(completions, 1);
});

test('extra advances after exhaustion do not repeat completion', () => {
    const { DialogueRunner, clock } = loadDialogueRunner();
    let completions = 0;
    const runner = new DialogueRunner('Final line.\n-> END', {
        onComplete: () => { completions += 1; },
    });

    runner.start();
    finishNaturally(clock);
    runner.advance();
    runner.advance();

    assert.equal(completions, 1);
});

test('a redirected Ink path with a new line can complete once again', () => {
    const { DialogueRunner, clock } = loadDialogueRunner();
    let completions = 0;
    const runner = new DialogueRunner(`Opening beat.
-> END

=== Later ===
Redirected beat.
-> END`, {
        onComplete: () => { completions += 1; },
    });

    runner.start();
    finishNaturally(clock);
    assert.equal(completions, 1);

    runner.story.ChoosePathString('Later');
    runner.step();
    finishNaturally(clock);
    runner.advance();

    assert.equal(completions, 2);
});
