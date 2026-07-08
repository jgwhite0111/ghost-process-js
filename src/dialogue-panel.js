// src/dialogue-panel.js — DOM dialogue box + choice list.
//
// A panel is one DOM node that:
//   - Shows text (typewriter-cumulative)
//   - Shows the current speaker name
//   - Shows the "▼" continue indicator when more text is available
//   - Shows a list of choice buttons when Ink pauses on `* [...]`
//   - Catches clicks/keys to advance or pick a choice
//
// One panel exists at a time. The Engine creates it on first scene and
// shows/hides it per scene based on whether the scene has Ink dialogue.
// For scenes without Ink (intro, alley pre-dialogue), the panel is
// still rendered but blank + hidden so transitions into/out of
// dialogue scenes don't visibly pop.
//
// Auto-dismiss: when Ink has no more lines AND no choices (onComplete),
// the next click on the dialogue box hides it. The scene task hint
// (if any) is shown by Toast at that point so the player has a clear
// "what to do next" prompt. If Ink later gets new content (e.g. via
// `_handleCommand('goto', ...)` redirect, or a choice branch emits
// more text), the panel unhides itself.

class DialoguePanel {
    constructor() {
        this.root = null;
        this.textEl = null;
        this.speakerEl = null;
        this.continueEl = null;
        this.choicesEl = null;
        this._currentRunner = null;
        // True once Ink has signalled onComplete — next click hides
        // the box. Reset to false whenever the runner fires a new
        // line, new choices, or the runner is swapped out.
        this._allSpoken = false;
        // Optional hook the scene installs so the dialogue click can
        // hand off to "show the task hint and then hide" logic.
        // signature: () => void.
        this._onDismiss = null;
        this._build();
    }

    _build() {
        const root = document.createElement('div');
        root.className = 'dialogue-box';
        const speaker = document.createElement('div');
        speaker.className = 'speaker';
        const text = document.createElement('div');
        text.className = 'text';
        const cont = document.createElement('div');
        cont.className = 'continue-indicator';
        cont.textContent = '▼';
        root.appendChild(speaker);
        root.appendChild(text);
        root.appendChild(cont);
        // Make the dialogue box clickable to advance.
        root.style.cursor = 'pointer';
        root.addEventListener('click', () => {
            // Hover the choices list first — if a real choice button is
            // visible, ignore the click (the button has its own handler).
            if (this.choicesEl && this.choicesEl.offsetParent !== null) return;
            if (!this._currentRunner) return;
            // If the dialogue is fully exhausted, a click here means
            // "I'm done reading" — hand off to the scene's dismiss hook
            // (which shows the task hint and hides the box) instead of
            // calling advance() (which would just step() on a dead story).
            if (this._allSpoken) {
                if (this._onDismiss) this._onDismiss();
                this.hide();
                return;
            }
            this._currentRunner.advance();
        });
        document.body.appendChild(root);
        this.root = root;
        this.speakerEl = speaker;
        this.textEl = text;
        this.continueEl = cont;
        // Keyboard advance: space/enter/click — handled at window level too.
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                if (this.choicesEl && this.choicesEl.offsetParent !== null) {
                    // First visible choice.
                    const first = this.choicesEl.querySelector('button');
                    if (first) first.click();
                    e.preventDefault();
                    return;
                }
                if (!this._currentRunner) return;
                if (this._allSpoken) {
                    if (this._onDismiss) this._onDismiss();
                    this.hide();
                    e.preventDefault();
                    return;
                }
                this._currentRunner.advance();
                e.preventDefault();
            }
            // Number shortcuts for visible choices.
            if (this.choicesEl && /^[1-9]$/.test(e.key)) {
                const btns = this.choicesEl.querySelectorAll('button');
                const idx = parseInt(e.key, 10) - 1;
                if (btns[idx]) btns[idx].click();
                e.preventDefault();
            }
        });
    }

    show() {
        this.root.style.display = 'block';
    }
    hide() {
        this.root.style.display = 'none';
        this.setChoices(null);
    }

    // Reset the panel to a clean state. Called when transitioning
    // between scenes so the previous scene's text/speaker/choices
    // don't linger until the new runner's first callback fires.
    // Without this, "Continue" buttons from one scene stay clickable
    // (and now-dead) in the next scene, and clicking the dialogue
    // box silently no-ops because the choices-list offsetParent
    // guard fires before advance().
    clear() {
        this.setChoices(null);
        this.setText('');
        this.setSpeaker('');
        this.setHasMore(false);
        this._currentRunner = null;
        this._allSpoken = false;
        this._onDismiss = null;
    }

    // Scene installs this when it has unresolved tasks. Called the
    // first time the player clicks the (now-exhausted) dialogue box
    // — the scene uses it to surface the next "what to do" hint and
    // then the box hides itself.
    setDismissHook(fn) { this._onDismiss = fn; }

    // Ink signalled onComplete: keep the box visible (player can
    // re-read the last line) but the next click should hide it.
    markAllSpoken() { this._allSpoken = true; }
    hasMoreDialogue() { return !this._allSpoken; }
    // A new line / choice / runner arrived → reset dismiss behaviour.
    resetAllSpoken() { this._allSpoken = false; }

    setSpeaker(name) {
        this.speakerEl.textContent = name || '';
        this.speakerEl.style.display = name ? 'inline-block' : 'none';
    }

    setText(visibleText) {
        this.textEl.textContent = visibleText;
        // Anything new to display = the dialogue isn't done yet.
        if (visibleText && visibleText.length > 0) {
            this.resetAllSpoken();
            // If the box was dismissed earlier this scene, unhide
            // it so the new text is visible. (No-op if already shown.)
            this.show();
        }
    }

    setHasMore(hasMore) {
        this.continueEl.style.display = hasMore ? 'inline' : 'none';
    }

    setChoices(choices, runner) {
        if (this.choicesEl) {
            this.choicesEl.remove();
            this.choicesEl = null;
        }
        if (!choices || choices.length === 0) {
            // No choices — restore the dialogue box to its default
            // bottom-anchored position so the most recent line sits
            // flush with the viewport bottom.
            this.root.style.bottom = '';
            this.root.classList.remove('choices-active');
            this.setHasMore(true);
            return;
        }
        // A choice list showing = there's clearly more dialogue pending.
        this.resetAllSpoken();
        this.setHasMore(false);
        this.show();
        const wrap = document.createElement('div');
        wrap.className = 'choices-list';
        choices.forEach((choice, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-button';
            const label = (i + 1) + '. ' + (choice.text || '');
            btn.textContent = label;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (runner) {
                    runner._suppressStep = false;
                    runner.choose(i);
                    runner._suppressStep = false;
                }
                this.setChoices(null);
            });
            wrap.appendChild(btn);
        });
        this.root.appendChild(wrap);
        this.choicesEl = wrap;

        // Lift the dialogue box so it sits directly above the
        // choices menu. Choices-list is position:fixed at
        // bottom:calc(200px + safe-bottom) and its height varies
        // (1 to N buttons). Without this lift, the box stays anchored
        // to viewport bottom and a chunk of empty alley scene appears
        // between the last line of dialogue and the first choice
        // button — the "last line hidden" bug. Lift = choices-list CSS
        // bottom (200 + safe-bottom) + its rendered height + a small
        // visual gap (8px).
        const choicesH = wrap.offsetHeight;
        const safeBottom = this._safeBottom();
        this.root.style.bottom = (200 + choicesH + 8 + safeBottom) + 'px';
        this.root.classList.add('choices-active');
    }

    _safeBottom() {
        // Read the CSS variable set on :root that holds
        // env(safe-area-inset-bottom). Falls back to 0 if env() is
        // unsupported or the variable isn't set. Returns a number.
        if (this._cachedSafeBottom !== undefined) return this._cachedSafeBottom;
        const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--safe-bottom') || '0px';
        const v = parseFloat(raw);
        this._cachedSafeBottom = isFinite(v) ? v : 0;
        return this._cachedSafeBottom;
    }

    attachRunner(runner) {
        // The scene-base.js already wires runner.onLine/onChoices/
        // onCommand to dispatch between DOM panel updates and scene-
        // specific hooks. The panel doesn't need to rewire those; it
        // just remembers the current runner so clicks on the dialogue
        // box can call advance() on it.
        this._currentRunner = runner;
        // New runner = fresh dialogue tree. Reset the dismiss latch.
        this.resetAllSpoken();
        runner.onComplete && runner.onComplete(() => {
            // No more lines — keep the box visible (player may want
            // to re-read), but flag it so the NEXT click dismisses.
            this.markAllSpoken();
        });
    }
}

window.DialoguePanel = new DialoguePanel();
