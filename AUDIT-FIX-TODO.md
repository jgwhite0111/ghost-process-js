# Audit Fix Queue

This file is the persistent execution queue for the validated 2026-07-14 audit findings.

## Working-tree guard

- Preserve the pre-existing `story.json` diff. It contains editor-authored sprite placements plus JSON formatting changes (`14 + / 14 -` at queue creation).
- Do not alter `terminal_lab_c` audio or related assets unless Joseph explicitly requests it.
- Parent agent plans, reviews, and verifies. MiniMax-M3 subagents implement code changes.
- Complete and verify one numbered item before moving to the next.
- Do not commit unless Joseph explicitly requests it.

## Queue

- [x] **1. Fix second-visit alley/Kabukicho pickup soft-locks** *(verified)*
  - Reconcile pickup tasks and Ink entry state from held/consumed inventory on scene entry.
  - Preserve first-visit pickup animation/dialogue behavior.
  - Verified: `npm test` 3/3; all 9 Ink files compile; real runtime first/held/consumed alley states and consumed Kabukicho route pass.

- [x] **2. Restore declared `intro → cold_open → alley` route** *(verified)*
  - Change PRESS START target from `alley` to `cold_open` without disturbing existing `story.json` edits.
  - Verified: all non-target `story.json` values preserved; 4/4 tests and all 9 Ink files pass; browser route visited `intro → cold_open → alley`.

- [x] **3. Stop cached scene revisits from accumulating character objects** *(verified)*
  - Reset scene-owned per-start character state or stop caching scene instances.
  - Verified: 5/5 tests and all 9 Ink files pass; four real alley visits each retained exactly one android character.

- [x] **4. Make final-dialogue completion idempotent** *(verified)*
  - Cancel/guard delayed completion callbacks after snap-finish.
  - Verified: 9/9 tests and all 9 Ink files pass; browser natural, snap, and redirected-path completion counts were `1`, `1`, and `2` respectively.

- [x] **5. Replace all-at-once startup preloading with staged loading** *(verified)*
  - Load only startup-critical assets, then preload upcoming scene assets opportunistically.
  - Preserve medley behavior and eliminate duplicate in-flight image loads.
  - Verified: 13/13 tests and all 9 Ink files pass; throttled cache-disabled Chrome reached the active intro at 29 total/10 asset requests while background loading remained incomplete, versus the audited 119-request/75.37 MB startup barrier.

- [x] **6. Clear and validate editor selection on scene changes** *(verified)*
  - Prevent inspector edits from mutating an object belonging to the previous scene.
  - Verified: 16/16 tests and all 9 Ink files pass; headless Chrome confirmed same-scene preservation, invalid-scene rejection, scene-change clearing, stale-inspector removal, unchanged old object, and reload reference clearing.

- [x] **7. Align editor task schema with runtime** *(verified)*
  - Use `goto_dialog`, expose required `combine.result`, and resolve/remove unsupported `use_item.on_hitbox`.
  - Verified: 21/21 tests and all 9 Ink files pass; behavioral VM tests execute real editor handlers and runtime task completion for every corrected schema path.

- [x] **8. Prevent empty numeric inputs from saving as `null`** *(verified)*
  - Reject/preserve non-finite values in the editor.
  - Add nested server-side numeric/schema validation.
  - Verified: 27/27 tests passed; all 9 Ink files compiled; direct HTTP rejection returned `400` with the precise nested path and left `story.json` byte-identical.

- [x] **9. Fix editor QueuePlayer/list-directory rerender leaks** *(verified)*
  - Retain and invoke QueuePlayer unsubscribe callbacks.
  - Cache/dedupe repeated `/api/list` requests.
  - Verified: 29/29 tests and all 9 Ink files passed; parent browser probe after 10 rerenders measured 1 active listener, 0 additional list requests, 5 mounted rows, and working play/highlight/stop state.

- [x] **10. Fix network/editor security findings** *(verified)*
  - Remove scene-ID `innerHTML` injection and validate identifiers.
  - Protect mutation endpoints with a safe loopback default, same-origin checks, and explicit token-gated non-loopback/Tailscale access.
  - Verified: 43/43 tests and all 9 Ink files pass; live browser injection probe rendered malicious markup as literal text; isolated loopback/remote servers returned expected 400/403/401 responses; unprotected non-loopback startup refused; `story.json` hash remained unchanged.

- [x] **11. Keep hitbox overlay and required-item labels correct after resize/hover** *(verified)*
  - Listen for canvas resize and resync overlay bounds.
  - Restore always-visible required-item labels after hover exits.
  - Verified: 46/46 tests and all 9 Ink files pass; live runtime probe confirmed overlay bounds changed from 640×480 at (100,50) to 320×240 at (60,70), required-item opacity restored after hover, and destroy detached the overlay/listener.

- [x] **12. Refresh an already-open inventory popup after mutations** *(verified)*
  - Re-render list contents on add/remove/refresh instead of early-returning.
  - Verified: 47/47 tests and all 9 Ink files pass; live browser probe added two items, preserved selection, removed the selected item with correct fallback, and retained the same popup shell throughout.

- [x] **13. Cache processed image work** *(verified)*
  - Preserve the verified in-flight image-promise cache; cache processed dither/despill canvases by source + complete rendering parameters.
  - Verified: 50/50 tests and all 9 Ink files pass; live title rendering is intact. A live 800×600 background repeat fell from 49.3 ms to 0 ms and a 240×426 Android despill repeat fell from 5.8 ms to 0 ms, returning the same canvas with identical pixel hashes.

- [x] **14. Resolve stale recipe data** *(verified)*
  - Recipes are not a shipped feature: removed dead recipe data and combination affordances coherently from live data, editor/runtime, validation, tests, and current architecture docs.
  - Verified: 52/52 tests and all 9 Ink files pass; live editor exposes only the five supported task types; isolated production HTTP validation rejects both top-level recipes and combine tasks without mutating the story.

- [x] **15. Clean low-risk tooling duplication/drift** *(verified)*
  - Removed the unused `MEDLEYS` declaration; `story.json` remains the authoritative queue wiring.
  - Updated `gen_intro_v2.py` default/docs from obsolete v7 to live v11.
  - Refreshed stale A/B-only comments in `src/runtime/music.js` to describe generic ordered medleys without changing executable code.
  - Replaced practical machine-specific roots in five utility scripts plus current README/AGENTS commands.
  - Left the duplicate preview `render()` helpers separate because those scripts are historical one-off diagnostics, not an active shared subsystem.
  - Verified: 52/52 tests, all 9 Ink files, Python compilation, composer `--list`, generator `--help`, AST checks, and JS syntax pass; runtime music code tokens and audio/image assets are unchanged.

## Findings deliberately not queued

- No generator-process HTTP endpoints exist; that delegated claim was disproved.
- A single dialogue-box click does not inherently dispatch to both the dialogue DOM and canvas.
- Intentional MIDI/MP3 pairs and sprite frames are not accidental duplicates.
