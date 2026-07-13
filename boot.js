// boot.js — entry point that wires the runtime together and boots.
//
// All modules are loaded as separate <script> tags from index.html.
// This file's job is just to call Engine.boot() once everything is in
// place. Everything UI-side is owned by:
//
//   - src/runtime/canvas.js     — the canvas element + asset loading
//   - src/runtime/music.js      — crossfading bgm
//   - src/runtime/sprites.js    — character sprite animation
//   - src/runtime/hitbox.js     — clickable regions on the canvas
//   - src/runtime/scene-base.js — Scene class (bg + characters + dialogue)
//   - src/runtime/engine.js     — scene transitions
//   - src/scenes/_registry.js   — Scene subclasses for each scene id
//   - src/dialogue.js           — InkJS walker + typewriter
//   - src/dialogue-panel.js     — DOM dialogue box + choice buttons
//   - src/inventory.js          — popup inventory UI
//   - src/toast.js              — transient status messages
//   - src/story.js              — story.json fetch + asset preload
//
// The 16-color palette / Bayer dither / scanlines look is applied as a
// DOM CSS overlay (.scanlines) and the canvas uses image-rendering:
// pixelated for crispness at any size.

(async () => {
    // STORY arrives via story-ready event; boot() waits for it.
    try {
        await window.Engine.boot();
    } catch (err) {
        console.error('boot failed:', err);
        document.body.innerHTML = `
            <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
                        background:#0a0a0a;color:#cfcfcf;font-family:monospace;padding:2em;text-align:center">
                <div>
                    <div style="color:#d4a045;letter-spacing:0.2em;margin-bottom:1em">GHOST//PROCESS</div>
                    <div style="font-size:1.2em">Failed to start: ${err.message}</div>
                </div>
            </div>`;
    }
})();
