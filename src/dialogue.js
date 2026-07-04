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
        this.onComplete = callbacks.onComplete || (() => {});

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
            return;
        }
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

    _cancelNextStep() {
        this._suppressStep = true;
    }

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
