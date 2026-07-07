// src/tasks.js — per-scene task tracker.
//
// A "task" is a small objective the player needs to complete to move
// the scene forward (e.g. "pick up the key", "try the key on the door").
// Tasks are declared per-scene in story.json under `scenes[id].tasks`.
// Each task has:
//   id      - unique within the scene, used by Ink and runtime to
//             reference it (EXTERNAL complete_task("id"))
//   type    - one of: pickup, use_item, combine, goto_hitbox,
//             goto_dialog, custom
//   hint    - the line shown via Toast when the dialogue box is
//             dismissed (or the scene opens) and this task is the
//             first unresolved one
//   <type-specific params — see below>
//
// Types and their completion triggers:
//   pickup      { item }                — completed when STATE.inventory
//                                          contains `item`.
//   use_item    { item, on_hitbox }     — completed when player clicks a
//                                          hitbox whose `item_required`
//                                          matches `item`, OR via the
//                                          runtime `_onItemUsedOnHitbox`
//                                          hook the hitbox layer fires.
//   combine     { items:[a,b], result } — completed when Inventory.combine
//                                          returns `result`.
//   goto_hitbox { target }              — completed when a hitbox click
//                                          transitions to `target`.
//   goto_dialog { ink_node }            — completed when Ink jumps to the
//                                          named knot (set via # goto:node
//                                          tag OR EXTERNAL redirect).
//   custom      { ... }                 — completed only via EXTERNAL
//                                          complete_task("id") from Ink.
//
// When all open tasks are completed, the Toast hint reverts to "…just
// look around" or is hidden (depends on scene).

class TaskTracker {
    constructor() {
        this.sceneId = null;
        this.tasks = [];       // full task list (immutable per scene)
        this.completed = new Set();   // ids that have fired
    }

    // Reset for a new scene. Pulls `scenes[sceneId].tasks` from
    // window.STORY; tasks array is optional (scenes without tasks
    // simply never show a hint). Pass an explicit list to override.
    bind(sceneId, tasks) {
        this.sceneId = sceneId;
        this.tasks = Array.isArray(tasks) ? tasks : [];
        this.completed = new Set();
    }

    // First unresolved task whose hint we should surface. Returns
    // null when every task is done.
    nextHint() {
        for (const t of this.tasks) {
            if (this.completed.has(t.id)) continue;
            return t.hint || null;
        }
        return null;
    }

    // True if there is at least one open task.
    hasOpen() {
        for (const t of this.tasks) {
            if (!this.completed.has(t.id)) return true;
        }
        return false;
    }

    // Mark one task done. Idempotent. Returns true if it changed
    // state (so the caller can decide whether to re-show a hint).
    complete(id) {
        if (this.completed.has(id)) return false;
        const t = this.tasks.find(x => x.id === id);
        if (!t) {
            // Unknown id — still record it so we don't keep firing.
            this.completed.add(id);
            return true;
        }
        this.completed.add(id);
        return true;
    }

    // ---- type-specific completion probes ----
    //
    // These are called by scene-base / hitbox / inventory at the
    // moments a task could resolve, so the editor / data layer never
    // has to know about runtime state.

    // Called when an item lands in the player's inventory.
    onItemAcquired(itemId) {
        for (const t of this.tasks) {
            if (this.completed.has(t.id)) continue;
            if (t.type === 'pickup' && t.item === itemId) {
                this.complete(t.id);
            }
        }
    }

    // Called when the player clicks a hitbox (regardless of action).
    //   - use_item: matches if hitbox.item_required === task.item
    //   - goto_hitbox: matches if hitbox.target === task.target
    onHitboxClicked(hb) {
        for (const t of this.tasks) {
            if (this.completed.has(t.id)) continue;
            if (t.type === 'goto_hitbox' && t.target && hb.target === t.target) {
                this.complete(t.id);
            }
            if (t.type === 'use_item' && t.item && hb.item_required === t.item) {
                this.complete(t.id);
            }
        }
    }

    // Called when Inventory.combine() returns a result id.
    onItemsCombined(result) {
        for (const t of this.tasks) {
            if (this.completed.has(t.id)) continue;
            if (t.type === 'combine' && t.result === result) {
                this.complete(t.id);
            }
        }
    }

    // Called when Ink jumps to a knot (via # goto:node tag, EXTERNAL,
    // or runner.ChoosePathString).
    onInkNodeReached(node) {
        for (const t of this.tasks) {
            if (this.completed.has(t.id)) continue;
            if (t.type === 'goto_dialog' && t.ink_node === node) {
                this.complete(t.id);
            }
        }
    }
}

// Singleton. Engine imports this; hitbox/inventory/scene-base
// reference it via window.TaskTracker.
window.TaskTracker = new TaskTracker();