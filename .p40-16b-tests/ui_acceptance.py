"""P40-16B synthetic-only Chromium acceptance. No real ERP data, requests or writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright

URL='http://127.0.0.1:8799/.p40-16b-tests/ui_fixture.html'
SCREEN=Path('.p40-16b-tests/screenshots')
SCREEN.mkdir(exist_ok=True,parents=True)

def start(browser,width,height):
    ctx=browser.new_context(viewport={'width':width,'height':height},locale='zh-TW')
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.on('request',lambda req: errors.append('outside localhost '+req.url)
            if not req.url.startswith('http://127.0.0.1:8799/') else None)
    page.goto(URL)
    page.wait_for_selector('[data-p4016-root]')
    assert not errors,errors
    return ctx,page,errors

def enter_metadata(page):
    page.locator('input[type="date"]').fill('2026-11-16')
    page.locator('textarea').nth(0).fill('虛構建商核定折讓，測試用')
    page.locator('textarea').nth(1).fill('SYNTHETIC sign-off sample only')

def input_rows(page,values):
    boxes=page.locator('.p4016-source')
    assert boxes.count()==2
    for i,row in enumerate(values):
        box=boxes.nth(i)
        for k,v in row.items():
            box.locator('[data-amount-key="'+k+'"]').fill(str(v))

def run(browser,name,viewport):
    ctx,page,errors=start(browser,*viewport)
    try:
        assert page.locator('button',has_text='核對分攤（不儲存）').count()==1
        assert page.locator('button').count()==2, 'should only be review and close'
        assert page.locator('[data-p4016-root]').get_attribute('data-readonly')=='true'
        before=page.evaluate('window.__p4016sandbox.before')
        # Try invalid form, then valid metadata with incomplete allocation.
        page.locator('button',has_text='核對分攤（不儲存）').click()
        result=page.locator('.p4016-result')
        assert result.get_attribute('data-status')=='blocked'
        enter_metadata(page)
        page.locator('button',has_text='核對分攤（不儲存）').click()
        assert result.get_attribute('data-status')=='blocked'
        assert '非負整數' in result.inner_text()
        # Allocate manually (no automatic tax split): 21000 + 11100 = 32100
        input_rows(page,[
          dict(untaxed=20000,tax=1000,grossTotal=21000,retention=0,receivable=21000),
          dict(untaxed=10571,tax=529,grossTotal=11100,retention=0,receivable=11100)
        ])
        page.locator('button',has_text='核對分攤（不儲存）').click()
        assert result.get_attribute('data-status')=='reviewed',result.inner_text()
        assert result.get_attribute('data-can-post')=='false'
        assert 'NT$32,100' in result.inner_text()
        assert '算術一致' in result.inner_text()
        assert '發票' in result.inner_text()
        assert '正式入帳：禁止' in result.inner_text()
        assert page.evaluate('window.__p4016sandbox.before===JSON.stringify(window.__p4016sandbox.model)')
        assert page.evaluate('window.__p4016sandbox.writes===0')
        assert not errors,(name,errors)
        bounds=page.locator('.p4016-card').bounding_box()
        assert bounds and bounds['x']>=0 and bounds['x']+bounds['width']<=viewport[0]+1,(name,bounds)
        page.screenshot(path=str(SCREEN/(name+'-valid-review.png')),full_page=True)
        # Deliberate inconsistent allocation: block; never save.
        page.locator('.p4016-source').nth(1).locator('[data-amount-key="grossTotal"]').fill('11000')
        page.locator('button',has_text='核對分攤（不儲存）').click()
        assert result.get_attribute('data-status')=='blocked'
        assert result.get_attribute('data-can-post')=='false'
        assert page.evaluate('window.__p4016sandbox.before===JSON.stringify(window.__p4016sandbox.model)')
        page.screenshot(path=str(SCREEN/(name+'-blocked-review.png')),full_page=True)
        page.locator('button',has_text='關閉').click()
        assert page.locator('[data-p4016-root]').count()==0
        print('PASS '+name+' P40-16B manual allocations, errors, issued invoice lock, zero writes',flush=True)
    finally:
        ctx.close()

def stale_version(browser):
    ctx,page,errors=start(browser,1400,900)
    try:
        enter_metadata(page)
        page.evaluate('window.__p4016sandbox.model.observedSnapshot="stale-version"')
        page.locator('button',has_text='核對分攤（不儲存）').click()
        assert page.locator('.p4016-result').get_attribute('data-status')=='blocked'
        assert '來源資料已變更' in page.locator('.p4016-result').inner_text()
        assert not errors
        print('PASS P40-16B stale snapshot fail closed',flush=True)
    finally:
        ctx.close()

if __name__=='__main__':
    import os
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.getenv('P40_CHROME_BINARY') or None,
            args=['--no-sandbox','--disable-dev-shm-usage'])
        run(browser,'desktop',(1440,900))
        run(browser,'mobile',(390,844))
        stale_version(browser)
        browser.close()
