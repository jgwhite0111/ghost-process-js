// Render scene_intro_v5.png through the runtime dither and write the
// dithered result to /tmp/scene_intro_v5_dithered.png so we can eyeball
// it before the user reloads the browser.
//
// Usage: node tools/dither_preview.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// We don't have a real DOM Image/canvas in node, so we hand-build the
// ImageData from PNG-decoded raw RGB pixels. Easiest path: use a node
// PNG library. Since we already use pillow via uv, do this:
//   - Decode the PNG with a pure-JS lib (pngjs) or shell out.
// Simpler: shell out to Python (already installed via uv) to convert
// the PNG to raw RGBA bytes, run the dither logic on those bytes, then
// hand the result back to Python for re-encoding.
//
// Actually, even simpler: we already have the dither logic in
// canvas.js. Just call it on raw bytes we pass in directly. The Python
// side can decode/encode PNG; the JS side does the dither math.

const { spawnSync } = require('child_process');

// 1. Decode PNG to raw RGBA via Python+Pillow
const root = path.join(__dirname, '..');
const srcPng = path.join(root, 'assets', 'backgrounds', 'scene_intro_v5.png');
const rawIn = '/tmp/v5_in.raw';
const rawOut = '/tmp/v5_out.raw';
const dstPng = '/tmp/scene_intro_v5_dithered.png';

const pyDecode = `
from PIL import Image
import sys
img = Image.open("${srcPng}").convert("RGBA")
print(img.size[0], img.size[1], file=sys.stderr)
open("${rawIn}", "wb").write(img.tobytes())
`;

const dec = spawnSync('python3', ['-c', pyDecode], { encoding: 'utf8' });
if (dec.status !== 0) {
    console.error('python decode failed:', dec.stderr, 'status=', dec.status);
    process.exit(1);
}
const [W, H] = dec.stderr.trim().split(/\s+/).map(Number);
console.log(`decoded ${srcPng} -> ${W}x${H} RGBA`);

// 2. Load the raw RGBA bytes
const rawBytes = fs.readFileSync(rawIn);
console.log(`raw bytes: ${rawBytes.length} (expected ${W*H*4})`);
if (rawBytes.length !== W * H * 4) {
    console.error('byte count mismatch');
    process.exit(1);
}

// 3. Set up vm with the canvas.js dither
const fakeWindow = { PALETTES: {}, console };
vm.createContext(fakeWindow);
fakeWindow.window = fakeWindow;

const palettesDir = path.join(root, 'assets', 'palettes');
for (const f of fs.readdirSync(palettesDir).sort()) {
    vm.runInNewContext(fs.readFileSync(path.join(palettesDir, f), 'utf8'), fakeWindow);
}
vm.runInNewContext(
    fs.readFileSync(path.join(root, 'src', 'runtime', 'canvas.js'), 'utf8'),
    fakeWindow);

const R = fakeWindow.Runtime;
const palette = R.resolvePalette('alley');

// 4. Run dither on the raw bytes via a typed Uint8ClampedArray view.
// Node Buffer is the same backing as Uint8Array, but ImageData wants
// Uint8ClampedArray. Wrap a copy.
const clamped = new Uint8ClampedArray(rawBytes);
const imageData = { data: clamped, width: W, height: H };
const t0 = Date.now();
R.ditherImageData(imageData, palette, 1.0);
console.log(`dithered ${W}x${H} in ${Date.now() - t0}ms`);

// 5. Write dithered RGBA back out
fs.writeFileSync(rawOut, Buffer.from(imageData.data));

// 6. Re-encode via Python
const pyEncode = `
from PIL import Image
img = Image.frombytes("RGBA", (${W}, ${H}), open("${rawOut}", "rb").read())
img.save("${dstPng}")
print("wrote ${dstPng}", "${W}x${H}", "size=", len(open("${dstPng}", "rb").read()))
`;
const enc = spawnSync('python3', ['-c', pyEncode], { encoding: 'utf8' });
console.log(enc.stdout.trim(), enc.stderr.trim());

// 7. Verify all pixels snapped to a palette entry
let offPalette = 0;
const paletteSet = new Set(palette.map(c => c[0] | c[1]<<8 | c[2]<<16));
const u32 = new Uint32Array(imageData.data.buffer);
for (let i = 0; i < u32.length; i++) {
    const px = u32[i] & 0x00ffffff;
    if (!paletteSet.has(px)) offPalette++;
}
console.log(`off-palette pixels: ${offPalette} / ${u32.length} (${(offPalette/u32.length*100).toFixed(2)}%)`);