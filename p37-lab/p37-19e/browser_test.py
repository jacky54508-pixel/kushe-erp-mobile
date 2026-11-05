"""P37-19E two distinct browser contexts against a localhost-only CAS mock.

This test intentionally does not access either Supabase project or real ERP data.
"""
import asyncio
import copy
import json
import pathlib
import sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from mock_remote import start_test_remote, SCOPE, DISCOUNT, EXPECTED, ORIGINAL, GUARD

async def run():
    remote, server, origin = start_test_remote()
    outbound = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            desktop = await browser.new_context(viewport={"width": 1280, "height": 850})
            mobile = await browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                               has_touch=True, device_scale_factor=2)
            a = await desktop.new_page()
            b = await mobile.new_page()
            async def only_local(route):
                url = route.request.url
                if not url.startswith(origin + "/"):
                    outbound.append(url)
                    await route.abort()
                else:
                    await route.continue_()
            await desktop.route("**/*", only_local)
            await mobile.route("**/*", only_local)
            await asyncio.gather(a.goto(origin), b.goto(origin))
            assert "SYNTHETIC" in await a.title()
            assert "SYNTHETIC" in await b.title()
            assert "KusheP3719ELab" in await a.evaluate("() => Object.keys(window).join(',')")
            assert not await a.evaluate("() => Object.keys(localStorage).length")
            assert not await b.evaluate("() => Object.keys(sessionStorage).length")

            # 1. Authentication and scope are enforced by the real local HTTP server.
            outsider = await a.evaluate("() => KusheP3719ELab.load('outsider')")
            assert outsider["http"] == 403, outsider
            missing = await a.evaluate("() => KusheP3719ELab.load('')")
            assert missing["http"] == 401, missing
            first, second = await asyncio.gather(
                a.evaluate("() => KusheP3719ELab.load('A')"),
                b.evaluate("() => KusheP3719ELab.load('B')"))
            assert first["version"] == second["version"] == 1, (first, second)

            # 2. Two intentional mid-transaction faults roll back the entire local mock.
            for fault in ("AFTER_APPEND", "AFTER_REVISION"):
                response = await a.evaluate(
                    "([key,fault]) => KusheP3719ELab.submit(key,fault)",
                    ["P37-19-SYN-ACTION-FAIL-" + fault, fault])
                assert response["http"] == 503, response
                s = remote.snapshot()
                assert s["version"] == 1 and not s["allowances"], s
                assert s["protected"] == GUARD and s["original"] == ORIGINAL

            # 3. Reject mismatched money/scope (browser cannot override the server authority).
            unbalanced = await a.evaluate(
                "() => KusheP3719ELab.submit('P37-19-SYN-ACTION-BAD-MONEY',null,"
                "{discount:{untaxed:26000,tax:1301,gross:27300,receivable:24700,retention:2600}})")
            assert unbalanced["http"] == 422, unbalanced
            foreign = await a.evaluate(
                "() => KusheP3719ELab.submit('P37-19-SYN-ACTION-FOREIGN',null,{scope:'FORMAL_ERP'})")
            assert foreign["http"] == 403, foreign
            assert remote.snapshot()["version"] == 1

            # 4. Two distinct isolated browsing contexts submit the identical stale baseline.
            result_a, result_b = await asyncio.gather(
                a.evaluate("() => KusheP3719ELab.submit('P37-19-SYN-ACTION-A')"),
                b.evaluate("() => KusheP3719ELab.submit('P37-19-SYN-ACTION-B')"))
            statuses = sorted([result_a["http"], result_b["http"]])
            assert statuses == [200, 409], (result_a, result_b)
            status_names = {result_a["status"], result_b["status"]}
            assert status_names == {"SYNTHETIC_APPLIED_NOT_FORMAL", "CONFLICT"}, status_names
            committed = remote.snapshot()
            assert committed["version"] == 2 and len(committed["allowances"]) == 1, committed
            assert committed["allowances"][0]["approved"] == EXPECTED
            assert committed["allowances"][0]["discount"] == DISCOUNT
            assert committed["original"] == ORIGINAL
            assert committed["protected"] == GUARD
            assert committed["formalBankEntries"] == committed["formalCloudWrites"] == 0
            assert committed["allowances"][0]["postedToERP"] is False
            assert committed["allowances"][0]["officialVoucherVerified"] is False

            # 5. Reloaded session sees exactly one synthetic entry; old tabs remain stale.
            await b.reload()
            newest = await b.evaluate("() => KusheP3719ELab.load('B')")
            assert newest["version"] == 2
            key = committed["allowances"][0]["idempotencyKey"]
            duplicate = await b.evaluate(
                "(key) => KusheP3719ELab.submit(key)", key)
            assert duplicate["http"] == 409 and duplicate["status"] == "DUPLICATE", duplicate
            stale = await a.evaluate(
                "() => KusheP3719ELab.submit('P37-19-SYN-ACTION-RETRY-STALE')")
            assert stale["http"] == 409, stale
            assert len(remote.snapshot()["allowances"]) == 1
            assert remote.snapshot()["version"] == 2

            # 6. No session token or financial state is saved to browser storage.
            for page in (a, b):
                assert await page.evaluate("() => Object.keys(localStorage).length") == 0
                assert await page.evaluate("() => Object.keys(sessionStorage).length") == 0
                assert await page.evaluate("() => KusheP3719ELab.visible().erpWriterConnected") is False
                assert await page.evaluate("() => KusheP3719ELab.visible().formalPostingEnabled") is False
            assert not outbound, outbound
            await desktop.close()
            await mobile.close()
            await browser.close()
        print("P37-19E ISOLATED HTTP BROWSER E2E PASS: independent desktop/mobile contexts,")
        print("401/403, rollback at two fault points, 27,300 balance, exactly one CAS winner,")
        print("stale/duplicate denied, no persistent browser storage, formal writes = 0.")
    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    asyncio.run(run())
