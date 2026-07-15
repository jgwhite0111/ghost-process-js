const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function makeAudio(src) {
    return {
        src,
        paused: true,
        volume: 1,
        currentTime: 0,
        playCalls: 0,
        pauseCalls: 0,
        play() {
            this.playCalls += 1;
            this.paused = false;
            return Promise.resolve();
        },
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
        },
    };
}

function loadMusicHandler({ deferredLoads = false } = {}) {
    let now = 0;
    let nextTimerId = 1;
    const frames = [];
    const audios = new Map();
    const loads = new Map();

    function audioFor(src) {
        if (!audios.has(src)) audios.set(src, makeAudio(src));
        return audios.get(src);
    }

    const window = {
        Runtime: {
            loadAudio(src) {
                if (!deferredLoads) return Promise.resolve(audioFor(src));
                if (!loads.has(src)) loads.set(src, deferred());
                return loads.get(src).promise;
            },
            getCachedAudio: () => null,
        },
    };
    const document = {
        addEventListener() {},
        removeEventListener() {},
    };
    const context = vm.createContext({
        window,
        document,
        console,
        WeakMap,
        performance: { now: () => now },
        requestAnimationFrame(callback) {
            frames.push(callback);
            return frames.length;
        },
        setTimeout() { return nextTimerId++; },
        clearTimeout() {},
        isFinite,
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'src/runtime/music.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

    function advance(ms, step = 100) {
        const target = now + ms;
        while (now < target) {
            now = Math.min(target, now + step);
            const pending = frames.splice(0);
            for (const callback of pending) callback(now);
        }
    }

    return {
        handler: window.MusicHandler,
        audioFor,
        loads,
        advance,
    };
}

test('cold_open medley fade cannot be orphaned by the transition to alley', async () => {
    const env = loadMusicHandler();
    const coldA = env.audioFor('assets/audio/cold_open.mp3');
    const coldB = env.audioFor('assets/audio/cold_open_b.mp3');
    const alley = env.audioFor('assets/audio/alley_confrontation.mp3');

    await env.handler.play([
        { file: 'cold_open.mp3' },
        { file: 'cold_open_b.mp3', fadeAt: 51.1 },
    ], 0.7, 1200);
    env.advance(1200);

    await env.handler._crossfadeToNext();
    env.advance(1000);
    assert.equal(coldA.paused, false, 'first cold_open track is still in its medley fade');
    assert.equal(coldB.paused, false);

    await env.handler.play('alley_confrontation.mp3', 0.7, 1200);
    env.advance(4000);

    assert.equal(coldA.paused, true, 'older outgoing track reaches its pause callback');
    assert.equal(coldA.volume, 0);
    assert.equal(coldB.paused, true, 'newer outgoing track also reaches its pause callback');
    assert.equal(coldB.volume, 0);
    assert.equal(alley.paused, false);
    assert.equal(alley.volume, 0.7);
    assert.equal(env.handler.music, alley);
});

test('latest concurrent scene music request wins when audio loads resolve out of order', async () => {
    const env = loadMusicHandler({ deferredLoads: true });

    const coldPlay = env.handler.play('cold_open.mp3');
    const alleyPlay = env.handler.play('alley_confrontation.mp3');

    const alley = env.audioFor('assets/audio/alley_confrontation.mp3');
    env.loads.get('assets/audio/alley_confrontation.mp3').resolve(alley);
    await alleyPlay;

    const cold = env.audioFor('assets/audio/cold_open.mp3');
    env.loads.get('assets/audio/cold_open.mp3').resolve(cold);
    await coldPlay;
    env.advance(1200);

    assert.equal(env.handler.music, alley);
    assert.equal(alley.paused, false);
    assert.equal(alley.volume, 0.7);
    assert.equal(cold.playCalls, 0, 'stale loaded audio is never started');
    assert.equal(cold.paused, true);
});
