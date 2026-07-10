"""Test v8 corridor sprite render. Use longer waits + Ink advancement."""
from playwright.sync_api import sync_playwright
import time


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-web-security"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()

        errors = []
        page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}"))

        page.goto("http://localhost:8765/", wait_until="load")
        # Wait for engine to init and intro scene to render
        time.sleep(3)

        # Trigger PRESS START — wait for hitbox to load
        triggered = page.evaluate("""
            () => new Promise(resolve => {
                let tries = 0;
                const tryTrig = () => {
                    const scene = window.__activeScene;
                    if (scene?.hitboxes?.length > 0) {
                        scene._triggerHitbox(scene.hitboxes[0], 0, 0);
                        resolve('triggered at try ' + tries);
                    } else if (tries < 50) {
                        tries++;
                        setTimeout(tryTrig, 200);
                    } else {
                        resolve('no hitbox after 50 tries');
                    }
                };
                tryTrig();
            })
        """)
        print(f"Trigger: {triggered}")

        # Wait for intro's 5s listen timer to elapse + scene transition
        time.sleep(8)

        # Now click through dialogue rapidly to get to corridor
        for i in range(80):
            scene_id = page.evaluate("window.__activeScene?.sceneId || '?'")
            if scene_id == "corridor":
                print(f"\n>>> corridor at iter {i}\n")
                break

            # Try to advance — pick first choice or click dialogue box
            clicked_something = page.evaluate("""
                () => {
                    const c = document.querySelector('.choice-button');
                    if (c) { c.click(); return 'choice'; }
                    const db = document.querySelector('.dialogue-box');
                    if (db && db.offsetParent !== null) { db.click(); db.click(); return 'dialogue-2x'; }
                    return 'idle';
                }
            """)
            if i < 5 or i % 10 == 0:
                print(f"[{i}] scene={scene_id} action={clicked_something}")
            time.sleep(0.3)

        # Capture screenshots
        if page.evaluate("window.__activeScene?.sceneId") == "corridor":
            time.sleep(1)
            page.screenshot(path="/tmp/v8_corridor_a.png")
            for delay_ms in [800, 1500, 2200, 3000, 5000]:
                page.wait_for_timeout(delay_ms)
                page.screenshot(path=f"/tmp/v8_corridor_b{delay_ms}.png")
        else:
            page.screenshot(path="/tmp/v8_corridor_NOT_REACHED.png")

        print("\nConsole output (sample):")
        for e in errors[-15:]:
            print(f"  {e}")
        browser.close()


if __name__ == "__main__":
    main()
