const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function runBrowserScript(context, relativePath) {
    const filename = path.join(ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

function loadCanvasRuntime(document = {}) {
    const window = {};
    const context = vm.createContext({
        window,
        document,
        console,
        Image: class MockImage {},
        Audio: class MockAudio {},
        setTimeout,
        clearTimeout,
    });
    context.globalThis = context;
    runBrowserScript(context, 'src/runtime/canvas.js');
    return { context, window, Runtime: window.Runtime };
}

function processingDescriptor(overrides = {}) {
    const parameters = {
        palette: [[0, 0, 0], [255, 255, 255]],
        bgColor: [0, 0, 0],
        ditherStrength: 1,
        anchor: 'center',
        profile: 'default',
        ...(overrides.parameters || {}),
    };
    return {
        operation: 'background-dither',
        version: 1,
        width: 4,
        height: 3,
        ...overrides,
        parameters,
    };
}

test('processed canvas cache is deterministic, complete, retryable, and identity-safe', () => {
    const { Runtime } = loadCanvasRuntime();
    const sourceImage = { src: 'shared-source.png', width: 4, height: 3 };
    let factoryCalls = 0;
    const makeCanvas = () => ({
        id: ++factoryCalls,
        pixels: new Uint8Array([7, 11, 13, 17]),
    });

    const first = Runtime.getProcessedCanvas(
        sourceImage,
        processingDescriptor(),
        makeCanvas,
    );
    const firstPixels = Array.from(first.pixels);
    const equivalentWithDifferentKeyOrder = Runtime.getProcessedCanvas(
        { src: 'shared-source.png', width: 4, height: 3 },
        {
            height: 3,
            parameters: {
                profile: 'default',
                anchor: 'center',
                ditherStrength: 1,
                bgColor: [0, 0, 0],
                palette: [[0, 0, 0], [255, 255, 255]],
            },
            width: 4,
            version: 1,
            operation: 'background-dither',
        },
        makeCanvas,
    );

    assert.strictEqual(equivalentWithDifferentKeyOrder, first);
    assert.equal(factoryCalls, 1);
    assert.deepEqual(Array.from(equivalentWithDifferentKeyOrder.pixels), firstPixels);

    const misses = [
        [{ src: 'different-source.png' }, processingDescriptor()],
        [sourceImage, processingDescriptor({ width: 5 })],
        [sourceImage, processingDescriptor({ parameters: { ditherStrength: 0.5 } })],
        [sourceImage, processingDescriptor({ parameters: {
            palette: [[1, 0, 0], [255, 255, 255]],
        } })],
        [sourceImage, processingDescriptor({ parameters: { bgColor: [1, 0, 0] } })],
        [sourceImage, processingDescriptor({ parameters: { anchor: 'right' } })],
        [sourceImage, processingDescriptor({ parameters: { profile: 'android' } })],
        [sourceImage, processingDescriptor({ version: 2 })],
        [sourceImage, processingDescriptor({ operation: 'sprite-despill' })],
    ];
    for (const [image, descriptor] of misses) {
        assert.notStrictEqual(
            Runtime.getProcessedCanvas(image, descriptor, makeCanvas),
            first,
        );
    }
    assert.equal(factoryCalls, 1 + misses.length);

    const sourceLessA = { width: 4, height: 3 };
    const sourceLessB = { width: 4, height: 3 };
    const identityA = Runtime.getProcessedCanvas(
        sourceLessA,
        processingDescriptor(),
        makeCanvas,
    );
    assert.strictEqual(
        Runtime.getProcessedCanvas(sourceLessA, processingDescriptor(), makeCanvas),
        identityA,
    );
    assert.notStrictEqual(
        Runtime.getProcessedCanvas(sourceLessB, processingDescriptor(), makeCanvas),
        identityA,
    );

    let attempts = 0;
    assert.throws(() => Runtime.getProcessedCanvas(
        { src: 'retry-after-throw.png' },
        processingDescriptor(),
        () => {
            attempts += 1;
            throw new Error('processing failed');
        },
    ), /processing failed/);
    const retried = Runtime.getProcessedCanvas(
        { src: 'retry-after-throw.png' },
        processingDescriptor(),
        () => {
            attempts += 1;
            return { retried: true };
        },
    );
    assert.equal(attempts, 2);
    assert.equal(retried.retried, true);
});

function makePalette(first = [0, 0, 0], accent = [255, 255, 255]) {
    return Array.from({ length: 16 }, (_, index) => (
        index === 0 ? first.slice() : accent.slice()
    ));
}

test('Scene dither path shares equivalent outputs and misses on rendering changes', () => {
    let createdCanvases = 0;
    const warnings = [];
    const document = {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            createdCanvases += 1;
            return { width: 0, height: 0 };
        },
    };
    const { context, window, Runtime } = loadCanvasRuntime(document);
    const paletteA = makePalette();
    const paletteB = makePalette([0, 0, 0], [240, 240, 240]);
    window.PALETTES = { paletteA, paletteB };
    window.STORY = {
        scenes: {
            first: { bgPalette: 'paletteA' },
            equivalent: { bgPalette: 'paletteA' },
            weaker: { bgPalette: 'paletteA', bgDitherStrength: 0.5 },
            right: { bgPalette: 'paletteA', bgAnchor: 'right' },
            otherPalette: { bgPalette: 'paletteB' },
            failed: { bgPalette: 'paletteA' },
        },
    };
    context.console = { ...console, warn: (...args) => warnings.push(args) };
    runBrowserScript(context, 'src/runtime/scene-base.js');

    let ditherCalls = 0;
    Runtime.ditherImageToCanvas = (image, canvas, palette, options) => {
        ditherCalls += 1;
        canvas.result = new Uint8Array([
            image.width,
            image.height,
            Math.round(options.ditherStrength * 10),
            palette[1][0],
        ]);
        return canvas;
    };

    const sharedOne = { src: 'scene.png', width: 8, height: 6 };
    const sharedTwo = { src: 'scene.png', width: 8, height: 6 };
    const first = new window.Scene('first');
    first.bgImage = sharedOne;
    first._ditherBg();
    const firstPixels = Array.from(first._ditheredBg.result);

    const equivalent = new window.Scene('equivalent');
    equivalent.bgImage = sharedTwo;
    equivalent._ditherBg();
    assert.strictEqual(equivalent._ditheredBg, first._ditheredBg);
    assert.deepEqual(Array.from(equivalent._ditheredBg.result), firstPixels);
    assert.equal(ditherCalls, 1, 'equivalent second Scene skips dither processing');
    assert.equal(createdCanvases, 1);

    for (const [sceneId, image] of [
        ['weaker', sharedOne],
        ['right', sharedOne],
        ['otherPalette', sharedOne],
        ['first', { src: 'other-scene.png', width: 8, height: 6 }],
        ['first', { src: 'scene.png', width: 9, height: 6 }],
    ]) {
        const scene = new window.Scene(sceneId);
        scene.bgImage = image;
        scene._ditherBg();
        assert.notStrictEqual(scene._ditheredBg, first._ditheredBg);
    }
    assert.equal(ditherCalls, 6);
    assert.equal(createdCanvases, 6);

    const failed = new window.Scene('failed');
    failed.bgImage = { src: 'failed-scene.png', width: 8, height: 6 };
    const workingDither = Runtime.ditherImageToCanvas;
    Runtime.ditherImageToCanvas = () => {
        ditherCalls += 1;
        throw new Error('mock dither failure');
    };
    failed._ditherBg();
    assert.equal(failed._ditheredBg, null, 'raw-image fallback remains selected');
    Runtime.ditherImageToCanvas = workingDither;
    failed._ditherBg();
    assert.ok(failed._ditheredBg, 'failed factory is retried on the next call');
    assert.equal(warnings.length, 1);
});

function createPixelDocument(counters) {
    return {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            counters.canvases += 1;
            const canvas = { width: 0, height: 0, pixels: null };
            let drawnImage = null;
            const ctx = {
                drawImage(image) {
                    drawnImage = image;
                },
                getImageData(x, y, width, height) {
                    counters.getImageData += 1;
                    return {
                        width,
                        height,
                        data: new Uint8ClampedArray(drawnImage.pixels),
                    };
                },
                putImageData(imageData) {
                    canvas.pixels = new Uint8ClampedArray(imageData.data);
                },
            };
            canvas.getContext = () => ctx;
            return canvas;
        },
    };
}

function characterConfig(id) {
    return {
        id,
        scenes: {
            lab: { frames: 'assets/sprites/lab/frame_*.png' },
        },
    };
}

test('CharacterSprite instances share despilled frames within a profile and isolate Android', () => {
    const counters = { canvases: 0, getImageData: 0 };
    const { context, window, Runtime } = loadCanvasRuntime(createPixelDocument(counters));
    runBrowserScript(context, 'src/runtime/sprites.js');

    const url = 'assets/sprites/lab/frame_01.png';
    Runtime.assets.images[url] = {
        src: url,
        width: 3,
        height: 1,
        pixels: new Uint8ClampedArray([
            8, 100, 8, 128,
            30, 100, 20, 255,
            0, 0, 0, 0,
        ]),
    };

    const firstDefault = new window.CharacterSprite(characterConfig('thug'), 'lab');
    firstDefault.bindFrames([url]);
    const firstPixels = Array.from(firstDefault.frames[0].pixels);
    assert.deepEqual(firstPixels, [
        8, 100, 8, 0,
        30, 65, 20, 0,
        0, 0, 0, 0,
    ], 'default despill pixels retain the existing three-pass result');

    const secondDefault = new window.CharacterSprite(characterConfig('convict'), 'lab');
    secondDefault.bindFrames([url]);
    assert.strictEqual(secondDefault.frames[0], firstDefault.frames[0]);
    assert.deepEqual(Array.from(secondDefault.frames[0].pixels), firstPixels);
    assert.equal(counters.getImageData, 1, 'second default instance skips despill work');
    assert.equal(counters.canvases, 1);

    const firstAndroid = new window.CharacterSprite(characterConfig('android'), 'lab');
    firstAndroid.bindFrames([url]);
    assert.notStrictEqual(firstAndroid.frames[0], firstDefault.frames[0]);
    assert.deepEqual(Array.from(firstAndroid.frames[0].pixels), [
        8, 100, 8, 0,
        30, 65, 20, 255,
        0, 0, 0, 0,
    ], 'Android profile retains its pass-3 exemption');
    assert.equal(counters.getImageData, 2, 'Android uses a separate despill profile');
    assert.equal(counters.canvases, 2);

    const secondAndroid = new window.CharacterSprite(characterConfig('android'), 'lab');
    secondAndroid.bindFrames([url]);
    assert.strictEqual(secondAndroid.frames[0], firstAndroid.frames[0]);
    assert.equal(counters.getImageData, 2, 'second Android instance also skips work');
    assert.equal(counters.canvases, 2);
});
