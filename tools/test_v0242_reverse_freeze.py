"""Verify v0.2.42 forward + reverse + freeze sprite animation.

The captain sprite in the corridor scene should:
  1. Play forward 0..15 (hand raises, ball appears and peaks)
  2. Play reverse 15..1 (hand lowers, ball shrinks)
  3. Freeze on frame 0 (rest pose, no ball)
  4. NOT loop — stays at frame 0 forever after the reverse completes

We sample currentFrame every 80ms for ~12 seconds, then assert:
  - The frame index visits the peak range [12, 15] during the forward playthrough
  - The frame index visits the descent range [12, 1] (descending order) during reverse
  - After reverse completes (around 8s @ 6fps = ~48 frames = 8s), currentFrame stays 0
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
        page.wait_for_timeout(2000)

        page.click(".hitbox", timeout=5000)
        page.wait_for_timeout(500)

        # Jump directly to corridor via the engine API.
        try:
            page.evaluate("() => window.Engine.goTo('corridor')")
        except Exception as exc:
            print(f"window.Engine.goTo('corridor') failed: {exc}")
            return 1

        page.wait_for_function(
            "() => window.Engine && window.Engine._state.current && "
            "window.Engine._state.current.sceneId === 'corridor'",
            timeout=10000,
        )
        print("Active scene: corridor")

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
        print("Android character mounted with frames bound")

        # Sample the sprite's state every 80ms for ~14 seconds.
        # At 6 fps, 16-frame forward = ~2.67s, 16-frame reverse = ~2.67s,
        # so total animation should complete in ~5.3s. We sample 14s to
        # verify the freeze holds for ~9s after.
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
                const sampleEvery = 80;
                const total = 14000;
                let next = t0;
                while (performance.now() - t0 < total) {
                    const now = performance.now();
                    if (now >= next) {
                        out.push({
                            t: Math.round(now - t0),
                            frame: android.currentFrame,
                            hasFiredOneShot: !!android._hasFiredOneShot,
                            hasFiredReverse: !!android._hasFiredReverse,
                            playOnce: !!android._playOnce,
                            playReverse: !!android._playReverse,
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

        print(f"\nSampled {len(samples)} frames over 14s")
        print("\n  t(ms)   frame  hasFwd  hasRev  playOnce  playRev  loop")
        # Print a windowed subset: every 5th sample, plus the first/last 5
        printed = set()
        for i in range(0, len(samples), 5):
            printed.add(i)
        for i in range(min(5, len(samples))):
            printed.add(i)
        for i in range(max(0, len(samples) - 5), len(samples)):
            printed.add(i)
        for i in sorted(printed):
            s = samples[i]
            print(
                f"  {s['t']:5d}   {s['frame']:4d}  "
                f"{str(s['hasFiredOneShot']):6s}  "
                f"{str(s['hasFiredReverse']):6s}  "
                f"{str(s['playOnce']):8s}  "
                f"{str(s['playReverse']):7s}  "
                f"{s['loop']}"
            )

        # ===== ASSERTIONS =====

        # 1. Flags are wired correctly
        first = samples[0]
        assert first["playOnce"] is True, \
            f"playOnce should be true (set via playForward), got {first['playOnce']}"
        assert first["playReverse"] is True, \
            f"playReverse should be true, got {first['playReverse']}"
        assert first["loop"] is False, \
            f"loop should be false, got {first['loop']}"
        print("\n✓ Flags wired: playOnce=True, playReverse=True, loop=False")

        # 2. Forward playthrough reaches the peak range [12, 15]
        peak_reached = any(12 <= s["frame"] <= 15 for s in samples)
        assert peak_reached, \
            "Forward playthrough should reach frames 12-15 (peak ball)"
        # Find when peak is reached
        first_peak = next(
            (s for s in samples if 12 <= s["frame"] <= 15), None)
        print(f"✓ Forward reached peak frame at t={first_peak['t']}ms "
              f"(frame={first_peak['frame']})")

        # 3. Forward playthrough hits frame 15 (or last)
        last_frame = samples[0]["frame"]  # initial value
        # Find max frame observed
        max_frame = max(s["frame"] for s in samples)
        assert max_frame == 15, \
            f"Forward should reach frame 15, max observed: {max_frame}"
        print(f"✓ Forward reached max frame {max_frame}")

        # 4. Reverse phase: after forward completes, frames should DECREASE
        # Find the first sample where hasFiredOneShot=true
        fwd_end = next(
            (s for s in samples if s["hasFiredOneShot"]), None)
        assert fwd_end is not None, \
            "Forward playthrough should fire hasFiredOneShot at some point"
        print(f"✓ Forward ended at t={fwd_end['t']}ms (frame={fwd_end['frame']})")

        # Find a sample in the reverse phase (hasFiredOneShot=true, hasFiredReverse=false)
        rev_samples = [
            s for s in samples
            if s["hasFiredOneShot"] and not s["hasFiredReverse"]
        ]
        assert len(rev_samples) > 0, \
            "Should have at least one sample in the reverse phase"
        print(f"✓ Reverse phase observed in {len(rev_samples)} samples")

        # 5. In the reverse phase, frames should be decreasing (or stay same on hold)
        # Find successive frame values in the reverse phase
        rev_frames = [s["frame"] for s in rev_samples]
        # Check that the reverse phase generally decreases
        first_rev = rev_frames[0]
        last_rev = rev_frames[-1]
        assert first_rev > last_rev, \
            f"Reverse phase should end lower than it started; " \
            f"start={first_rev}, end={last_rev}"
        print(f"✓ Reverse phase descends: frame {first_rev} → frame {last_rev}")

        # 6. After reverse completes, frame freezes on 0
        # Find samples where hasFiredReverse=true
        frozen_samples = [s for s in samples if s["hasFiredReverse"]]
        assert len(frozen_samples) > 0, \
            "Should have samples in the frozen (rest) state"
        frozen_frames = set(s["frame"] for s in frozen_samples)
        assert frozen_frames == {0}, \
            f"Frozen state should be frame 0, observed: {frozen_frames}"
        print(f"✓ Frozen on frame 0 ({len(frozen_samples)} samples confirm)")

        # 7. The last few samples should ALL be frame 0 (no loop)
        last_samples = samples[-10:]
        last_frames = set(s["frame"] for s in last_samples)
        assert last_frames == {0}, \
            f"Final samples should all be frame 0, got: {last_frames}"
        print(f"✓ Last 10 samples all at frame 0 — no looping")

        # 8. Page errors check
        if errors:
            print(f"\n⚠️  Page errors during run:")
            for e in errors[:10]:
                print(f"  {e}")
        else:
            print(f"\n✓ No page errors during run")

        print("\n🎉 ALL ASSERTIONS PASSED — forward+reverse+freeze mode works!")
        return 0


if __name__ == "__main__":
    sys.exit(main())