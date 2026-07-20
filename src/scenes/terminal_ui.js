// src/scenes/terminal_ui.js — Ink-backed terminal OS scene.
//
// The Grok-spliced 4:3 plate supplies only text-free chrome. All meaningful
// labels, the repository's existing isometric icons, module text, choices,
// and interaction states are composited here at runtime.

const TERMINAL_PLATE_W = 1152;
const TERMINAL_PLATE_H = 864;

const TERMINAL_APPS = [
    {
        id: 'log',
        label: 'LOG',
        title: 'SYSTEM LOG',
        code: 'SYS.LOG/ARCHIVE',
        icon: 'assets/icons/isometric/log.png',
    },
    {
        id: 'email',
        label: 'EMAIL',
        title: 'INTERNAL MAIL',
        code: 'COM.MAIL/LOCAL',
        icon: 'assets/icons/isometric/email.png',
    },
    {
        id: 'map',
        label: 'MAP',
        title: 'FACILITY MAP',
        code: 'NAV.OBELAB/SUB-2',
        icon: 'assets/icons/isometric/map.png',
    },
    {
        id: 'sysinfo',
        label: 'SYSINFO',
        title: 'SYSTEM INFORMATION',
        code: 'SYS.DIAG/READ-ONLY',
        icon: 'assets/icons/isometric/sysinfo.png',
    },
];

class TerminalUIScene extends Scene {
    constructor(sceneId) {
        super(sceneId);
        this._overlay = null;
        this._stage = null;
        this._content = null;
        this._choiceBar = null;
        this._title = null;
        this._moduleCode = null;
        this._footerModule = null;
        this._activeApp = null;
        this._launcherButtons = new Map();
        this._runnerWired = false;
        this._onTerminalResize = () => this._layoutStage();
    }

    onReady() {
        if (window.DialoguePanel) window.DialoguePanel.hide();
        // Scene.start() may create the inventory button immediately after
        // onReady(), so a body state class is more reliable than hiding the
        // current element reference once.
        document.body.classList.add('terminal-ui-active');

        this._buildOverlay();
        this._wireRunner();
        this._showDesktop();
    }

    // This plate is deliberately 4:3. Unlike exploration backgrounds, it must
    // remain completely visible so the launcher and command row cannot be
    // cropped off on widescreen or portrait displays.
    _drawBackground() {
        if (!this.bgImage || !this.canvas || !this.ctx) return;
        const source = this._ditheredBg || this.bgImage;
        const scale = Math.min(
            this.canvas.width / TERMINAL_PLATE_W,
            this.canvas.height / TERMINAL_PLATE_H,
        );
        const w = TERMINAL_PLATE_W * scale;
        const h = TERMINAL_PLATE_H * scale;
        const x = (this.canvas.width - w) / 2;
        const y = (this.canvas.height - h) / 2;

        this.ctx.fillStyle = '#01080c';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(source, x, y, w, h);
    }

    _buildOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'tui-overlay';
        overlay.setAttribute('role', 'application');
        overlay.setAttribute('aria-label', 'Sable terminal interface');

        const stage = document.createElement('div');
        stage.className = 'tui-stage';
        overlay.appendChild(stage);

        const header = document.createElement('header');
        header.className = 'tui-header';
        header.innerHTML = `
            <span class="tui-header-title">SABLE//TERM 04</span>
            <span class="tui-header-state"><i aria-hidden="true"></i> QUARANTINE LINK / LOCAL ONLY</span>
        `;
        stage.appendChild(header);

        const launcher = document.createElement('nav');
        launcher.className = 'tui-launcher';
        launcher.setAttribute('aria-label', 'Terminal modules');

        for (const app of TERMINAL_APPS) {
            const button = this._makeLauncherButton(app);
            launcher.appendChild(button);
            this._launcherButtons.set(app.id, button);
        }

        const exit = this._makeLauncherButton({
            id: 'exit',
            label: 'EXIT',
            title: 'Disconnect terminal',
            icon: 'assets/icons/isometric/exit.png',
        });
        exit.classList.add('tui-launcher-exit');
        exit.addEventListener('click', () => this._exitTerminal());
        launcher.appendChild(exit);
        stage.appendChild(launcher);

        const windowEl = document.createElement('section');
        windowEl.className = 'tui-window';
        windowEl.setAttribute('aria-live', 'polite');
        windowEl.innerHTML = `
            <div class="tui-titlebar">
                <span class="tui-titlebar-text"></span>
                <span class="tui-module-code"></span>
                <button class="tui-titlebar-close" type="button" aria-label="Return to terminal desktop">×</button>
            </div>
            <div class="tui-content"></div>
            <div class="tui-commandbar" aria-label="Module commands"></div>
        `;
        stage.appendChild(windowEl);

        const footer = document.createElement('footer');
        footer.className = 'tui-footer';
        footer.innerHTML = `
            <span>OBELAB INTERNAL NETWORK // NODE 07</span>
            <span class="tui-footer-module">SHELL READY</span>
        `;
        stage.appendChild(footer);

        const game = document.getElementById('game');
        (game || document.body).appendChild(overlay);

        this._overlay = overlay;
        this._stage = stage;
        this._content = windowEl.querySelector('.tui-content');
        this._choiceBar = windowEl.querySelector('.tui-commandbar');
        this._title = windowEl.querySelector('.tui-titlebar-text');
        this._moduleCode = windowEl.querySelector('.tui-module-code');
        this._footerModule = footer.querySelector('.tui-footer-module');

        windowEl.querySelector('.tui-titlebar-close').addEventListener('click', () => {
            this._showDesktop();
        });
        window.addEventListener('resize', this._onTerminalResize);
        this._layoutStage();
    }

    _makeLauncherButton(app) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tui-launcher-button';
        button.dataset.app = app.id;
        button.setAttribute('aria-label', app.title);

        const img = document.createElement('img');
        img.className = 'tui-icon-img';
        img.src = app.icon;
        img.alt = '';
        img.draggable = false;

        const label = document.createElement('span');
        label.className = 'tui-icon-label';
        label.textContent = app.label;

        button.append(img, label);
        if (app.id !== 'exit') {
            button.addEventListener('click', () => this._openApp(app));
        }
        return button;
    }

    _layoutStage() {
        if (!this._overlay || !this._stage) return;
        const width = this._overlay.clientWidth;
        const height = this._overlay.clientHeight;
        if (!width || !height) return;

        const scale = Math.min(width / TERMINAL_PLATE_W, height / TERMINAL_PLATE_H);
        const renderedW = TERMINAL_PLATE_W * scale;
        const renderedH = TERMINAL_PLATE_H * scale;
        this._stage.style.left = `${(width - renderedW) / 2}px`;
        this._stage.style.top = `${(height - renderedH) / 2}px`;
        this._stage.style.transform = `scale(${scale})`;
    }

    _wireRunner() {
        const runner = this.dialogueRunner;
        if (!runner || !runner.story || this._runnerWired) return;
        this._runnerWired = true;

        // Scene.start() has already surfaced the first Ink line through the
        // global dialogue runner. Cancel that hidden typewriter before
        // replacing its callbacks, otherwise each timer tick would append a
        // duplicate line inside this custom terminal window.
        runner.stop();

        // Terminal Ink is rendered inside the generated window, never in the
        // global dialogue panel. These callbacks also support future knots
        // that choose to advance through DialogueRunner normally.
        runner.onLine = (text, tags) => this._appendLine(text, tags);
        runner.onChoices = (choices) => this._renderChoices(choices);
        runner.onCommand = () => {};
    }

    _showDesktop() {
        this._activeApp = null;
        this._setActiveLauncher(null);
        this._title.textContent = 'SABLE SYSTEM SHELL';
        this._moduleCode.textContent = 'ROOT/INDEX';
        this._footerModule.textContent = 'SHELL READY';
        this._walkInk('desktop');
    }

    _openApp(app) {
        this._activeApp = app.id;
        this._setActiveLauncher(app.id);
        this._title.textContent = app.title;
        this._moduleCode.textContent = app.code;
        this._footerModule.textContent = `${app.label} // ACTIVE`;
        this._walkInk(app.id);
    }

    _setActiveLauncher(id) {
        for (const [appId, button] of this._launcherButtons) {
            const active = appId === id;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
    }

    _walkInk(knot) {
        if (!this._content || !this._choiceBar) return;
        this._content.replaceChildren();
        this._choiceBar.replaceChildren();

        const runner = this.dialogueRunner;
        const story = runner && runner.story;
        if (!story) {
            this._appendLine('[TERMINAL DATA UNAVAILABLE]', ['warn']);
            return;
        }

        try {
            // Each module is a read-only document. Resetting its Ink state
            // makes reopening a module deterministic even after a previous
            // RETURN choice reached END.
            if (typeof story.ResetState === 'function') story.ResetState();
            story.ChoosePathString(knot);
            let guard = 0;
            while (story.canContinue && guard++ < 200) {
                const line = story.Continue();
                const tags = story.currentTags || [];
                if (line.trim()) this._appendLine(line, tags, knot);
            }
            this._renderChoices(story.currentChoices || []);
        } catch (error) {
            console.error(`[terminal_ui] Ink knot '${knot}' failed`, error);
            this._appendLine('[MODULE READ ERROR]', ['warn']);
        }
    }

    _appendLine(text, tags = [], knot = this._activeApp) {
        if (!this._content || !String(text).trim()) return;
        const line = document.createElement('div');
        line.className = 'tui-line';
        line.textContent = String(text).replace(/\r?\n$/, '');

        const normalizedTags = tags.map((tag) => String(tag).split(':')[0].trim().toLowerCase());
        for (const tag of normalizedTags) {
            if (['warn', 'ok', 'dim', 'heading', 'divider'].includes(tag)) {
                line.classList.add(`tui-${tag}`);
            }
        }
        if (knot === 'map') line.classList.add('tui-map-line');
        if (/^\[HIGH PRIORITY\]|QUARANTINE|WARNING|OFFLINE|CONTAINMENT/i.test(line.textContent)) {
            line.classList.add('tui-warn');
        }
        if (/^(SUBJECT:|SYSTEM INFORMATION|OBELISK LABORATORIES|FACILITY MAP)/i.test(line.textContent)) {
            line.classList.add('tui-heading');
        }
        if (/^[─━═-]{5,}/.test(line.textContent.trim())) line.classList.add('tui-divider');

        this._content.appendChild(line);
    }

    _renderChoices(choices) {
        if (!this._choiceBar) return;
        this._choiceBar.replaceChildren();
        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tui-command';
            button.textContent = choice.text || 'RETURN';
            button.addEventListener('click', () => this._chooseInk(index));
            this._choiceBar.appendChild(button);
        });
    }

    _chooseInk(index) {
        const story = this.dialogueRunner && this.dialogueRunner.story;
        if (!story) return;
        try {
            story.ChooseChoiceIndex(index);
            this._showDesktop();
        } catch (error) {
            console.error('[terminal_ui] Ink choice failed', error);
            this._showDesktop();
        }
    }

    _exitTerminal() {
        if (window.Engine) window.Engine.goTo('terminal_obelab');
    }

    shutdown() {
        window.removeEventListener('resize', this._onTerminalResize);
        document.body.classList.remove('terminal-ui-active');
        if (this._overlay) this._overlay.remove();
        this._overlay = null;
        this._stage = null;
        this._runnerWired = false;
        super.shutdown();
    }
}

window.Engine.register('terminal_ui', TerminalUIScene);
