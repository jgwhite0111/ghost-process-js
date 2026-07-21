# AI-HANDOFF — Ghost Process

## Update — 2026-07-21

This handoff was rewritten after the terminal integration checkpoint. The detailed editor overhaul is now specified in [`EDITOR-AUTHORING-SPEC.md`](EDITOR-AUTHORING-SPEC.md). Read that file before changing the editor/runtime authoring model.

## Current repository state

- Project: `/Users/jwhite/ghost-process-js`
- Branch: `feature/exploration-hybrid`
- No push is authorized.
- The latest implementation checkpoint is `7235943` — `polish terminal plate indicators and spacing`.
- The preceding rollback checkpoint is `efbacaf` — `checkpoint terminal interface and Obelab integration`.
- The current documentation checkpoint includes this handoff, `EDITOR-AUTHORING-SPEC.md`, and the `.tmp/` ignore rule.
- Verify the exact current HEAD, branch, divergence, and status with Git rather than trusting this note.
- `.tmp/` contains local diagnostic scratch files and must remain excluded from Git.

## What is currently shipped

### Terminal integration

`terminal_obelab` and `terminal_ui` are playable end to end:

```text
exploration_demo → terminal_obelab
terminal_obelab / Access terminal → terminal_ui
terminal_obelab / Walk away → exploration_demo
terminal_ui / EXIT → terminal_obelab
```

`story.json` owns the scene routes, Ink paths, backgrounds, audio, and current hitboxes. The terminal prose remains in `ink/terminal_ui.ink`.

`src/scenes/terminal_ui.js` is an interim custom scene. It currently builds the terminal DOM, launcher icons, module window, Ink lines/choices, RETURN behavior, EXIT behavior, contained 4:3 stage, responsive layout, and terminal HUD suppression. Do not delete it until the generic authoring system reaches full visual and behavioral parity.

The terminal plate is `assets/backgrounds/scene_terminal_ui_grok.png`, produced by `tools/build_terminal_ui_grok.py`. The generated PNG, prompt sidecar, and final generation-log record currently agree on SHA-256:

```text
ebf702fe011b56ec5ef439d6f939763d73ff6ebe01a87fecfe2e7ccf46a04ba8
```

The PNG must remain reproducible through the build script. Do not hand-edit it.

### Final terminal polish

Commit `7235943` contains the reviewed finishing changes:

- brightness-aware, feathered alpha isolation for all four indicator lamps;
- complete lamp layer moved to plate `y=32` for equal visual clearance;
- terminal header-state right margin adjusted to `34px`;
- updated provenance sidecar and generation log.

## Approved architecture direction

The editor overhaul is **not** a general-purpose visual scripting system.

Use:

```text
Element → Event → ordered typed Actions
```

Presentation is independent from behavior. Do not make `button`, `exit`, `pickup`, `terminal`, or `walkAway` behavior classes.

Initial generic scene-local overlay elements:

- `container`;
- `image`;
- `text`;
- `hotspot`.

This is a starting vocabulary, not an arbitrary permanent four-type cap. Higher-level buttons and terminal controls should be editor presets/compositions, not new runtime behavior types.

Initial actions:

- `goToScene(scene)`;
- `openInk(knot)`;
- `giveItem(item)`;
- `setView(view)`.

Initial events:

- `activate` for click/tap/keyboard activation;
- `choiceSelected` for authored Ink choices.

Initially expose existing canonical hitbox fields (`target`, `ink`, `item`) clearly before requiring a story-wide migration. Runtime behavior currently resolves those fields in `item → target → ink` precedence; preserve that during compatibility work.

## Next implementation entry point

Start with **Phase 1 — Repair the existing hitbox inspector** in `EDITOR-AUTHORING-SPEC.md`:

1. separate Presentation from Behavior in `editor.js`;
2. expose target, Ink knot, and item independently of presentation;
3. use typed scene/Ink/item controls;
4. prevent presentation changes from deleting behavior;
5. add action summaries and target-scene shortcuts;
6. update focused editor tests.

Then proceed through the spec’s phases in separate reviewable commits:

1. inspector truthfulness;
2. shared typed action executor;
3. generic overlay elements and editor layer authoring;
4. views and Ink content bindings;
5. `terminal_ui` migration and parity verification;
6. validation, cleanup, and final `SPEC.md` update.

## Hard constraints to preserve

- Vanilla JavaScript + InkJS + Express; no bundler, TypeScript, engine, or new dependency without discussion.
- `story.json` remains the single source of truth.
- Scene-local terminal controls are not inventory items.
- Terminal prose stays in `ink/terminal_ui.ink`.
- No per-scene CSS in the final no-code architecture; generic built-in styling is acceptable.
- Preserve terminal launch, RETURN, EXIT, contained 4:3 responsive behavior, and inventory-HUD behavior during migration.
- Do not remove `src/scenes/terminal_ui.js` until generic parity is proven.
- Do not generate or purchase new media for this editor migration.
- Do not use MiniMax without separate explicit permission.
- Keep `.tmp/` scratch assets excluded.
- Do not push without explicit authorization.

## Verification baseline

The latest reviewed implementation passed:

- `git diff --check`;
- Python build-script syntax compilation;
- `node --check src/scenes/terminal_ui.js`;
- `story.json` and terminal provenance JSON parsing;
- generated asset/sidecar/log hash agreement;
- `npm test`: **81/81 passing**.

After any further implementation, rerun the focused tests and the full suite. Before claiming a phase complete, also run direct-route/browser checks appropriate to the changed runtime surface.

## Useful current files

- `EDITOR-AUTHORING-SPEC.md` — authoritative overhaul plan and target schema.
- `SPEC.md` — existing project architecture.
- `story.json` — current scene/hitbox/item data.
- `editor.js` / `editor.html` — current authoring surface.
- `server.js` — story validation and atomic save API.
- `src/runtime/scene-base.js` — current hitbox behavior and scene lifecycle.
- `src/runtime/hitbox.js` — hitbox rendering/interaction.
- `src/scenes/terminal_ui.js` — interim custom terminal implementation.
- `ink/terminal_ui.ink` — terminal prose and RETURN choices.
- `tools/build_terminal_ui_grok.py` — reproducible terminal plate compositor.

## Session hygiene

Before ending a future implementation session:

```bash
pkill -f "node server.js" 2>/dev/null
cd "$(git rev-parse --show-toplevel)"
npm start &
git status --short --branch
```

Do not claim a server is live unless its process and HTTP route have been checked. Do not claim the tree is clean while intentionally retained scratch files are not ignored.
