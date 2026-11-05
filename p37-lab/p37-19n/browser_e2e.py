"""P37-19N run the exact original ERP Store JS in isolated Chromium.

This uses only localhost-delivered synthetic legacy data and never authenticates
or sends requests to production ERP or Supabase.
"""
import asyncio
import shutil
import sys
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import start, original_source_verified


def as_error(msg):
    return str(msg.get("message", "")) if isinstance(msg, dict) else str(msg)


async def invoke(page, script, arg=None):
    if arg is None:
        return await page.evaluate(script)
    return await page.evaluate(script, arg)


async def try_write(page, expression, arg=None):
    return await invoke(page, """async ([fn,argument]) => {
      try {return {ok:true,value:await window.KuSheERPStore[fn](...argument)}}
      catch(e){return {ok:false,message:String(e.message||e),code:String(e.code||'')}}
    }""", [expression, arg or []])


async def inspect(page):
    return await invoke(page, """() => {
      const s=window.KuSheERPStore.getState();
      if(!s)return null;
      const a=s.receivables.find(x=>x.id===window.P37N.ids.A);
      const b=s.receivables.find(x=>x.id===window.P37N.ids.B);
      const bank=s.banks.find(x=>x.id===window.P37N.ids.BANK);
      return {
        count:s.billings.length,receivables:s.receivables.length,
        invoiceCount:s.invoices.length,allowanceCount:s.billingAllowances.length,
        receipts:s.receipts.length,retentionReceipts:s.retentionReceipts.length,
        bankRows:s.bankTransactions.length,bankIncome:bank.income,
        bankBalance:bank.balance,receivedClean:b.received,receivedAllowance:a.received,
        allowanceGross:a.amount,allowanceRetention:a.retentionAmount,
        financialHistoryUnchanged:s.billingAllowances[0].grossReduction===27300,
        settingsCompany:s.settings.company,
        revision:s.meta.businessSnapshotRevision?.id||'',
        revisionSequence:s.meta.businessSnapshotRevision?.sequence||0,
        frozen:Object.isFrozen(s)
      };
    }""")


async def persisted(page):
    return await invoke(page, """async () => {
      const db=await new Promise((resolve,reject)=>{
        const q=indexedDB.open('KuSheERP25_Core34_DB');
        q.onsuccess=()=>resolve(q.result);
        q.onerror=()=>reject(q.error);
      });
      const result=await new Promise((resolve,reject)=>{
        const tr=db.transaction('erp','readonly'),st=tr.objectStore('erp');
        const a=st.get('main'),b=st.get('store:transaction:journal:v1');
        let state,journal;
        a.onsuccess=()=>{state=a.result};
        b.onsuccess=()=>{journal=b.result};
        tr.oncomplete=()=>resolve({state,journal});
        tr.onerror=()=>reject(tr.error);
        tr.onabort=()=>reject(tr.error);
      });
      db.close();
      const s=result.state, j=result.journal;
      return {
        exists:Boolean(s),journalPhase:j?.phase||'',
        revision:s?.meta?.businessSnapshotRevision?.id||'',
        billings:s?.billings?.length??null,
        receipts:s?.receipts?.length??null,
        allowanceCount:s?.billingAllowances?.length??null,
        bankTransactions:s?.bankTransactions?.length??null,
        emergencyMirrorPresent:Boolean(localStorage.getItem('KuSheERP25_EMERGENCY')),
        localTokenPresent:Boolean(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN')),
        receiptCommitVersionPresent:Boolean(localStorage.getItem('KuSheERP25_RECEIPT_COMMIT_VERSION')),
        emergencyEqual: s?localStorage.getItem('KuSheERP25_EMERGENCY')===JSON.stringify(s):false
      };
    }""")


def receipt(amount=20000, deduction=2000, key="P37-19-SYN-ACTION-RECEIPT-1"):
    return {
        "receivableId": "P37-19-SYN-AR-CLEAN",
        "date": "2026-11-06",
        "cashAmount": amount,
        "deductions": ([{"category": "垃圾清運費", "amount": deduction,
                        "note": "P37-19N synthetic"}] if deduction else []),
        "fee": 100 if amount >= 100 else 0,
        "feePayer": "company",
        "bankId": "P37-19-SYN-BANK-1",
        "paymentMethod": "銀行轉帳",
        "note": "P37-19N synthetic real Store writer isolated",
        "idempotencyKey": key,
    }


def settings(name):
    return {
        "company": name, "taxId": "P37-19-SYN-TAX-NO",
        "owner": "P37-19-SYN-OWNER", "phone": "0",
        "address": "127.0.0.1 P37 LAB ONLY", "defaultTax": 5,
    }


async def main():
    original_len = original_source_verified()
    server, origin = start()
    external = []
    failures = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                executable_path=shutil.which("google-chrome")
                or shutil.which("chromium") or None
            )
            context = await browser.new_context()
            async def localhost_only(route):
                if not route.request.url.startswith(origin + "/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*", localhost_only)
            page = await context.new_page()
            page.on("pageerror", lambda e: failures.append(str(e)))
            await page.goto(origin)
            assert "ORIGINAL ERP STORE" in await page.title()
            assert await invoke(page, "() => typeof window.KuSheERPStore") == "object"
            assert await invoke(page, "() => Object.isFrozen(window.KuSheERPStore)")
            first = await invoke(page, "() => window.KuSheERPStore.load().then(()=>true)")
            assert first is True
            base = await inspect(page)
            assert base["count"] == 2 and base["receivables"] == 2, base
            assert base["receipts"] == base["bankRows"] == 0, base
            assert base["financialHistoryUnchanged"] and base["frozen"], base
            assert base["revision"] == "", base

            # Public direct persist must remain disabled in actual Store.
            direct = await try_write(page, "persist")
            assert not direct["ok"] and (
                "DIRECT_PERSIST_FORBIDDEN" in direct["code"] or "直接 persist" in direct["message"]
            ), direct
            blocked = await try_write(page, "addReceipt", [{
                **receipt(), "receivableId": "P37-19-SYN-AR-ALLOW",
                "idempotencyKey": "P37-19-SYN-ACTION-BLOCKED"
            }])
            assert not blocked["ok"] and "折讓" in blocked["message"], blocked
            blocked_ret = await try_write(page, "addRetentionReceipt", [{
                "receivableId": "P37-19-SYN-AR-ALLOW", "amount": 1000,
                "bankId": "P37-19-SYN-BANK-1",
                "idempotencyKey": "P37-19-SYN-ACTION-RET-BLOCKED"
            }])
            assert not blocked_ret["ok"] and "折讓" in blocked_ret["message"], blocked_ret
            assert (await inspect(page))["receipts"] == 0

            # Original Store (not synthetic simulator) now commits a harmless,
            # test-only setting through its real IDB/journal/mirror kernel.
            initial_write = await try_write(page, "saveSystemSettings",
                                            [settings("P37-19N SYNTHETIC FIRST COMMIT")])
            assert initial_write["ok"], initial_write
            actual = await persisted(page)
            assert actual["exists"] and actual["journalPhase"] == "COMMIT_VERIFIED", actual
            assert actual["revision"] and actual["allowanceCount"] == 1, actual
            assert actual["emergencyEqual"] and actual["localTokenPresent"], actual
            assert actual["receiptCommitVersionPresent"], actual
            initial_revision = actual["revision"]

            # Browser reload really reopens and validates ERP IndexedDB and mirror.
            await page.reload()
            assert await invoke(page, "() => window.KuSheERPStore.load().then(()=>true)")
            rebooted = await inspect(page)
            assert rebooted["revision"] == initial_revision, rebooted
            assert rebooted["settingsCompany"] == "P37-19N SYNTHETIC FIRST COMMIT"

            # Only the unadjusted synthetic receivable is permitted to receive
            # actual Store money transactions in this fully isolated origin.
            clean = receipt()
            first_receipt = await try_write(page, "addReceipt", [clean])
            assert first_receipt["ok"], first_receipt
            r1 = await inspect(page)
            assert r1["receipts"] == 1 and r1["bankRows"] == 1, r1
            assert r1["receivedClean"] == 22000, r1
            assert r1["receivedAllowance"] == 0, r1
            assert r1["bankIncome"] == 19900 and r1["bankBalance"] == 119900, r1
            assert r1["financialHistoryUnchanged"] and r1["allowanceGross"] == 1185600
            saved = await persisted(page)
            assert saved["receipts"] == saved["bankTransactions"] == 1
            assert saved["emergencyEqual"] and saved["journalPhase"] == "COMMIT_VERIFIED"

            # Same idempotency key replays without a second receipt or bank
            # transaction, keeping original billing source untouched.
            replay = await try_write(page, "addReceipt", [clean])
            assert replay["ok"], replay
            same = await inspect(page)
            assert same["receipts"] == same["bankRows"] == 1
            assert same["bankIncome"] == 19900 and same["receivedClean"] == 22000
            assert same["revision"] == r1["revision"]

            over = receipt(31000, 1000, "P37-19-SYN-ACTION-OVERLIMIT")
            rejected = await try_write(page, "addReceipt", [over])
            assert not rejected["ok"], rejected
            assert (await inspect(page))["revision"] == r1["revision"]
            assert (await persisted(page))["receipts"] == 1

            # Run true Storage Estimation failure injection on original commit
            # kernel. The draft may be updated in memory, but the old published
            # snapshot and IndexedDB must not be changed.
            fail_result = await invoke(page, """async (values) => {
              const original=navigator.storage.estimate;
              navigator.storage.estimate=async()=>({quota:1,usage:1});
              try {
                try {
                  await window.KuSheERPStore.saveSystemSettings(values);
                  return {ok:true};
                } catch(e) {
                  return {ok:false,code:String(e.code||''),message:String(e.message)};
                }
              } finally {navigator.storage.estimate=original}
            }""", settings("P37-19N SHOULD NEVER PERSIST"))
            assert not fail_result["ok"], fail_result
            assert (await inspect(page))["revision"] == r1["revision"]
            assert (await persisted(page))["revision"] == r1["revision"]
            await page.reload()
            await invoke(page, "() => window.KuSheERPStore.load()")
            assert (await inspect(page))["settingsCompany"] == "P37-19N SYNTHETIC FIRST COMMIT"

            # Two stale browser tabs of same origin really share the DB. Both
            # hold a local snapshot, but only the first may update the version.
            stale_tab = await context.new_page()
            stale_tab.on("pageerror", lambda e: failures.append(str(e)))
            await stale_tab.goto(origin)
            await invoke(stale_tab, "() => window.KuSheERPStore.load()")
            stale_baseline = (await inspect(stale_tab))["revision"]
            assert stale_baseline == r1["revision"]
            winner = await try_write(page, "saveSystemSettings",
                                     [settings("P37-19N NEWER SYNTHETIC TAB")])
            assert winner["ok"], winner
            winner_revision = (await inspect(page))["revision"]
            assert winner_revision != stale_baseline
            loser = await try_write(stale_tab, "saveSystemSettings",
                                    [settings("P37-19N STALE TAB MUST NOT WIN")])
            assert not loser["ok"], loser
            latest = await persisted(page)
            assert latest["revision"] == winner_revision and latest["emergencyEqual"], latest
            await stale_tab.reload()
            await invoke(stale_tab, "() => window.KuSheERPStore.load()")
            assert (await inspect(stale_tab))["settingsCompany"] == "P37-19N NEWER SYNTHETIC TAB"
            assert (await inspect(stale_tab))["revision"] == winner_revision
            assert (await inspect(stale_tab))["receipts"] == 1

            # Force a tampered emergency backup in this sandbox only. Original
            # Store must not silently accept and commit new data against it.
            await invoke(page, """() => localStorage.setItem(
                'KuSheERP25_EMERGENCY','P37-19N-INTENTIONAL-SYNTHETIC-CORRUPTION')""")
            tampered = await try_write(page, "saveSystemSettings",
                                       [settings("P37-19N CORRUPT MIRROR MUST NOT COMMIT")])
            assert not tampered["ok"], tampered
            assert (await persisted(page))["revision"] == winner_revision
            assert (await persisted(page))["receipts"] == 1

            assert not external, external
            assert not failures, failures
            await stale_tab.close()
            await context.close()
            await browser.close()
            print("P37-19N REAL original erp-store.js SHA verified:",
                  original_len, "bytes")
            print("Actual Store load/IDB, commit journal, emergency mirror,"
                  " synthetic receipt/bank, allowance-linked refusal,"
                  " idempotency, stale tabs, quota fault, mirror failure PASS")
            print("No formal ERP page/Cloud Sync/Supabase or company data used")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    asyncio.run(main())
