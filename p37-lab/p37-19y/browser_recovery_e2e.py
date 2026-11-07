"""P37-19Y actual Chromium recovery callback tests, no live HTTP.

Serves pinned Auth Lab HTML/JS/CSS using in-browser route.fulfill for the
exact beta URL; mocks EVERY Supabase Auth request. No SMTP, real JWT, login,
password change, official ERP or Supabase production traffic.
"""
import asyncio
import shutil
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
PAGE='https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/reset-password.html'
AUTH='https://ldktrfgzzzmklhsnfrol.supabase.co'
USER='00000000-0000-4000-8000-0000000019aa'
FAKE_TOKEN='synthetic-test-only-access-token-'+'a'*170

async def main():
    html=(ROOT/'p37-lab/reset-password.html').read_bytes()
    script=(ROOT/'p37-lab/reset-password.js').read_bytes()
    style=(ROOT/'p37-lab/p37-lab.css').read_bytes()
    external=[]
    calls=[]
    async with async_playwright() as playwright:
        browser=await playwright.chromium.launch(
            headless=True,
            executable_path=shutil.which('google-chrome') or
                shutil.which('chromium') or None
        )
        context=await browser.new_context()
        async def mock_every_request(route):
            request=route.request
            url=request.url
            origin=urlsplit(url).scheme+'://'+urlsplit(url).netloc
            pathname=urlsplit(url).path
            if origin==AUTH and pathname.startswith('/auth/v1/') or \
               origin==AUTH and pathname=='/rest/v1/p37_lab_members':
                calls.append((pathname,request.method))
                headers={
                    'access-control-allow-origin':'https://jacky54508-pixel.github.io',
                    'access-control-allow-methods':'GET,PUT,POST,OPTIONS',
                    'access-control-allow-headers':'apikey,authorization,accept,content-type',
                    'cache-control':'no-store',
                    'content-type':'application/json'
                }
                if request.method=='OPTIONS':
                    await route.fulfill(status=204,headers=headers,body='')
                elif pathname=='/auth/v1/user' and request.method=='GET':
                    await route.fulfill(status=200,headers=headers,
                        body='{"id":"'+USER+'"}')
                elif pathname=='/rest/v1/p37_lab_members':
                    await route.fulfill(status=200,headers=headers,
                        body='[{"user_id":"'+USER+'","enabled":true,"purpose":"P37_9B_TEST_ONLY"}]')
                elif pathname=='/auth/v1/user' and request.method=='PUT':
                    await route.fulfill(status=200,headers=headers,
                        body='{"id":"'+USER+'"}')
                elif pathname=='/auth/v1/logout' and request.method=='POST':
                    await route.fulfill(status=204,headers=headers,body='')
                else:
                    await route.fulfill(status=401,headers=headers,body='{"code":"not_permitted"}')
                return
            if origin=='https://jacky54508-pixel.github.io':
                prefix='/kushe-erp-mobile/beta/p37-lab/'
                if pathname==prefix+'reset-password.html':
                    await route.fulfill(status=200,body=html,
                      headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
                    return
                if pathname==prefix+'reset-password.js':
                    await route.fulfill(status=200,body=script,
                      headers={'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'})
                    return
                if pathname==prefix+'p37-lab.css':
                    await route.fulfill(status=200,body=style,
                      headers={'content-type':'text/css; charset=utf-8','cache-control':'no-store'})
                    return
            external.append((origin,pathname,request.method))
            await route.abort()
        await context.route('**/*',mock_every_request)

        # Browser entry with expired Supabase callback: detailed message,
        # no password fields unlocked, no sensitive raw string echoed.
        page=await context.new_page()
        await page.goto(PAGE+'#error=access_denied&error_code=otp_expired&error_description=PRIVATE-IGNORE')
        await page.wait_for_function(
          "() => document.querySelector('#verify-result').textContent.includes('otp_expired')")
        message=await page.locator('#verify-result').inner_text()
        assert 'PRIVATE-IGNORE' not in message
        assert await page.locator('#save-password').is_disabled()
        assert await page.evaluate("location.hash")=='' and await page.evaluate("location.search")==''
        assert not any(x[1] not in ('OPTIONS',) for x in calls),calls
        await page.close()

        # PKCE code without matching verifier is rejected, not exchanged as JWT.
        page=await context.new_page()
        await page.goto(PAGE+'?code=SYNTHETIC-NO-VERIFIER')
        await page.wait_for_function(
          "() => document.querySelector('#verify-result').textContent.includes('PKCE')")
        assert await page.locator('#save-password').is_disabled()
        assert not any(x[0]=='/auth/v1/token' for x in calls)
        assert await page.evaluate("location.search")==''
        await page.close()

        # A valid-shaped *synthetic* implicit recovery link: mock Auth user
        # and P37 allowlist must both pass before fields become enabled.
        page=await context.new_page()
        await page.goto(PAGE+'#access_token='+FAKE_TOKEN+
                        '&type=recovery&expires_in=300&token_type=bearer')
        await page.wait_for_function(
          "() => document.querySelector('#save-password').disabled === false")
        message=await page.locator('#verify-result').inner_text()
        assert '白名單' in message
        assert FAKE_TOKEN not in message
        assert await page.evaluate("location.hash")==''
        assert any(p=='/auth/v1/user' and m=='GET' for p,m in calls)
        assert any(p=='/rest/v1/p37_lab_members' and m=='GET' for p,m in calls)
        await page.locator('#password-new').fill('synthetic-test-only-password-12')
        await page.locator('#password-confirm').fill('synthetic-test-only-password-12')
        await page.locator('#save-password').click()
        await page.wait_for_function(
          "() => document.querySelector('#change-result').textContent.includes('設定成功')")
        assert await page.locator('#password-new').is_disabled()
        assert any(p=='/auth/v1/user' and m=='PUT' for p,m in calls)
        assert any(p=='/auth/v1/logout' and m=='POST' for p,m in calls)
        await page.close()

        assert not external,external
        await context.close()
        await browser.close()
        print('P37-19Y REAL CHROMIUM CALLBACK MOCK PASS: otp_expired, unsupported PKCE, '
              'signed-shaped recovery with mocked user and RLS; no real Auth calls')
if __name__=='__main__':
    asyncio.run(main())
