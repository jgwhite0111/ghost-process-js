// Quick standalone dither smoke test — runs the runtime dither against
// scene_intro_v5.png and writes the result so we can eyeball it before
// hitting reload in the browser.
//
// Usage: uv run --with pillow node tools/test_dither.js
//
// Actually we're just node here — use `uv run` with the right script.
// Easier: just use the canvas.js logic directly via a small node harness.

// We need to shim `window` since canvas.js references it. Load the file
// via a vm and run with a fake window.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal DOM-ish shim
const fakeWindow = {
    PALETTES: {},
    Runtime: null,
    console,
    Image: class { /* unused */ },
    document: {
        createElement: () => ({
            getContext: () => ({
                fillStyle: '',
                fillRect: () => {},
                drawImage: () => {},
                getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
                putImageData: () => {},
            }),
            width: 0,
            height: 0,
        }),
    },
};

// `window` needs to be a global of the vm context
vm.createContext(fakeWindow);
fakeWindow.window = fakeWindow;

// Load all palette files first
const palettesDir = path.join(__dirname, '..', 'assets', 'palettes');
for (const f of fs.readdirSync(palettesDir).sort()) {
    const code = fs.readFileSync(path.join(palettesDir, f), 'utf8');
    vm.runInNewContext(code, fakeWindow);
}
console.log('palettes registered:', Object.keys(fakeWindow.PALETTES).join(', '));

// Load canvas.js — it uses `window.X = ...` so fakeWindow picks it up
const canvasJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'canvas.js'), 'utf8');
vm.runInNewContext(canvasJs, fakeWindow);

const R = fakeWindow.Runtime;
console.log('Runtime has resolvePalette:', typeof R.resolvePalette);
console.log('Runtime has ditherImageData:', typeof R.ditherImageData);
console.log('alley palette length:', R.resolvePalette('alley').length);
console.log('terminal_lab palette is alias of lab_clinic:',
    R.resolvePalette('terminal_lab') === R.resolvePalette('lab_clinic'));
console.log('Bayer 8x8 matrix length:', R.BAYER_8.length);

// Make a synthetic 64x64 ImageData and run the dither, verify all pixels
// snap to a palette colour.
const W = 64, H = 64;
const buf = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
    // Gradient + small noise
    buf[i*4 + 0] = (i % W) * 4;       // r
    buf[i*4 + 1] = ((i / W) | 0) * 7; // g
    buf[i*4 + 2] = 128;               // b
    buf[i*4 + 3] = 255;               // a
}
const palette = R.resolvePalette('alley');
const t0 = Date.now();
R.ditherImageData({ data: buf, width: W, height: H }, palette, 1.0);
console.log(`dithered ${W}x${H} in ${Date.now() - t0}ms`);

// Verify all pixels snapped to a palette entry
const paletteSet = new Set(palette.map(c => (c[0] | c[1]<<8 | c[2]<<16)));
let snapCount = 0, offCount = 0;
const u32 = new Uint32Array(buf.buffer);
for (let i = 0; i < u32.length; i++) {
    const px = u32[i] & 0x00ffffff;
    if (paletteSet.has(px)) snapCount++;
    else offCount++;
}
console.log(`pixel snap: ${snapCount}/${u32.length} (${offCount} off-palette)`);
console.log(`pass: ${offCount === 0 ? 'YES' : 'NO'}`);