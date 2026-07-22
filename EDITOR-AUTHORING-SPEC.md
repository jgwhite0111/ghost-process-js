# Editor-Managed Scene Authoring — Implementation Spec

> New to the browser editor? Start with [`EDITOR-MANUAL.md`](EDITOR-MANUAL.md). This document is the lower-level data and runtime contract.

**Status:** Approved implementation plan
**Date:** 2026-07-21
**Primary acceptance scene:** `terminal_ui`
**Architecture references:** [`SPEC.md`](SPEC.md), [`AGENTS.md`](AGENTS.md), [`AI-HANDOFF.md`](AI-HANDOFF.md)

## 1. Objective

Make scene interactions and scene-local interfaces visible, editable, and validatable in the existing browser editor without requiring scene-specific JavaScript.

The finished system must let an author inspect and edit:

- what is present in a scene;
- where it is positioned;
- how it is presented to the player;
- what happens when it is activated;
- which scene, Ink knot, item, view, or scene-local element an action references;
- which UI view(s) contain an element;
- where dynamic Ink lines and choices are rendered.

`terminal_ui` is the proving case. Its launcher, module windows, Ink content, RETURN flow, EXIT route, responsive 4:3 composition, and inventory-HUD suppression must all become data-driven and editor-visible before its custom implementation is removed.

This is an overhaul of the current authoring surface, not a request for a general-purpose visual programming language.

## 2. Current baseline

### 2.1 Existing interactions are already partly data-driven

`story.json` stores scene-local hitboxes with normalized geometry. The runtime in `src/runtime/scene-base.js` currently interprets their behavior in this priority order:

1. `item` — give/pick up an inventory item;
2. `target` — transition to another scene;
3. `ink` — jump to an Ink knot in the current scene.

For example, `terminal_obelab` already contains:

- `Access terminal` with `target: "terminal_ui"`;
- `Walk away` with `target: "exploration_demo"`.

The runtime honors those targets regardless of hitbox presentation. Hitboxes are single-use by default; set `repeatable: true` on a navigation hotspot that must remain usable after returning to the scene.

### 2.2 The editor currently misrepresents that data

The hitbox inspector in `editor.js` uses `type: "button"` as both a presentation choice and a gate for behavior fields:

- `target` is shown only for button presentation;
- `item` is shown only for non-button presentation;
- changing presentation to button deletes `item`;
- non-button hitboxes with valid `target` data appear to be generic “Item / interactive” objects;
- `ink` is not exposed in this inspector.

This is an editor-model problem, not a limitation of the existing runtime hitbox schema.

### 2.3 `terminal_ui` is not presently no-code authored

The scene’s background and Ink path are declared in `story.json`, and terminal prose is stored in `ink/terminal_ui.ink`, but `src/scenes/terminal_ui.js` currently constructs and controls:

- the fixed 1152×864 contained stage;
- terminal header and footer;
- launcher icons and labels;
- module title/code state;
- the application window;
- Ink line and choice rendering;
- active-module presentation;
- RETURN behavior;
- EXIT behavior;
- responsive scaling;
- terminal-specific HUD suppression.

The `.tui-*` selectors in `styles.css` provide scene-specific presentation. This is the interim implementation to replace only after generic parity exists.

## 3. Architectural decisions

### 3.1 Keep presentation independent from behavior

An eye affordance, hand cursor, invisible hotspot, image, label, or panel does not determine what actions are available.

Changing presentation must never silently delete or rewrite behavior.

There is no special Exit, Door, Pickup, Terminal App, or Walk Away element type. Those meanings are compositions of visual elements plus typed actions.

### 3.2 Use elements, events, and typed actions

The authoring model has three separate concerns:

1. **Element** — what exists and where it is;
2. **Event** — when behavior runs;
3. **Action** — what happens, with a typed payload.

Example:

```text
Hotspot: LOG
  On activate
    1. Set UI view → log
    2. Open Ink knot → log
```

Events contain ordered action lists. The editor supplies a dedicated form control for each payload rather than exposing raw JSON or arbitrary code.

### 3.3 Prefer fields and action payloads over behavior-specific element types

The initial visual vocabulary is deliberately small, but there is no arbitrary promise that the system must always contain exactly four types.

Initial element kinds:

- `container`;
- `image`;
- `text`;
- `hotspot`.

Higher-level editor presets may compose these kinds:

- Button = container + text + hotspot;
- Icon button = image + text + hotspot;
- Terminal window = containers + text/content bindings;
- Exit = hotspot with `goToScene`;
- Pickup = hotspot with `giveItem`.

Presets are authoring conveniences, not additional runtime behavior classes.

### 3.4 Keep `story.json` as the single source of truth

The editor mutates the same scene data the runtime reads. Do not create a second editor-only scene format, generated HTML file, per-scene CSS file, or hidden JavaScript representation.

### 3.5 Migrate compatibly

The first passes must expose and validate the existing top-level hitbox fields:

- `target`;
- `ink`;
- `item`;
- `type` as the current presentation marker.

Do not force an immediate full-story schema migration just to repair the inspector. A compatibility adapter may normalize legacy hitboxes into the internal action executor while those fields remain canonical.

### 3.6 Scene-local controls are not inventory items

Terminal launcher icons, RETURN controls, close controls, and EXIT controls are scene-local interface elements. They must not appear in the global `items` pool.

### 3.7 Terminal prose remains in Ink

All module prose and Ink choices remain in `ink/terminal_ui.ink`. The overlay schema defines where current Ink lines and choices render; it does not copy narrative prose into `story.json` or JavaScript.

### 3.8 No per-scene CSS as the final authoring mechanism

Generic runtime/editor classes and built-in style controls are allowed. New `.terminal-*` or `.tui-*` scene-specific overrides are not part of the target architecture.

The generated plate remains reproducible through `tools/build_terminal_ui_grok.py`. Do not hand-edit `assets/backgrounds/scene_terminal_ui_grok.png`.

## 4. Explicit non-goals

Do not build the following unless a later concrete game requirement proves it necessary:

- a node graph;
- drag-and-drop programming blocks;
- arbitrary JavaScript or HTML fields;
- arbitrary expressions;
- loops;
- general if/else trees;
- user-defined functions;
- an entity-component framework;
- a layout engine equivalent to CSS;
- window dragging, z-order focus, or freeform overlapping terminal windows;
- a replacement for Ink;
- a replacement for the existing character or exploration systems.

The terminal uses stacked logical views with one application view active at a time.

## 5. Target scene data contract

The names below are the implementation target. If implementation evidence requires a minor naming adjustment, update this spec and its tests in the same commit rather than allowing undocumented drift.

### 5.1 Scene-level UI configuration

```json
{
  "id": "terminal_ui",
  "kind": "ink",
  "bg": "scene_terminal_ui_grok",
  "bgFit": "contain",
  "hud": {
    "inventory": false
  },
  "overlay": {
    "designWidth": 1152,
    "designHeight": 864,
    "initialView": "desktop",
    "views": ["desktop", "log", "email", "map", "sysinfo"],
    "elements": []
  }
}
```

Decisions:

- Overlay geometry is normalized to the fitted scene stage, matching existing hitbox conventions.
- `designWidth` and `designHeight` define editor rulers and aspect ratio; persisted element rectangles remain normalized.
- `bgFit: "contain"` makes generic background and overlay layout share the same visible 4:3 stage.
- `hud.inventory: false` replaces terminal-specific body-class behavior.
- View names are scene-local identifiers and must be unique.
- Element IDs are unique within one scene.

### 5.2 Common element fields

```json
{
  "id": "log_button",
  "type": "container",
  "parent": "launcher",
  "x": 0.02,
  "y": 0.15,
  "w": 0.10,
  "h": 0.12,
  "visibleIn": ["desktop", "log", "email", "map", "sysinfo"],
  "locked": false,
  "style": {}
}
```

Common rules:

- `id` is required and scene-local.
- `type` selects only the element renderer/editor controls.
- `parent` is optional and references a scene-local container.
- `x`, `y`, `w`, and `h` are finite normalized numbers.
- Array order is paint/order order among siblings.
- `visibleIn` omitted means visible in every view.
- `locked` is an editor authoring flag and must not change runtime semantics.
- Parent cycles are invalid.

### 5.3 Element-specific fields

#### Container

A grouping and clipping/layout surface.

```json
{
  "id": "module_window",
  "type": "container",
  "clip": true,
  "style": {
    "background": "rgba(2, 12, 18, 0.82)",
    "borderWidth": 2,
    "borderColor": "#6aa4aa",
    "padding": 8
  }
}
```

Initial editor-native style controls should cover only proven needs:

- background color/opacity;
- border width/color;
- bevel or inset preset;
- padding;
- clipping;
- opacity;
- alignment.

#### Image

```json
{
  "id": "log_icon",
  "type": "image",
  "asset": "assets/icons/isometric/log.png",
  "fit": "contain",
  "pixelated": true
}
```

The asset must be selected from the project asset browser. Raw external URLs are not supported.

#### Text

```json
{
  "id": "log_label",
  "type": "text",
  "text": "LOG",
  "style": {
    "fontPreset": "pc98-ui",
    "color": "#a7d8dc",
    "align": "center"
  }
}
```

Literal text is for interface labels, not terminal narrative content.

#### Hotspot

```json
{
  "id": "log_hotspot",
  "type": "hotspot",
  "label": "Open system log",
  "presentation": "control",
  "activeIn": ["log"],
  "events": {
    "activate": {
      "actions": [
        { "type": "setView", "view": "log" },
        { "type": "openInk", "knot": "log" }
      ]
    }
  }
}
```

`activate` means click, tap, or keyboard activation. `presentation` controls affordance only:

- `inspect` — eye/examine affordance;
- `control` — hand/button affordance;
- `invisible` — no visual decoration, while remaining accessible through its label where applicable.

`activeIn` is a presentation binding; it does not execute behavior.

## 6. Dynamic content bindings

Dynamic content is a source binding on a text/container element, not a terminal-specific element class.

Initial sources:

- `literal` — ordinary authored interface text;
- `inkLines` — lines emitted by the currently opened Ink knot;
- `inkChoices` — current Ink choices rendered as accessible controls.

Example Ink line region:

```json
{
  "id": "module_content",
  "type": "container",
  "visibleIn": ["log", "email", "map", "sysinfo"],
  "content": {
    "source": "inkLines",
    "tagStyles": {
      "heading": "heading",
      "warn": "warning",
      "ok": "success",
      "dim": "dim",
      "divider": "divider"
    }
  }
}
```

Example Ink choice region:

```json
{
  "id": "module_commands",
  "type": "container",
  "visibleIn": ["log", "email", "map", "sysinfo"],
  "content": {
    "source": "inkChoices",
    "controlPreset": "terminal-command"
  },
  "events": {
    "choiceSelected": {
      "actions": [
        { "type": "setView", "view": "desktop" },
        { "type": "openInk", "knot": "desktop" }
      ]
    }
  }
}
```

The Ink renderer must use tags explicitly authored in Ink. Do not preserve the current terminal’s prose-regex styling guesses as part of the generic architecture.

## 7. Event and action contract

### 7.1 Initial events

Implement only the events required by existing interactions and terminal parity:

- `activate` — hotspot click/tap/keyboard activation;
- `choiceSelected` — after an authored Ink choice is selected in an `inkChoices` content region.

`initialView` handles scene entry. Hover is presentation state, not an authorable behavior event.

### 7.2 Initial actions

| Action | Payload | Editor control | Required for |
|---|---|---|---|
| `goToScene` | `scene` | Scene dropdown | Access terminal, Walk away, EXIT |
| `openInk` | `knot` | Knot dropdown from the scene’s Ink file | Existing `ink` hitboxes, terminal modules |
| `giveItem` | `item` | Item dropdown | Existing pickup hitboxes |
| `setView` | `view` | Current scene’s view dropdown | Terminal desktop/modules |

Example:

```json
{
  "type": "goToScene",
  "scene": "terminal_obelab"
}
```

Actions run in listed order and stop safely if an action transitions away from the current scene. Unknown action types or missing references are validation errors, not silent no-ops.

Do not add show/hide, arbitrary state variables, delays, conditions, or scripting until a concrete scene requires them. View visibility covers the current terminal requirement.

### 7.3 Legacy hitbox compatibility

The shared action executor must be able to normalize current hitbox fields without rewriting every scene:

```text
item   → giveItem(item)
target → goToScene(target)
ink    → openInk(ink)
```

During compatibility, preserve the current runtime precedence `item` → `target` → `ink`. The editor should warn when more than one legacy behavior field is populated because only the highest-priority field currently runs.

Phase 1 may continue writing existing fields. A later migration to explicit `events.activate.actions` must be deliberate, tested, and atomic; do not leave duplicated canonical behavior in both forms.

## 8. Editor requirements

### 8.1 Inspector truthfulness

The hitbox inspector must have separate sections:

```text
Presentation
  Affordance: Inspect / Control

Behavior
  Action: Give item / Go to scene / Open Ink knot / None
  Typed payload control
```

Requirements:

- Presentation changes do not delete behavior fields.
- Scene targets use a dropdown of real scene IDs.
- Ink knots use a dropdown parsed from the selected scene’s Ink file.
- Items use a dropdown of real item IDs.
- Canvas labels summarize behavior, for example `Access terminal → terminal_ui`.
- A destination shortcut selects/opens the target scene in the editor.
- Invalid and missing references are visible before save.

### 8.2 Overlay layer tree

Add a scene-local overlay section that supports:

- add Container, Image, Text, or Hotspot;
- select an element from the tree or canvas;
- drag and resize normalized rectangles;
- reorder siblings;
- group under containers;
- duplicate;
- lock/unlock;
- show/hide in the editor;
- delete with child/reference warnings;
- inspect element-specific fields;
- preview each scene-local view.

Do not mix overlay controls into the global item list.

### 8.3 Typed action editor

For each supported event:

- show an ordered action list;
- add/remove/reorder actions;
- switch action type without retaining orphan payload fields;
- render the correct payload control;
- validate references immediately;
- summarize the event in the layer tree/canvas label.

The editor must never require hand-editing JSON for supported actions.

### 8.4 Preview parity

The editor preview must use the same geometry, view-visibility, ordering, content-source, and style interpretation as the runtime. Shared pure helpers are preferred over parallel calculations.

View selector for the acceptance scene:

```text
Desktop | LOG | EMAIL | MAP | SYSINFO
```

The preview may use representative Ink output, but it must clearly distinguish preview state from saved state and must not mutate playthrough state.

## 9. Runtime architecture

### 9.1 Shared action executor

Create one runtime action dispatcher used by legacy hitboxes and overlay events. It owns:

- action validation assumptions;
- ordered execution;
- scene transition stopping rules;
- Ink knot activation;
- inventory pickup integration;
- scene-local view changes;
- task-tracker notification at the equivalent point in the current lifecycle.

Do not duplicate action switches between `scene-base.js`, a new overlay module, and custom scenes.

### 9.2 Generic overlay renderer

Add a generic runtime module, expected at `src/runtime/overlay.js` unless implementation shows a clearer name. It owns:

- building scene-local overlay DOM;
- fitted-stage geometry;
- element hierarchy and paint order;
- view visibility;
- built-in style application;
- content-source rendering;
- accessible semantics;
- event wiring;
- complete teardown of DOM and retained listeners.

`Scene` owns the module’s lifecycle. The overlay must be destroyed on every scene shutdown and safe across cached-scene re-entry.

### 9.3 Generic Ink document rendering

The generic content renderer must:

- choose an authored knot;
- render all current lines without the global typewriter panel;
- preserve explicit Ink tags;
- render current choices as accessible controls;
- execute `choiceSelected` actions after choosing;
- report missing knots without crashing the scene;
- avoid duplicate callbacks/timers when the scene is re-entered.

The terminal’s current manual `_walkInk()` behavior is the parity reference, not the final implementation location.

### 9.4 Generic scene presentation options

Add generic data-driven handling for:

- background fit (`cover` remains default; `contain` is opt-in);
- overlay design aspect/stage;
- per-scene HUD visibility.

Do not hide the inventory through a terminal-specific body class in the final implementation.

## 10. Validation requirements

Extend `server.js::validateStory` and focused tests to reject:

- non-array or malformed overlay structures;
- duplicate view names;
- invalid `initialView` references;
- duplicate element IDs;
- missing parents;
- parent references to non-containers;
- parent cycles;
- non-finite geometry;
- unsupported element types;
- invalid `visibleIn` or `activeIn` views;
- unsupported event types;
- malformed action arrays;
- unsupported action types;
- missing scene, item, view, element, or Ink-knot references where the validator can resolve them;
- content sources used on unsupported element kinds.

The save endpoint must continue to perform atomic writes.

## 11. Phased implementation plan

Each phase should be a separately reviewable commit with its own focused tests. Keep the playable custom terminal until Phase 5 parity is proven.

### Phase 1 — Repair the existing hitbox inspector

- [x] Separate Presentation and Behavior sections.
- [x] Expose `target`, `ink`, and `item` independent of presentation.
- [x] Stop presentation changes from deleting behavior.
- [x] Replace raw scene target input with a scene dropdown.
- [x] Add Ink-knot and item dropdowns.
- [x] Add action summaries to canvas labels.
- [x] Warn on multiple populated legacy behavior fields.
- [x] Add a shortcut to open a target scene.
- [x] Update focused editor tests, especially `test/editor-button-hitbox.test.js`.

**Acceptance:** `Access terminal` and `Walk away` both visibly show their actual destinations while retaining the desired affordance.

### Phase 2 — Introduce the shared typed action executor

- [ ] Define the action registry and payload validators.
- [ ] Normalize legacy `item`, `target`, and `ink` hitboxes internally.
- [ ] Route current hitbox activation through the executor.
- [ ] Preserve current action precedence and task/inventory timing.
- [ ] Test `giveItem`, `goToScene`, and `openInk` through real runtime paths.
- [ ] Confirm every existing scene still plays without story migration.

**Acceptance:** Existing hitboxes behave identically, but behavior execution no longer depends on scattered field-specific branches.

### Phase 3 — Add generic overlay elements and editor layer authoring

- [ ] Add scene-level `overlay` validation.
- [ ] Add generic runtime overlay lifecycle.
- [ ] Implement Container, Image, Text, and Hotspot.
- [ ] Implement normalized geometry against the fitted scene stage.
- [ ] Add layer tree, selection, drag, resize, reorder, grouping, lock, duplicate, and delete.
- [ ] Reuse selection/drag lifecycle safeguards already established for sprites and hitboxes.
- [ ] Add `bgFit: "contain"` and generic HUD visibility.
- [ ] Add runtime teardown and editor lifecycle tests.

**Acceptance:** A test scene can be composed in the editor from elements, saved, reloaded, rendered, activated by pointer and keyboard, and torn down without leaked DOM/listeners.

### Phase 4 — Add scene-local views and Ink content bindings

- [ ] Add view definitions, initial view, and preview selector.
- [ ] Implement `visibleIn` and `activeIn`.
- [ ] Implement `setView`.
- [ ] Implement `inkLines` and `inkChoices` content sources.
- [ ] Implement explicit Ink tag-to-style mapping.
- [ ] Implement `choiceSelected` actions.
- [ ] Add missing-knot and scene-reentry tests.

**Acceptance:** A generic authored mini-terminal can switch views, render an Ink document, choose RETURN, and restore the desktop without custom scene code.

### Phase 5 — Migrate `terminal_ui`

- [ ] Encode the contained 1152×864 stage and inventory-HUD policy in `story.json`.
- [ ] Author header, footer, launcher, icons, labels, module window, line region, and command region as overlay elements.
- [ ] Author LOG, EMAIL, MAP, and SYSINFO activation as `setView` + `openInk` action lists.
- [ ] Keep all module prose and RETURN choices in `ink/terminal_ui.ink`.
- [ ] Author EXIT as `goToScene → terminal_obelab`.
- [ ] Verify active launcher states and all Ink tag styles.
- [ ] Verify desktop, all modules, RETURN, titlebar close behavior, EXIT, and re-entry.
- [ ] Verify desktop and responsive viewport parity before removing the fallback.
- [ ] Remove `src/scenes/terminal_ui.js` only after parity.
- [ ] Remove its `index.html` script entry only after parity.
- [ ] Remove terminal-specific `.tui-*` CSS only after equivalent built-in styling is proven.

**Acceptance:** A new agent can understand and modify the complete terminal flow through `story.json`, Ink, and the editor, with no terminal-specific JavaScript or CSS.

### Phase 6 — Harden and document

- [ ] Add reference-integrity tests for scenes, items, views, parents, and actions.
- [ ] Add editor save/reload round-trip coverage.
- [ ] Add browser interaction tests for the migrated terminal.
- [ ] Update `SPEC.md` with the shipped schema and runtime module ownership.
- [ ] Remove compatibility code only when no live story data depends on it.
- [ ] Keep this file as the migration record; mark completed phases and record intentional deviations.

## 12. Terminal parity matrix

| Behavior | Current owner | Target owner | Must preserve |
|---|---|---|---|
| 4:3 contained plate | `TerminalUIScene._drawBackground/_layoutStage` | Generic `bgFit` + overlay stage | No crop at portrait/wide viewports |
| Header/footer | `terminal_ui.js` + `.tui-*` CSS | Overlay elements + built-in styles | Text, spacing, status lamp alignment |
| Launcher icons | `TERMINAL_APPS` + DOM | Overlay image/text/hotspot groups | Assets, labels, hover/active states |
| Module selection | `_openApp()` | `setView` + `openInk` | LOG/EMAIL/MAP/SYSINFO routes |
| Module prose | `terminal_ui.ink` + `_walkInk()` | Same Ink + generic Ink renderer | Exact prose and authored tags |
| RETURN choice | `_renderChoices/_chooseInk` | `inkChoices` + `choiceSelected` actions | Returns to desktop reliably |
| Titlebar close | `_showDesktop()` | Hotspot action list | Returns to desktop |
| EXIT | `_exitTerminal()` | `goToScene` | Returns to `terminal_obelab` |
| Inventory suppression | body class | `hud.inventory: false` | Hidden only in terminal scene |
| Teardown/re-entry | `shutdown()` | Generic overlay lifecycle | No stale DOM/listeners/state |
| Generated plate | build script | Unchanged build script | Reproducible PNG + sidecar/log |

## 13. Required verification before removing the custom terminal

Automated:

- [ ] `git diff --check`.
- [ ] `node --check` on changed JavaScript.
- [ ] `story.json` parses and passes `validateStory`.
- [ ] Full `npm test` passes.
- [ ] Focused action, overlay, editor, validation, and lifecycle tests pass.
- [ ] Direct `terminal_ui` route returns HTTP 200.
- [ ] Browser automation opens all four modules, activates RETURN, activates close, exits, and re-enters.
- [ ] Browser console contains no runtime errors.

Visual:

- [ ] 1152×864 design alignment matches the approved plate.
- [ ] 1280×720 desktop contains the complete terminal.
- [ ] 1920×1080 desktop contains the complete terminal.
- [ ] 800×1000 portrait contains the complete terminal.
- [ ] Header status, all four lamps, icon labels, titlebar, content, command bar, and footer remain aligned.
- [ ] Terminal Ink content remains readable and does not overflow.
- [ ] No inventory artifact appears over the terminal.

Authoring:

- [ ] Every visible terminal control can be selected in the editor.
- [ ] Every destination/action is visible through a typed control.
- [ ] Every view can be previewed without running the game.
- [ ] Editing and saving does not require raw JSON, JavaScript, HTML, or per-scene CSS.

## 14. Rollback and commit discipline

- Keep the current terminal implementation playable until parity is demonstrated.
- Commit each phase separately.
- Do not combine terminal deletion with the first generic-runtime commit.
- Preserve `efbacaf` as the main terminal/Obelab rollback checkpoint.
- Preserve `7235943` as the final indicator-lamp/spacing polish checkpoint.
- Do not push without explicit authorization.
- Keep `.tmp/` and diagnostic scratch assets out of Git.
- Do not make paid media-generation calls as part of this editor migration.

## 15. Definition of done

The overhaul is complete when:

1. existing hitbox behavior is accurately represented in the editor;
2. presentation changes cannot alter behavior accidentally;
3. supported event/action payloads use typed, validated controls;
4. scene-local overlays are composed and previewed in the editor;
5. `terminal_ui` has full visual and behavioral parity without `src/scenes/terminal_ui.js` or terminal-specific CSS;
6. Ink remains the source of terminal prose and choices;
7. runtime/editor/save validation agree on the same schema;
8. all focused, full-suite, route, browser, responsive, teardown, and re-entry checks pass;
9. `SPEC.md` documents the final shipped architecture;
10. the repository is left clean except for intentionally ignored local scratch files.
