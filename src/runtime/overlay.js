// src/runtime/overlay.js — generic scene-local overlay DOM, views, and Ink bindings.
(() => {
    const ELEMENT_TYPES = Object.freeze(['container', 'image', 'text', 'hotspot']);
    const CONTENT_SOURCES = Object.freeze(['literal', 'inkLines', 'inkChoices']);

    function fittedStageRect(sceneConfig, canvas) {
        const overlay = sceneConfig?.overlay;
        const dstW = canvas?.width || canvas?.clientWidth || 0;
        const dstH = canvas?.height || canvas?.clientHeight || 0;
        const designW = overlay?.designWidth;
        const designH = overlay?.designHeight;
        if (sceneConfig?.bgFit === 'contain' &&
            Number.isFinite(designW) && designW > 0 &&
            Number.isFinite(designH) && designH > 0 &&
            window.Runtime?.containRect) {
            return window.Runtime.containRect(designW, designH, dstW, dstH);
        }
        return { x: 0, y: 0, w: dstW, h: dstH };
    }

    function applyRect(node, element) {
        node.style.left = `${element.x * 100}%`;
        node.style.top = `${element.y * 100}%`;
        node.style.width = `${element.w * 100}%`;
        node.style.height = `${element.h * 100}%`;
    }

    function applyStyle(node, element) {
        const style = element.style || {};
        if (typeof style.background === 'string') node.style.background = style.background;
        if (typeof style.borderColor === 'string') node.style.borderColor = style.borderColor;
        if (Number.isFinite(style.borderWidth)) {
            node.style.borderStyle = 'solid';
            node.style.borderWidth = `${style.borderWidth}px`;
        }
        if (Number.isFinite(style.padding)) node.style.padding = `${style.padding}px`;
        if (Number.isFinite(style.opacity)) node.style.opacity = String(style.opacity);
        if (typeof style.color === 'string') node.style.color = style.color;
        if (['left', 'center', 'right'].includes(style.align)) node.style.textAlign = style.align;
        for (const key of ['fontSize', 'lineHeight', 'letterSpacing', 'fontFamily', 'fontWeight', 'textTransform', 'whiteSpace']) {
            if (typeof style[key] === 'string' || Number.isFinite(style[key])) node.style[key] = String(style[key]);
        }
        if (typeof style.overflow === 'string') node.style.overflow = style.overflow;
        if (typeof style.cursor === 'string') node.style.cursor = style.cursor;
        if (style.bevel === 'inset') node.classList.add('overlay-bevel-inset');
        else if (style.bevel === 'outset') node.classList.add('overlay-bevel-outset');
    }

    function isVisibleInView(element, view) {
        return !Array.isArray(element?.visibleIn) || element.visibleIn.includes(view);
    }

    function isActiveInView(element, view) {
        return Array.isArray(element?.activeIn) && element.activeIn.includes(view);
    }

    function clearNode(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        // Tiny DOM fixtures used by unit tests expose children but not firstChild.
        if (Array.isArray(node.children)) {
            for (const child of node.children) child.parentElement = null;
            node.children.length = 0;
        }
        if ('textContent' in node) node.textContent = '';
    }

    function styleClassName(value) {
        return `overlay-tag-${String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
    }

    function makeNode(element, activate) {
        let node;
        if (element.type === 'image') {
            node = document.createElement('img');
            node.src = element.asset;
            node.alt = element.alt || '';
            node.draggable = false;
            node.style.objectFit = element.fit || 'contain';
            if (element.pixelated !== false) node.style.imageRendering = 'pixelated';
        } else if (element.type === 'text') {
            node = document.createElement('div');
            node.textContent = element.text || '';
        } else if (element.type === 'hotspot') {
            node = document.createElement('button');
            node.type = 'button';
            node.setAttribute('aria-label', element.label || element.id);
            node.dataset.presentation = element.presentation || 'invisible';
            node.addEventListener('pointerdown', (event) => event.stopPropagation());
            node.addEventListener('click', (event) => {
                event.stopPropagation();
                activate(element, event);
            });
        } else {
            node = document.createElement('div');
        }
        node.classList.add('scene-overlay-element', `scene-overlay-${element.type}`);
        node.dataset.overlayId = element.id;
        applyRect(node, element);
        applyStyle(node, element);
        if (element.type === 'container' && element.clip === true) node.style.overflow = 'hidden';
        return node;
    }

    class OverlayLayer {
        constructor({ canvas, scene, sceneConfig }) {
            this.canvas = canvas;
            this.scene = scene;
            this.sceneConfig = sceneConfig;
            this.root = null;
            this.stage = null;
            this.nodes = new Map();
            this.activeView = null;
            this.inkStory = null;
            this.inkLines = [];
            this._destroyed = false;
            this._onResize = () => this.layout();
        }

        mount() {
            const config = this.sceneConfig.overlay;
            if (!config || !Array.isArray(config.elements)) return;
            const parent = this.canvas.parentElement;
            if (!parent) return;

            this._destroyed = false;
            this.activeView = config.initialView || config.views?.[0] || null;
            this.root = document.createElement('div');
            this.root.className = 'scene-overlay-root';
            this.root.dataset.sceneId = this.scene.sceneId;
            this.stage = document.createElement('div');
            this.stage.className = 'scene-overlay-stage';
            this.root.appendChild(this.stage);
            parent.appendChild(this.root);

            for (const element of config.elements) {
                this.nodes.set(element.id, makeNode(element, (item, event) => {
                    const actions = item.events?.activate?.actions || [];
                    window.ActionExecutor.execute(actions, {
                        scene: this.scene,
                        pageX: event.pageX,
                        pageY: event.pageY,
                        fromOverlay: true,
                    });
                }));
            }
            // Preserve authored array order among siblings while allowing a
            // child to appear before its parent in the flat persisted array.
            for (const element of config.elements) {
                const parentNode = element.parent ? this.nodes.get(element.parent) : this.stage;
                parentNode.appendChild(this.nodes.get(element.id));
            }
            this.applyView();
            this.layout();
            window.addEventListener('game:canvas-resized', this._onResize);
        }

        hasInkContent() {
            return !!this.sceneConfig.overlay?.elements?.some(element =>
                ['inkLines', 'inkChoices'].includes(element.content?.source));
        }

        bindInk(source) {
            if (!this.hasInkContent()) return { handled: false, ok: false };
            try {
                this.inkStory = new window.inkjs.Compiler(source).Compile();
                return { handled: true, ok: true };
            } catch (error) {
                this.inkStory = null;
                this.reportInkError('Ink compilation failed', error);
                return { handled: true, ok: false, error };
            }
        }

        startInk() {
            if (!this.inkStory) return { handled: this.hasInkContent(), ok: false };
            return this.renderInk();
        }

        openInk(knot) {
            if (!this.hasInkContent()) return { handled: false, ok: false };
            if (!this.inkStory) {
                const error = new Error('Ink content is not initialized');
                this.reportInkError(error.message, error);
                return { handled: true, ok: false, error };
            }
            try {
                // Authored document modules are deterministic entry points: reopening
                // a knot must not inherit a prior choice path or exhausted state.
                if (typeof this.inkStory.ResetState === 'function') this.inkStory.ResetState();
                this.inkStory.ChoosePathString(knot);
                return this.renderInk();
            } catch (error) {
                this.reportInkError(`Missing Ink knot "${knot}"`, error);
                return { handled: true, ok: false, error };
            }
        }

        renderInk() {
            if (!this.inkStory || this._destroyed) return { handled: true, ok: false };
            this.inkLines = [];
            try {
                while (this.inkStory.canContinue) {
                    const text = this.inkStory.Continue().replace(/\r?\n$/, '');
                    this.inkLines.push({ text, tags: [...(this.inkStory.currentTags || [])] });
                }
                this.renderInkRegions();
                return { handled: true, ok: true };
            } catch (error) {
                this.reportInkError('Ink rendering failed', error);
                return { handled: true, ok: false, error };
            }
        }

        renderInkRegions() {
            if (this._destroyed) return;
            for (const element of this.sceneConfig.overlay?.elements || []) {
                const source = element.content?.source;
                if (source === 'inkLines') this.renderInkLines(element);
                else if (source === 'inkChoices') this.renderInkChoices(element);
            }
        }

        renderInkLines(element) {
            const node = this.nodes.get(element.id);
            if (!node) return;
            clearNode(node);
            const tagStyles = element.content?.tagStyles || {};
            for (const line of this.inkLines) {
                const row = document.createElement('div');
                row.classList.add('scene-overlay-ink-line');
                row.textContent = line.text;
                for (const tag of line.tags) {
                    const preset = tagStyles[tag];
                    if (typeof preset === 'string' && preset.trim()) row.classList.add(styleClassName(preset));
                }
                node.appendChild(row);
            }
        }

        renderInkChoices(element) {
            const node = this.nodes.get(element.id);
            if (!node) return;
            clearNode(node);
            for (const choice of this.inkStory?.currentChoices || []) {
                const button = document.createElement('button');
                button.type = 'button';
                button.classList.add('scene-overlay-ink-choice');
                if (element.content?.controlPreset) button.dataset.controlPreset = element.content.controlPreset;
                button.textContent = choice.text;
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.selectInkChoice(element, choice.index);
                });
                node.appendChild(button);
            }
        }

        selectInkChoice(element, choiceIndex) {
            if (!this.inkStory || this._destroyed) return { ok: false };
            try {
                this.inkStory.ChooseChoiceIndex(choiceIndex);
                const result = window.ActionExecutor.execute(
                    element.events?.choiceSelected?.actions || [],
                    { scene: this.scene, fromOverlay: true },
                );
                if (!result.transitioned && !this._destroyed) this.renderInk();
                return result;
            } catch (error) {
                this.reportInkError(`Ink choice ${choiceIndex} failed`, error);
                return { ok: false, error };
            }
        }

        reportInkError(message, error) {
            console.warn(`[${this.scene.sceneId}] ${message}`, error);
            this.inkLines = [{ text: `[${message}]`, tags: [] }];
            this.renderInkRegions();
        }

        setView(view) {
            const views = this.sceneConfig.overlay?.views || [];
            if (!views.includes(view)) {
                console.warn(`[${this.scene.sceneId}] overlay view "${view}" does not exist`);
                return false;
            }
            this.activeView = view;
            this.applyView();
            return true;
        }

        applyView() {
            for (const element of this.sceneConfig.overlay?.elements || []) {
                const node = this.nodes.get(element.id);
                if (!node) continue;
                node.hidden = !isVisibleInView(element, this.activeView);
                node.dataset.active = isActiveInView(element, this.activeView) ? 'true' : 'false';
                if (element.type === 'hotspot') node.setAttribute('aria-pressed', node.dataset.active);
            }
            if (this.root) this.root.dataset.activeView = this.activeView || '';
        }

        layout() {
            if (!this.stage) return;
            const rect = fittedStageRect(this.sceneConfig, this.canvas);
            Object.assign(this.stage.style, {
                left: `${rect.x}px`, top: `${rect.y}px`,
                width: `${rect.w}px`, height: `${rect.h}px`,
            });
            const designWidth = this.sceneConfig.overlay?.designWidth;
            const scale = Number.isFinite(designWidth) && designWidth > 0 ? rect.w / designWidth : 1;
            if (typeof this.stage.style.setProperty === 'function') this.stage.style.setProperty('--overlay-scale', String(scale));
            else this.stage.style['--overlay-scale'] = String(scale);
        }

        destroy() {
            this._destroyed = true;
            window.removeEventListener('game:canvas-resized', this._onResize);
            if (this.root) this.root.remove();
            this.nodes.clear();
            this.inkStory = null;
            this.inkLines = [];
            this.root = null;
            this.stage = null;
        }
    }

    window.OverlayRuntime = Object.freeze({
        OverlayLayer,
        ELEMENT_TYPES,
        CONTENT_SOURCES,
        fittedStageRect,
        applyRect,
        applyStyle,
        isVisibleInView,
        isActiveInView,
    });
})();
