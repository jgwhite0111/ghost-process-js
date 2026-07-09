"""Capture the android sprite at peak hold frames for visual confirmation.

Walks to the corridor scene, waits for the one-shot to complete, then
takes a screenshot of the full canvas. We crop to the area where the
android sits (right side of the screen) so we can compare the held
pose against frames 5, 6, 7, 8, 9 of the source sprite sheet.
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
        page.goto("http://localhost:8765/index.html", wait_until="load")
        page.wait_for_timeout(2000)
        page.click(".hitbox", timeout=5000)
        page.wait_for_timeout(500)

        # Jump to corridor directly.
        page.evaluate("() => window.Engine.goTo('corridor')")

        # Wait for corridor + frames bound.
        page.wait_for_function(
            "() => window.Engine && window.Engine._state.current && "
            "window.Engine._state.current.sceneId === 'corridor'",
            timeout=10000,
        )
        page.wait_for_function(
            """() => {
                const eng = window.Engine;
                if (!eng || !eng._state.current) return false;
                const chars = eng._state.current.characters || [];
                for (const c of chars) {
                    if (c.character && c.character.id === 'android' &&
                        c.frames && c.frames.length > 0) return true;
                }
                return false;
            }""",
            timeout=5000,
        )

        # Walk the Ink past the portrait:android tag. The narration
        # line needs to step once (or be told to step) for the
        # portrait:android tag to fire. Calling runner.step() is what
        # the dialogue advance handler does.
        runner_visible = page.evaluate("""async () => {
            const scene = window.Engine._state.current;
            if (!scene || !scene.dialogueRunner) return { err: 'no runner' };
            const runner = scene.dialogueRunner;
            // Step once (advances past narration, fires portrait tag)
            await runner.step();
            // Wait a moment for the fade-in to start
            await new Promise(r => setTimeout(r, 600));
            const c = (scene.characters || []).find(x => x.character.id === 'android');
            return {
                opacity: c ? c.opacity : null,
                targetOpacity: c ? c.targetOpacity : null,
            };
        }""")
        print(f"After first step: {runner_visible}")

        # Wait for the android to be visible.
        page.wait_for_function(
            """() => {
                const c = (window.Engine._state.current.characters || [])
                    .find(x => x.character.id === 'android');
                return c && c.opacity > 0.5;
            }""",
            timeout=10000,
        )
        print("Android is visible (opacity > 0.5)")

        # Wait for the hold phase to begin (or it might already be in
        # hold if we got here after the one-shot).
        page.wait_for_function(
            "() => { const c = (window.Engine._state.current.characters || [])"
            ".find(x => x.character.id === 'android'); return c && c._hasFiredOneShot; }",
            timeout=8000,
        )
        print("Hold phase reached")

        # Take 3 screenshots over 1.2 seconds to confirm the energy ball
        # pulses (different hold frames visible). At 6fps with 5 hold
        # frames the cycle is ~833ms; sampling at 0/400/800ms should
        # show the ball in 3 different states.
        for i, ms in enumerate([0, 400, 800]):
            if i > 0:
                # Wait the delta from the previous snapshot.
                delta = [0, 400, 800][i] - [0, 400, 800][i - 1]
                page.wait_for_timeout(delta)
            out_path = f"/tmp/corridor_android_hold_{i}.png"
            page.screenshot(path=out_path, full_page=False)
            frame_idx = page.evaluate(
                "() => { const c = (window.Engine._state.current.characters || [])"
                ".find(x => x.character.id === 'android'); return c ? c.currentFrame : null; }"
            )
            print(f"  [{i}] t+{ms}ms, frame={frame_idx}, screenshot={out_path}")

        # Also dump the current frame + a few diagnostic lines.
        diag = page.evaluate(
            """() => {
                const c = (window.Engine._state.current.characters || [])
                    .find(x => x.character.id === 'android');
                if (!c) return null;
                return {
                    frame: c.currentFrame,
                    hasFiredOneShot: c._hasFiredOneShot,
                    holdStart: c._holdStart,
                    holdEnd: c._holdEnd,
                    playOnce: c._playOnce,
                    // Image info for the current held frame.
                    currentImgSrc: c.frames[c.currentFrame] ? c.frames[c.currentFrame].src : null,
                    // Canvas placement
                    canvasW: c.canvas && c.canvas.width,
                    canvasH: c.canvas && c.canvas.height,
                    x: c.x, y: c.y, w: c.w, h: c.h,
                    isSpeaking: c.isSpeaking,
                    visible: c.opacity > 0,
                };
            }"""
        )
        print("Diag:", diag)

        browser.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
