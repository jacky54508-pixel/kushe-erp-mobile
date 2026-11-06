"""P37-19Q actual Chromium race: two stale tabs submit adjusted synthetic
receipt and retention mutations against the exact original Store code,
patched only in ephemeral P37-19P localhost fixture. NOT two real devices,
NOT Supabase, NOT production.
"""
from __future__ import annotations
import asyncio
import shutil
import sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "p37-lab" / "p37-19p"
sys.path.insert(0, str(P))
from server import start
from lab_overlay import ORIGINAL_SHA, build

AR = "P37-19-SYN-AR-APPROVED"
BANK = "P37-19-SYN-BANK-1"
DATE = "2026-11-06"


async def js(page, expr, arg=None):
    return await page.evaluate(expr) if arg is None else await page.evaluate(expr, arg)


async def op(page, name, *args):
    return await js(page, """async ([name,params])=>{
      try{return {ok:true,result:await window.KuSheERPStore[name](...params)}}
      catch(error){return {ok:false,error:String(error?.message||error),
        code:String(error?.code||'')}}
    }""", [name, list(args)])


async def view(page):
    return await js(page, """()=>{
       const s=KuSheERPStore.getState();
       const ar=s.receivables.find(r=>r.id===window.P37P.ids.AR);
       const bill=s.billings.find(b=>b.id===window.P37P.ids.BILL);
       const bank=s.banks.find(b=>b.id===window.P37N.ids.BANK);
       const receipt=s.receipts.filter(r=>r.receivableId===ar.id);
       const retention=s.retentionReceipts.filter(r=>r.receivableId===ar.id);
       const bankEntries=s.bankTransactions.filter(r=>r.receivableId===ar.id);
       const pool=KuSheERPStore.commissionReleasePool()
         .filter(r=>r.commissionId===window.P37P.ids.COMM);
       return {
         revision:s.meta?.businessSnapshotRevision?.id||'',
         originalAR:ar.amount,originalRet:ar.retentionAmount,
         originalBillAR:bill.total,originalBillRet:bill.retentionAmount,
         received:ar.received,remaining:KuSheERPStore.billingReceiptState(bill).unreceived,
         retReceived:ar.retentionReceived,retRemaining:ar.remainingRetention,
         invoiceGross:s.invoices.find(i=>i.id===window.P37P.ids.INV).grossAmount,
         allowanceGross:s.billingAllowances.find(a=>a.id===window.P37P.ids.ALLOW).allowance.gross,
         receiptCount:receipt.length,retentionCount:retention.length,bankCount:bankEntries.length,
         cash:receipt.reduce((n,r)=>n+(r.cashAmount||0),0),
         customerDeductions:receipt.reduce((n,r)=>n+(r.deductionAmount||0),0),
         bankActual:bankEntries.reduce((n,b)=>n+b.amount,0),
         bankIncome:bank.income,bankBalance:bank.balance,
         commissionUnlocked:pool[0]?.unlocked===true,
         commissionCount:s.commissions.length,salaryPayments:s.salaryPayments.length,
         sourceScopeAllSynthetic:s.billings.every(b=>b.id.startsWith('P37-19-SYN-'))&&
           s.receivables.every(r=>r.id.startsWith('P37-19-SYN-'))
       };
    }""")


async def durable(page):
    return await js(page, """async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('KuSheERP25_Core34_DB');
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
      });
      const found=await new Promise((resolve,reject)=>{
        const tx=db.transaction('erp','readonly'),st=tx.objectStore('erp');
        let s,j;
        st.get('main').onsuccess=e=>{s=e.target.result};
        st.get('store:transaction:journal:v1').onsuccess=e=>{j=e.target.result};
        tx.oncomplete=()=>resolve({s,j});
        tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      db.close();
      return {revision:found.s?.meta?.businessSnapshotRevision?.id||'',
        journal:found.j?.phase||'',
        mirrorMatches:localStorage.getItem('KuSheERP25_EMERGENCY')===
            JSON.stringify(found.s),
        tokenPresent:!!localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN'),
        receiptCount:found.s?.receipts?.filter(r=>r.receivableId===
            'P37-19-SYN-AR-APPROVED').length||0,
        retentionCount:found.s?.retentionReceipts?.filter(r=>r.receivableId===
            'P37-19-SYN-AR-APPROVED').length||0,
        bankCount:found.s?.bankTransactions?.filter(r=>r.receivableId===
            'P37-19-SYN-AR-APPROVED').length||0
      };
    }""")


def receipt(key):
    return dict(
      receivableId=AR,date=DATE,cashAmount=800000,
      deductions=[{"category":"垃圾清運費","amount":20000,
                    "note":"P37-19Q synthetic customer deduction"}],
      fee=200,feePayer="company",bankId=BANK,paymentMethod="銀行轉帳",
      note="P37-19Q synthetic concurrent receipt",
      idempotencyKey="P37-19-SYN-Q-"+key
    )


def retention(key):
    return dict(
      receivableId=AR,date=DATE,amount=100000,
      fee=100,feePayer="company",bankId=BANK,paymentMethod="銀行轉帳",
      note="P37-19Q synthetic concurrent retention",
      idempotencyKey="P37-19-SYN-Q-"+key
    )


async def load(page, origin):
    await page.goto(origin)
    assert await js(page,"()=>window.KuSheERPStore.load().then(()=>true)")


async def main():
    patched=build()
    assert len(patched)>925386
    server,origin,temp=start()
    external=[]
    try:
        async with async_playwright() as engine:
            browser=await engine.chromium.launch(headless=True,
              executable_path=shutil.which("google-chrome") or
              shutil.which("chromium") or None)
            context=await browser.new_context(viewport={"width":1250,"height":760})

            async def only_local(route):
                if not route.request.url.startswith(origin+"/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()

            await context.route("**/*",only_local)
            a,b=await context.new_page(),await context.new_page()
            await load(a,origin)

            # First harmless synthetic setting creates a real durable Store
            # journal, Emergency mirror and local commit token.
            baseline=await op(a,"saveSystemSettings",{
              "company":"P37-19Q SYNTHETIC MULTITAB",
              "taxId":"P37-19-SYN-TAX","owner":"P37-19-SYN-OWNER",
              "phone":"0","address":"localhost P37-19Q","defaultTax":5
            })
            assert baseline["ok"],baseline
            initial=await view(a)
            assert initial["received"]==0 and initial["retReceived"]==0
            assert initial["originalAR"]==1185600
            assert initial["remaining"]==1160900
            assert initial["retRemaining"]==122200
            assert initial["sourceScopeAllSynthetic"]
            await load(b,origin)
            assert (await view(b))["revision"]==initial["revision"]

            # Same-origin two real Chromium tabs start from identical local
            # committed version and concurrently ask to add >50% of approved AR.
            # One must fail: two receipts would exceed the effective 1,160,900.
            left,right=await asyncio.gather(
              op(a,"addReceipt",receipt("RECEIPT-A")),
              op(b,"addReceipt",receipt("RECEIPT-B"))
            )
            assert sum(bool(r["ok"]) for r in (left,right))==1,(left,right)
            assert sum(not r["ok"] for r in (left,right))==1,(left,right)
            assert any(("逾時" in r.get("error","") or
                        "舊" in r.get("error","") or
                        "變更" in r.get("error","") or
                        "超過" in r.get("error","") or
                        "STORE_" in r.get("code",""))
                       for r in (left,right) if not r["ok"]),(left,right)

            latest=await context.new_page()
            await load(latest,origin)
            after=await view(latest)
            assert after["receiptCount"]==1 and after["bankCount"]==1,after
            assert after["received"]==820000 and after["remaining"]==340900,after
            assert after["cash"]==800000 and after["customerDeductions"]==20000,after
            assert after["bankActual"]==799800,after
            assert after["bankIncome"]==799800 and after["bankBalance"]==899800,after
            assert after["commissionUnlocked"] is False
            assert after["salaryPayments"]==0
            assert after["originalAR"]==after["originalBillAR"]==1185600
            assert after["originalRet"]==after["originalBillRet"]==124800
            assert after["invoiceGross"]==1310400 and after["allowanceGross"]==27300
            st=await durable(latest)
            assert st["journal"]=="COMMIT_VERIFIED" and st["mirrorMatches"],st
            assert st["tokenPresent"] and st["receiptCount"]==st["bankCount"]==1,st

            # Both tabs reload and obtain the newer committed baseline.
            await asyncio.gather(a.reload(),b.reload())
            await asyncio.gather(
              js(a,"()=>KuSheERPStore.load()"),
              js(b,"()=>KuSheERPStore.load()")
            )
            assert (await view(a))["revision"]==(await view(b))["revision"]

            # Two retention requests of 100k each exceed adjusted 122,200.
            left_ret,right_ret=await asyncio.gather(
              op(a,"addRetentionReceipt",retention("RET-A")),
              op(b,"addRetentionReceipt",retention("RET-B"))
            )
            assert sum(bool(r["ok"]) for r in (left_ret,right_ret))==1,(left_ret,right_ret)
            await latest.reload()
            await js(latest,"()=>KuSheERPStore.load()")
            end=await view(latest)
            assert end["retentionCount"]==1 and end["retReceived"]==100000,end
            assert end["retRemaining"]==22200,end
            assert end["bankCount"]==2 and end["bankActual"]==899700,end
            assert end["bankIncome"]==899700 and end["bankBalance"]==999700,end
            assert end["receiptCount"]==1 and end["received"]==820000,end
            assert end["commissionUnlocked"] is False and end["salaryPayments"]==0
            assert end["originalAR"]==1185600 and end["originalRet"]==124800,end
            assert end["invoiceGross"]==1310400 and end["allowanceGross"]==27300,end
            persisted=await durable(latest)
            assert persisted["mirrorMatches"] and persisted["journal"]=="COMMIT_VERIFIED",persisted
            assert persisted["receiptCount"]==1 and persisted["retentionCount"]==1
            assert persisted["bankCount"]==2
            assert not external,external
            await context.close()
            await browser.close()
            print("P37-19Q SAME-ORIGIN TWO-TAB SYNTHETIC RACE PASS")
            print("Adjusted principal 1,160,900; 800,000 cash + 20,000 deduction "
                  "accepted once; mock bank credit 799,800.")
            print("Adjusted retention 122,200; one 100,000 receipt; "
                  "one mock bank credit 99,900.")
            print("No duplicate IDB, bank or retention rows; original invoices "
                  "and tax history unmodified; no real Cloud Sync.")
    finally:
        server.shutdown()
        server.server_close()
        temp.cleanup()


if __name__=="__main__":
    asyncio.run(main())
