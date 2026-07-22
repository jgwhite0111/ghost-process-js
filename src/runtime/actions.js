// src/runtime/actions.js — shared typed action validation and execution.
//
// Current story hitboxes still use the legacy `item`, `target`, and `ink`
// fields. normalizeLegacyHitbox() maps those fields to typed actions while
// preserving the established item -> target -> ink precedence. Future
// overlay events can pass ordered typed-action arrays to execute() directly.

(() => {
    function requireString(action, key) {
        if (typeof action[key] !== 'string' || action[key].trim() === '') {
            return `action ${action.type || '<unknown>'}.${key} must be a non-empty string`;
        }
        return null;
    }

    const ACTION_REGISTRY = Object.freeze({
        giveItem: Object.freeze({
            validate(action) {
                return requireString(action, 'item');
            },
            execute(action, context) {
                const scene = context.scene;
                const itemId = action.item;
                const label = itemId.replace(/_/g, ' ');
                window.Inventory.addWithFly(
                    itemId,
                    context.pageX,
                    context.pageY,
                    label,
                    () => {
                        if (scene.hitboxLayer?.refresh) scene.hitboxLayer.refresh();
                        scene._refreshTaskHint();
                    },
                );

                const item = window.STORY?.items?.[itemId];
                if (item?.pickup_message) {
                    setTimeout(() => window.Toast.show(item.pickup_message), 350);
                }
                if (scene._onItemPicked) scene._onItemPicked(itemId);
                return null;
            },
        }),

        goToScene: Object.freeze({
            validate(action) {
                return requireString(action, 'scene');
            },
            execute(action, context) {
                context.scene._transition(action.scene);
                return { transitioned: true };
            },
        }),

        openInk: Object.freeze({
            validate(action) {
                return requireString(action, 'knot');
            },
            execute(action, context) {
                const scene = context.scene;
                const overlayResult = scene.overlayLayer?.openInk(action.knot);
                if (overlayResult?.handled) return null;
                if (!scene.dialogueRunner) return null;
                try {
                    scene.dialogueRunner.story.ChoosePathString(action.knot);
                    scene.dialogueRunner.step();
                    if (window.DialoguePanel) window.DialoguePanel.show();
                } catch (error) {
                    const source = context.fromExploration
                        ? `hotspot Ink path ${action.knot}`
                        : `hitbox ink ${action.knot}`;
                    console.warn(`[${scene.sceneId}] ${source} failed`, error);
                }
                return null;
            },
        }),

        setView: Object.freeze({
            validate(action) {
                return requireString(action, 'view');
            },
            execute(action, context) {
                const scene = context.scene;
                if (!scene.overlayLayer?.setView) {
                    console.warn(`[${scene.sceneId}] setView requires a mounted scene overlay`);
                    return null;
                }
                scene.overlayLayer.setView(action.view);
                return null;
            },
        }),
    });

    function validateAction(action) {
        if (!action || typeof action !== 'object' || Array.isArray(action)) {
            return 'action must be an object';
        }
        if (typeof action.type !== 'string' || action.type.trim() === '') {
            return 'action.type must be a non-empty string';
        }
        const definition = ACTION_REGISTRY[action.type];
        if (!definition) return `unsupported action type "${action.type}"`;
        return definition.validate(action);
    }

    function normalizeLegacyHitbox(hitbox) {
        if (!hitbox || typeof hitbox !== 'object') return [];
        if (hitbox.item) return [{ type: 'giveItem', item: hitbox.item }];
        if (hitbox.target) return [{ type: 'goToScene', scene: hitbox.target }];
        if (hitbox.ink) return [{ type: 'openInk', knot: hitbox.ink }];
        return [];
    }

    function execute(actions, context = {}) {
        const actionList = Array.isArray(actions) ? actions : [actions];
        const scene = context.scene;
        if (!scene) {
            const error = 'action execution requires a scene context';
            console.warn(error);
            return { ok: false, error };
        }

        // Preserve the existing lifecycle: task notification occurs once,
        // immediately before behavior executes, and receives the original
        // legacy hitbox shape used by current task definitions.
        if (context.hitbox && window.TaskTracker) {
            window.TaskTracker.onHitboxClicked(context.hitbox);
        }

        for (let index = 0; index < actionList.length; index += 1) {
            const action = actionList[index];
            const error = validateAction(action);
            if (error) {
                console.warn(`[${scene.sceneId}] invalid action at index ${index}: ${error}`);
                return { ok: false, error, index };
            }
            const result = ACTION_REGISTRY[action.type].execute(action, context);
            if (result?.transitioned) {
                return { ok: true, transitioned: true, index };
            }
        }
        return { ok: true, transitioned: false };
    }

    window.ActionExecutor = Object.freeze({
        registry: ACTION_REGISTRY,
        validateAction,
        normalizeLegacyHitbox,
        execute,
    });
})();
