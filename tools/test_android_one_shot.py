"""Verify the corridor android hand-raise plays once then holds.

Navigates from the title screen to the corridor scene, then samples the
android sprite's currentFrame every 100ms for 8 seconds. Asserts:
  - The frame index visits 0..15 during the first 3 seconds (the one-shot)
  - After ~3 seconds, the frame index is bounded by [5, 9] (the hold range)
  - The frame index does NOT leave the hold range after settling

If playOnce / holdFrames aren't wired up, the loop will visit 0..15
forever and the hold-range assertion will fail.
"""
import sys
from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda exc: errors.append(f"PAGEERROR: {exc}"))
        page.on(
            "console",
            lambda msg: errors.append(f"CONSOLE.{msg.type}: {msg.text}")
            if msg.type == "error" else None,
        )

        page.goto("http://localhost:8765/index.html", wait_until="load")
        page.wait_for_timeout(2000)  # autoplay wait

        # Click PRESS START
        page.click(".hitbox", timeout=5000)
        page.wait_for_timeout(500)  # navigate to alley

        # In the production story flow, we need to walk: alley -> chase ->
        # kabukicho -> corp_office -> corridor. Easiest: just walk forward
        # through hitboxes until we land on corridor. The terminal_lab is
        # right after corridor (no hitbox to advance), so we just wait
        # through dialogue until corridor is the active scene.
        #
        # Simpler approach: directly navigate via the engine's internal
        # API. Look for window.Engine / window.goTo / etc.
        # Inspect globals.
        has_globals = page.evaluate("""() => {
            const keys = Object.keys(window).filter(k =>
                /engine|scene|story|register|inkjs/i.test(k)
            );
            return keys;
        }""")
        print(f"Window globals matching engine/scene/story/register: {has_globals}")

        # Easiest: just navigate via the engine's `goTo` if exposed.
        # Most likely: the engine exposes a `goTo` or similar.
        # Fall back to walking the hitbox path if not.
        try:
            page.evaluate("() => window.Engine.goTo('corridor')")
        except Exception as exc:
            print(f"window.Engine.goTo('corridor') failed: {exc}")
            # Walk the story path instead.
            # From alley: click through to chase, kabukicho, corp_office,
            # then corridor. Each scene has a hitbox or a wait.
            for label, advance in [
                ("alley", "click hitbox to chase"),
                ("chase", "wait for chase to advance"),
                ("kabukicho", "click hitbox to corp_office"),
                ("corp_office", "wait for corp_office to advance"),
                ("corridor", "arrived"),
            ]:
                if advance.startswith("click"):
                    try:
                        page.click(".hitbox", timeout=3000)
                        page.wait_for_timeout(500)
                    except Exception as e2:
                        print(f"  {label}: hitbox click failed: {e2}")
                else:
                    # Just wait; auto-advance scenes have no hitbox.
                    page.wait_for_timeout(3000)
                print(f"  walked to {label}")

        # Wait for the corridor scene to be active.
        page.wait_for_function(
            "() => window.Engine && window.Engine._state.current && "
            "window.Engine._state.current.sceneId === 'corridor'",
            timeout=10000,
        )
        print("Active scene: corridor")

        # Wait for the android character to be mounted and frames bound.
        page.wait_for_function(
            """() => {
                const eng = window.Engine;
                if (!eng || !eng._state.current) return false;
                const chars = eng._state.current.characters || [];
                for (const c of chars) {
                    if (c.character && c.character.id === 'android' &&
                        c.frames && c.frames.length > 0) {
                        return true;
                    }
                }
                return false;
            }""",
            timeout=5000,
        )
        print("Android character is mounted with frames bound")

        # Sample the android's currentFrame every 100ms for 8 seconds.
        # We use evaluate inside a loop to keep the script in the page
        # context for fast sampling (avoids round-trip overhead per
        # sample).
        samples = page.evaluate(
            """async () => {
                const eng = window.Engine;
                const scene = eng._state.current;
                const chars = scene.characters || [];
                let android = null;
                for (const c of chars) {
                    if (c.character && c.character.id === 'android') {
                        android = c; break;
                    }
                }
                if (!android) return { error: 'android not found' };

                const out = [];
                const t0 = performance.now();
                const sampleEvery = 100; // ms
                const total = 8000;     // ms
                let next = t0;
                while (performance.now() - t0 < total) {
                    const now = performance.now();
                    if (now >= next) {
                        out.push({
                            t: Math.round(now - t0),
                            frame: android.currentFrame,
                            hasFiredOneShot: !!android._hasFiredOneShot,
                            playOnce: !!android._playOnce,
                            holdStart: android._holdStart,
                            holdEnd: android._holdEnd,
                            loop: android.loop,
                        });
                        next = now + sampleEvery;
                    }
                    await new Promise(r => setTimeout(r, 16));
                }
                return out;
            }"""
        )

        if isinstance(samples, dict) and "error" in samples:
            print(f"ERROR: {samples['error']}")
            return 1

        print(f"\nSampled {len(samples)} frames over 8s")
        print("\n  t(ms)  frame  hasFiredOneShot  playOnce  holdStart  holdEnd  loop")
        for s in samples[::3]:  # print every 3rd sample
            print(
                f"  {s['t']:5d}  {s['frame']:5d}  "
                f"{str(s['hasFiredOneShot']):15s}  "
                f"{str(s['playOnce']):8s}  "
                f"{str(s['holdStart']):9s}  "
                f"{str(s['holdEnd']):7s}  "
                f"{str(s['loop'])}"
            )

        # Sanity check the config was read
        first = samples[0]
        assert first["playOnce"] is True, \
            f"playOnce not picked up: {first}"
        assert first["holdStart"] == 5 and first["holdEnd"] == 9, \
            f"holdFrames not picked up: {first}"
        assert first["loop"] is True, \
            f"loop not picked up: {first}"
        print("\n✓ Config fields read correctly: playOnce=True, holdFrames=[5,9], loop=True")

        # One-shot: during the first ~3s, the frame should visit 0..15
        # (16 frames * 167ms = ~2.67s for the one-shot playthrough at 6fps).
        one_shot_samples = [s for s in samples if not s["hasFiredOneShot"]]
        hold_samples = [s for s in samples if s["hasFiredOneShot"]]
        print(f"\n  Pre-one-shot samples: {len(one_shot_samples)}")
        print(f"  Hold-state samples:   {len(hold_samples)}")

        assert len(one_shot_samples) > 0, \
            "No samples during the one-shot phase"
        assert len(hold_samples) > 0, \
            "No samples after the one-shot fired — did the transition happen?"

        # Find the highest frame visited during the one-shot
        max_one_shot_frame = max(s["frame"] for s in one_shot_samples)
        print(f"  Max frame during one-shot: {max_one_shot_frame} (should reach 15)")
        assert max_one_shot_frame == 15, \
            f"Expected one-shot to reach frame 15, got {max_one_shot_frame}"

        # Hold range: all hold-state samples must be within [5, 9]
        for s in hold_samples:
            assert 5 <= s["frame"] <= 9, \
                f"Frame {s['frame']} at t={s['t']}ms is outside hold range [5,9]"
        print(f"  All {len(hold_samples)} hold-state samples within [5, 9] ✓")

        # Verify it actually loops: unique frames in hold state
        unique_hold_frames = set(s["frame"] for s in hold_samples)
        print(f"  Unique frames in hold state: {sorted(unique_hold_frames)}")
        assert len(unique_hold_frames) >= 2, \
            f"Expected at least 2 distinct frames in hold state, got {unique_hold_frames}"

        if errors:
            print("\nBrowser errors:")
            for e in errors[:20]:
                print(f"  {e}")

        browser.close()
        print("\n✓ ALL CHECKS PASSED — one-shot + hold range working")
        return 0


if __name__ == "__main__":
    sys.exit(main())
