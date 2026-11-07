"""P37-19Z real Chromium UI acceptance with fully MOCKED Supabase responses.

All requests intercepted. No real OTP emails, no passwords, no actual
Supabase accounts, no service-role, no financial data or GitHub Pages deploy.
"""
import asyncio
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
LAB=ROOT/"p37-lab"/"p37-19z"
PAGE="https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/p37-19z/otp-reset.html"
AUTH="https://ldktrfgzzzmklhsnfrol.supabase.co"
USER="00000000-0000-4000-8000-000000001900"
ACCESS="SYNTHETIC_NOT_REAL_ACCESS_TOKEN_"+"X"*180
EMAIL="not-a-real-user@example.invalid"
CODE="123456"

async def main():
    html=(LAB/"otp-reset.html").read_bytes()
    script=(LAB/"otp-reset.js").read_bytes()
    style=(ROOT/"p37-lab"/"p37-lab.css").read_bytes()
    calls=[]
    external=[]
    errors=[]
    mode={"code":"OK","member":"OK","put":"OK"}

    async def intercepted(route):
        url=route.request.url
        parts=urlsplit(url)
        origin=parts.scheme+"://"+parts.netloc
        pathname=parts.path
        if origin=="https://jacky54508-pixel.github.io":
            exact="/kushe-erp-mobile/beta/p37-lab/p37-19z/"
            if pathname==exact+"otp-reset.html":
                await route.fulfill(status=200,body=html,headers={
                    "content-type":"text/html; charset=utf-8",
                    "cache-control":"no-store"
                })
                return
            if pathname==exact+"otp-reset.js":
                await route.fulfill(status=200,body=script,headers={
                    "content-type":"text/javascript; charset=utf-8",
                    "cache-control":"no-store"
                })
                return
            if pathname=="/kushe-erp-mobile/beta/p37-lab/p37-lab.css":
                await route.fulfill(status=200,body=style,headers={
                    "content-type":"text/css; charset=utf-8","cache-control":"no-store"
                })
                return
        if origin==AUTH:
            headers={
                "access-control-allow-origin":"https://jacky54508-pixel.github.io",
                "access-control-allow-methods":"GET,POST,PUT,OPTIONS",
                "access-control-allow-headers":"apikey,authorization,accept,content-type",
                "cache-control":"no-store",
                "content-type":"application/json"
            }
            method=route.request.method
            if method=="OPTIONS":
                await route.fulfill(status=204,headers=headers,body="")
                return
            calls.append((pathname,method))
            body=json.loads(route.request.post_data or "null")
            if pathname=="/auth/v1/recover" and method=="POST":
                assert body=={"email":EMAIL}
                await route.fulfill(status=200,headers=headers,body="{}")
                return
            if pathname=="/auth/v1/verify" and method=="POST":
                assert body=={"email":EMAIL,"token":CODE,"type":"recovery"}
                if mode["code"]=="EXPIRED":
                    await route.fulfill(status=403,headers=headers,
                        body='{"code":"otp_expired"}')
                    return
                await route.fulfill(status=200,headers=headers,body=json.dumps({
                    "access_token":ACCESS,"token_type":"bearer","expires_in":3600,
                    "user":{"id":USER}
                }))
                return
            if pathname=="/auth/v1/user" and method=="GET":
                assert route.request.headers.get("authorization")=="Bearer "+ACCESS
                await route.fulfill(status=200,headers=headers,body=json.dumps({"id":USER}))
                return
            if pathname=="/rest/v1/p37_lab_members" and method=="GET":
                assert route.request.headers.get("authorization")=="Bearer "+ACCESS
                members=[] if mode["member"]=="DENY" else [
                    {"user_id":USER,"enabled":True,"purpose":"P37_9B_TEST_ONLY"}]
                await route.fulfill(status=200,headers=headers,body=json.dumps(members))
                return
            if pathname=="/auth/v1/user" and method=="PUT":
                assert route.request.headers.get("authorization")=="Bearer "+ACCESS
                assert len(body["password"])>=12
                if mode["put"]=="FAIL":
                    await route.fulfill(status=503,headers=headers,body='{"code":"failed"}')
                else:
                    await route.fulfill(status=200,headers=headers,body=json.dumps({"id":USER}))
                return
            if pathname=="/auth/v1/logout" and method=="POST":
                assert route.request.headers.get("authorization")=="Bearer "+ACCESS
                await route.fulfill(status=204,headers=headers,body="")
                return
        external.append((origin,pathname,route.request.method))
        await route.abort()

    async with async_playwright() as browser_api:
        browser=await browser_api.chromium.launch(
            headless=True,
            executable_path=shutil.which("google-chrome") or
                shutil.which("chromium") or None)
        context=await browser.new_context(viewport={"width":1280,"height":900})
        await context.route("**/*",intercepted)

        # Main happy path: no unauthenticated password controls, 1 email,
        # verify with Auth + RLS, password PUT, sign out. No live requests.
        page=await context.new_page()
        page.on("pageerror",lambda e: errors.append(str(e)))
        await page.goto(PAGE)
        assert "6 位驗證碼" in await page.title()
        assert await page.locator("#save-password").is_disabled()
        assert await page.locator("#verify-otp").is_disabled()
        assert not calls
        await page.locator("#otp-email").fill(EMAIL)
        await page.locator("#send-otp").click()
        await page.wait_for_function("()=>document.querySelector('#send-result').textContent.includes('寄送請求')")
        assert await page.locator("#send-otp").is_disabled()
        assert await page.locator("#verify-otp").is_enabled()
        await page.locator("#otp-code").fill(CODE)
        await page.locator("#verify-otp").click()
        await page.wait_for_function("()=>document.querySelector('#verify-result').textContent.includes('已通過')")
        assert await page.locator("#password-new").is_enabled()
        assert await page.locator("#save-password").is_enabled()
        await page.locator("#password-new").fill("mock-only-password-1234")
        await page.locator("#password-confirm").fill("mock-only-password-1234")
        await page.locator("#save-password").click()
        await page.wait_for_function("()=>document.querySelector('#change-result').textContent.includes('成功')")
        assert await page.locator("#save-password").is_disabled()
        assert await page.locator("#password-new").input_value()==""
        assert [x for x in calls if x==("/auth/v1/recover","POST")]==[
            ("/auth/v1/recover","POST")]
        assert [x for x in calls if x==("/auth/v1/verify","POST")]==[
            ("/auth/v1/verify","POST")]
        assert ("/auth/v1/user","PUT") in calls
        assert ("/auth/v1/logout","POST") in calls
        await page.close()

        # Expired OTP cannot enable password controls.
        mode["code"]="EXPIRED"
        page=await context.new_page()
        await page.goto(PAGE)
        await page.locator("#otp-email").fill(EMAIL)
        await page.locator("#send-otp").click()
        await page.locator("#otp-code").fill(CODE)
        await page.locator("#verify-otp").click()
        await page.wait_for_function("()=>document.querySelector('#verify-result').textContent.includes('403')")
        assert await page.locator("#save-password").is_disabled()
        assert await page.locator("#password-new").is_disabled()
        await page.close()

        # A signed Auth result alone is insufficient without P37 RLS allowlist.
        mode["code"]="OK"
        mode["member"]="DENY"
        page=await context.new_page()
        await page.goto(PAGE)
        await page.locator("#otp-email").fill(EMAIL)
        await page.locator("#send-otp").click()
        await page.locator("#otp-code").fill(CODE)
        await page.locator("#verify-otp").click()
        await page.wait_for_function("()=>document.querySelector('#verify-result').textContent.includes('白名單')")
        assert await page.locator("#save-password").is_disabled()
        assert await page.locator("#password-new").is_disabled()
        await page.close()

        assert not external,external
        assert not errors,errors
        await context.close()
        await browser.close()
        print("P37-19Z REAL CHROMIUM OTP RESET MOCK ACCEPTANCE PASS")
        print("Recovery POST -> 6-digit recovery OTP -> Auth User -> P37 RLS -> "
              "password PUT -> logout, expired OTP and denied membership fail closed.")
        print("No real SMTP, live Supabase authentication, financial data or deployment.")

if __name__=="__main__":
    asyncio.run(main())
