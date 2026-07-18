// src/runtime/exploration.js — small, data-driven point-and-click layer.
//
// Exploration deliberately stays on top of the existing Scene, Canvas,
// CharacterSprite, HitboxLayer, Inventory, TaskTracker, and Ink plumbing.
// v1 supports a single room, a rectangular/polygon walkable area, click-to-
// walk, animation, depth ordering, and hotspot actions. It does not do
// pathfinding, camera scrolling, or room graphs.

class ExplorationController {
    constructor({ scene, sprite, config }) {
        this.scene = scene;
        this.sprite = sprite;
        this.config = config || {};
        const spawn = this.config.spawn || { x: 0.5, y: 0.78 };
        this.x = Number.isFinite(spawn.x) ? spawn.x : 0.5;
        this.y = Number.isFinite(spawn.y) ? spawn.y : 0.78;
        this.target = null;
        this.speed = Number.isFinite(this.config.walkSpeed) ? this.config.walkSpeed : 140;
        this._moving = false;
        this._arrival = null;
        this._lastPagePoint = { x: 0, y: 0 };
        this._setSpritePosition();
        if (this.sprite) {
            this.sprite.setVisible(true, true);
            this.sprite.setSpeaking(false);
        }
    }

    _setSpritePosition() {
        if (!this.sprite || !this.sprite.character) return;
        this.sprite.character.placementX = this.x;
        this.sprite.character.placementY = this.y;
        this._applyDepthScale();
        this.sprite.character.flipX = this.facing === 'left';
    }

    _insideWalkable(x, y) {
        const area = this.config.walkableArea || this.config.walkable || {
            x: 0.05, y: 0.35, w: 0.9, h: 0.55
        };
        if (Array.isArray(area)) {
            let inside = false;
            for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
                const xi = area[i].x, yi = area[i].y;
                const xj = area[j].x, yj = area[j].y;
                const intersects = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
                if (intersects) inside = !inside;
            }
            return inside;
        }
        return x >= area.x && x <= area.x + area.w &&
            y >= area.y && y <= area.y + area.h;
    }

    _nearestPointOnPolygon(x, y, polygon) {
        let best = { x: polygon[0].x, y: polygon[0].y };
        let bestDistance = Infinity;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lengthSq = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
            const point = { x: a.x + t * dx, y: a.y + t * dy };
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance < bestDistance) {
                best = point;
                bestDistance = distance;
            }
        }
        return best;
    }

    _clampPoint(x, y) {
        const area = this.config.walkableArea || this.config.walkable || {
            x: 0.05, y: 0.35, w: 0.9, h: 0.55
        };
        if (Array.isArray(area)) {
            return this._insideWalkable(x, y)
                ? { x, y }
                : this._nearestPointOnPolygon(x, y, area);
        }
        return {
            x: Math.max(area.x, Math.min(area.x + area.w, x)),
            y: Math.max(area.y, Math.min(area.y + area.h, y)),
        };
    }

    _applyDepthScale() {
        if (!this.sprite?.character) return;
        const depth = this.config.depth;
        if (!depth || !Number.isFinite(depth.farY) || !Number.isFinite(depth.nearY)) return;
        const denominator = depth.nearY - depth.farY || 1;
        const t = Math.max(0, Math.min(1, (this.y - depth.farY) / denominator));
        const farScale = Number.isFinite(depth.farScale) ? depth.farScale : 0.8;
        const nearScale = Number.isFinite(depth.nearScale) ? depth.nearScale : 1.05;
        const baseTargetH = Number.isFinite(this.sprite.character.explorationBaseTargetH)
            ? this.sprite.character.explorationBaseTargetH
            : (this.sprite.character.targetH || 0.42);
        this.sprite.character.explorationBaseTargetH = baseTargetH;
        this.sprite.character.targetH = baseTargetH * (farScale + (nearScale - farScale) * t);
    }

    // ---------- blocked-tile grid (opt-in) ----------
    //
    // Optional new fields under sceneConfig.exploration:
    //   tileSize      - grid cell size as a fraction of the canvas
    //                   (e.g. 0.04 = 4%; default 0.04 if config absent)
    //   gridOrigin    - { x, y } in canvas fractions; defaults to the
    //                   top-center of the walkable polygon
    //   gridAngle     - radians of rotation around the grid origin
    //                   (~+/-15 deg absorbs AI-FOV drift between
    //                   generated scenes; default 0)
    //   blockedTiles  - array of either {col, row} or [col, row] in
    //                   grid coordinates; tiles where the character
    //                   may not stand
    //
    // All four are optional. With none configured, the grid layer is
    // a no-op and behaviour is identical to the pre-grid exploration
    // controller (polygon walkableArea + _clampPoint remain the
    // boundary source of truth; the grid is purely an inner
    // blocked-tile layer on top of that).

    _getGridConfig() {
        if (this._gridCache) return this._gridCache;
        const origin = this._computeGridOrigin();
        const tileSize = Number.isFinite(this.config.tileSize)
            ? this.config.tileSize
            : 0.04;
        const angle = Number.isFinite(this.config.gridAngle)
            ? this.config.gridAngle
            : 0;
        const blockedSet = new Set();
        const raw = Array.isArray(this.config.blockedTiles)
            ? this.config.blockedTiles
            : [];
        for (const t of raw) {
            if (Array.isArray(t) && t.length >= 2 &&
                Number.isFinite(t[0]) && Number.isFinite(t[1])) {
                blockedSet.add(`${t[0]},${t[1]}`);
            } else if (t && Number.isFinite(t.col) && Number.isFinite(t.row)) {
                blockedSet.add(`${t.col},${t.row}`);
            }
        }
        this._gridCache = { origin, tileSize, angle, blockedSet };
        return this._gridCache;
    }

    _computeGridOrigin() {
        if (this.config.gridOrigin &&
            Number.isFinite(this.config.gridOrigin.x) &&
            Number.isFinite(this.config.gridOrigin.y)) {
            return {
                x: this.config.gridOrigin.x,
                y: this.config.gridOrigin.y,
            };
        }
        // Default: top-center of the walkable polygon (its
        // far edge in screen-Y is the smallest y in the points).
        // Track the top edge's x range as its own pair - the
        // polygon's top edge may not span the full polygon width
        // (typical isometric scenes lean the side walls inward
        // at the top, so the bottom edge is wider than the top).
        const area = this.config.walkableArea;
        if (Array.isArray(area) && area.length > 0) {
            let minY = area[0].y;
            let topMinX = area[0].x;
            let topMaxX = area[0].x;
            for (const p of area) {
                if (p.y < minY) {
                    minY = p.y;
                    topMinX = p.x;
                    topMaxX = p.x;
                } else if (p.y === minY) {
                    if (p.x < topMinX) topMinX = p.x;
                    if (p.x > topMaxX) topMaxX = p.x;
                }
            }
            return { x: (topMinX + topMaxX) / 2, y: minY };
        }
        // Rect fallback (matches _clampPoint's default).
        const rect = this.config.walkable || { x: 0.05, y: 0.35, w: 0.9, h: 0.55 };
        return { x: rect.x + rect.w / 2, y: rect.y };
    }

    worldToGrid(x, y) {
        const g = this._getGridConfig();
        const dx = x - g.origin.x;
        const dy = y - g.origin.y;
        // Inverse rotation by gridAngle: rotate by -angle.
        const cos = Math.cos(-g.angle);
        const sin = Math.sin(-g.angle);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        return { col: rx / g.tileSize, row: ry / g.tileSize };
    }

    gridToWorld(col, row) {
        const g = this._getGridConfig();
        const cx = col * g.tileSize;
        const cy = row * g.tileSize;
        const cos = Math.cos(g.angle);
        const sin = Math.sin(g.angle);
        const rx = cx * cos - cy * sin;
        const ry = cx * sin + cy * cos;
        return { x: g.origin.x + rx, y: g.origin.y + ry };
    }

    _isTileBlocked(col, row) {
        const c = Math.round(col);
        const r = Math.round(row);
        return this._getGridConfig().blockedSet.has(`${c},${r}`);
    }

    _clampThroughBlocked(fromX, fromY, toX, toY) {
        const g = this._getGridConfig();
        // Backward-compat fast path: no blocked tiles configured
        // means the grid layer is invisible to movement.
        if (g.blockedSet.size === 0) return { x: toX, y: toY };
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return { x: toX, y: toY };
        // Sample at ~40% of a tile so we always enter the blocked
        // cell before declaring it blocked (otherwise we'd land
        // exactly on the entry edge and the next-frame moveTo
        // would re-enter it).
        const stepSize = Math.max(g.tileSize * 0.4, 0.002);
        const numSteps = Math.max(2, Math.ceil(dist / stepSize));
        let lastX = fromX;
        let lastY = fromY;
        for (let i = 1; i <= numSteps; i++) {
            const t = i / numSteps;
            const wx = fromX + dx * t;
            const wy = fromY + dy * t;
            // Re-check inside-walkable at the sample point: if
            // the straight line crosses out of the polygon AND
            // into a blocked tile in the same step, the polygon
            // wins (we shouldn't pretend the grid extends past
            // the floor edge).
            if (!this._insideWalkable(wx, wy)) {
                return { x: lastX, y: lastY };
            }
            const cell = this.worldToGrid(wx, wy);
            if (this._isTileBlocked(cell.col, cell.row)) {
                return { x: lastX, y: lastY };
            }
            lastX = wx;
            lastY = wy;
        }
        return { x: toX, y: toY };
    }

    // moveTo now does two clamps: first the polygon (boundary),
    // then the grid's straight-line blocked-tile sweep. The grid
    // clamp is a no-op when no blockedTiles are configured, so
    // existing exploration_demo scenes (which do not yet set
    // blockedTiles) keep their current behaviour exactly.
    moveTo(x, y, onArrival = null, pagePoint = null) {
        const area = this.config.walkableArea || this.config.walkable;
        const polygonPoint = this._clampPoint(x, y);
        if (!Array.isArray(area) && !this._insideWalkable(polygonPoint.x, polygonPoint.y)) return false;
        if (!Number.isFinite(polygonPoint.x) || !Number.isFinite(polygonPoint.y)) return false;
        const point = this._clampThroughBlocked(this.x, this.y, polygonPoint.x, polygonPoint.y);
        this.target = point;
        this._arrival = onArrival;
        if (pagePoint) this._lastPagePoint = pagePoint;
        this.facing = point.x < this.x ? 'left' : point.x > this.x ? 'right' : this.facing;
        this._setSpritePosition();
        return true;
    }

    handleCanvasPoint(x, y, pageX, pageY) {
        return this.moveTo(x, y, null, { x: pageX, y: pageY });
    }

    handleHotspot(hotspot, pageX, pageY) {
        const walkTo = hotspot.walkTo || hotspot.walk_to;
        if (!Array.isArray(walkTo) || walkTo.length < 2) {
            this.scene._activateExplorationHotspot(hotspot, pageX, pageY);
            return true;
        }
        return this.moveTo(Number(walkTo[0]), Number(walkTo[1]), () => {
            this.scene._activateExplorationHotspot(
                hotspot,
                this._lastPagePoint.x,
                this._lastPagePoint.y,
            );
        }, { x: pageX, y: pageY });
    }

    update(deltaMs) {
        if (!this.target) {
            if (this.sprite) this.sprite.setSpeaking(false);
            return;
        }
        const dt = Math.min(100, Math.max(0, deltaMs)) / 1000;
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const distance = Math.hypot(dx, dy);
        const logicalW = window.Runtime?.INTERNAL_W || 640;
        const logicalH = window.Runtime?.INTERNAL_H || 480;
        const step = (this.speed / Math.max(logicalW, logicalH)) * dt;
        if (distance <= step || distance < 0.001) {
            this.x = this.target.x;
            this.y = this.target.y;
            this.target = null;
            this._setSpritePosition();
            if (this.sprite) this.sprite.setSpeaking(false);
            const arrival = this._arrival;
            this._arrival = null;
            if (arrival) arrival();
            return;
        }
        this.x += dx / distance * step;
        this.y += dy / distance * step;
        this.facing = dx < 0 ? 'left' : 'right';
        this._setSpritePosition();
        if (this.sprite) this.sprite.setSpeaking(true);
    }
}

window.ExplorationController = ExplorationController;
