// src/dialogue.js — InkJS story walker + typewriter presenter
//
// Loads the Ink file referenced by the current scene, walks the story,
// handles tags (# speaker:NAME, # portrait:NAME, # give:ITEM, etc.),
// and renders text with typewriter effect + speaker portrait.

class DialogueRunner {
    constructor(inkText, onLine, onChoices, onCommand, onComplete) {
        this.story = null;
        this.currentLine = '';
        this.typewriterTimer = null;
        this.typing = false;
        this.onLine = onLine;
        this.onChoices = onChoices;
        this.onCommand = onCommand;
        this.onComplete = onComplete;

        // Compile Ink source. InkJS 2.x exposes a global `inkjs` namespace
        // with both `Compiler` and `Story`. Compiler.Compile() returns a
        // Story directly (no intermediate JSON needed).
        try {
            const compiler = new inkjs.Compiler(inkText);
            this.story = compiler.Compile();
            if (compiler.errors && compiler.errors.length > 0) {
                console.error('Ink compilation errors for: ' + inkText.slice(0, 60) + '...');
                for (const e of compiler.errors) console.error('  ' + e);
                // Show in dialogue box so the developer can see what's wrong.
                if (this.onLine) this.onLine('[Ink error] ' + compiler.errors[0], [], 0, 0);
                return;
            }
        } catch (err) {
            console.error('Ink compilation failed:', err);
            if (this.onLine) this.onLine('[Ink fatal] ' + err.message, [], 0, 0);
            return;
        }

        // Register external functions called from Ink via EXTERNAL.
        this.story.BindExternalFunction('return_to_alley', () => {
            this.onCommand && this.onCommand('return_to_alley', []);
        });

        // Tags are read after each Continue() call.
        this.story.BindExternalFunction('has', (itemId) => {
            return window.STATE.inventory.indexOf(itemId) !== -1;
        });

        this.start();
    }

    start() {
        this.step();
    }

    step() {
        if (!this.story) return;

        // Walk through lines until we hit a choice or end.
        while (this.story.canContinue) {
            const line = this.story.Continue();
            const tags = this.story.currentTags || [];

            if (line.trim() === '') continue;  // skip blank lines

            // Tags drive game state. Recognized tags:
            //   # speaker:NAME        — animate mouth on sprite NAME
            //   # portrait:NAME       — show portrait (or 'none' to hide)
            //   # give:ITEM_ID        — add item to inventory
            //   # take:ITEM_ID        — remove item
            //   # goto:SCENE_ID       — transition to scene
            //   # music:MP3_FILE      — swap music
            //   # background:PLATE_ID — swap background
            for (const tag of tags) {
                const [key, value] = tag.split(':').map(s => s.trim());
                if (!key) continue;
                this.onCommand && this.onCommand(key, value ? [value] : []);
            }

            this.showLine(line, tags);
            return;  // wait for click before next line
        }

        // No more lines to continue: either choices or end.
        if (this.story.currentChoices && this.story.currentChoices.length > 0) {
            this.onChoices && this.onChoices(this.story.currentChoices);
        } else {
            this.onComplete && this.onComplete();
        }
    }

    choose(index) {
        if (!this.story) return;
        this.story.ChooseChoiceIndex(index);
        this.step();
    }

    showLine(line, tags) {
        this.typing = true;
        this.currentLine = line;
        this.currentTags = tags;
        this.onLine && this.onLine(line, tags, /* typed-so-far */ 0, /* full */ line.length);

        // Typewriter effect. 30ms per char.
        let i = 0;
        const target = line;
        const self = this;
        if (this.typewriterTimer) clearInterval(this.typewriterTimer);
        this.typewriterTimer = setInterval(() => {
            i++;
            self.onLine && self.onLine(target, tags, i, target.length);
            if (i >= target.length) {
                clearInterval(self.typewriterTimer);
                self.typewriterTimer = null;
                self.typing = false;
            }
        }, 30);
    }

    // User clicked: finish typewriter instantly (snap to full text), or
    // advance to next line if already fully revealed.
    advance() {
        if (!this.story) return;
        if (this.typing) {
            // Skip typewriter: stop the timer AND immediately render the
            // full line. Without this, the partial text would freeze on
            // screen and a second click would jump past the line entirely.
            if (this.typewriterTimer) {
                clearInterval(this.typewriterTimer);
                this.typewriterTimer = null;
            }
            this.typing = false;
            // Re-fire the presenter's onLine with the FULL text by
            // re-emitting the line we already have cached in currentLine.
            this.onLine && this.onLine(
                this.currentLine,
                this.currentTags || [],
                this.currentLine.length,
                this.currentLine.length
            );
        } else {
            this.step();
        }
    }
}

window.DialogueRunner = DialogueRunner;