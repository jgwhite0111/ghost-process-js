const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storyPath = path.resolve(__dirname, '..', 'story.json');

function loadStory() {
    return JSON.parse(fs.readFileSync(storyPath, 'utf8'));
}

test('PRESS START restores the declared intro to cold_open to alley route', () => {
    const story = loadStory();
    const pressStart = story.scenes.intro.hitboxes[0];

    assert.equal(pressStart.label, 'PRESS START');
    assert.equal(pressStart.target, 'cold_open');
    assert.equal(story.next.intro, 'cold_open');
    assert.equal(story.next.cold_open, 'alley');
});
