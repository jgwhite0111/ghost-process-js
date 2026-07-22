const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStory } = require('../server.js');

function storyWithOverlay() {
    return {
        start: 'room',
        items: { key: { id: 'key', name: 'Key' } },
        scenes: {
            room: {
                id: 'room', kind: 'ink', hitboxes: [], bgFit: 'contain', hud: { inventory: false },
                overlay: {
                    designWidth: 1152, designHeight: 864,
                    elements: [
                        { id: 'panel', type: 'container', x: 0.1, y: 0.1, w: 0.8, h: 0.6, clip: true },
                        { id: 'heading', type: 'text', parent: 'panel', x: 0.05, y: 0.05, w: 0.9, h: 0.1, text: 'ACCESS' },
                        { id: 'art', type: 'image', parent: 'panel', x: 0.05, y: 0.2, w: 0.4, h: 0.6, asset: 'assets/items/key.png' },
                        { id: 'open', type: 'hotspot', parent: 'panel', x: 0.5, y: 0.2, w: 0.4, h: 0.2, label: 'Open', presentation: 'control', events: { activate: { actions: [{ type: 'giveItem', item: 'key' }, { type: 'goToScene', scene: 'exit' }] } } },
                    ],
                },
            },
            exit: { id: 'exit', kind: 'end', hitboxes: [] },
        },
    };
}

test('production validator accepts the Phase 3 overlay schema and typed action references', () => {
    assert.equal(validateStory(storyWithOverlay()), null);
});

test('production validator rejects malformed overlay identity, geometry, hierarchy, and actions', () => {
    const cases = [
        [s => { s.scenes.room.overlay.elements[1].id = 'panel'; }, /duplicates overlay element/],
        [s => { delete s.scenes.room.overlay.elements[1].x; }, /\.x is required/],
        [s => { s.scenes.room.overlay.elements[1].w = 1.2; }, /\.w must be between 0 and 1/],
        [s => { s.scenes.room.overlay.elements[1].parent = 'missing'; }, /references missing parent/],
        [s => { s.scenes.room.overlay.elements[0].parent = 'heading'; }, /parent "heading" is not a container/],
        [s => { s.scenes.room.overlay.elements[0].parent = 'panel'; }, /parent cycle/],
        [s => { s.scenes.room.overlay.elements[3].events.activate.actions[0].item = 'missing'; }, /references missing item/],
        [s => { s.scenes.room.overlay.elements[3].events.activate.actions = {}; }, /actions must be an array/],
        [s => { s.scenes.room.overlay.elements[2].asset = 'https:\/\/example.test\/x.png'; }, /project asset path/],
    ];
    for (const [mutate, expected] of cases) {
        const story = storyWithOverlay(); mutate(story);
        assert.match(validateStory(story), expected);
    }
});

test('Phase 4 views, setView, and generic Ink bindings validate with references', () => {
    const story = storyWithOverlay();
    const room = story.scenes.room;
    room.ink = 'ink/terminal_ui.ink';
    room.overlay.views = ['overview', 'details'];
    room.overlay.initialView = 'overview';
    room.overlay.elements[1].visibleIn = ['overview'];
    room.overlay.elements[3].activeIn = ['details'];
    room.overlay.elements[3].events.activate.actions = [
        { type: 'setView', view: 'details' },
        { type: 'openInk', knot: 'sysinfo' },
    ];
    room.overlay.elements.push(
        { id: 'lines', type: 'container', x: 0.1, y: 0.7, w: 0.8, h: 0.1, content: { source: 'inkLines', tagStyles: { heading: 'heading', warn: 'warning' } } },
        { id: 'choices', type: 'container', x: 0.1, y: 0.82, w: 0.8, h: 0.1, content: { source: 'inkChoices', controlPreset: 'terminal-command' }, events: { choiceSelected: { actions: [{ type: 'setView', view: 'overview' }] } } },
    );
    assert.equal(validateStory(story), null);

    const invalidCases = [
        [s => { s.scenes.room.overlay.elements[1].visibleIn = ['missing']; }, /visibleIn contains an unknown view/],
        [s => { s.scenes.room.overlay.elements[3].events.activate.actions[0].view = 'missing'; }, /references missing view/],
        [s => { s.scenes.room.overlay.elements[3].events.activate.actions[1].knot = 'missing'; }, /references missing Ink knot/],
        [s => { s.scenes.room.overlay.elements[4].content.source = 'unknown'; }, /content.source is unsupported/],
        [s => { s.scenes.room.overlay.elements[4].content.tagStyles.warn = 'sparkles'; }, /tagStyles.*unsupported preset/],
        [s => { s.scenes.room.overlay.elements[4].events = { choiceSelected: { actions: [] } }; }, /choiceSelected requires inkChoices content/],
    ];
    for (const [mutate, expected] of invalidCases) {
        const copy = structuredClone(story); mutate(copy); assert.match(validateStory(copy), expected);
    }
});
