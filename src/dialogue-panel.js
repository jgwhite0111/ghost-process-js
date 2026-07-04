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

class DialoguePanel {
    constructor() {
        this.root = null;
        this.textEl = null;
        this.speakerEl = null;
        this.continueEl = null;
        this.choicesEl = null;
        this._currentRunner = null;
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
            // Otherwise advance the runner.
            if (this.choicesEl && this.choicesEl.offsetParent !== null) return;
            if (this._currentRunner) this._currentRunner.advance();
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
                if (this._currentRunner) this._currentRunner.advance();
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
    }

    setSpeaker(name) {
        this.speakerEl.textContent = name || '';
        this.speakerEl.style.display = name ? 'inline-block' : 'none';
    }

    setText(visibleText) {
        this.textEl.textContent = visibleText;
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
            this.setHasMore(true);
            return;
        }
        this.setHasMore(false);
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
    }

    attachRunner(runner) {
        // The scene-base.js already wires runner.onLine/onChoices/
        // onCommand to dispatch between DOM panel updates and scene-
        // specific hooks. The panel doesn't need to rewire those; it
        // just remembers the current runner so clicks on the dialogue
        // box can call advance() on it.
        this._currentRunner = runner;
        runner.onComplete && runner.onComplete(() => {
            // No more lines — dialogue is finished. The next click on
            // the dialogue box will now advance whatever scene logic
            // is listening (typically transition_next from Ink). The
            // panel itself stays visible: an Ink scene can finish
            // mid-scene (e.g. after choices) and the next thing is
            // a visual transition, not a UI change.
        });
    }
}

window.DialoguePanel = new DialoguePanel();
