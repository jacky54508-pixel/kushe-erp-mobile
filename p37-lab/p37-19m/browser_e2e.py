"""P37-19M real Chromium IndexedDB + localStorage restart tests.

Two genuinely separate BrowserContexts talk only to a mock 127.0.0.1 server.
Never contacts a live ERP, Supabase or user account.
"""
import asyncio
import pathlib
import shutil
import sys

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from mock_server import start_test_server, SCOPE

ACTION = "KusheP3719MBrowserLab"


async def call(page, expression, arg=None):
    if arg is None:
        return await page.evaluate(expression)
    return await page.evaluate(expression, arg)


async def run():
    remote, server, origin = start_test_server()
    rejected_external = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, executable_path=shutil.which("google-chrome")
                or shutil.which("chromium") or None
            )
            desktop = await browser.new_context(
                viewport={"width": 1280, "height": 800}
            )
            mobile = await browser.new_context(
                viewport={"width": 390, "height": 780},
                is_mobile=True, has_touch=True, device_scale_factor=2
            )

            async def local_only(route):
                if not route.request.url.startswith(origin + "/"):
                    rejected_external.append(route.request.url)
                    await route.abort()
                    return
                await route.continue_()

            await desktop.route("**/*", local_only)
            await mobile.route("**/*", local_only)
            a = await desktop.new_page()
            b = await mobile.new_page()
            await asyncio.gather(a.goto(origin), b.goto(origin))
            assert "SYNTHETIC" in await a.title()
            assert "SYNTHETIC" in await b.title()
            assert await call(a, "() => window.KusheP3719MBrowserLab.boot()")
            assert await call(b, "() => window.KusheP3719MBrowserLab.boot()")

            first_a = await call(a, "() => KusheP3719MBrowserLab.inspect()")
            first_b = await call(b, "() => KusheP3719MBrowserLab.inspect()")
            assert first_a["revision"] == first_b["revision"] == 0
            assert first_a["cloudStatus"] == first_b["cloudStatus"] == "SYNCED"
            assert first_a["receiptCount"] == first_b["receiptCount"] == 0
            assert first_a["mirrorValid"] and first_b["mirrorValid"]
            assert first_a["fingerprint"] == first_b["fingerprint"]
            assert first_a["scope"] == SCOPE

            # Browser IndexedDB and emergency mirror are genuinely used.
            dbs = await call(a, "() => indexedDB.databases()")
            assert any(x["name"] == "P37-19M-SYNTHETIC-ISOLATED-INDEXEDDB"
                       for x in dbs), dbs
            ls = await call(a, "() => Object.keys(localStorage)")
            assert sorted(ls) == sorted([
                "P37-19M-SYNTHETIC-EMERGENCY",
                "P37-19M-SYNTHETIC-COMMIT-TOKEN",
                "P37-19M-SYNTHETIC-CLOUD-GATE"
            ]), ls

            # Crash and real page reload: recover all partial local layers.
            for failure in ("AFTER_PRIMARY", "AFTER_EMERGENCY", "AFTER_TOKENS"):
                remote.reset()
                await call(a, "() => KusheP3719MBrowserLab.reset()")
                boot = await call(a, "() => KusheP3719MBrowserLab.boot()")
                assert boot["revision"] == 0, boot
                response = await call(a, """async (fault) => {
                    try {
                        await KusheP3719MBrowserLab.commit(
                            'P37-19-SYN-TX-FAULT-' + fault.replaceAll('_','-'),
                            55000, fault);
                        return 'NO_INJECTED_FAILURE';
                    } catch (error) {
                        return String(error.message);
                    }
                }""", failure)
                assert "INJECTED_" + failure in response, response
                await a.reload()
                recovered = await call(
                    a, "() => KusheP3719MBrowserLab.boot()"
                )
                assert recovered["recovery"] == \
                    "ROLLED_BACK_INCOMPLETE_SYNTHETIC_TRANSACTION", \
                    (failure, recovered)
                result = await call(
                    a, "() => KusheP3719MBrowserLab.inspect()"
                )
                assert result["revision"] == 0, (failure, result)
                assert result["receiptCount"] == result["bankCount"] == 0
                assert result["principalReceived"] == 0
                assert result["mirrorValid"] and result["cloudStatus"] == "SYNCED"

            # Actual IDB durable success persists across reload/new tab.
            remote.reset()
            await call(a, "() => KusheP3719MBrowserLab.reset()")
            await call(a, "() => KusheP3719MBrowserLab.boot()")
            result = await call(a, """() => KusheP3719MBrowserLab.commit(
                'P37-19-SYN-TX-PERSIST-A', 50000)""")
            assert result["localCommitted"] and not result["remoteCommitted"]
            await a.reload()
            boot = await call(a, "() => KusheP3719MBrowserLab.boot()")
            assert boot["revision"] == 1 and boot["cloudStatus"] == "PENDING_UPLOAD"
            s = await call(a, "() => KusheP3719MBrowserLab.inspect()")
            assert s["receiptCount"] == s["bankCount"] == 1
            assert s["principalReceived"] == 50000
            assert s["outstanding"] == 1110900
            assert s["mirrorValid"]
            assert remote.read()["version"] == "41"

            # Local journal verified, ACK absent: never claim rollback/sync.
            remote.reset()
            await call(a, "() => KusheP3719MBrowserLab.reset()")
            await call(a, "() => KusheP3719MBrowserLab.boot()")
            error = await call(a, """async () => {
                try {
                    await KusheP3719MBrowserLab.commit(
                        'P37-19-SYN-TX-ACK-UNKNOWN', 63000, 'AFTER_VERIFIED');
                    return 'NO_INJECTED_FAILURE';
                } catch (e) {return String(e.message)}
            }""")
            assert "INJECTED_AFTER_VERIFIED_ACK_UNKNOWN" in error
            await a.reload()
            blocked = await call(a, """async () => {
                try {await KusheP3719MBrowserLab.boot();return 'UNSAFE_SUCCESS'}
                catch(e){return String(e.message)}
            }""")
            assert "UNTRACKED_LOCAL_COMMIT_AFTER_ACK_LOSS_STOP" in blocked, blocked

            # Two separate real browser storage profiles, same remote CAS base.
            remote.reset()
            await asyncio.gather(
                call(a, "() => KusheP3719MBrowserLab.reset()"),
                call(b, "() => KusheP3719MBrowserLab.reset()")
            )
            await asyncio.gather(
                call(a, "() => KusheP3719MBrowserLab.boot()"),
                call(b, "() => KusheP3719MBrowserLab.boot()")
            )
            local_a, local_b = await asyncio.gather(
                call(a, """() => KusheP3719MBrowserLab.commit(
                    'P37-19-SYN-TX-RACE-A', 50000)"""),
                call(b, """() => KusheP3719MBrowserLab.commit(
                    'P37-19-SYN-TX-RACE-B', 72000)""")
            )
            assert local_a["localCommitted"] and local_b["localCommitted"]
            assert remote.read()["version"] == "41"
            applied = await call(a, "() => KusheP3719MBrowserLab.upload('NORMAL')")
            assert applied["status"] == "SYNTHETIC_REMOTE_ACK_CONFIRMED", applied
            conflict = await call(b, "() => KusheP3719MBrowserLab.upload('NORMAL')")
            assert conflict["status"] == "SYNTHETIC_CAS_CONFLICT_STOP", conflict
            remote_data = remote.read()
            assert remote_data["version"] == "42"
            assert len(remote_data["commits"]) == 1
            assert remote_data["commits"][0]["amount"] == 50000
            assert remote_data["formalERPCloudWrites"] == 0
            await asyncio.gather(a.reload(), b.reload())
            read_a, read_b = await asyncio.gather(
                call(a, "() => KusheP3719MBrowserLab.inspect()"),
                call(b, "() => KusheP3719MBrowserLab.inspect()")
            )
            assert read_a["cloudStatus"] == "SYNCED"
            assert read_b["cloudStatus"] == "CONFLICT_STOP"
            assert read_a["principalReceived"] == 50000
            assert read_b["principalReceived"] == 72000
            assert read_a["mirrorValid"] and read_b["mirrorValid"]
            assert read_b["bankCount"] == 1
            no_retry = await call(b, """async () => {
                try {await KusheP3719MBrowserLab.upload('NORMAL');return 'BAD'}
                catch(e){return String(e.message)}
            }""")
            assert "NO_VERIFIED_OUTBOX_FOR_SYNC" in no_retry

            # Remote applied but HTTP success ACK missing: must re-read exact
            # version/fingerprint rather than send the money action twice.
            remote.reset()
            await call(a, "() => KusheP3719MBrowserLab.reset()")
            await call(a, "() => KusheP3719MBrowserLab.boot()")
            await call(a, """() => KusheP3719MBrowserLab.commit(
                'P37-19-SYN-TX-LOST-ACK', 30000)""")
            lost = await call(a, "() => KusheP3719MBrowserLab.upload('ACK_LOST')")
            assert lost["status"] == "AMBIGUOUS_REMOTE_ACK_STOP", lost
            assert remote.read()["version"] == "42"
            await a.reload()
            status = await call(a, "() => KusheP3719MBrowserLab.inspect()")
            assert status["cloudStatus"] == "UNCERTAIN_REMOTE_ACK"
            reconciled = await call(a, "() => KusheP3719MBrowserLab.reconcile()")
            assert reconciled["status"] == "INDEPENDENT_REMOTE_RECONCILED"
            assert reconciled["noAutomaticRetry"]
            assert len(remote.read()["commits"]) == 1

            # Remote didn't apply: keep local receipt, require explicit manual
            # decision (not automatic resend or falsely successful sync).
            remote.reset()
            await call(a, "() => KusheP3719MBrowserLab.reset()")
            await call(a, "() => KusheP3719MBrowserLab.boot()")
            await call(a, """() => KusheP3719MBrowserLab.commit(
                'P37-19-SYN-TX-FAIL-BEFORE-CLOUD', 45000)""")
            missed = await call(a, "() => KusheP3719MBrowserLab.upload('TIMEOUT_BEFORE')")
            assert missed["status"] == "AMBIGUOUS_REMOTE_ACK_STOP"
            assert remote.read()["version"] == "41"
            await a.reload()
            retry = await call(a, "() => KusheP3719MBrowserLab.reconcile()")
            assert retry["status"] == "REMOTE_UNCHANGED_MANUAL_RETRY_ONLY"
            persisted = await call(a, "() => KusheP3719MBrowserLab.inspect()")
            assert persisted["principalReceived"] == 45000
            assert persisted["bankCount"] == 1
            assert persisted["cloudStatus"] == "MANUAL_RETRY"
            assert remote.read()["commits"] == []

            # Valid journal with intentionally corrupted emergency mirror must
            # fail closed; do not auto-replace any authenticated business state.
            remote.reset()
            await call(a, "() => KusheP3719MBrowserLab.reset()")
            await call(a, "() => KusheP3719MBrowserLab.boot()")
            await call(a, """() => KusheP3719MBrowserLab.commit(
                'P37-19-SYN-TX-CORRUPT-MIRROR', 30000)""")
            await call(a, "() => KusheP3719MBrowserLab.tamperEmergencyForTest()")
            await a.reload()
            blocked = await call(a, """async () => {
                try{await KusheP3719MBrowserLab.boot();return 'UNSAFE_SUCCESS'}
                catch(e){return String(e.message)}
            }""")
            assert "COMMITTED_IDB_MIRRORS_MISMATCH_STOP" in blocked, blocked

            assert not rejected_external, rejected_external
            await desktop.close()
            await mobile.close()
            await browser.close()
            print("P37-19M SYNTHETIC ISOLATED CHROMIUM IDB / EMERGENCY MIRROR PASS")
            print("Full browser reload recovery; local receipt/bank persistence;")
            print("two independent browser contexts CAS conflict, ambiguous cloud ACK,")
            print("untracked committed state blocked; no Supabase/real ERP writes.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    asyncio.run(run())
