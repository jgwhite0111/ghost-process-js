// test/exploration-grid.test.js
//
// Unit tests for the grid + blocked-tile math added to the
// ExplorationController (src/runtime/exploration.js, around line
// 117). These do NOT load the full runtime - they hand-build a
// minimal window context via vm.createContext so we can feed
// synthetic polygons + tile lists directly. Mirrors the style of
// scene-character-lifecycle.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadController() {
    const window = {};
    const context = vm.createContext({
        window,
        console,
        performance: { now: () => 0 },
        setTimeout,
        clearTimeout,
    });
    context.globalThis = context;
    const filename = path.join(ROOT, 'src/runtime/exploration.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return window.ExplorationController;
}

function makeController(config) {
    const EC = loadController();
    const character = {
        placementX: 0.5,
        placementY: 0.7,
        targetH: 0.4,
        explorationBaseTargetH: 0.4,
    };
    const sprite = {
        character,
        setVisible() {},
        setSpeaking() {},
    };
    return new EC({ scene: {}, sprite, config });
}

test('worldToGrid round-trips with default origin and zero angle', () => {
    const c = makeController({
        walkableArea: [
            { x: 0, y: 0.5 }, { x: 1, y: 0.5 },
            { x: 1, y: 1 }, { x: 0, y: 1 },
        ],
        spawn: { x: 0.5, y: 0.6 },
        tileSize: 0.05,
    });
    const cell = { col: 4, row: 3 };
    const world = c.gridToWorld(cell.col, cell.row);
    const back = c.worldToGrid(world.x, world.y);
    assert.ok(Math.abs(back.col - cell.col) < 1e-9, `col drift ${back.col - cell.col}`);
    assert.ok(Math.abs(back.row - cell.row) < 1e-9, `row drift ${back.row - cell.row}`);
});

test('grid rotation around configured origin preserves round-trip', () => {
    const c = makeController({
        walkableArea: [
            { x: 0, y: 0.5 }, { x: 1, y: 0.5 },
            { x: 1, y: 1 }, { x: 0, y: 1 },
        ],
        spawn: { x: 0.5, y: 0.6 },
        tileSize: 0.05,
        gridOrigin: { x: 0.5, y: 0.6 },
        gridAngle: Math.PI / 12, // ~15 degrees
    });
    const cell = { col: 5, row: 4 };
    const world = c.gridToWorld(cell.col, cell.row);
    const back = c.worldToGrid(world.x, world.y);
    assert.ok(Math.abs(back.col - cell.col) < 1e-9, `col drift ${back.col - cell.col}`);
    assert.ok(Math.abs(back.row - cell.row) < 1e-9, `row drift ${back.row - cell.row}`);
});

test('isTileBlocked accepts both {col,row} and [col,row] shapes', () => {
    const c = makeController({
        walkableArea: [
            { x: 0, y: 0.5 }, { x: 1, y: 0.5 },
            { x: 1, y: 1 }, { x: 0, y: 1 },
        ],
        spawn: { x: 0.5, y: 0.6 },
        tileSize: 0.05,
        gridOrigin: { x: 0.5, y: 0.5 },
        blockedTiles: [
            { col: 2, row: 3 },
            [4, 5],
        ],
    });
    assert.equal(c._isTileBlocked(2, 3), true);
    assert.equal(c._isTileBlocked(4, 5), true);
    assert.equal(c._isTileBlocked(2.49, 3.49), true, 'rounds toward the cell');
    assert.equal(c._isTileBlocked(0, 0), false);
    assert.equal(c._isTileBlocked(2, 4), false, 'different row');
});

test('grid origin defaults to top-center of walkable polygon', () => {
    const c = makeController({
        walkableArea: [
            { x: 0.1, y: 0.6 }, { x: 0.7, y: 0.6 },
            { x: 0.9, y: 0.95 }, { x: 0.2, y: 0.95 },
        ],
        spawn: { x: 0.4, y: 0.7 },
        tileSize: 0.05,
    });
    const origin = c._computeGridOrigin();
    assert.ok(Math.abs(origin.x - 0.4) < 1e-9, `x ${origin.x}`);
    assert.ok(Math.abs(origin.y - 0.6) < 1e-9, `y ${origin.y}`);
});

test('moveTo without blockedTiles behaves as before (no clamp, exact target)', () => {
    // Forward-compat: existing exploration_demo scenes that do not
    // set blockedTiles must move to the polygon-clamp point
    // exactly.
    const c = makeController({
        walkableArea: [
            { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 },
            { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
        ],
        spawn: { x: 0.5, y: 0.6 },
        tileSize: 0.1,
        gridOrigin: { x: 0.5, y: 0.5 },
    });
    const r = c.moveTo(0.85, 0.85);
    assert.equal(r, true);
    assert.ok(c.target, 'target set');
    assert.ok(Math.abs(c.target.x - 0.85) < 1e-6, `x ${c.target.x}`);
    assert.ok(Math.abs(c.target.y - 0.85) < 1e-6, `y ${c.target.y}`);
});

test('moveTo clamps at first blocked tile along the straight line', () => {
    // Grid origin (0.5, 0.5), tileSize 0.1 - clean cartesian.
    // Tile (2, 2) covers world rect x in [0.65, 0.75], y in
    // [0.65, 0.75] (cell center at 0.7, 0.7). The line from
    // (0.5, 0.5) to (0.85, 0.85) crosses (0.7, 0.7) at the
    // midpoint, so the player must stop short of (0.7, 0.7) in
    // both axes.
    const c = makeController({
        walkableArea: [
            { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
            { x: 1.0, y: 1.0 }, { x: 0.0, y: 1.0 },
        ],
        spawn: { x: 0.5, y: 0.5 },
        tileSize: 0.1,
        gridOrigin: { x: 0.5, y: 0.5 },
        blockedTiles: [[2, 2]],
    });
    const r = c.moveTo(0.85, 0.85);
    assert.equal(r, true);
    assert.ok(c.target, 'target set');
    assert.ok(c.target.x < 0.7, `clamp x ${c.target.x} should land before blocked tile entry`);
    assert.ok(c.target.y < 0.7, `clamp y ${c.target.y} should land before blocked tile entry`);
    assert.ok(c.target.x > 0.5, `clamp x ${c.target.x} should still be right of spawn`);
    assert.ok(c.target.y > 0.5, `clamp y ${c.target.y} should still be below spawn`);
});

test('moveTo into a clear tile in the same direction still lands there', () => {
    const c = makeController({
        walkableArea: [
            { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
            { x: 1.0, y: 1.0 }, { x: 0.0, y: 1.0 },
        ],
        spawn: { x: 0.1, y: 0.1 },
        tileSize: 0.1,
        gridOrigin: { x: 0.5, y: 0.5 },
        blockedTiles: [[5, 5]], // far from the path under test
    });
    const r = c.moveTo(0.2, 0.3);
    assert.equal(r, true);
    assert.ok(Math.abs(c.target.x - 0.2) < 1e-6, `x ${c.target.x}`);
    assert.ok(Math.abs(c.target.y - 0.3) < 1e-6, `y ${c.target.y}`);
});

test('grid rotation survives a blocked-tile sweep (skew hook smoke)', () => {
    // With 15 deg rotation around (0, 0.5), a walk from (0, 0.5)
    // to (0.4, 0.5) travels mostly +col with a small -row drift
    // in grid space (the world y-line maps to a tilted line).
    // The path crosses col=1 at roughly row=-0.21 - squarely inside
    // cell (1, 0). Blocking that cell must clamp the move.
    const angle = Math.PI / 12;
    const c = makeController({
        walkableArea: [
            { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
            { x: 1.0, y: 1.0 }, { x: 0.0, y: 1.0 },
        ],
        spawn: { x: 0.0, y: 0.5 },
        tileSize: 0.1,
        gridOrigin: { x: 0.0, y: 0.5 },
        gridAngle: angle,
        blockedTiles: [[1, 0]],
    });
    const r = c.moveTo(0.4, 0.5);
    assert.equal(r, true);
    assert.ok(c.target, 'target set');
    const dx = c.target.x - 0.4;
    const dy = c.target.y - 0.5;
    assert.ok(Math.hypot(dx, dy) > 1e-3,
        `move should have been clamped (target ${c.target.x},${c.target.y})`);
});
