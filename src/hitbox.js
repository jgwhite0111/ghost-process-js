// src/hitbox.js — clickable regions on the background plate
//
// Hitboxes are defined in story.json as normalized coordinates (0..1).
// Each hitbox has an action: target (goto scene), item (pickup), or
// external (Ink jump).
//
// Visibility policy:
//   - By default hitboxes are INVISIBLE. The affordance is the cursor
//     changing to an eye / hand when hovering a clickable region.
//   - The yellow debug rectangle + label appear TRANSIENTLY when the
//     mouse hovers a hitbox and disappear when it leaves. This gives
//     the player a hint without cluttering the screen with permanent
//     overlays. Per-hitbox label_size / label_font / label_color
//     fields on story.json let authors tune the label appearance.
//
// Override for development / debugging: `localStorage.hideHitboxes = '0'`
// re-enables permanent debug rendering.

class HitboxLayer {
    constructor(scene, sceneId, sceneConfig, onTrigger) {
        this.scene = scene;
        this.sceneId = sceneId;
        this.config = sceneConfig;
        this.onTrigger = onTrigger;
        this.hitboxes = sceneConfig.hitboxes || [];
        // Title-screen scenes keep their hitbox affordances (rect +
        // label) permanently visible — the user needs to see the
        // "PRESS START" button, not hunt for it. Game scenes use
        // transient hover-only affordances (cursor + on-hover label).
        this._alwaysVisible = (sceneConfig.kind === 'title');
        // Phaser Graphics for the yellow rect outline. Starts empty; we
        // stroke it only while a hitbox is hovered.
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(50);
        // DOM overlay div anchored to the canvas's bounding box. Labels
        // live inside this so their percentages correctly track the
        // scaled canvas (not the full-viewport parent).
        this.overlay = this._buildOverlay();
        this._labels = {};  // hitbox label index -> DOM element
        for (let i = 0; i < this.hitboxes.length; i++) {
            const hb = this.hitboxes[i];
            this._labels[i] = this._createLabel(hb);
        }
        this._hovered = null;  // index of currently-hovered hitbox, or null

        // Optional dev override: localStorage.hideHitboxes === '0' means
        // "show hitboxes permanently for debugging". Default is hidden.
        this._debugAlwaysVisible = (localStorage.hideHitboxes === '0');

        // Title-screen scenes: draw all hitboxes permanently. Game
        // scenes: keep hidden until hover.
        if (this._alwaysVisible) {
            this._drawAllDebug();
            for (const idx in this._labels) {
                this._labels[idx].style.opacity = '1';
            }
        }
    }

    _buildOverlay() {
        const canvas = this.scene.game.canvas;
        const parent = canvas.parentElement;
        // Anchor an overlay div to the canvas's current bounding rect.
        const ov = document.createElement('div');
        ov.className = 'hitbox-overlay';
        ov.style.cssText = 'position:absolute;pointer-events:none;z-index:5;';
        parent.appendChild(ov);
        // Sync AFTER appending so parent rect is settled, and use `ov`
        // directly (this.overlay is set by the caller in the constructor).
        this._syncOverlayToCanvasFor(ov, parent.getBoundingClientRect());
        return ov;
    }

    _syncOverlayToCanvas() {
        if (!this.overlay) return;
        const parentR = this.overlay.parentElement.getBoundingClientRect();
        this._syncOverlayToCanvasFor(this.overlay, parentR);
    }

    _syncOverlayToCanvasFor(ov, parentR) {
        const r = this.scene.game.canvas.getBoundingClientRect();
        ov.style.left = (r.left - parentR.left) + 'px';
        ov.style.top = (r.top - parentR.top) + 'px';
        ov.style.width = r.width + 'px';
        ov.style.height = r.height + 'px';
    }

    _createLabel(hb) {
        const labelSize = hb.label_size || '11px';
        const labelFont = hb.label_font || '"NouveauIBM", "PC98Serif", monospace';
        const labelColor = hb.label_color || '#d4a045';
        const labelStyle = hb.label_style || 'bold';
        const label = document.createElement('div');
        label.className = 'hitbox-label';
        label.textContent = hb.label || hb.target || hb.item || '?';
        // Convert normalized hb.x/y/w/h to percentages of the overlay.
        // The overlay matches the canvas's bounding rect, so the label
        // scales correctly with the canvas regardless of viewport size.
        const cxPct = (hb.x + hb.w / 2) * 100;
        const cyPct = (hb.y + hb.h / 2) * 100;
        label.style.cssText = [
            'position:absolute',
            'left:' + cxPct + '%',
            'top:' + cyPct + '%',
            'transform:translate(-50%,-50%)',
            'font:' + labelStyle + ' ' + labelSize + ' ' + labelFont,
            'color:' + labelColor,
            'background:rgba(0,0,0,0.6)',
            'padding:2px 6px',
            'pointer-events:none',
            'white-space:nowrap',
            'letter-spacing:0.05em',
            'opacity:0',
            'transition:opacity 0.1s'
        ].join(';');
        this.overlay.appendChild(label);
        return label;
    }

    // Test whether (x, y) in canvas coordinates lies inside any hitbox.
        // Returns the hitbox object, or null. Hitboxes whose `item` has
        // already been picked up (in STATE.inventory or STATE.consumed)
        // are ignored — the user has taken that item, hovering the area
        // again should NOT show a stale "Search the bins" affordance.
        hitTest(x, y) {
            const W = this.scene.scale.width;
            const H = this.scene.scale.height;
            const nx = x / W;
            const ny = y / H;
            const inv = window.STATE?.inventory || [];
            const consumed = window.STATE?.consumed || [];
            for (const hb of this.hitboxes) {
                if (hb.item && (inv.indexOf(hb.item) !== -1 || consumed.indexOf(hb.item) !== -1)) {
                    continue;  // item already picked up — hitbox is dead
                }
                if (nx >= hb.x && nx <= hb.x + hb.w &&
                    ny >= hb.y && ny <= hb.y + hb.h) {
                    return hb;
                }
            }
            return null;
        }

    // Show the yellow rect + label for the given hitbox, hide others.
    // Called from the scene's pointermove handler.
    setHovered(hb) {
        if (this._debugAlwaysVisible) {
            // Render every hitbox permanently (dev mode).
            this._drawAllDebug();
            return;
        }
        if (this._alwaysVisible) {
            // Title scene: everything stays drawn permanently. We
            // only need to swap the cursor between default and the
            // eye icon so the user gets confirmation of hover.
            this._hovered = hb;
            return;
        }
        if (hb === this._hovered) return;  // no change
        this._hovered = hb;
        this.graphics.clear();
        this._hideAllLabels();
        if (hb) {
            this._drawDebug(hb);
            const idx = this.hitboxes.indexOf(hb);
            const label = this._labels[idx];
            if (label) label.style.opacity = '1';
        }
    }

    _drawDebug(hb) {
        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        this.graphics.lineStyle(2, 0xd4a045, 0.7);
        this.graphics.strokeRect(hb.x * W, hb.y * H, hb.w * W, hb.h * H);
    }

    _drawAllDebug() {
        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        this.graphics.clear();
        for (const hb of this.hitboxes) {
            this.graphics.lineStyle(2, 0xd4a045, 0.7);
            this.graphics.strokeRect(hb.x * W, hb.y * H, hb.w * W, hb.h * H);
            const idx = this.hitboxes.indexOf(hb);
            const label = this._labels[idx];
            if (label) label.style.opacity = '1';
        }
    }

    _hideAllLabels() {
        for (const label of Object.values(this._labels)) {
            label.style.opacity = '0';
        }
    }

    // Called on pointerdown; converts click coords to hitbox space and fires action.
    // Returns the hitbox on success (so callers can inspect the result), or null.
    handleClick(pointerX, pointerY) {
        const hb = this.hitTest(pointerX, pointerY);
        if (!hb) return null;
        // Each hitbox is single-use unless explicitly multi.
        const key = this.sceneId + ':' + (hb.label || hb.target || hb.item);
        if (window.STATE.spentHitboxes[key]) return null;
        window.STATE.spentHitboxes[key] = true;
        // Pass the click position to the handler so callers can
        // animate pickups from where the player clicked.
        this.onTrigger && this.onTrigger(hb, pointerX, pointerY);
        return hb;
    }

    destroy() {
        this.graphics.destroy();
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this._labels = null;
    }
}

window.HitboxLayer = HitboxLayer;