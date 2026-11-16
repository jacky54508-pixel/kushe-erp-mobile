"""P40-15B browser integration using the ACTUAL billing.js and billing-groups.js.
The site and accounting Store are NOT loaded: every input is fake and all writers throw.
"""
from playwright.sync_api import sync_playwright

URL='http://127.0.0.1:8799/.p40-15-tests/integrated_fixture.html'

def run_case(browser, width, height, mobile):
    name='mobile' if mobile else 'desktop'
    ctx=browser.new_context(viewport={'width':width,'height':height}, locale='zh-TW')
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:errors.append('unexpected internet request '+r.url)
        if not r.url.startswith('http://127.0.0.1:8799/') else None)
    try:
        page.goto(URL,wait_until='load')
        page.wait_for_selector('#billingsApp .billing-list-table')
        page.wait_for_function('!!window.KusheBillingGroups && !!window.KusheBilling')
        assert not errors, (name,errors)
        before=page.evaluate('() => window.__p40integrated.snapshot()')
        # Actual billing module rendered all three original bills; grouping controls must exist.
        assert page.locator('.bg-inline-row [data-bg-discount]').count()==1
        assert page.locator('.bg-group-mobile [data-bg-discount]').count()==1
        assert page.locator('.bg-originals [data-billing-detail]').count()>=2
        assert page.evaluate('() => window.__p40integrated.group.sources.reduce((n,s)=>n+s.document.originalLines.length,0)')==18

        # Try normal single bill through ACTUAL list and event handler.
        single=page.locator(
            '.mobile-billings [data-billing-discount-readonly="FAKE-SINGLE"]' if mobile
            else '.billing-list-table [data-billing-discount-readonly="FAKE-SINGLE"]')
        assert single.count()==1 and single.is_visible(),(name,'single entry not visible')
        single.click()
        modal=page.locator('.p40-12-shade')
        modal.wait_for()
        modal.locator('input[type="number"]').fill('90000')
        modal.locator('button',has_text='試算差額').click()
        assert modal.locator('.p40-12-result').get_attribute('data-preview-status')=='ok',(name,modal.inner_text())
        assert '$10,000' in modal.inner_text()
        modal.locator('button',has_text='關閉').click()
        assert page.evaluate('() => window.__p40integrated.snapshot()')==before

        # Actual list group action including 2 originals / 18 details, one concession only.
        group_button=page.locator('.bg-group-mobile [data-bg-discount]' if mobile else '.bg-inline-row [data-bg-discount]')
        assert group_button.is_visible(),(name,'merged group button hidden')
        group_button.click()
        merged=page.locator('.p40-15-shade')
        merged.wait_for()
        merged.locator('input[type="number"]').fill('600000')
        merged.locator('button',has_text='試算整張折讓').click()
        assert merged.locator('.p40-15-out').get_attribute('data-status')=='ok'
        assert 'NT$32,100' in merged.inner_text()
        assert '發票' in merged.inner_text() and '已有收款' in merged.inner_text()
        assert merged.locator('button').count()==2,'No save / post control is allowed'
        assert page.evaluate('() => window.__p40integrated.snapshot()')==before
        merged.locator('button',has_text='關閉').click()

        # The detail button for an already-grouped original must redirect to WHOLE group.
        page.evaluate('() => window.KusheBilling.openDetail("FAKE-A")')
        original=page.locator('.erp-detail-overlay')
        original.wait_for()
        original.locator('[data-billing-discount-readonly]').click()
        assert page.locator('.p40-15-shade').count()==1,(name,'grouped original wrongly routed to standalone')
        assert page.locator('.p40-12-shade').count()==0
        page.locator('.p40-15-shade').locator('button',has_text='關閉').click()
        # Synthetic original remains unchanged, no implicit write or reallocation.
        assert page.evaluate('() => window.__p40integrated.snapshot()')==before
        assert page.evaluate('() => window.__p40integrated.writes.length')==0
        assert not errors,(name,errors)
        print('PASS P40-15B '+name+': real module, single, merged, grouped original redirected, 18 lines, zero writes',flush=True)
    finally:
        ctx.close()

def stale_group(browser):
    ctx=browser.new_context(viewport={'width':1440,'height':900})
    p=ctx.new_page()
    try:
        p.goto(URL)
        p.wait_for_selector('.bg-inline-row')
        original=p.evaluate('() => window.__p40integrated.snapshot()')
        # Corrupt grouping index, leaving ACTIVE record: must block single fallback.
        p.evaluate('() => { window.__p40integrated.group.canGroup=false; window.KusheBilling.render() }')
        b=p.locator('.billing-list-table [data-billing-discount-readonly="FAKE-A"]')
        b.wait_for()
        b.click()
        assert '禁止改以單筆折讓試算' in p.evaluate('() => window.__p40integrated.lastToast')
        assert p.locator('.p40-12-shade,.p40-15-shade').count()==0
        assert p.evaluate('() => window.__p40integrated.writes.length')==0
        p.evaluate('() => { window.__p40integrated.group.canGroup=true;window.KusheBilling.render() }')
        assert p.evaluate('() => window.__p40integrated.snapshot()')==original
        print('PASS P40-15B stale active group blocks standalone fallback',flush=True)
    finally:
        ctx.close()

if __name__=='__main__':
    import os
    with sync_playwright() as playwright:
        binary=os.environ.get('P40_CHROME_BINARY')
        b=playwright.chromium.launch(headless=True,executable_path=binary if binary else None,
                                     args=['--no-sandbox','--disable-dev-shm-usage'])
        run_case(b,1440,900,False)
        run_case(b,390,844,True)
        stale_group(b)
        b.close()
