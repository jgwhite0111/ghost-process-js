"""Smoke-test the full vanilla-JS flow — every scene in the chain.

Walks: intro → cold_open → alley → chase → kabukicho → corp_office →
       corridor → jailbreak → terminal_lab → ship_engine → alley (loop).

For each scene: advances through dialogue, picks the first choice
repeatedly, verifies the next scene loads. Hits the kabukicho hitbox
before advancing so the Ink redirect to ContactMade fires.

Reports visited order + any console errors.
"""
from playwright.sync_api import sync_playwright
import sys
import time


def text(page, sel):
    return page.evaluate(f'document.querySelector({sel!r})?.textContent?.slice(0,60) || ""')


def advance_to_choice(page, max_clicks=20):
    """Click dialogue-box until choice buttons appear or budget runs out."""
    for _ in range(max_clicks):
        n = page.evaluate("document.querySelectorAll('.choice-button').length")
        if n > 0:
            return n
        try:
            page.click('.dialogue-box', timeout=1500)
        except Exception:
            pass
        page.wait_for_timeout(250)
    return 0


def wait_for_scene(page, target, timeout=15):
    """Click through dialogue + first-choice + hitbox until sceneId == target.

    Priority order each tick:
      1. If choice buttons are visible, pick the first one.
      2. Else if the dialogue box has visible text, advance it (double-click
         to clear any in-progress typewriter AND step the runner — tilde-only
         lines like `~ transition_next()` need both).
      3. Else if a canvas hitbox is showing, click it ONCE.
      4. Else just wait for the scene to initialize.

    Hitboxes are only clicked when there's no dialogue-box text — otherwise
    re-clicking an item pickup (like alley's bins) loops the Ink back to
    the choice beat and the scene never advances.
    """
    clicked_hitbox = False
    deadline = time.time() + timeout
    while time.time() < deadline and page.evaluate('window.STATE.sceneId') != target:
        choice_count = page.evaluate("document.querySelectorAll('.choice-button').length")
        text_content = page.evaluate(
            "(document.querySelector('.dialogue-box .text')?.textContent || '').trim()"
        )
        hitbox_count = page.evaluate("document.querySelectorAll('.hitbox').length")
        if choice_count > 0:
            clicked_hitbox = False
            try:
                page.click('.choice-button:nth-of-type(1)', timeout=1500)
            except Exception:
                pass
        elif text_content:
            clicked_hitbox = False
            try:
                page.click('.dialogue-box', timeout=1500)
            except Exception:
                pass
            page.wait_for_timeout(120)
            try:
                page.click('.dialogue-box', timeout=1500)
            except Exception:
                pass
        elif hitbox_count > 0 and not clicked_hitbox:
            try:
                page.click('.hitbox:nth-of-type(1)', timeout=1500)
            except Exception:
                pass
            clicked_hitbox = True
        else:
            # Nothing actionable — wait for scene to settle.
            page.wait_for_timeout(300)
        page.wait_for_timeout(300)
    final = page.evaluate('window.STATE.sceneId')
    if final != target:
        print(f'    wait_for_scene({target}) ENDED at {final} (NOT target)')


def pick_choice(page, n, label=''):
    """Pick the n-th choice button (1-indexed). Waits for the button to appear."""
    page.wait_for_selector('.choice-button', timeout=4000)
    labels = page.evaluate('[...document.querySelectorAll(".choice-button")].map(b=>b.textContent)')
    if label:
        print(f'  {label} choices: {labels}')
    page.click(f'.choice-button:nth-of-type({n})', timeout=3000)
    page.wait_for_timeout(400)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto('http://localhost:8765/index.html', wait_until='networkidle')
    page.wait_for_timeout(2000)

    # intro → cold_open → alley
    page.click('.hitbox', timeout=3000)
    page.wait_for_function("window.STATE.sceneId === 'alley'", timeout=8000)
    print('OK intro -> cold_open -> alley')

    # alley: pick up rusty key via the bins hitbox, then walk to choice.
    page.wait_for_selector('.hitbox', timeout=4000)
    page.click('.hitbox', timeout=3000)
    page.wait_for_timeout(1200)  # 700ms fly + buffer
    n = advance_to_choice(page)
    print(f'  alley choices={n}  text={text(page, ".dialogue-box .text")!r}')

    # Pick Run (second choice on first beat — Ask why is first).
    pick_choice(page, 2, label='alley')
    wait_for_scene(page, 'chase', timeout=15)
    print('OK alley -> chase')

    # chase: advance to choice, pick "Keep running" (first).
    n = advance_to_choice(page)
    pick_choice(page, 1, label='chase')
    wait_for_scene(page, 'kabukicho', timeout=15)
    print('OK chase -> kabukicho')

    # kabukicho: vendor hitbox fires datacard pickup + Ink redirect.
    page.wait_for_selector('.hitbox', timeout=4000)
    page.click('.hitbox', timeout=3000)
    page.wait_for_timeout(1200)
    n = advance_to_choice(page)
    pick_choice(page, 1, label='kabukicho')
    wait_for_scene(page, 'corp_office', timeout=15)
    print('OK kabukicho -> corp_office')

    # corp_office: flashback beat, no hitbox.
    n = advance_to_choice(page)
    pick_choice(page, 1, label='corp_office')
    wait_for_scene(page, 'corridor', timeout=15)
    print('OK corp_office -> corridor')

    # corridor: pull away (second choice).
    n = advance_to_choice(page)
    pick_choice(page, 2, label='corridor')
    wait_for_scene(page, 'jailbreak', timeout=15)
    print('OK corridor -> jailbreak')

    # jailbreak: break the lock (second choice).
    n = advance_to_choice(page)
    pick_choice(page, 2, label='jailbreak')
    wait_for_scene(page, 'terminal_lab', timeout=15)
    print('OK jailbreak -> terminal_lab')

    # terminal_lab: descend beat, first choice.
    n = advance_to_choice(page)
    pick_choice(page, 1, label='terminal_lab')
    wait_for_scene(page, 'ship_engine', timeout=15)
    print('OK terminal_lab -> ship_engine')

    # ship_engine: climax beat, first choice (side with android).
    n = advance_to_choice(page)
    pick_choice(page, 1, label='ship_engine')
    wait_for_scene(page, 'alley', timeout=15)
    print('OK ship_engine -> alley (loop close)')

    print()
    print('VISITED:', page.evaluate('window.STATE.visited'))
    print('ERRORS:', errors)
    browser.close()
    sys.exit(1 if errors else 0)