// Run the runtime dither against EVERY scene background and write a
// preview to /tmp/dithered/<name>.png so the user can see what each
// scene looks like once they reload the browser.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const bgDir = path.join(root, 'assets', 'backgrounds');
const outDir = '/tmp/dithered';
fs.mkdirSync(outDir, { recursive: true });

// Read story.json so we know which palettes to apply per scene
const story = JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8'));

// Setup vm with palettes + canvas.js
const fakeWindow = { PALETTES: {}, console };
vm.createContext(fakeWindow);
fakeWindow.window = fakeWindow;
for (const f of fs.readdirSync(path.join(root, 'assets', 'palettes')).sort()) {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', 'palettes', f), 'utf8'), fakeWindow);
}
vm.runInNewContext(
    fs.readFileSync(path.join(root, 'src', 'runtime', 'canvas.js'), 'utf8'),
    fakeWindow);
const R = fakeWindow.Runtime;

// Map each scene's bg file to its declared palette. The bg filename
// usually matches the scene id (scene_alley.png -> alley scene), but
// intro/cold_open both use scene_intro_v5.png now.
function paletteForBg(bgFile) {
    for (const scene of Object.values(story.scenes)) {
        if (scene.bg === bgFile.replace('.png', '')) {
            return R.resolvePalette(scene.bgPalette);
        }
    }
    return R.resolvePalette('alley'); // safe default
}

const files = fs.readdirSync(bgDir)
    .filter(f => f.endsWith('.png') && !f.includes('.prompt.'))
    .filter(f => !f.startsWith('scene_intro_v'))  // only the canonical scene_*.png
    .sort();

console.log(`dithering ${files.length} scene backgrounds…`);
for (const f of files) {
    const src = path.join(bgDir, f);
    const dst = path.join(outDir, f);
    const palette = paletteForBg(f);
    const t0 = Date.now();
    const pyDecode = `
from PIL import Image
import sys
img = Image.open("${src}").convert("RGBA")
print(img.size[0], img.size[1], file=sys.stderr)
open("/tmp/_in.raw", "wb").write(img.tobytes())`;
    const dec = spawnSync('python3', ['-c', pyDecode], { encoding: 'utf8' });
    if (dec.status !== 0) { console.error('decode failed:', f, dec.stderr); continue; }
    const [W, H] = dec.stderr.trim().split(/\s+/).map(Number);
    const rawBytes = fs.readFileSync('/tmp/_in.raw');
    const clamped = new Uint8ClampedArray(rawBytes);
    R.ditherImageData({ data: clamped, width: W, height: H }, palette, 1.0);
    fs.writeFileSync('/tmp/_out.raw', Buffer.from(clamped));
    const pyEnc = `
from PIL import Image
img = Image.frombytes("RGBA", (${W}, ${H}), open("/tmp/_out.raw", "rb").read())
img.save("${dst}")`;
    spawnSync('python3', ['-c', pyEnc]);
    const sz = fs.statSync(dst).size;
    console.log(`  ${f} (${W}x${H}) -> ${dst}  ${(sz/1024).toFixed(0)} KB  ${Date.now()-t0}ms`);
}
console.log('done');