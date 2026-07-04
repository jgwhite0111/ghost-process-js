// src/inventory.js — item storage + popup UI
//
// Items are added via hitboxes (item: ITEM_ID) or Ink tags (# give:ITEM_ID).
// There is no persistent HUD bar. Instead, a small "INV" button lives in
// the top-right of the screen; clicking it opens a popup that lists
// every collected item as an icon + name, and clicking an item shows
// its description.
//
// No automatic scene cleanup is needed — the inventory button is owned
// by the document (sibling of the canvas), not by any scene, so it
// survives scene transitions and only needs to be created once.

class Inventory {
    constructor() {
        this.button = null;       // top-right INV button (always visible)
        this.popup = null;        // popup overlay (null when closed)
        this._lastFocusedItem = null;  // for keyboard re-focus on reopen
    }

    // Defer the inventory button until the user has actually entered a
    // game scene. Showing it during the Boot/intro loading phase is
    // misleading on mobile (the button appears before the canvas is
    // ready, and looks like a broken artifact next to the "Loading…"
    // text). The button is created lazily on first inventory mutation
    // OR on explicit call from a scene's create().
    _userHasEnteredGame = false;

    ensureButton() {
        // Don't show during boot/loading.
        if (!this._userHasEnteredGame) return;
        if (this.button) return;
        if (!window.STATE || !window.STORY) return;
        const btn = document.createElement('button');
        btn.id = 'inventory-button';
        btn.className = 'inventory-button';
        btn.type = 'button';
        btn.innerHTML = '<span class="inv-label">INV</span><span class="inv-count">0</span>';
        btn.addEventListener('click', () => this._togglePopup());
        document.body.appendChild(btn);
        this.button = btn;
        this._updateCount();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.popup) {
                this._closePopup();
                e.stopPropagation();
            }
        });
    }

    // Called by the first game scene (intro) once it's safe to show UI.
    // After this point the button will be created and kept in sync.
    unlockForGameplay() {
        this._userHasEnteredGame = true;
        this.ensureButton();
    }

    _updateCount() {
        if (!this.button) return;
        const count = window.STATE ? window.STATE.inventory.length : 0;
        const countEl = this.button.querySelector('.inv-count');
        if (countEl) countEl.textContent = String(count);
        // Style hint: dim button when empty so it doesn't look broken.
        this.button.classList.toggle('is-empty', count === 0);
    }

    _togglePopup() {
        if (this.popup) {
            this._closePopup();
        } else {
            this._openPopup();
        }
    }

    _openPopup() {
        if (this.popup) return;
        const items = (window.STATE && window.STATE.inventory) || [];
        // Backdrop dims the scene so the popup reads as a modal layer.
        const backdrop = document.createElement('div');
        backdrop.className = 'inventory-backdrop';
        const popup = document.createElement('div');
        popup.className = 'inventory-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Inventory');
        // Header
        const header = document.createElement('div');
        header.className = 'inventory-popup-header';
        header.innerHTML = '<span class="inv-title">INVENTORY</span>' +
            '<button class="inv-close" type="button" aria-label="Close">×</button>';
        popup.appendChild(header);
        header.querySelector('.inv-close').addEventListener('click', () => this._closePopup());
        // Item list
        const list = document.createElement('div');
        list.className = 'inventory-list';
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'inventory-empty';
            empty.textContent = '— nothing collected —';
            list.appendChild(empty);
        } else {
            for (const itemId of items) {
                const item = window.STORY.items[itemId];
                if (!item) continue;
                const slot = document.createElement('button');
                slot.type = 'button';
                slot.className = 'inventory-item';
                slot.dataset.itemId = itemId;
                const img = document.createElement('img');
                img.src = item.icon;
                img.alt = item.name;
                const name = document.createElement('span');
                name.className = 'inventory-item-name';
                name.textContent = item.name;
                slot.appendChild(img);
                slot.appendChild(name);
                slot.addEventListener('click', () => this._showDescription(itemId));
                list.appendChild(slot);
            }
        }
        popup.appendChild(list);
        // Description panel (initially shows first item or a placeholder).
        const desc = document.createElement('div');
        desc.className = 'inventory-description';
        if (items.length > 0 && window.STORY.items[items[0]]) {
            this._lastFocusedItem = items[0];
            this._renderDescription(items[0], desc);
            // Highlight the first item.
            const firstSlot = list.querySelector('.inventory-item');
            if (firstSlot) firstSlot.classList.add('is-selected');
        } else {
            desc.innerHTML = '<span class="inventory-empty-desc">Pick up items by clicking them in the scene.</span>';
        }
        popup.appendChild(desc);
        backdrop.appendChild(popup);
        backdrop.addEventListener('click', (e) => {
            // Click on backdrop (not popup) closes — matches OS window UX.
            if (e.target === backdrop) this._closePopup();
        });
        document.body.appendChild(backdrop);
        this.popup = backdrop;
    }

    _renderDescription(itemId, descEl) {
        const item = window.STORY.items[itemId];
        if (!item) return;
        descEl.innerHTML = '';
        const name = document.createElement('div');
        name.className = 'inventory-desc-name';
        name.textContent = item.name;
        const body = document.createElement('div');
        body.className = 'inventory-desc-body';
        body.textContent = item.description || '—';
        descEl.appendChild(name);
        descEl.appendChild(body);
    }

    _showDescription(itemId) {
        if (!this.popup) return;
        // Update selected slot highlight.
        const slots = this.popup.querySelectorAll('.inventory-item');
        slots.forEach(s => s.classList.toggle('is-selected', s.dataset.itemId === itemId));
        const desc = this.popup.querySelector('.inventory-description');
        this._renderDescription(itemId, desc);
        this._lastFocusedItem = itemId;
    }

    _closePopup() {
        if (!this.popup) return;
        this.popup.remove();
        this.popup = null;
    }

    add(itemId) {
        if (!window.STATE) return;
        if (window.STATE.inventory.indexOf(itemId) !== -1) return;
        window.STATE.inventory.push(itemId);
        this.ensureButton();
        this._updateCount();
        // If the popup is currently open, refresh it so the new item
        // shows up without the user having to close+reopen.
        if (this.popup) this._openPopup(); // close+reopen pattern
    }

    remove(itemId) {
        if (!window.STATE) return;
        const idx = window.STATE.inventory.indexOf(itemId);
        if (idx !== -1) {
            window.STATE.inventory.splice(idx, 1);
            window.STATE.consumed.push(itemId);
        }
        this.ensureButton();
        this._updateCount();
        if (this.popup) this._openPopup();
    }

    has(itemId) {
        return window.STATE && window.STATE.inventory.indexOf(itemId) !== -1;
    }

    refresh() {
        this.ensureButton();
        this._updateCount();
        if (this.popup) this._openPopup();
    }
}

window.Inventory = new Inventory();