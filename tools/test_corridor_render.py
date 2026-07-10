"""Test just the corridor scene render with v6 sprites.

Boots the JS bundle, skips past intro/title, forces navigation to
corridor, waits a beat, then takes screenshots of the canvas at
multiple animation phases.
"""
from playwright.sync_api import sync_playwright
import time
import sys


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()

        errors = []
        page.on("console", lambda msg: msg.type == "error" and errors.append(f"[{msg.type}] {msg.text}"))

        page.goto("http://localhost:8765/", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Bypass title screen: call the navigate immediately with target "alley"
        # then advance through alley quickly to reach corridor
        try:
            page.evaluate("""
                // Trigger PRESS START hitbox directly
                const ov = window.__activeScene?.hitboxLayer?.overlay;
                if (ov) ov.style.display = 'none';
                const scene = window.__activeScene;
                if (scene && scene.hitboxes?.length) {
                    const hb = scene.hitboxes[0];
                    scene._triggerHitbox(hb, 0, 0);
                }
            """)
        except Exception as e:
            print(f"trigger failed: {e}")

        # Wait for navigation to alley
        page.wait_for_timeout(2000)

        # Try to jump directly to corridor scene
        page.evaluate("""
            try {
                const eng = window.engine || window.Engine;
                if (eng && eng.loadScene) eng.loadScene('corridor');
                console.log('engine keys', Object.keys(window).filter(k => /scene|engine/i.test(k)).join(','));
            } catch (e) { console.log('engine jump failed', e); }
        """)

        # Take screenshot 1s after arrival
        page.wait_for_timeout(1000)
        page.screenshot(path="/tmp/corridor_test_t1.0s.png", full_page=False)

        # Sample at multiple points to catch different idle frames
        for ms in [1500, 2000, 2500, 3000, 4500, 6000, 8000, 10000]:
            page.wait_for_timeout(ms - (ms - 1))
            page.screenshot(path=f"/tmp/corridor_test_t{ms}.png", full_page=False)

        if errors:
            print("\n=== CONSOLE ERRORS ===")
            for e in errors:
                print(e)
        else:
            print("\nNo console errors.")

        browser.close()


if __name__ == "__main__":
    main()
