// src/scenes/boot.js — preload all assets, then start intro scene.
//
// Phaser's loader is synchronous in setup but async in completion. To enumerate
// sprite frame globs at runtime we need a server round-trip BEFORE we call
// this.load.image(). Boot handles this: fetch /api/list for each glob, queue
// loads with predictable keys, then transition to the first scene.

window.BootScene = class BootScene extends Phaser.Scene {
    constructor() {
        super('Boot');
    }

    preload() {
        const w = this.scale.width;
        const h = this.scale.height;

        // Loading UI: a small "LOADING…" label and a horizontal progress
        // bar centered on the canvas. The bar is drawn directly with
        // Phaser Graphics so it scales with the canvas and renders
        // crisply at any DPI (no font dependency, no <img> fallback).
        // Phaser fires `progress` events as the loader advances.
        const barW = Math.min(280, w * 0.6);
        const barH = 8;
        const barX = (w - barW) / 2;
        const barY = h / 2 + 24;

        this.add.text(w / 2, h / 2 - 24, 'LOADING…', {
            fontFamily: 'NouveauIBM, PC98Serif, monospace',
            fontSize: '14px',
            color: '#d4a045',
            stroke: '#000',
            strokeThickness: 1
        }).setOrigin(0.5);

        const frame = this.add.graphics();
        frame.lineStyle(1, 0xd4a045, 1);
        frame.strokeRect(barX, barY, barW, barH);

        const fill = this.add.graphics();
        const drawFill = (pct) => {
            fill.clear();
            fill.fillStyle(0xd4a045, 1);
            fill.fillRect(barX + 1, barY + 1, (barW - 2) * pct, barH - 2);
        };
        drawFill(0);

        this.load.on('progress', (value) => drawFill(value));

        // Preload every scene's background, music, and sprite frames.
        // v1 assumption: every sprite uses the 16-frame chroma-keyed idle
        // animation (idle_01.png .. idle_16.png). If we later add scene-
        // specific animations, swap this for a runtime /api/list call.
        for (const [sceneId, scene] of Object.entries(window.STORY.scenes)) {
            // Background.
            if (scene.bg) {
                this.load.image(scene.bg, `assets/backgrounds/${scene.bg}.png`);
            }

            // Music.
            if (scene.music) {
                this.load.audio('music_' + scene.music, `assets/audio/${scene.music}`);
            }

            // Sprite frames: glob pattern "<dir><prefix>_*.png", 16 frames.
            for (const char of scene.characters || []) {
                const sprites = (char.scenes || {})[sceneId] || {};
                if (sprites.frames) {
                    const m = sprites.frames.match(/^(.+\/)([^/]+)_\*\.png$/);
                    if (m) {
                        const dir = m[1];
                        const prefix = m[2];
                        for (let i = 1; i <= 16; i++) {
                            const num = String(i).padStart(2, '0');
                            const key = `${char.id}_${sceneId}_frame_${num}`;
                            this.load.image(key, `${dir}${prefix}_${num}.png`);
                        }
                    }
                }
            }
        }
    }

    create() {
        // Apply PC98 post-fx pipeline globally.
        if (window.PC98Pipeline) {
            this.game.renderer.pipelines.addPostPipeline('PC98Pipeline', window.PC98Pipeline);
        }
        // Jump straight to intro.
        this.scene.start(window.STORY.start);
    }
};