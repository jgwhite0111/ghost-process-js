// src/runtime/hitbox.js — clickable regions on the scene canvas.
//
// Each hitbox is a normalized rectangle (x, y, w, h ∈ [0,1]) on the
// scene canvas. The cursor changes to an eye icon when hovering a
// region and a yellow debug rectangle + label fades in transiently.
// This mirrors the behaviour that was previously implemented via a
// Phaser Graphics overlay + a sibling DOM layer for labels — both
// roles are now consolidated in CSS+JS without the Phaser middleman.
//
// Coordinates are tested in canvas-space (pageToCanvasCoords converts
// pointer events on the way in), then matched against the hitbox rect.

const EYE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<path d="M2 16 Q16 4 30 16 Q16 28 2 16 Z" fill="white" stroke="black" stroke-width="1.5"/>' +
    '<circle cx="16" cy="16" r="5" fill="black"/>' +
    '<circle cx="17" cy="14" r="1.5" fill="white"/>' +
    '</svg>';
window.EYE_CURSOR = "url('data:image/svg+xml;utf8," + EYE_SVG + "') 0 0, default";

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
            const lbl = this._createLabel(this.hitboxes[i]);
            if (this._alwaysVisible) lbl.setAttribute('title-screen', '');
            this._labels[i] = lbl;
            this._hitboxEls = this._hitboxEls || [];
            this._hitboxEls[i] = this._createHitboxDiv(this.hitboxes[i], i);
        }
        this._hoveredIdx = null;
        if (this._alwaysVisible) {
            for (const idx in this._labels) this._labels[idx].style.opacity = '1';
        } else if (this._itemHitboxesAlwaysVisible) {
            // Show item-pickup hitbox labels so the player can find them.
            // But hide them once the item is in inventory or consumed.
            for (let i = 0; i < this.hitboxes.length; i++) {
                this._updateItemLabel(i);
            }
        }
        this._syncOverlay();
    }

    _updateItemLabel(i) {
        const hb = this.hitboxes[i];
        if (!hb || !hb.item) return;
        const inv = window.STATE?.inventory || [];
        const consumed = window.STATE?.consumed || [];
        const inInv = inv.indexOf(hb.item) !== -1 || consumed.indexOf(hb.item) !== -1;
        this._labels[i].style.opacity = inInv ? '0' : '1';
    }

    _createHitboxDiv(hb, idx) {
        const el = document.createElement('div');
        el.className = 'hitbox';
        el.style.cssText = [
            'position:absolute',
            'cursor:' + window.EYE_CURSOR,
            'left:' + (hb.x * 100) + '%',
            'top:' + (hb.y * 100) + '%',
            'width:' + (hb.w * 100) + '%',
            'height:' + (hb.h * 100) + '%'
        ].join(';');
        const self = this;
        el.addEventListener('pointerdown', function (e) { self._handleDomDown(e, hb, idx); });
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
            for (const i in this._labels) this._labels[i].style.opacity = '0';
        } else {
            this.canvas.style.cursor = window.EYE_CURSOR;
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
            this.canvas.style.cursor = window.EYE_CURSOR;
            const idx = this.hitboxes.indexOf(hb);
            if (idx !== this._hoveredIdx) {
                this._hoveredIdx = idx;
                for (const i in this._labels) this._labels[i].style.opacity = (i == idx) ? '1' : '0';
            }
        } else {
            this.canvas.style.cursor = '';
            this._hoveredIdx = null;
            for (const i in this._labels) this._labels[i].style.opacity = '0';
        }
    }

    _handleDown(e) {
        const { x, y } = window.Runtime.pageToCanvasCoords(this.canvas, e.clientX, e.clientY);
        const hb = this._hitTest(x, y);
        if (!hb) return false;
        const key = this.sceneId + ':' + (hb.label || hb.target || hb.item);
        if (window.STATE.spentHitboxes[key]) return false;
        window.STATE.spentHitboxes[key] = true;
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
        if (window.STATE.spentHitboxes[key]) return false;
        window.STATE.spentHitboxes[key] = true;
        if (this.onTrigger) this.onTrigger(hb, e.clientX, e.clientY);
        e.stopPropagation();
        e.preventDefault();
        return true;
    }

    destroy() {
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
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
