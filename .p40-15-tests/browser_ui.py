"""P40-15A real Chromium UI acceptance against 100% synthetic in-memory fixture only."""
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8799/.p40-15-tests/browser_fixture.html'
SCREENSHOTS = Path('.p40-15-tests/screenshots')
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

def page_for(browser, name, viewport):
    context = browser.new_context(viewport=viewport, device_scale_factor=1, locale='zh-TW')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('request', lambda req: errors.append('BLOCKED NONLOCAL REQUEST: ' + req.url)
            if not req.url.startswith('http://127.0.0.1:8799/') else None)
    page.goto(URL, wait_until='load')
    page.wait_for_function("!!window.KusheBillingGroups && !!window.KusheBillingGroupDiscountPreview")
    assert not errors, (name, errors)
    return context, page, errors

def check_merged(page, name, mobile):
    selector = '.bg-group-mobile [data-bg-discount]' if mobile else '.bg-inline-row [data-bg-discount]'
    action = page.locator(selector)
    assert action.count() == 1, (name, 'group concession button count', action.count())
    assert action.is_visible(), (name, 'button not visible')
    assert action.is_enabled(), (name, 'button not enabled')
    assert page.locator('.bg-group-mobile').count() == 1
    assert page.locator('.bg-inline-row').count() == 1
    assert page.evaluate("() => window.__p40synthetic.group.sources.reduce((n,s)=>n+s.document.originalLines.length,0)") == 18
    before = page.evaluate("() => window.__p40synthetic.snapshot()")
    action.click()
    popup = page.locator('.p40-15-shade')
    popup.wait_for()
    assert '632,100' in popup.inner_text(), (name, popup.inner_text())
    assert '2 張原單' in popup.inner_text()
    popup.locator('input[type="number"]').fill('600000')
    popup.locator('button', has_text='試算整張折讓').click()
    assert popup.locator('.p40-15-out').get_attribute('data-status') == 'ok'
    result = popup.inner_text()
    assert 'NT$32,100' in result and 'NT$600,000' in result, (name, result)
    assert '已開發票' in result and '已有收款' in result
    assert '稅額／保留款／應收調整：待核對' in result
    assert popup.locator('button').count() == 2, (name, 'only close+preview permitted')
    assert page.evaluate("() => window.__p40synthetic.snapshot()") == before, name + ' mutated fixture'
    assert page.evaluate("() => window.__p40synthetic.writes.length") == 0
    box = popup.locator('.p40-15-modal').bounding_box()
    assert box, name + ' dialog has no layout'
    vw = page.evaluate('window.innerWidth')
    assert box['x'] >= -1 and box['x'] + box['width'] <= vw + 1, (name, 'popup overflow', box, vw)
    page.screenshot(path=str(SCREENSHOTS / (name + '-merged.png')), full_page=False)
    popup.locator('button', has_text='關閉').click()
    assert page.locator('.p40-15-shade').count() == 0
    assert page.evaluate("() => window.__p40synthetic.snapshot()") == before

def check_single(page, name, mobile):
    selector = '.mobile-billing-card [data-billing-discount-readonly="FAKE-SINGLE"]' if mobile else '.billing-list-table [data-billing-discount-readonly="FAKE-SINGLE"]'
    action = page.locator(selector)
    assert action.count() == 1 and action.is_visible(), (name, 'single list button missing')
    before = page.evaluate("() => window.__p40synthetic.snapshot()")
    action.click()
    popup = page.locator('.p40-12-shade')
    popup.wait_for()
    popup.locator('input[type="number"]').fill('90000')
    popup.locator('button', has_text='試算差額').click()
    assert popup.locator('.p40-12-result').get_attribute('data-preview-status') == 'ok', (name, popup.inner_text())
    assert '$10,000' in popup.inner_text()
    assert page.evaluate("() => window.__p40synthetic.snapshot()") == before
    assert page.evaluate("() => window.__p40synthetic.writes.length") == 0
    if mobile:
        box = popup.locator('.p40-12-modal').bounding_box()
        vw = page.evaluate('window.innerWidth')
        assert box and box['x'] >= -1 and box['x'] + box['width'] <= vw + 1, (name, box, vw)
    page.screenshot(path=str(SCREENSHOTS / (name + '-single.png')), full_page=False)
    popup.locator('button', has_text='關閉').click()

def check_fail_closed(page):
    group = page.evaluate("() => window.__p40synthetic.group")
    before = page.evaluate("() => window.__p40synthetic.snapshot()")
    # Stale groups must reject before a dialog opens, never try saving.
    page.evaluate("() => { window.__p40synthetic.group.termsChanged = true }")
    try:
        page.locator('.bg-inline-row [data-bg-discount]').click()
        assert page.locator('.p40-15-shade').count() == 0
        assert page.evaluate("() => window.__p40synthetic.writes.length") == 0
    finally:
        page.evaluate("() => { window.__p40synthetic.group.termsChanged = false }")
    assert page.evaluate("() => window.__p40synthetic.snapshot()") == before

def main():
    with sync_playwright() as p:
        import os
        executable = os.environ.get('P40_CHROME_BINARY')
        browser = p.chromium.launch(headless=True, executable_path=executable if executable else None,
            args=['--no-sandbox', '--disable-dev-shm-usage'])
        for name, viewport, mobile in [('desktop', {'width':1440,'height':900}, False),
                                       ('mobile', {'width':390,'height':844}, True)]:
            ctx, page, errors = page_for(browser, name, viewport)
            try:
                check_merged(page, name, mobile)
                check_single(page, name, mobile)
                if not mobile:
                    check_fail_closed(page)
                assert not errors, (name, errors)
                print('PASS ' + name + ': merged and single bill entry/modal, 18 source rows, no writes', flush=True)
            finally:
                ctx.close()
        browser.close()

if __name__ == '__main__':
    main()
