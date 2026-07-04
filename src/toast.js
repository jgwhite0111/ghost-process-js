// src/toast.js — transient status line messages
//
// The toast is a thin status bar that sits between the title bar area
// and the dialogue box. It shows short hints like "You found a rusty
// key." or "The door is locked." It is COMPLETELY INDEPENDENT of the
// dialogue runner — it never pauses, replaces, or interferes with
// dialogue text. It is also pointer-event-transparent so it never
// blocks clicks on the scene canvas.
//
// Messages queue: if a new message arrives while another is on screen,
// the new one waits for the current to fade out, then fades in.
// Manual dismiss is not exposed — toasts always auto-dismiss.

class Toast {
    constructor() {
        this.layer = null;
        this.queue = [];
        this._busy = false;
    }

    // Lazy construction. Safe to call before STATE/STORY exist.
    ensureLayer() {
        if (this.layer) return;
        const el = document.createElement('div');
        el.id = 'toast-layer';
        el.className = 'toast-layer';
        // Mark as a system layer; the scanner-overlay (z=1000) should
        // sit above us so the scanline effect applies uniformly. Use
        // z=100 — well above dialogue (10) and inventory button (50),
        // well below scanlines (1000).
        document.body.appendChild(el);
        this.layer = el;
    }

    // Public: enqueue a message. Returns immediately. The message
    // will display when no other toast is active.
    show(text, opts = {}) {
        this.ensureLayer();
        const msg = {
            text: String(text),
            // Default durations match the spec: fade-in 150ms,
            // hold 2500ms (or until dismissed by next message),
            // fade-out 400ms.
            fadeIn: opts.fadeIn ?? 150,
            hold: opts.hold ?? 2500,
            fadeOut: opts.fadeOut ?? 400,
            // 'info' = subtle gold, 'warn' = red, 'success' = green.
            kind: opts.kind ?? 'info'
        };
        this.queue.push(msg);
        if (!this._busy) this._drain();
    }

    _drain() {
        if (this.queue.length === 0) {
            this._busy = false;
            return;
        }
        this._busy = true;
        const msg = this.queue.shift();
        const el = document.createElement('div');
        el.className = `toast toast-${msg.kind}`;
        el.textContent = msg.text;
        el.style.opacity = '0';
        el.style.transition = `opacity ${msg.fadeIn}ms ease-out`;
        this.layer.appendChild(el);
        // Force layout, then fade in.
        requestAnimationFrame(() => {
            el.style.opacity = '1';
        });
        // Hold, then fade out.
        setTimeout(() => {
            el.style.transition = `opacity ${msg.fadeOut}ms ease-in`;
            el.style.opacity = '0';
            // Remove from DOM after fade-out completes, then drain.
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
                this._drain();
            }, msg.fadeOut);
        }, msg.fadeIn + msg.hold);
    }
}

window.Toast = new Toast();