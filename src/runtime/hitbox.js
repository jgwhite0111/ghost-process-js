// src/runtime/hitbox.js — clickable regions on the scene canvas.
//
// Each hitbox is a normalized rectangle (x, y, w, h ∈ [0,1]) on the
// scene canvas. The cursor changes to an eye icon when hovering a
// region and a yellow debug rectangle + label fades in transiently.
// Both the cursor swap and the debug overlay are pure CSS — no
// graphics library involved.
//
// Coordinates are tested in canvas-space (pageToCanvasCoords converts
// pointer events on the way in), then matched against the hitbox rect.

const EYE_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<path d="M2 16 Q16 4 30 16 Q16 28 2 16 Z" fill="white" stroke="black" stroke-width="1.5"/>' +
    '<circle cx="16" cy="16" r="5" fill="black"/>' +
    '<circle cx="17" cy="14" r="1.5" fill="white"/>' +
    '</svg>';
const HAND_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<path d="M10 27c-2-3-5-7-5-9 0-1 1-2 2-2 1 0 2 1 3 2V7c0-2 3-2 3 0v7-5c0-2 3-2 3 0v5-4c0-2 3-2 3 0v5-3c0-2 3-2 3 0v8c0 3-2 5-4 7Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';
window.EYE_CURSOR = "url('data:image/svg+xml;utf8," + EYE_CURSOR_SVG + "') 0 0, default";
window.HAND_CURSOR = "url('data:image/svg+xml;utf8," + HAND_CURSOR_SVG + "') 7 2, pointer";

class HitboxLayer {
    constructor({ canvas, sceneId, sceneConfig, onTrigger }) {
        this.canvas = canvas;
        this.sceneId = sceneId;
        this.config = sceneConfig;
        this.onTrigger = onTrigger;
        this.hitboxes = sceneConfig.hitboxes || [];
        this._alwaysVisible = (sceneConfig.kind === 'title');
        // Item-pickup hitboxes (e.g. rusty_key in the alley) need to be
        // discoverable: their label is always visible because the only
        // way to advance the scene is to find and click them, and the
        // player has no other visual cue.
        this._itemHitboxesAlwaysVisible = (sceneConfig.kind === 'ink');
        this._debugAlwaysVisible = (localStorage.hideHitboxes === '0');

        // Pointer-move handler reads canvas-coords and tests hitboxes.
        // Pointerdown handler ignores hitboxes — clicks are processed
        // by the scene's pointerdown for hitbox triggers and by the
        // dialogue box for advancing text.
        this._onPointerMove = (e) => this._handleMove(e);
        this._onPointerDown = (e) => this._handleDown(e);
        this.canvas.addEventListener('pointermove', this._onPointerMove);
        this.canvas.addEventListener('pointerdown', this._onPointerDown);

        // Debug overlay: an absolutely-positioned div anchored to the
        // canvas, sized to canvas pixel dimensions (via CSS transform
        // scaling — the internal 640x480 maps onto whatever size the
        // canvas is displayed at via object-fit:contain).
        const parent = canvas.parentElement;
        const overlay = document.createElement('div');
        overlay.className = 'hitbox-overlay';
        overlay.style.cssText = 'position:absolute;pointer-events:none;z-index:5;';
        parent.appendChild(overlay);
        this.overlay = overlay;

        this._labels = {};
        for (let i = 0; i < this.hitboxes.length; i++) {
            const hb = this.hitboxes[i];
            // Button/control hitboxes render their own visible text inside a
            // semantic <button>. They deliberately do not get the exploration
            // label used by item and ordinary interactive regions.
            if (hb.type !== 'button') {
                const lbl = this._createLabel(hb);
                if (this._alwaysVisible) lbl.setAttribute('title-screen', '');
                this._labels[i] = lbl;
            }
            this._hitboxEls = this._hitboxEls || [];
            this._hitboxEls[i] = this._createHitboxDiv(hb, i);
        }
        this._hoveredIdx = null;
        this._restoreBaselineLabels();
        this._syncOverlay();
        this._onCanvasResized = () => this._syncOverlay();
        window.addEventListener('game:canvas-resized', this._onCanvasResized);
    }

    _updateItemLabel(i) {
        const hb = this.hitboxes[i];
        if (!hb || !hb.item) return;
        const inv = window.STATE?.inventory || [];
        const consumed = window.STATE?.consumed || [];
        const inInv = inv.indexOf(hb.item) !== -1 || consumed.indexOf(hb.item) !== -1;
        this._labels[i].style.opacity = inInv ? '0' : '1';
    }

    _restoreBaselineLabels() {
        for (const i in this._labels) {
            this._labels[i].style.opacity = this._alwaysVisible ? '1' : '0';
        }
        if (!this._itemHitboxesAlwaysVisible) return;
        for (let i = 0; i < this.hitboxes.length; i++) this._updateItemLabel(i);
    }

    _createHitboxDiv(hb, idx) {
        const isButton = hb.type === 'button';
        const el = document.createElement(isButton ? 'button' : 'div');
        el.className = isButton ? 'hitbox hitbox-button' : 'hitbox';
        if (isButton) {
            el.type = 'button';
            el.textContent = hb.label || hb.target || 'CONTINUE';
            el.setAttribute('aria-label', el.textContent);
        }
        el.style.cssText = [
            'position:absolute',
            'cursor:' + (isButton ? window.HAND_CURSOR : window.EYE_CURSOR),
            'left:' + (hb.x * 100) + '%',
            'top:' + (hb.y * 100) + '%',
            'width:' + (hb.w * 100) + '%',
            'height:' + (hb.h * 100) + '%'
        ].join(';');
        const self = this;
        // Controls use click so keyboard activation works as well as pointer
        // activation. Exploration hitboxes retain pointerdown timing.
        el.addEventListener(isButton ? 'click' : 'pointerdown', function (e) {
            self._handleDomDown(e, hb, idx);
        });
        el.addEventListener('pointerenter', function () { self._setHovered(idx, hb); });
        el.addEventListener('pointerleave', function () { self._setHovered(null, null); });
        this.overlay.appendChild(el);
        return el;
    }

    _setHovered(idx, hb) {
        if (idx === this._hoveredIdx) return;
        this._hoveredIdx = idx;
        if (idx === null) {
            this.canvas.style.cursor = '';
            this._restoreBaselineLabels();
        } else {
            this.canvas.style.cursor = hb?.type === 'button' ? window.HAND_CURSOR : window.EYE_CURSOR;
            for (const i in this._labels) this._labels[i].style.opacity = (i == idx) ? '1' : '0';
        }
    }

    _syncOverlay() {
        const r = this.canvas.getBoundingClientRect();
        const parentR = this.overlay.parentElement.getBoundingClientRect();
        this.overlay.style.left = (r.left - parentR.left) + 'px';
        this.overlay.style.top = (r.top - parentR.top) + 'px';
        this.overlay.style.width = r.width + 'px';
        this.overlay.style.height = r.height + 'px';
    }

    _createLabel(hb) {
        const labelSize = hb.label_size || '11px';
        const labelFont = hb.label_font || '"NouveauIBM", monospace';
        const labelColor = hb.label_color || '#d4a045';
        const labelStyle = hb.label_style || 'bold';
        const label = document.createElement('div');
        label.className = 'hitbox-label';
        label.textContent = hb.label || hb.target || hb.item || '?';
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

    _hitTest(x, y) {
        const W = this.canvas.width, H = this.canvas.height;
        const nx = x / W, ny = y / H;
        const inv = window.STATE?.inventory || [];
        const consumed = window.STATE?.consumed || [];
        for (const hb of this.hitboxes) {
            if (hb.item && (inv.indexOf(hb.item) !== -1 || consumed.indexOf(hb.item) !== -1)) continue;
            if (nx >= hb.x && nx <= hb.x + hb.w && ny >= hb.y && ny <= hb.y + hb.h) {
                return hb;
            }
        }
        return null;
    }

    _handleMove(e) {
        const { x, y } = window.Runtime.pageToCanvasCoords(this.canvas, e.clientX, e.clientY);
        const hb = this._hitTest(x, y);
        if (hb) {
            this.canvas.style.cursor = hb.type === 'button' ? window.HAND_CURSOR : window.EYE_CURSOR;
            const idx = this.hitboxes.indexOf(hb);
            if (idx !== this._hoveredIdx) {
                this._hoveredIdx = idx;
                for (const i in this._labels) this._labels[i].style.opacity = (i == idx) ? '1' : '0';
            }
        } else {
            this.canvas.style.cursor = '';
            this._hoveredIdx = null;
            this._restoreBaselineLabels();
        }
    }

    _handleDown(e) {
        const { x, y } = window.Runtime.pageToCanvasCoords(this.canvas, e.clientX, e.clientY);
        const hb = this._hitTest(x, y);
        if (!hb) return false;
        const key = this.sceneId + ':' + (hb.label || hb.target || hb.item);
        if (!hb.repeatable) {
            if (window.STATE.spentHitboxes[key]) return false;
            window.STATE.spentHitboxes[key] = true;
        }
        // Pass page-space coords so callers (e.g. Inventory.addWithFly)
        // can position UI elements in the same coordinate system as
        // pointer events.
        this.onTrigger && this.onTrigger(hb, e.clientX, e.clientY);
        e.stopPropagation();
        return true;
    }

    _handleDomDown(e, hb, idx) {
        if (!hb) return false;
        const key = this.sceneId + ':' + (hb.label || hb.target || hb.item);
        if (!hb.repeatable) {
            if (window.STATE.spentHitboxes[key]) return false;
            window.STATE.spentHitboxes[key] = true;
        }
        if (this.onTrigger) this.onTrigger(hb, e.clientX, e.clientY);
        e.stopPropagation();
        e.preventDefault();
        return true;
    }

    destroy() {
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('game:canvas-resized', this._onCanvasResized);
        if (this.overlay) this.overlay.remove();
        this.canvas.style.cursor = '';
    }

    refresh() {
        // Re-evaluate which labels should be visible (e.g. an item hitbox
        // should hide once the item is in inventory). Called by the scene
        // after _triggerHitbox adds the item.
        if (!this._itemHitboxesAlwaysVisible) return;
        for (let i = 0; i < this.hitboxes.length; i++) this._updateItemLabel(i);
    }
}

window.HitboxLayer = HitboxLayer;
