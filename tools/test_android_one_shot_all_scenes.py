"""Verify the android one-shot+hold config is applied to ALL scenes
using the corridor android sprite (corridor, corp_office,
terminal_lab, ship_engine). Just reads the sprite config off each
scene and asserts playOnce=True, holdFrames=[5,9].

This is a config-presence test, not a behavioral test. The behavioral
test (test_android_one_shot.py) exercises the corridor scene and proves
the code path works; this test just ensures the other three scenes
got the config change.
"""
import sys
from playwright.sync_api import sync_playwright


SCENES_WITH_ANDROID_CORRIDOR_SPRITE = [
    "corridor",
    "corp_office",
    "terminal_lab",
    "ship_engine",
]


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

        # For each target scene, jump to it, wait for the android to
        # mount, then read the sprite's config and assert it.
        results = []
        for scene_id in SCENES_WITH_ANDROID_CORRIDOR_SPRITE:
            page.evaluate(
                f"() => window.Engine.goTo('{scene_id}')"
            )
            page.wait_for_function(
                f"""() => {{
                    const eng = window.Engine;
                    if (!eng || !eng._state.current) return false;
                    if (eng._state.current.sceneId !== '{scene_id}') return false;
                    const chars = eng._state.current.characters || [];
                    for (const c of chars) {{
                        if (c.character && c.character.id === 'android' &&
                            c.frames && c.frames.length > 0) {{
                            return true;
                        }}
                    }}
                    return false;
                }}""",
                timeout=10000,
            )

            diag = page.evaluate(
                """() => {
                    const chars = window.Engine._state.current.characters || [];
                    const c = chars.find(x => x.character.id === 'android');
                    if (!c) return { err: 'no android' };
                    return {
                        playOnce: !!c._playOnce,
                        holdStart: c._holdStart,
                        holdEnd: c._holdEnd,
                        frameCount: c.frames.length,
                    };
                }"""
            )
            results.append((scene_id, diag))
            ok = (
                diag.get("playOnce") is True
                and diag.get("holdStart") == 5
                and diag.get("holdEnd") == 9
                and diag.get("frameCount") == 16
            )
            status = "✓" if ok else "✗"
            print(
                f"  {status} {scene_id}: {diag}"
            )

        # Final assertion
        all_ok = all(
            r["playOnce"] is True
            and r["holdStart"] == 5
            and r["holdEnd"] == 9
            and r["frameCount"] == 16
            for _, r in results
        )
        browser.close()
        if not all_ok:
            print("\n✗ One or more scenes are missing the one-shot config")
            return 1
        print(f"\n✓ All {len(results)} scenes have playOnce=True, holdFrames=[5,9]")
        return 0


if __name__ == "__main__":
    sys.exit(main())
