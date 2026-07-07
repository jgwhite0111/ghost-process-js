// src/dialogue.js — InkJS story walker + typewriter presenter
//
// Loads the Ink file referenced by the current scene, walks the story,
// handles tags (# speaker:NAME, # portrait:NAME, # give:ITEM, etc.),
// and renders text with typewriter effect.
//
// In v2 (no Phaser) the runner is purely JS — DOM dialogue box, no
// scene plugin involved. The runner fires events for scene listeners:
//   - onLine(text, tags, typed-so-far, total) — typewriter ticks
//   - onChoices(choices) — choice buttons appeared
//   - onCommand(key, args) — Ink-level commands (tags + EXTERNAL calls)
//   - onComplete() — story ended
//
// EXTERNAL functions called from Ink are bound here:
//   transition_next() — looks up STORY.next[sceneId] and asks Engine
//                       to navigate; uses _suppressStep so the post-
//                       transition step() doesn't trigger Ink's
//                       "ran out of content" warning.

class DialogueRunner {
    constructor(inkText, callbacks = {}) {
        this.story = null;
        this.currentLine = '';
        this.currentTags = [];
        this.typewriterTimer = null;
        this.typing = false;
        this.onLine = callbacks.onLine || (() => {});
        this.onChoices = callbacks.onChoices || (() => {});
        this.onCommand = callbacks.onCommand || (() => {});
        this._onCompleteFns = [];
        // Back-compat: callers that still pass onComplete in the
        // callbacks bag get the same first-party dispatch.
        if (typeof callbacks.onComplete === 'function') {
            this._onCompleteFns.push(callbacks.onComplete);
        }
        // New API: runner.onComplete(fn) registers a listener. Multiple
        // listeners are supported (panel + scene can both subscribe).
        // Calling without args fires all registered listeners (used by
        // the runner itself when Ink is exhausted).
        this.onComplete = (fnOrFire) => {
            if (typeof fnOrFire === 'function') {
                this._onCompleteFns.push(fnOrFire);
                return;
            }
            // No arg = dispatch.
            for (const cb of this._onCompleteFns) {
                try { cb(); } catch (e) { console.warn('[dialogue] onComplete listener threw', e); }
            }
        };

        try {
            const compiler = new inkjs.Compiler(inkText);
            this.story = compiler.Compile();
            if (compiler.errors && compiler.errors.length > 0) {
                console.error('Ink compilation errors:', compiler.errors);
                this.onLine('[Ink error] ' + (compiler.errors[0]?.message || 'unknown'));
                return;
            }
        } catch (err) {
            console.error('Ink compilation failed:', err);
            this.onLine('[Ink fatal] ' + err.message);
            return;
        }

        // EXTERNAL transition_next(): defers to the engine via a tag-like
        // command. Scene sets this._sceneId before step() is called.
        this._sceneId = '?';
        this.story.BindExternalFunction('transition_next', () => {
            const nextId = (window.STORY.next || {})[this._sceneId];
            this._suppressStep = true;
            this.onCommand('transition_next', [nextId || null]);
        });
        this.story.BindExternalFunction('return_to_alley', () => {
            this.onCommand('return_to_alley', []);
        });
        this.story.BindExternalFunction('has', (itemId) => {
            return (window.STATE?.inventory || []).indexOf(itemId) !== -1;
        });
        // EXTERNAL complete_task(id) — Ink signals a `custom` task is
        // done. The TaskTracker singleton records it; the scene's
        // dismiss hook picks up the next-open hint afterwards.
        this.story.BindExternalFunction('complete_task', (taskId) => {
            if (window.TaskTracker) window.TaskTracker.complete(taskId);
        });

        // Don't auto-start here — the caller may need to wire runner.onLine/
        // onChoices/onCommand BEFORE the first step() pulls a line. Use
        // runner.start() explicitly after wiring.
    }

    bindExternal(name, fn) {
        // If the binding already exists for this name, replace it. InkJS
        // throws on double-bind; we sidestep that by skipping the rebind
        // if the existing function was already set (the constructor
        // binds all the known externals up front, so scene-base shouldn't
        // need to call this at all).
        if (!this.story) return;
        try {
            this.story.BindExternalFunction(name, fn);
        } catch (e) {
            console.warn('[dialogue] bindExternal failed for', name, e.message);
        }
    }

    start() {
        this.step();
    }

    step() {
        if (this._suppressStep) {
            this._suppressStep = false;
            return;
        }
        if (!this.story) return;
        const maxLinesPerStep = 100;
        let walked = 0;
        // Walk past blank lines and surface the FIRST non-empty line
        // so the typewriter / speaker / portrait hooks fire one line
        // at a time. After surfacing the line, return immediately so
        // the player gets to read it before the next click.
        while (this.story.canContinue && walked < maxLinesPerStep) {
            walked++;
            const line = this.story.Continue();
            const tags = this.story.currentTags || [];
            if (line.trim() === '') continue;
            for (const tag of tags) {
                const [key, value] = tag.split(':').map(s => s.trim());
                if (!key) continue;
                this.onCommand(key, value ? [value] : []);
            }
            this.showLine(line, tags);
            // After surfacing a line, Ink may now be empty (single-line
            // scene) or choices may be on the stack. Either way the
            // player has everything they need to read — fire onComplete
            // so the panel can mark the box dismissable on next click
            // rather than making the player no-op step() through an
            // empty story.
            if (!this.story.canContinue && (!this.story.currentChoices || this.story.currentChoices.length === 0)) {
                // Defer until the typewriter finishes so the player sees
                // the line before the box tries to disappear on them.
                setTimeout(() => {
                    if (!this.typing) this.onComplete();
                }, this.typing ? Math.max(50, (this.currentLine?.length || 0) * 30 + 80) : 50);
            }
            return;
        }
        // Ink has nothing more to emit (canContinue === false). At
        // this point either:
        //   (a) the story has choices waiting — the player just walked
        //       past the last line of a `*` / `+` choice block and the
        //       choice list is on the stack. Surface them now so the
        //       DOM choice buttons appear without an extra "blank"
        //       click. Without this branch, the player would have to
        //       click through a no-op step() to see the choice buttons.
        //   (b) the story ended cleanly (-> END, end-of-file).
        // Either way the per-line return above already pulled the
        // final line and called showLine, so we don't risk showing it
        // twice.
        if (this.story.currentChoices && this.story.currentChoices.length > 0) {
            this.onChoices(this.story.currentChoices);
        } else {
            this.onComplete();
        }
    }

    choose(index) {
        if (!this.story) return;
        this.story.ChooseChoiceIndex(index);
        this.step();
    }

    // Externally mark Ink as exhausted (used by dialogue-panel/dismiss
    // flow when a scene chooses a goto redirect and we want to suppress
    // the next step so the empty story doesn't fire onComplete).
    markAllDone() { this._allDone = true; }
    // Same name as the older method (kept for scenes that still call it).
    _cancelNextStep() { this._suppressStep = true; }

    showLine(line, tags) {
        this.typing = true;
        this.currentLine = line;
        this.currentTags = tags;
        this.onLine(line, tags, 0, line.length);
        let i = 0;
        const target = line;
        const self = this;
        if (this.typewriterTimer) clearInterval(this.typewriterTimer);
        this.typewriterTimer = setInterval(() => {
            i++;
            self.onLine(target, tags, i, target.length);
            if (i >= target.length) {
                clearInterval(self.typewriterTimer);
                self.typewriterTimer = null;
                self.typing = false;
            }
        }, 30);
    }

    advance() {
        if (!this.story) return;
        if (this.typing) {
            if (this.typewriterTimer) {
                clearInterval(this.typewriterTimer);
                this.typewriterTimer = null;
            }
            this.typing = false;
            this.onLine(this.currentLine, this.currentTags, this.currentLine.length, this.currentLine.length);
            // After snap-finishing the typewriter, check whether Ink
            // is now sitting on a choice point. step()'s walk loop
            // returns early after showLine, so the choice/complete
            // branch at the bottom of step() doesn't fire when we
            // snap a line that turned out to be the LAST line of a
            // choice beat. Stepping once more lets step() see
            // canContinue === false and route to onChoices.
            // step() is a no-op when there are still lines to walk,
            // so this is safe — the player won't see a "ghost" line.
            this.step();
        } else {
            this.step();
        }
    }

    stop() {
        if (this.typewriterTimer) {
            clearInterval(this.typewriterTimer);
            this.typewriterTimer = null;
        }
    }
}

window.DialogueRunner = DialogueRunner;
