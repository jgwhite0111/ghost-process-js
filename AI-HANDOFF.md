# AI-HANDOFF — Ghost Process

> **Stack assertion:** This is `/Users/jwhite/ghost-process-js`, the live browser-first project. Use vanilla JavaScript + InkJS + Express only. Do not work in `~/ghost-process/` or `~/ghost-process-98/`; they are unrelated dead projects. Do not introduce TypeScript, a bundler, Phaser, Godot, Mono, or Yarn Spinner.

## Update (2026-07-22) — generic overlay/editor batch committed

The completed Phase 3/4/5 implementation and the canonical newcomer editor manual are committed in `4bcb02c` (`Complete generic overlay editor and terminal migration`). This handoff is the separate documentation boundary immediately on top of that implementation commit. Verify the live branch and remote state with the commands below rather than trusting stale ahead/behind numbers.

## Current state

- Project: `/Users/jwhite/ghost-process-js`
- Branch: `feature/exploration-hybrid`
- Implementation checkpoint: `4bcb02c`
- Intended remote branch: `origin/feature/exploration-hybrid`
- `origin/main` remains the historical comparison base; do not rebase or reset without an explicit request.
- The generic overlay/editor batch is complete. No known Phase 3/4/5 carry-over item is open.
- The canonical newcomer guide is [`EDITOR-MANUAL.md`](EDITOR-MANUAL.md); the lower-level contract is [`EDITOR-AUTHORING-SPEC.md`](EDITOR-AUTHORING-SPEC.md).

## What is complete

- Phase 3: generic static overlays and editor authoring.
- Phase 4: scene-local overlay views and generic Ink bindings.
- Phase 5: `terminal_ui` migrated from the deleted scene-specific module to a generic authored overlay.
- Follow-up repairs: titlebar close-glyph alignment, repeatable `terminal_obelab` “Walk away” navigation, and editor-only yellow selection highlighting.
- `src/scenes/terminal_ui.js` and its obsolete terminal-specific CSS/registration path are deleted. Do not recreate them.
- `src/runtime/actions.js` remains the shared typed action executor. Do not bypass it or add terminal-specific action types.
- `story.json` remains the authoring source of truth.

## Generic overlay contract

- Element types are exactly `container`, `image`, `text`, and `hotspot`.
- `terminal_ui` has 56 authored elements and five local views: `desktop`, `log`, `email`, `map`, and `sysinfo`.
- Terminal prose and choices remain in `ink/terminal_ui.ink`; overlay data contains bindings, not duplicated dialogue.
- Local views are scene-local presentation state. `setView(view)` is not scene navigation; `goToScene(scene)` is the navigation action.
- Hitboxes/hotspots are one-shot by default. Use `repeatable: true` only for interactions that must work after revisits.
- Yellow selected handles are transient editor UI from `state.selected`; they are not serialized story data and are not player rendering.

## Verification recorded for the committed batch

| Check | Result |
|---|---:|
| `npm test` | **103 passed, 0 failed** |
| Phase 3/4 raw-CDP acceptance | **40/40** |
| Phase 5 raw-CDP acceptance | **24/24** |
| Browser console/page errors | **0 / 0** |
| `story.json` parse and production validation | **passed; 56 terminal elements** |
| JavaScript syntax checks | **passed** |
| `git diff --check` | **passed** |
| HTTP smoke: `/editor.html`, `/index.html?scene=terminal_ui`, `/api/story` | **200 / 200 / 200** |
| Manual link check | **17 valid relative links** |

`npm test` emits one non-failing `MODULE_TYPELESS_PACKAGE_JSON` warning for `test/terminal-overlay-phase5.test.js`; it does not affect the passing result.

## Required reading order for a new session

1. `AGENTS.md`
2. `SPEC.md`
3. `EDITOR-MANUAL.md`
4. `EDITOR-AUTHORING-SPEC.md`
5. This handoff
6. `story.json`, `src/runtime/overlay.js`, `src/runtime/scene-base.js`, and `src/runtime/actions.js` when changing authoring/runtime behavior
7. `test/terminal-overlay-phase5.test.js` and `tools/browser-phase5-terminal-acceptance.mjs` when changing terminal behavior

## Safe continuation

- Verify the live boundary before editing:

  ```bash
  cd /Users/jwhite/ghost-process-js
  git status -sb
  git rev-parse --short HEAD
  git rev-list --left-right --count origin/feature/exploration-hybrid...HEAD
  npm test
  git diff --check
  ```

- Treat Phases 3, 4, and 5 as complete unless a new regression is demonstrated. Do not redo or redesign the generic terminal migration.
- Preserve exploration, Ink, inventory, hitbox, transition, resize, teardown, and re-entry behavior.
- Keep the authoring server loopback-only and do not expose it publicly.
- Do not generate or purchase media for this work.
- Do not reset, force-push, or discard existing work without explicit authorization.
- For a new regression, use the repository-owned browser acceptance scripts with finite timeouts and fixture restoration, then update this handoff with concrete evidence.

## Git boundary

- Implementation commit: `4bcb02c`.
- The handoff refresh is intentionally a separate documentation commit on top; do not cite that future commit’s SHA inside this file.
- A valid `/new` boundary has an empty `git status --short` and matching local/remote branch SHAs after the requested push. Verify with:

  ```bash
  git status --short
  git rev-parse --short HEAD origin/feature/exploration-hybrid
  git rev-list --left-right --count origin/feature/exploration-hybrid...HEAD
  ```
