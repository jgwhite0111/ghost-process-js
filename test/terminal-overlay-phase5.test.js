import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const story = JSON.parse(fs.readFileSync(path.join(ROOT, 'story.json'), 'utf8'));
const terminal = story.scenes.terminal_ui;
const overlay = terminal.overlay;
const byId = id => overlay.elements.find(element => element.id === id);

function actionsFor(id) {
    return byId(id)?.events?.activate?.actions || [];
}

test('terminal_ui is fully authored as a contained generic overlay', () => {
    assert.equal(terminal.bgFit, 'contain');
    assert.deepEqual(terminal.hud, { inventory: false });
    assert.deepEqual(overlay.views, ['desktop', 'log', 'email', 'map', 'sysinfo']);
    assert.equal(overlay.initialView, 'desktop');
    assert.deepEqual([overlay.designWidth, overlay.designHeight], [1152, 864]);
    assert.equal(overlay.elements.length, 56);

    for (const id of [
        'header', 'header_status', 'launcher_rail', 'module_window', 'titlebar',
        'content_frame', 'ink_lines', 'ink_lines_map', 'command_bar', 'ink_choices', 'footer',
    ]) assert.ok(byId(id), `missing authored terminal element ${id}`);

    for (const app of ['log', 'email', 'map', 'sysinfo', 'exit']) {
        assert.equal(byId(`launcher_${app}`).type, 'container');
        assert.equal(byId(`launcher_${app}_icon`).type, 'image');
        assert.equal(byId(`launcher_${app}_label`).type, 'text');
        assert.equal(byId(`launcher_${app}_hotspot`).type, 'hotspot');
        if (app !== 'exit') assert.deepEqual(byId(`launcher_${app}_active_plate`).visibleIn, [app]);
    }

    assert.deepEqual(byId('ink_lines').content, {
        source: 'inkLines',
        tagStyles: { heading: 'heading', warn: 'warning', ok: 'success', dim: 'dim', divider: 'divider' },
    });
    assert.deepEqual(byId('ink_lines').visibleIn, ['desktop', 'log', 'email', 'sysinfo']);
    assert.deepEqual(byId('ink_lines_map').visibleIn, ['map']);
    assert.equal(byId('ink_lines_map').style.fontSize, 'calc(var(--overlay-scale) * 15px)');
    assert.equal(byId('ink_lines_map').style.lineHeight, 'calc(var(--overlay-scale) * 23.5px)');
    assert.equal(byId('ink_choices').content.source, 'inkChoices');
    assert.equal(byId('ink_choices').content.controlPreset, 'terminal-command');
});

test('terminal launcher actions preserve the legacy module routes and exit destination', () => {
    for (const app of ['log', 'email', 'map', 'sysinfo']) {
        assert.deepEqual(actionsFor(`launcher_${app}_hotspot`), [
            { type: 'setView', view: app },
            { type: 'openInk', knot: app },
        ]);
        assert.deepEqual(byId(`launcher_${app}`).activeIn, [app]);
    }
    assert.deepEqual(actionsFor('launcher_exit_hotspot'), [{ type: 'goToScene', scene: 'terminal_obelab' }]);
    assert.deepEqual(actionsFor('titlebar_close'), [
        { type: 'setView', view: 'desktop' },
        { type: 'openInk', knot: 'desktop' },
    ]);
    assert.deepEqual(byId('ink_choices').events.choiceSelected.actions, [{ type: 'setView', view: 'desktop' }]);
});

test('terminal overlay keeps authored styling scalable against the fitted stage', () => {
    assert.equal(byId('ink_lines').style.fontSize, 'calc(var(--overlay-scale) * 17px)');
    assert.equal(byId('ink_lines').style.lineHeight, 'calc(var(--overlay-scale) * 26px)');
    assert.equal(byId('title_desktop').visibleIn[0], 'desktop');
    assert.equal(byId('title_log').visibleIn[0], 'log');
    assert.equal(byId('footer_sysinfo').visibleIn[0], 'sysinfo');
});
