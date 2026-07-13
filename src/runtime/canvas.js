// src/runtime/canvas.js — the canvas itself, plus an asset cache.
//
// Internal canvas resolution tracks the viewport (not a fixed 640x480
// backbuffer). Sprite coords land exactly where they're drawn — no CSS
// scaling gap, no letterbox bars on portrait mobile. The canvas uses
// `image-rendering: pixelated` so the dither stays crisp at any size.
//
// Asset preload is one big Promise.all of Image() objects keyed by
// filename. Each asset is loaded with an `src=` assignment + onload
// handler.

const INTERNAL_W = 640;
const INTERNAL_H = 480;

const assets = {
    images: {},      // filename -> HTMLImageElement (loaded)
    audio: {}        // filename -> { audio: HTMLAudioElement, decoded: Promise }
};

function createGameCanvas(parentId = 'game') {
    const parent = document.getElementById(parentId);
    if (!parent) throw new Error(`#${parentId} not found`);
    parent.innerHTML = '';
    const canvas = document.createElement('canvas');
    // The internal canvas matches the viewport pixel size so sprite
    // coords land exactly where they're drawn — no CSS scaling gap,
    // no letterbox bars on portrait mobile. Background is drawn via
    // coverRect to preserve aspect; sprites sit at canvas bottom in
    // real pixels so their feet anchor to the visible bottom edge of
    // the scene region.
    //
    // For gameplay scenes we reserve the bottom ~140px of the
    // viewport for the dialogue box overlay (position:absolute;
    // bottom:0 in CSS), so the canvas is sized to viewport MINUS
    // that strip — sprite feet therefore land right above the
    // dialogue box. For the title screen (intro), there's no
    // dialogue box so the canvas fills the whole viewport, and the
    // scene image (with its cover-fit background) reaches all the
    // way to the screen edge.
    //
    // The title-vs-game decision is made at scene start: each scene
    // (via Scene._configureCanvasLayout) flips the canvas height
    // and CSS between full-viewport and reserved-strip modes.
    canvas.width = parent.clientWidth || INTERNAL_W;
    canvas.height = parent.clientHeight || INTERNAL_H;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    parent.appendChild(canvas);
    // Resize listener — canvas re-syncs to the parent so coords stay
    // 1:1 with viewport pixels across orientation changes and
    // browser window resizes. The active scene re-applies its
    // layout (full vs reserved-strip) when this fires.
    window.addEventListener('resize', () => {
        const nw = parent.clientWidth, nh = parent.clientHeight;
        if (nw <= 0 || nh <= 0) return;
        // Defer to the scene's layout configurator if a scene is
        // active — it knows whether to reserve the dialogue strip.
        if (window.__activeScene && typeof window.__activeScene._configureCanvasLayout === 'function') {
            window.__activeScene._configureCanvasLayout();
            return;
        }
        // No scene yet — fill the whole viewport.
        if (nw === canvas.width && nh === canvas.height) return;
        canvas.width = nw;
        canvas.height = nh;
    });
    window.addEventListener('orientationchange', () => {
        if (window.__activeScene && typeof window.__activeScene._configureCanvasLayout === 'function') {
            window.__activeScene._configureCanvasLayout();
        }
    });
    return canvas;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        if (assets.images[src]) return resolve(assets.images[src]);
        const img = new Image();
        img.onload = () => { assets.images[src] = img; resolve(img); };
        img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

function loadAudio(src) {
    return new Promise((resolve, reject) => {
        const existing = assets.audio[src];
        if (existing) {
            if (existing.decoded) return existing.decoded.then(() => resolve(existing.audio));
            return resolve(existing.audio);
        }
        const audio = new Audio();
        audio.src = src;
        audio.preload = 'auto';
        audio.loop = true;
        const decoded = new Promise((res) => {
            audio.addEventListener('canplaythrough', () => res(audio), { once: true });
            audio.addEventListener('error', () => reject(new Error(`Failed to load audio: ${src}`)), { once: true });
            // Some browsers don't fire canplaythrough on cached files.
            // Fallback: any loaded data is enough for our fade-in usage.
            setTimeout(() => res(audio), 1500);
        });
        assets.audio[src] = { audio, decoded };
        decoded.then(() => resolve(audio));
    });
}

/**
 * Synchronously read a previously-decoded audio element from cache.
 * Used by MusicHandler to compute sensible default fadeAt times
 * (mid-track) once the first loop is already playing. Returns null
 * if the file hasn't been loaded yet — caller must fall back to a
 * default in that case.
 *
 * @param {string} src - cache key (typically `assets/audio/<file>.mp3`)
 * @returns {HTMLAudioElement|null}
 */
function getCachedAudio(src) {
    const entry = assets.audio[src];
    return entry ? entry.audio : null;
}

// Cover Image given as {image: HTMLImageElement}. Returns the
// destination rect that scales-and-crops the image to fully fill the
// canvas while preserving aspect ratio. Letterbox the gaps with
// backgroundColor.
//
// `anchor` controls which side of the source aligns to the same side
// of the canvas when the source overflows:
//   - 'left'   → image anchored to the LEFT (title screens with a
//                 left-edge logo: the logo never gets cropped on
//                 portrait phones).
//   - 'right'  → image anchored to the RIGHT.
//   - 'center' → image centred (default; gameplay scenes where the
//                 characters are mid-frame).
function coverRect(srcW, srcH, dstW, dstH, anchor = 'center') {
    const srcAspect = srcW / srcH;
    const dstAspect = dstW / dstH;
    let w, h;
    if (srcAspect > dstAspect) {
        // Image is wider than canvas — fit height, overflow width.
        h = dstH;
        w = h * srcAspect;
    } else {
        w = dstW;
        h = w / srcAspect;
    }
    let x;
    if (anchor === 'left') {
        x = 0;
    } else if (anchor === 'right') {
        x = dstW - w;
    } else {
        x = (dstW - w) / 2;  // 'center' or anything else
    }
    const y = (dstH - h) / 2;
    return { x, y, w, h };
}

// Contain Image: scales the source to fit ENTIRELY inside the destination,
// letterboxing the gaps. Used for title screens so the logo is never
// cropped. Same aspect-ratio logic as coverRect but never overflows.
function containRect(srcW, srcH, dstW, dstH) {
    const srcAspect = srcW / srcH;
    const dstAspect = dstW / dstH;
    let w, h;
    if (srcAspect > dstAspect) {
        // Source is wider — fit width.
        w = dstW;
        h = w / srcAspect;
    } else {
        h = dstH;
        w = h * srcAspect;
    }
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

// Convert a page-space {clientX, clientY} (e.g. a pointer event) into
// canvas-space coordinates using the object-fit:contain display model.
// Returns {x, y} in canvas pixels.
function pageToCanvasCoords(canvas, pageX, pageY) {
    const rect = canvas.getBoundingClientRect();
    const displayedW = rect.width;
    const displayedH = rect.height;
    const scaleX = INTERNAL_W / displayedW;
    const scaleY = INTERNAL_H / displayedH;
    return {
        x: (pageX - rect.left) * scaleX,
        y: (pageY - rect.top) * scaleY
    };
}

// -----------------------------------------------------------------------------
// PC-98 dither post-process.
//
// Snap every background pixel to the nearest of 16 palette colours using
// ordered (Bayer 8x8) dithering, which produces the chunky-pixel +
// cross-hatched texture that defines the PC-98 look. Source images are
// clean smooth illustrations; this is where the retro aesthetic lives.
//
// Perf: dither is paid ONCE per scene load into an offscreen canvas,
// then blitted every frame. ImageData is mutated in place via Uint32Array
// view for ~3x speedup over per-byte get/set. A 1280x720 dither takes
// ~120ms on M-series — only blocks the first paint of a new scene.
// -----------------------------------------------------------------------------

// Bayer 8x8 ordered-dither matrix, normalised to [-0.5, +0.5).
const BAYER_8 = (() => {
    // Standard 8x8 Bayer matrix scaled so each cell sits in [-0.5, 0.5).
    const m = [
         0, 32,  8, 40,  2, 34, 10, 42,
        48, 16, 56, 24, 50, 18, 58, 26,
        12, 44,  4, 36, 14, 46,  6, 38,
        60, 28, 52, 20, 62, 30, 54, 22,
         3, 35, 11, 43,  1, 33,  9, 41,
        51, 19, 59, 27, 49, 17, 57, 25,
        15, 47,  7, 39, 13, 45,  5, 37,
        63, 31, 55, 23, 61, 29, 53, 21,
    ];
    return new Float32Array(64).map((_, i) => m[i] / 64 - 0.5);
})();

// Flatten a 16-colour palette ([[r,g,b], ...]) into a Uint8Array for tight
// inner-loop access. Layout: [r0,g0,b0, r1,g1,b1, ...].
function flattenPalette(palette) {
    const flat = new Uint8Array(palette.length * 3);
    for (let i = 0; i < palette.length; i++) {
        flat[i * 3 + 0] = palette[i][0];
        flat[i * 3 + 1] = palette[i][1];
        flat[i * 3 + 2] = palette[i][2];
    }
    return flat;
}

// Quantize an ImageData in-place to the nearest 16-colour palette entry
// with 8x8 Bayer ordered dithering. `palette` is the 16-entry colour
// table; `ditherStrength` controls how much the dither biases the
// pixel — 1.0 is the canonical PC-98 look, lower = less banding.
function ditherImageData(imageData, palette, ditherStrength = 1.0) {
    const data = imageData.data;
    const W = imageData.width;
    const flat = flattenPalette(palette);
    const N = palette.length;

    // Per-channel bias lookup. For each output colour channel of each
    // palette entry, precompute how much each pixel needs to nudge
    // towards it (signed, since Bayer is in [-0.5, +0.5]).
    //
    // Trick: instead of adding the Bayer cell to the input and then
    // finding the nearest palette entry (slow), we precompute, for
    // each palette entry, an offset table indexed by (bayerCell × 64)
    // and apply the entry's offsets to the input. Then we still need
    // to find the nearest. So this optimisation doesn't quite land —
    // see below for the actual fast path.

    // Fast path: treat the imageData buffer as RGBA Uint32 — most
    // platforms are little-endian and put the channels in [r,g,b,a]
    // byte order, which means a single Uint32 read gives us all four
    // bytes for a comparison. We compare in palette-index space: for
    // each pixel, find the palette index that minimises squared
    // distance, with Bayer bias applied to break ties away from the
    // exact-midpoint (gives the cross-hatch texture).
    const px = new Uint32Array(data.buffer);
    const total = px.length;
    for (let i = 0; i < total; i++) {
        const argb = px[i];
        const r = (argb >>> 0) & 0xff;
        const g = (argb >>> 8) & 0xff;
        const b = (argb >>> 16) & 0xff;
        const a = (argb >>> 24) & 0xff;
        if (a < 8) continue; // skip near-transparent pixels

        // Bayer cell in [-0.5, +0.5) scaled by ditherStrength.
        const bx = i % W;
        const by = (i / W) | 0;
        const bayer = BAYER_8[(by & 7) * 8 + (bx & 7)] * ditherStrength;
        // Dither bias is added in luminance terms (0..255). We apply
        // it to each channel proportionally — the human eye can't
        // distinguish a per-channel vs luma bias at this strength, and
        // per-channel is one multiply.
        const bias = bayer * 64; // ±32 grey levels

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let p = 0; p < N; p++) {
            const dr = (flat[p * 3 + 0] - r);
            const dg = (flat[p * 3 + 1] - g);
            const db = (flat[p * 3 + 2] - b);
            // Signed squared distance with Bayer bias folded in:
            // smaller bias favours darker palette entries (more
            // banding to the dark side, which reads as PC-98 shadow).
            const dist = dr * dr + dg * dg + db * db + bias * dr * 0.3;
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = p;
            }
        }
        // Write the chosen palette entry back as a Uint32.
        px[i] =
            (flat[bestIdx * 3 + 0]) |
            (flat[bestIdx * 3 + 1] << 8) |
            (flat[bestIdx * 3 + 2] << 16) |
            (a << 24);
    }
    return imageData;
}

// Render an HTMLImageElement into a fresh offscreen canvas, applying
// Bayer dither + 16-colour palette quantize. Returns the canvas (which
// is then blitted by the scene each frame).
//
// `palette` is a 16-entry [[r,g,b], ...] array. `bgColor` is the letterbox
// fill (rendered before the image is drawn so the letterbox pixels also
// get dithered — otherwise you'd see solid-colour bars framing a dithered
// image, which looks terrible).
//
// `anchor` ('left' | 'right' | 'center') is passed through to
// coverRect so title screens with a left-edge logo stay anchored.
function ditherImageToCanvas(image, canvas, palette, opts = {}) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const bgColor = opts.bgColor || [0, 0, 0];
    ctx.fillStyle = `rgb(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`;
    ctx.fillRect(0, 0, W, H);
    // Cover-fit the source image into the canvas.
    const rect = coverRect(image.width, image.height, W, H, opts.anchor || 'center');
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    // Quantize the resulting bitmap to the palette.
    const imageData = ctx.getImageData(0, 0, W, H);
    ditherImageData(imageData, palette, opts.ditherStrength ?? 1.0);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

// Resolve a palette by name (e.g. "alley", "terminal_lab"). Falls back to
// `window.PALETTES.alley` if the name isn't loaded yet, then to the first
// registered palette. Returns the 16-entry array.
function resolvePalette(name) {
    const P = window.PALETTES || {};
    if (name && P[name] && Array.isArray(P[name]) && P[name].length === 16) {
        return P[name];
    }
    if (P.alley) return P.alley;
    const first = Object.values(P).find(
        (v) => Array.isArray(v) && v.length === 16);
    if (first) return first;
    // Last-resort: a pure dark palette so the dither still runs but the
    // scene renders black instead of throwing.
    return [
        [0,0,0],[16,16,16],[32,32,32],[8,8,8],[24,24,24],[48,48,48],
        [204,32,32],[140,16,16],[236,232,224],[204,168,60],
        [220,200,184],[168,40,40],[80,200,200],[160,220,100],
        [16,16,24],[252,252,248]
    ];
}

window.Runtime = {
    INTERNAL_W, INTERNAL_H,
    assets,
    createGameCanvas,
    loadImage,
    loadAudio,
    getCachedAudio,
    coverRect,
    containRect,
    pageToCanvasCoords,
    // PC-98 dither post-process API
    ditherImageData,
    ditherImageToCanvas,
    resolvePalette,
    BAYER_8,
};
