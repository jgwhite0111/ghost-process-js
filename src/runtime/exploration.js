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

    moveTo(x, y, onArrival = null, pagePoint = null) {
        const area = this.config.walkableArea || this.config.walkable;
        const point = this._clampPoint(x, y);
        if (!Array.isArray(area) && !this._insideWalkable(point.x, point.y)) return false;
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
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
