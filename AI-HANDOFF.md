# AI-HANDOFF — Ghost Process

## Update (2026-07-18) — approved narrow-step Grok walk shipped

### Live state

- Project: `/Users/jwhite/ghost-process-js`
- Stack: vanilla JavaScript + InkJS + Express. Do not use the abandoned Godot repo at `/Users/jwhite/ghost-process` or the legacy `/Users/jwhite/ghost-process-98` project.
- Branch: `feature/exploration-hybrid`
- Latest code/assets commit: `ac12dfb` (`feat: ship approved Grok exploration walk cycle`)
- The handoff is a documentation commit on top of that code commit.
- Nothing from this update has been pushed. Re-check with `git status -sb` and `git rev-list --left-right --count origin/main...HEAD` rather than relying on a stored ahead count.
- Verification at the code commit: `npm test` passed 73/73; `node --check src/runtime/sprites.js`, both prompt JSON files, `story.json`, `python3 -m py_compile tools/rebuild_grok_stroll_v2.py`, and `git diff --check` passed.
- The local demo and Tailscale exploration URL returned HTTP 200. A fresh 390×844 headless-Chrome screenshot showed the v3 protagonist rendered in the OBE lab with no page-level visual breakage.

### What landed

The exploration demo now uses the user-approved Grok v3 narrow-step stroll:

```text
assets/sprites/protagonist/obe_lab/walk_frames_grok_stroll_v3_narrow_step_16/frame_*.png
```

Runtime configuration in `story.json` is 16 frames at 8 fps. `src/runtime/sprites.js` now supports data-driven `idleFrame` and `loopStartFrame` values so a rest pose can remain outside a movement loop when future sprites need that distinction.

The approved earlier Grok v2 stroll remains a fallback:

```text
assets/sprites/protagonist/obe_lab/walk_frames_grok_stroll_v2_16/frame_*.png
```

Both frame sets contain exactly 16 RGBA PNGs at 240×426, plus a contact sheet, strip, and GIF preview. The original MiniMax sheet and its retained v1/v4/hold derivatives remain in the same asset directory. No failed protagonist-generation branch remains in the asset directory; do not restore discarded branches as live assets.

### Prompt provenance

The exact successful I2V prompts are committed beside the sprite assets:

- `assets/sprites/protagonist/obe_lab/grok_investigator_stroll_v3_narrow_step.prompt.json` — `approved_current`; exact narrow-step prompt, input image path, source MP4 path, and live runtime glob.
- `assets/sprites/protagonist/obe_lab/grok_investigator_stroll_v2.prompt.json` — `approved_fallback`; exact earlier stroll prompt, source MP4 path, and fallback runtime glob.

The v3 prompt is the reusable starting point for future walking sprites. Its important gait constraints are compact short steps, feet passing beneath the hips, low foot clearance, no wide boot separation, no lunges, and smooth alternating contact/passing/toe-off phases.

The generated source MP4s are retained in OpenClaw's machine-local media directory, not Git. The committed runtime frames and prompt provenance are self-contained for the game, while `tools/rebuild_grok_stroll_v2.py` documents the v2 MP4-to-16-frame extraction and chroma cleanup path.

### Decisions to preserve

- Grok v3 narrow-step is the current approved live animation; do not silently switch the demo back to MiniMax or Grok v2.
- Grok v2 is the previous approved fallback, not a failed iteration.
- Keep the original MiniMax sheet and its v1/v4/hold derivatives unless the user explicitly requests their removal.
- The user preferred v3 because its stride is narrower and more ordinary. Do not reintroduce a wide-stride, marching, hiking, power-walk, or high-knee gait.
- The exact saved v3 prompt is superior to the prior prompt and should be adapted rather than reconstructed from memory.

### Demo URL

Use the Tailscale hostname, not the raw `100.x` address:

```text
https://josephs-macbook-air-1.tail7d9c15.ts.net:8444/index.html?scene=exploration_demo
```

The Express server intentionally listens only on `127.0.0.1:8765`; Tailscale Serve proxies it tailnet-only on port 8444. No public webserver allowlist rule is required.

### Carry-over

No required follow-up remains from the protagonist walk-cycle work. If Joseph asks for another gait refinement, start from the committed v3 prompt and keep the current v3 runtime frames live until a replacement is explicitly approved.

Do not push without a new explicit request.
