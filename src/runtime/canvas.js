// src/runtime/canvas.js — the canvas itself, plus an asset cache.
//
// The Phaser version used a 640x480 internal resolution with FIT scale.
// We keep that 4:3 contract: a fixed-resolution backbuffer that the
// browser scales to fit the viewport via CSS. This makes the pixel-
// art + dither aesthetic crisper than fluid-rendering, and it matches
// the dialogue box dimensions that were tuned in styles.css.
//
// Asset preload is one big Promise.all of Image() objects keyed by
// filename. We don't need Phaser's loader API for v1 — every asset is
// triggered by an `src=` assignment + onload handler, exactly the
// pattern used by the v0.98 prototype.

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
    canvas.width = INTERNAL_W;
    canvas.height = INTERNAL_H;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.objectFit = 'contain';
    canvas.style.display = 'block';
    parent.appendChild(canvas);
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

// Cover Image given as {image: HTMLImageElement}. Returns the
// destination rect that scales-and-crops the image to fully fill the
// canvas while preserving aspect ratio. Letterbox the gaps with
// backgroundColor.
function coverRect(srcW, srcH, dstW, dstH) {
    const srcAspect = srcW / srcH;
    const dstAspect = dstW / dstH;
    let w, h;
    if (srcAspect > dstAspect) {
        // Image is wider than canvas — fit height.
        h = dstH;
        w = h * srcAspect;
    } else {
        w = dstW;
        h = w / srcAspect;
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

window.Runtime = {
    INTERNAL_W, INTERNAL_H,
    assets,
    createGameCanvas,
    loadImage,
    loadAudio,
    coverRect,
    pageToCanvasCoords
};
