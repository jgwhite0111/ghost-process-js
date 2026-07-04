"""Smoke-test the full v0.2 vanilla-JS flow."""
from playwright.sync_api import sync_playwright
import time, sys

def text(page, sel):
    return page.evaluate(f'document.querySelector({sel!r})?.textContent?.slice(0,60) || ""')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto('http://localhost:8765/index.html', wait_until='networkidle')
    page.wait_for_timeout(2000)

    # intro → alley
    page.click('.hitbox', timeout=3000)
    page.wait_for_function("window.STATE.sceneId === 'alley'", timeout=8000)
    print('OK intro -> alley')

    # wait for first dialogue line + advance to choice
    page.wait_for_function("document.querySelector('.dialogue-box .text')?.textContent", timeout=5000)

    def advance_to_choice():
        for _ in range(20):
            n = page.evaluate("document.querySelectorAll('.choice-button').length")
            if n > 0: return n
            page.click('.dialogue-box', timeout=2000)
            page.wait_for_timeout(300)
        return 0

    n = advance_to_choice()
    print(f'  alley choices={n}  text={text(page, ".dialogue-box .text")!r}')

    # Pick first choice (Ask why)
    page.click('.choice-button:nth-of-type(1)', timeout=3000)
    page.wait_for_timeout(500)
    n = advance_to_choice()
    print(f'  alley: after Ask why, choices={n}  text={text(page, ".dialogue-box .text")!r}')

    # Pick "Continue" / Run -> chase
    labels = page.evaluate("[...document.querySelectorAll('.choice-button')].map(b=>b.textContent)")
    print(f'  alley: choices={labels}')
    if len(labels) >= 2:
        page.click('.choice-button:nth-of-type(2)', timeout=3000)
    elif len(labels) >= 1:
        page.click('.choice-button:nth-of-type(1)', timeout=3000)

    # Continue clicking through any remaining choices until scene changes
    deadline_inner = time.time() + 6
    while time.time() < deadline_inner and page.evaluate('window.STATE.sceneId') == 'alley':
        if page.evaluate("document.querySelectorAll('.choice-button').length") > 0:
            page.click('.choice-button:nth-of-type(1)', timeout=1000)
        else:
            try:
                page.click('.dialogue-box', timeout=1000)
            except Exception:
                pass
        page.wait_for_timeout(300)

    page.wait_for_function("window.STATE.sceneId === 'chase'", timeout=10000)
    print('OK alley -> chase')

    page.wait_for_timeout(800)
    n = advance_to_choice()
    labels = page.evaluate("[...document.querySelectorAll('.choice-button')].map(b=>b.textContent)")
    print(f'  chase choices={labels}  text={text(page, ".dialogue-box .text")!r}')

    if not labels:
        print('  no chase choices, continuing')
    else:
        page.click('.choice-button:nth-of-type(1)', timeout=3000)

    # Advance through any remaining choices within chase scene before moving on
    deadline_inner = time.time() + 6
    while time.time() < deadline_inner and page.evaluate('window.STATE.sceneId') == 'chase':
        if page.evaluate("document.querySelectorAll('.choice-button').length") > 0:
            page.click('.choice-button:nth-of-type(1)', timeout=1000)
        else:
            page.click('.dialogue-box', timeout=1000)
        page.wait_for_timeout(300)

    # chase -> corridor -> jailbreak -> eidolon_return -> alley
    for target in ['corridor', 'jailbreak', 'eidolon_return', 'alley']:
        deadline = time.time() + 12
        while time.time() < deadline and page.evaluate('window.STATE.sceneId') != target:
            if page.evaluate("document.querySelectorAll('.choice-button').length") > 0:
                try:
                    page.click('.choice-button:nth-of-type(1)', timeout=1000)
                except Exception:
                    pass
            else:
                try:
                    page.click('.dialogue-box', timeout=1000)
                except Exception:
                    pass
            page.wait_for_timeout(400)
        print(f'OK chain -> {target}')

    print()
    print('VISITED:', page.evaluate('window.STATE.visited'))
    print('ERRORS:', errors)
    browser.close()
