const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadScene() {
    const sceneConfig = {
        kind: 'title',
        characters: [{ id: 'android', scenes: { alley: {} } }],
    };
    const window = {
        STORY: { scenes: { alley: sceneConfig } },
        Runtime: {},
        CharacterSprite: class {
            constructor(character, sceneId) {
                this.character = character;
                this.sceneId = sceneId;
            }
        },
        HitboxLayer: class {
            destroy() {}
        },
        dispatchEvent() {},
    };
    const context = vm.createContext({
        window,
        console,
        CustomEvent: class {},
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
    });
    context.globalThis = context;

    const filename = path.join(ROOT, 'src/runtime/scene-base.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return window.Scene;
}

function makeCanvas() {
    return {
        parentElement: { clientWidth: 640, clientHeight: 480 },
        style: {},
        width: 0,
        height: 0,
        getContext: () => ({}),
        addEventListener() {},
        removeEventListener() {},
    };
}

test('cached scene releases per-start characters before every revisit', async () => {
    const Scene = loadScene();
    const scene = new Scene('alley');
    const canvas = makeCanvas();
    const charactersSeen = new Set();

    for (let visit = 1; visit <= 3; visit += 1) {
        await scene.start({ canvas, sceneId: 'alley' });
        assert.equal(
            scene.characters.length,
            1,
            `visit ${visit} has exactly one character`,
        );
        assert.equal(
            charactersSeen.has(scene.characters[0]),
            false,
            `visit ${visit} uses fresh per-start state`,
        );
        charactersSeen.add(scene.characters[0]);

        scene.shutdown();
        assert.equal(
            scene.characters.length,
            0,
            `shutdown ${visit} releases per-start characters`,
        );
    }
});
