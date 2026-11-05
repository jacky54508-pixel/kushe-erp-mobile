"""P37-19O: ORIGINAL ERP STORE integration on a localhost synthetic fixture.

This test exercises unmodified Store retention, cheque, bank, commission
readers/writers and rollback in an ephemeral Chromium origin. There is no
production ERP account or Supabase request.
"""
import asyncio
import json
import shutil
import sys
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from server import start, original_source_verified

DATE = "2026-11-06"
BANK = "P37-19-SYN-BANK-1"
AR = "P37-19-SYN-AR-RET-CHEQUE"
ALLOW = "P37-19-SYN-AR-ALLOW"
BILL = "P37-19-SYN-BILL-RET-CHEQUE"
EMP = "P37-19-SYN-EMP-COMM"
PROJ = "P37-19-SYN-PROJECT"


async def js(page, code, arg=None):
    return await page.evaluate(code) if arg is None else await page.evaluate(code, arg)


async def op(page, fn, *args):
    return await js(page, """async ([name,values]) => {
        try {return {ok:true,value:await window.KuSheERPStore[name](...values)}}
        catch(error){return {ok:false,code:String(error?.code||''),
            message:String(error?.message||error)}}
    }""", [fn, list(args)])


async def state(page):
    return await js(page, """() => {
        const s=window.KuSheERPStore.getState();
        const a=s.receivables.find(x=>x.id===window.P37N.ids.A);
        const ar=s.receivables.find(x=>x.id===window.P37O.ids.AR);
        const bank=s.banks.find(x=>x.id===window.P37N.ids.BANK);
        const cheques=ar.receivableCheques||[];
        const commission=window.KuSheERPStore.commissionReleasePool()
          .filter(r=>r.commissionId===window.P37O.ids.COMM);
        return {
          revision:s.meta.businessSnapshotRevision?.id||'',
          billings:s.billings.length,allowanceCount:s.billingAllowances.length,
          invoices:s.invoices.length,originalAllowanceAR:a.amount,
          originalAllowanceRetention:a.retentionAmount,
          retentionAR:ar.retentionAmount,retentionReceived:ar.retentionReceived,
          principalAR:ar.amount,principalReceived:ar.received,
          chequeCount:cheques.length,
          cheques:cheques.map(c=>({id:c.id,number:c.number,status:c.status,
              amount:c.amount,reservedAmount:c.reservedAmount,
              receiptId:c.receiptId||null,bankTransactionId:c.bankTransactionId||null,
              revision:c.revision})),
          receipts:s.receipts.map(r=>({id:r.id,amount:r.amount,
              settlementAmount:r.settlementAmount,
              deductionAmount:r.deductionAmount,
              chequeId:r.chequeId||null,bankTransactionId:r.bankTransactionId||null,
              receivableId:r.receivableId})),
          retentionReceipts:s.retentionReceipts.map(r=>({id:r.id,amount:r.amount,
              netAmount:r.netAmount,bankTransactionId:r.bankTransactionId,
              receivableId:r.receivableId})),
          bankRows:s.bankTransactions.map(t=>({id:t.id,sourceType:t.sourceType,
              amount:t.amount,receiptId:t.sourceId,receivableId:t.receivableId,
              chequeId:t.chequeId||null})),
          bankIncome:bank.income,bankBalance:bank.balance,
          payrollCount:s.payroll.length,salaryPayments:s.salaryPayments.length,
          commissionCount:s.commissions.length,commissionRelease:commission.map(r=>({
            status:r.releaseStatus,unlocked:r.unlocked,settled:r.settled,
            amount:r.amount,receivableAmount:r.receivableAmount,
            receivedAmount:r.receivedAmount
          })),
          noCompanyMutation:s.billings.every(b=>b.id.startsWith('P37-19-SYN-'))
            &&s.receivables.every(r=>r.id.startsWith('P37-19-SYN-'))
            &&s.billingAllowances.every(r=>r.id.startsWith('P37-19-SYN-'))
        };
    }""")


async def durable(page):
    return await js(page, """async () => {
        const db=await new Promise((resolve,reject)=>{
           const q=indexedDB.open('KuSheERP25_Core34_DB');
           q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
        });
        const row=await new Promise((resolve,reject)=>{
           const t=db.transaction('erp','readonly'),s=t.objectStore('erp');
           const a=s.get('main'),b=s.get('store:transaction:journal:v1');
           let state,journal;
           a.onsuccess=()=>{state=a.result};b.onsuccess=()=>{journal=b.result};
           t.oncomplete=()=>resolve({state,journal});
           t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
        });
        db.close();
        return {
          revision:row.state?.meta?.businessSnapshotRevision?.id||'',
          phase:row.journal?.phase||'',
          receipts:row.state?.receipts?.length??-1,
          retentionReceipts:row.state?.retentionReceipts?.length??-1,
          bankRows:row.state?.bankTransactions?.length??-1,
          mirrorMatches:localStorage.getItem('KuSheERP25_EMERGENCY')===JSON.stringify(row.state),
          hasCommitToken:Boolean(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN')),
          allowanceCount:row.state?.billingAllowances?.length??-1
        };
    }""")


async def cheque_snapshot(page, ar=AR):
    return await op(page, "receivableChequeSnapshot", ar)


def ticket(number="P37-19-SYN-CH-001", key="P37-19-SYN-CHEQUE-KEY-1"):
    return {
        "number": number, "amount": 20000,
        "receivedDate": DATE, "dueDate": DATE, "reminderDays": 0,
        "issuerBank": "P37 SYNTHETIC ISSUER",
        "drawer": "P37 SYNTHETIC DRAWER",
        "note": "P37-19O synthetic cheque",
        "deductions": [{"category": "垃圾清運費", "amount": 1000,
                        "note": "P37-19O synthetic deduction"}],
        "idempotencyKey": key,
    }


def retention(amount=2500, fee=100, note="P37-19O synthetic retention"):
    return {
        "receivableId": AR, "amount": amount,
        "date": DATE, "bankId": BANK,
        "fee": fee, "feePayer": "company",
        "paymentMethod": "銀行轉帳", "note": note,
        "idempotencyKey": "P37-19-SYN-RET-KEY-1",
    }


def receipt(cash, key, fee=0):
    return {
        "receivableId": AR, "date": DATE,
        "cashAmount": cash, "deductions": [],
        "fee": fee, "feePayer": "company", "bankId": BANK,
        "paymentMethod": "銀行轉帳", "note": "P37-19O synthetic receipt",
        "idempotencyKey": key,
    }


async def fail_quota(page, name, args):
    return await js(page, """async ([method,values])=>{
      const original=navigator.storage.estimate;
      navigator.storage.estimate=async()=>({quota:1,usage:1});
      try {
        try {await window.KuSheERPStore[method](...values);
          return {ok:true}}
        catch(e){return {ok:false,code:String(e?.code||''),
          message:String(e?.message||'')}}
      }finally{navigator.storage.estimate=original}
    }""", [name, args])


async def main():
    exact_size = original_source_verified()
    server, origin = start()
    external, errors = [], []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True,
                executable_path=shutil.which("google-chrome")
                or shutil.which("chromium") or None
            )
            context = await browser.new_context(
                viewport={"width": 1300, "height": 800}
            )

            async def allow_local(route):
                if not route.request.url.startswith(origin + "/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()

            await context.route("**/*", allow_local)
            page = await context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(origin)
            assert "ORIGINAL ERP STORE" in await page.title()
            assert await js(page, "()=>window.P37O.scope") == \
                "P37_19O_REAL_STORE_ISOLATED_FIXTURE"
            assert await js(page, "()=>KuSheERPStore.load().then(()=>true)")
            initial = await state(page)
            assert initial["billings"] == 3, initial
            assert initial["allowanceCount"] == 1
            assert initial["principalAR"] == 94500
            assert initial["retentionAR"] == 10500
            assert initial["retentionReceived"] == 0
            assert initial["bankIncome"] == 0
            assert len(initial["commissionRelease"]) == 1
            assert initial["commissionRelease"][0]["unlocked"] is False
            assert initial["noCompanyMutation"]

            # Bootstrap real production Store's versioned mirror on disposable origin.
            settings = {
                "company": "P37-19O SYNTHETIC ONLY", "taxId": "P37-19-SYN-TAX",
                "owner": "P37-19-SYN-OWNER", "phone": "0",
                "address": "127.0.0.1 P37-19O ONLY", "defaultTax": 5,
            }
            boot = await op(page, "saveSystemSettings", settings)
            assert boot["ok"], boot
            first_durable = await durable(page)
            assert first_durable["phase"] == "COMMIT_VERIFIED"
            assert first_durable["mirrorMatches"]
            assert first_durable["hasCommitToken"]
            assert first_durable["allowanceCount"] == 1
            await page.reload()
            await js(page, "()=>KuSheERPStore.load()")
            assert (await durable(page))["revision"] == first_durable["revision"]

            # Real Store must block all financial writes against synthetic
            # allowance-linked AR; never bypass that gate in these tests.
            blocked = await op(page, "addRetentionReceipt", {
                "receivableId": ALLOW, "amount": 1000, "bankId": BANK,
                "idempotencyKey": "P37-19-SYN-ALLOW-RET-STOP",
            })
            assert not blocked["ok"] and "折讓" in blocked["message"], blocked
            ar_allow_snapshot = await cheque_snapshot(page, ALLOW)
            assert ar_allow_snapshot["ok"], ar_allow_snapshot
            blocked_ticket = await op(
                page, "saveReceivableCheque", ALLOW,
                {**ticket(), "expectedSnapshot": ar_allow_snapshot["value"]}
            )
            assert not blocked_ticket["ok"] and \
                "折讓" in blocked_ticket["message"], blocked_ticket

            # Retention receipt: actual Store updates bank and retention
            # summary atomically, but NOT the principal amount.
            ret = retention()
            created = await op(page, "addRetentionReceipt", ret)
            assert created["ok"], created
            ret_id = created["value"]["id"]
            after_ret = await state(page)
            assert after_ret["retentionReceived"] == 2500
            assert after_ret["bankIncome"] == 2400
            assert after_ret["bankBalance"] == 102400
            assert len(after_ret["retentionReceipts"]) == 1
            assert len(after_ret["bankRows"]) == 1
            assert after_ret["principalReceived"] == 0
            assert after_ret["commissionRelease"][0]["unlocked"] is False
            saved = await durable(page)
            assert saved["retentionReceipts"] == saved["bankRows"] == 1
            assert saved["mirrorMatches"] and saved["phase"] == "COMMIT_VERIFIED"

            duplicate = await op(page, "addRetentionReceipt", ret)
            assert duplicate["ok"], duplicate
            assert (await state(page))["bankIncome"] == 2400
            assert len((await state(page))["retentionReceipts"]) == 1

            updated = await op(page, "updateRetentionReceipt", ret_id,
                               {**ret, "amount": 3000, "fee": 150})
            assert updated["ok"], updated
            after_update = await state(page)
            assert after_update["retentionReceived"] == 3000
            assert after_update["bankIncome"] == 2850
            assert len(after_update["bankRows"]) == 1
            assert after_update["principalReceived"] == 0

            reversed_ret = await op(page, "deleteRetentionReceipt", ret_id)
            assert reversed_ret["ok"], reversed_ret
            clean_ret = await state(page)
            assert clean_ret["retentionReceived"] == 0
            assert clean_ret["bankIncome"] == 0
            assert len(clean_ret["retentionReceipts"]) == 0
            assert len(clean_ret["bankRows"]) == 0

            # Cheque: full 20,000 face plus 1,000 customer deduction is
            # reserved, without a receipt, bank income or commission release.
            before_cheque = await cheque_snapshot(page)
            assert before_cheque["ok"], before_cheque
            initial_ticket = ticket()
            recorded = await op(page, "saveReceivableCheque", AR, {
                **initial_ticket, "expectedSnapshot": before_cheque["value"]
            })
            assert recorded["ok"], recorded
            ch_id = recorded["value"]["id"]
            pending = await state(page)
            assert pending["chequeCount"] == 1
            assert pending["cheques"][0]["status"] == "pending"
            assert pending["cheques"][0]["reservedAmount"] == 21000
            assert pending["principalReceived"] == 0
            assert pending["bankIncome"] == 0
            assert not pending["receipts"] and not pending["retentionReceipts"]
            assert pending["commissionRelease"][0]["unlocked"] is False

            cap = await op(page, "receivableChequeCapacity", AR)
            assert cap["ok"], cap
            assert cap["value"]["outstanding"] == 94500, cap
            assert cap["value"]["reserved"] == 21000, cap
            assert cap["value"]["available"] == 73500, cap

            replay_ticket = await op(page, "saveReceivableCheque", AR, {
                **initial_ticket, "expectedSnapshot": before_cheque["value"]
            })
            assert replay_ticket["ok"], replay_ticket
            assert (await state(page))["chequeCount"] == 1

            stale = await op(page, "saveReceivableCheque", AR, {
                **ticket("P37-19-SYN-CH-002", "P37-19-SYN-CHEQUE-KEY-2"),
                "expectedSnapshot": before_cheque["value"]
            })
            assert not stale["ok"] and \
                "變動" in stale["message"], stale
            assert (await state(page))["chequeCount"] == 1

            # A valid clearance attempt that crashes before Store commit
            # must restore all draft mutations, including linked bank row.
            clear_args = {
                "date": DATE, "bankId": BANK, "fee": 100,
                "feePayer": "company", "note": "P37-19O clear",
                "confirmed": True,
                "idempotencyKey": "P37-19-SYN-CLEAR-KEY-1",
                "expectedSnapshot": (await cheque_snapshot(page))["value"],
            }
            before_clear = await state(page)
            fingerprint_before = (await durable(page))["revision"]
            blocked_quota = await fail_quota(
                page, "clearReceivableCheque", [AR, ch_id, clear_args]
            )
            assert not blocked_quota["ok"], blocked_quota
            after_failed_clear = await state(page)
            assert after_failed_clear == before_clear, (
                before_clear, after_failed_clear)
            assert (await durable(page))["revision"] == fingerprint_before
            await page.reload()
            await js(page, "()=>KuSheERPStore.load()")
            assert (await state(page)) == before_clear

            # Invalid confirmation cannot transition pending -> cleared.
            unconfirmed = await op(page, "clearReceivableCheque", AR, ch_id,
                                   {**clear_args, "confirmed": False})
            assert not unconfirmed["ok"], unconfirmed
            assert (await state(page)) == before_clear

            # Real Store clearance atomically adds ONE receipt and ONE bank
            # entry, consumes reserved amount, and updates received principal.
            reverified = await cheque_snapshot(page)
            clear_args["expectedSnapshot"] = reverified["value"]
            cleared = await op(page, "clearReceivableCheque",
                               AR, ch_id, clear_args)
            assert cleared["ok"], cleared
            after_cleared = await state(page)
            assert after_cleared["cheques"][0]["status"] == "cleared"
            assert after_cleared["principalReceived"] == 21000
            assert after_cleared["bankIncome"] == 19900
            assert len(after_cleared["receipts"]) == 1
            assert len(after_cleared["bankRows"]) == 1
            assert after_cleared["receipts"][0]["settlementAmount"] == 21000
            assert after_cleared["receipts"][0]["deductionAmount"] == 1000
            assert after_cleared["bankRows"][0]["amount"] == 19900
            assert after_cleared["cheques"][0]["receiptId"] == \
                after_cleared["receipts"][0]["id"]
            assert after_cleared["cheques"][0]["bankTransactionId"] == \
                after_cleared["bankRows"][0]["id"]
            assert after_cleared["commissionRelease"][0]["unlocked"] is False
            assert after_cleared["salaryPayments"] == 0
            assert after_cleared["allowanceCount"] == 1
            assert after_cleared["originalAllowanceAR"] == 1185600

            duplicate_clear = await op(page, "clearReceivableCheque",
                                       AR, ch_id, clear_args)
            assert duplicate_clear["ok"], duplicate_clear
            assert (await state(page)) == after_cleared

            # Collect the remaining 73,500 on the clean unadjusted bill.
            # The real commission release reader may now *display* unlocked,
            # but no pay/salary/bank expense is created automatically.
            final = await op(
                page, "addReceipt", receipt(
                    73500, "P37-19-SYN-RECEIPT-FINAL", 0
                )
            )
            assert final["ok"], final
            completed = await state(page)
            assert completed["principalReceived"] == 94500
            assert completed["bankIncome"] == 93400
            assert len(completed["bankRows"]) == len(completed["receipts"]) == 2
            assert completed["commissionRelease"][0]["unlocked"] is True
            assert completed["commissionRelease"][0]["status"] == "可發"
            assert completed["commissionRelease"][0]["amount"] == 2500
            assert completed["commissionRelease"][0]["receivedAmount"] == 94500
            assert completed["salaryPayments"] == 0
            assert completed["allowanceCount"] == 1
            assert completed["originalAllowanceAR"] == 1185600
            assert completed["noCompanyMutation"]
            independent = await durable(page)
            assert independent["phase"] == "COMMIT_VERIFIED"
            assert independent["mirrorMatches"]
            assert independent["receipts"] == 2 and independent["bankRows"] == 2
            await page.reload()
            await js(page, "()=>KuSheERPStore.load()")
            assert (await state(page)) == completed

            assert not errors, errors
            assert not external, external
            await context.close()
            await browser.close()
            print("P37-19O REAL ERP STORE: retention add/edit/delete, cheque reserve/clear, "
                  "bank and commission unlock PASS")
            print("Actual unmodified Store 875k-character JS; verified SHA source "
                  f"{original_source_verified()} bytes")
            print("Synthetic browser only. No real ERP, no Supabase, no company funds.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    asyncio.run(main())
