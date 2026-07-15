const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateStory } = require('../server.js');

function makeValidStory() {
    return {
        version: 3,
        start: 'intro',
        scenes: {
            intro: {
                id: 'intro',
                kind: 'title',
                ink: 'ink/intro.ink',
                titleSizePct: 0.1,
                music: [
                    { file: 'intro_a.mp3' },
                    { file: 'intro_b.mp3', fadeAt: 12.5 },
                ],
                characters: [{
                    id: 'android',
                    placementX: -1.25,
                    placementY: 2.5,
                    targetH: 0.8,
                    scenes: {
                        intro: { frames: 'assets/sprites/android/frame_*.png', fps: 4 },
                    },
                }],
                hitboxes: [{ x: -0.2, y: 0.25, w: 1.4, h: 0.5 }],
            },
        },
    };
}

const numericFields = [
    ['story.version', (story, value) => { story.version = value; }],
    ['story.scenes["intro"].titleSizePct', (story, value) => { story.scenes.intro.titleSizePct = value; }],
    ['story.scenes["intro"].music[1].fadeAt', (story, value) => { story.scenes.intro.music[1].fadeAt = value; }],
    ['story.scenes["intro"].characters[0].placementX', (story, value) => { story.scenes.intro.characters[0].placementX = value; }],
    ['story.scenes["intro"].characters[0].placementY', (story, value) => { story.scenes.intro.characters[0].placementY = value; }],
    ['story.scenes["intro"].characters[0].targetH', (story, value) => { story.scenes.intro.characters[0].targetH = value; }],
    ['story.scenes["intro"].characters[0].scenes["intro"].fps', (story, value) => { story.scenes.intro.characters[0].scenes.intro.fps = value; }],
    ['story.scenes["intro"].hitboxes[0].x', (story, value) => { story.scenes.intro.hitboxes[0].x = value; }],
    ['story.scenes["intro"].hitboxes[0].y', (story, value) => { story.scenes.intro.hitboxes[0].y = value; }],
    ['story.scenes["intro"].hitboxes[0].w', (story, value) => { story.scenes.intro.hitboxes[0].w = value; }],
    ['story.scenes["intro"].hitboxes[0].h', (story, value) => { story.scenes.intro.hitboxes[0].h = value; }],
];

const invalidNumbers = [null, '4', NaN, Infinity, -Infinity];

test('production story validator accepts finite numeric fields including off-canvas placements', () => {
    assert.equal(validateStory(makeValidStory()), null);
});

test('production story validator keeps numeric fields optional', () => {
    assert.equal(validateStory({
        start: 'intro',
        scenes: {
            intro: { id: 'intro', kind: 'ink', hitboxes: [] },
        },
    }), null);
});

test('production story validator rejects obsolete recipe and combination data clearly', () => {
    const withRecipes = makeValidStory();
    withRecipes.recipes = [];
    assert.equal(validateStory(withRecipes), 'story.recipes is not supported');

    const withCombineTask = makeValidStory();
    withCombineTask.scenes.intro.tasks = [{
        id: 'legacy_combine',
        type: 'combine',
        items: ['rusty_key', 'scrap_metal'],
        result: 'tinkered_key',
    }];
    assert.equal(
        validateStory(withCombineTask),
        'story.scenes["intro"].tasks[0].type "combine" is not supported',
    );
});

test('production story validator preserves existing scene errors', () => {
    const invalidKind = makeValidStory();
    invalidKind.scenes.intro.kind = 'video';
    assert.equal(
        validateStory(invalidKind),
        'scene "intro" has invalid kind "video" (must be ink|choice|end|title)',
    );

    const invalidHitboxes = makeValidStory();
    invalidHitboxes.scenes.intro.hitboxes = null;
    assert.equal(validateStory(invalidHitboxes), 'scene "intro" hitboxes must be an array');
});

test('production story validator rejects every known wrong or non-finite numeric field with its path', () => {
    for (const [propertyPath, setValue] of numericFields) {
        for (const invalidValue of invalidNumbers) {
            const story = makeValidStory();
            setValue(story, invalidValue);
            assert.equal(
                validateStory(story),
                `${propertyPath} must be a finite number`,
                `${propertyPath} should reject ${String(invalidValue)}`,
            );
        }
    }
});

test('production story validator checks fadeAt on the supported single-track object form', () => {
    const story = makeValidStory();
    story.scenes.intro.music = { file: 'intro.mp3', fadeAt: null };
    assert.equal(
        validateStory(story),
        'story.scenes["intro"].music.fadeAt must be a finite number',
    );
});

test('production story validator rejects invalid scene keys with the exact scene path', () => {
    const story = makeValidStory();
    story.start = 'bad-id';
    story.scenes = { 'bad-id': { id: 'bad-id', kind: 'ink', hitboxes: [] } };
    assert.equal(
        validateStory(story),
        'story.scenes["bad-id"] key must match /^[a-z][a-z0-9_]*$/',
    );
});

test('production story validator rejects every present invalid scene id', () => {
    for (const invalidId of ['', 'BadScene', 'bad-scene', '_bad_scene', '9scene', 42, null]) {
        const story = makeValidStory();
        story.scenes.intro.id = invalidId;
        assert.equal(
            validateStory(story),
            'story.scenes["intro"].id must match /^[a-z][a-z0-9_]*$/',
            `scene id ${JSON.stringify(invalidId)} should be rejected`,
        );
    }
});

test('production story contains no dead recipe or combination data and passes validation', () => {
    const liveStory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'story.json'), 'utf8'));
    assert.equal(validateStory(liveStory), null);
    assert.equal(Object.prototype.hasOwnProperty.call(liveStory, 'recipes'), false);
    for (const [sceneKey, scene] of Object.entries(liveStory.scenes)) {
        assert.match(sceneKey, /^[a-z][a-z0-9_]*$/);
        if (Object.prototype.hasOwnProperty.call(scene, 'id')) {
            assert.match(scene.id, /^[a-z][a-z0-9_]*$/);
        }
        for (const task of scene.tasks || []) {
            assert.notEqual(task.type, 'combine', `${sceneKey} must not contain combine tasks`);
        }
    }
});
