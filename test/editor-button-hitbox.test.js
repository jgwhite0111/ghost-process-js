const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const editorSource = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const editorHtml = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
const story = JSON.parse(fs.readFileSync(path.join(ROOT, 'story.json'), 'utf8'));

test('intro START hitbox is stored as an editor-visible button control', () => {
    const start = story.scenes.intro.hitboxes.find((hb) => hb.label === 'PRESS START');
    assert.ok(start);
    assert.equal(start.type, 'button');
    assert.equal(start.target, 'cold_open');
});

test('editor exposes button/control presentation and informative overlay styling', () => {
    assert.match(editorSource, /'Presentation \/ type'/);
    assert.match(editorSource, /\['button', 'Button \/ control \(hand cursor\)'\]/);
    assert.match(editorSource, /div\.classList\.toggle\('button-control', isButton\)/);
    assert.match(editorSource, /button: \$\{hb\.label \|\| hb\.target \|\| 'control'\}/);
    assert.match(editorSource, /makeField\('target', 'Target scene'/,
        'button controls expose their transition target in the editor');
    assert.match(editorHtml, /\.hitbox-handle\.button-control\s*\{/);
});
