"""P37-19P real original ERP Store with a strictly isolated, SHA-pinned
lab-only ephemeral overlay. No real ERP, Supabase, users, invoices, or money.
"""
from __future__ import annotations
import asyncio
import shutil
import sys
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from server import start
from lab_overlay import build, ORIGINAL_SHA

DATE="2026-11-06"
BANK="P37-19-SYN-BANK-1"
ALLOW="P37-19-SYN-AR-APPROVED"
UNVERIFIED="P37-19-SYN-AR-ALLOW"
BILL="P37-19-SYN-BILL-APPROVED"
EMP="P37-19-SYN-EMP-COMM"


async def js(page,expression,arg=None):
    return await page.evaluate(expression) if arg is None else await page.evaluate(expression,arg)


async def op(page,name,*arguments):
    return await js(page, """async ([method,values])=>{
      try {return {ok:true,value:await window.KuSheERPStore[method](...values)}}
      catch(error){return {ok:false,message:String(error?.message||error),
        code:String(error?.code||'')}}
    }""",[name,list(arguments)])


async def snapshot(page):
    return await js(page, """()=>{
      const s=KuSheERPStore.getState(),ids=window.P37P.ids;
      const ar=s.receivables.find(r=>r.id===ids.AR);
      const b=s.billings.find(r=>r.id===ids.BILL);
      const bank=s.banks.find(r=>r.id===window.P37N.ids.BANK);
      const all=(s.receipts||[]).filter(r=>r.receivableId===ids.AR);
      const retention=(s.retentionReceipts||[]).filter(r=>r.receivableId===ids.AR);
      const tickets=ar.receivableCheques||[];
      const income=(s.bankTransactions||[]).filter(r=>r.receivableId===ids.AR);
      const comm=KuSheERPStore.commissionReleasePool().filter(r=>r.commissionId===ids.COMM);
      const billing=KuSheERPStore.billingReceiptState(b);
      return {
        revision:s.meta?.businessSnapshotRevision?.id||'',
        arOriginal:ar.amount,billOriginal:b.total,
        arOriginalRetention:ar.retentionAmount,billOriginalRetention:b.retentionAmount,
        originalUntaxed:b.amount,originalTax:b.tax,originalGross:b.grossTotal,
        received:ar.received,retentionReceived:ar.retentionReceived,
        derivedRemainingRetention:ar.remainingRetention,
        billingRemainingRetention:b.remainingRetention,
        retentionStatus:ar.retentionStatus,
        billingStatus:billing.status,billingOutstanding:billing.unreceived,
        bankIncome:bank.income,bankBalance:bank.balance,
        receiptCount:all.length,retentionCount:retention.length,
        bankCount:income.length,
        bankEntries:income.map(r=>({id:r.id,type:r.sourceType,amount:r.amount,
           sourceId:r.sourceId,chequeId:r.chequeId||''})),
        receipts:all.map(r=>({id:r.id,cash:r.cashAmount,
            settled:r.settlementAmount,deduction:r.deductionAmount,
            chequeId:r.chequeId||'',bankTransactionId:r.bankTransactionId||''})),
        cheques:tickets.map(r=>({id:r.id,number:r.number,status:r.status,
            reserved:r.reservedAmount,amount:r.amount,receiptId:r.receiptId||'',
            bankTransactionId:r.bankTransactionId||''})),
        commission:comm.map(r=>({unlocked:r.unlocked,status:r.releaseStatus,
            received:r.receivedAmount,receivable:r.receivableAmount,
            amount:r.amount})),
        salaryPayments:s.salaryPayments.length,
        originalInvoice:s.invoices.find(r=>r.id===ids.INV)?.grossAmount||null,
        allowanceRecord:s.billingAllowances.find(r=>r.id===ids.ALLOW)?.allowance?.gross||null,
        unrelatedOriginalAllowance:s.billingAllowances.find(r=>r.id==='P37-19-SYN-ALLOWANCE')?.grossReduction||null,
        invoiceCount:s.invoices.length,
        allIdsSynthetic:s.receivables.every(r=>/^P37-19-SYN-/.test(r.id))&&
          s.billings.every(r=>/^P37-19-SYN-/.test(r.id))
      };
    }""")


async def storage(page):
    return await js(page, """async ()=>{
      const db=await new Promise((resolve,reject)=>{
        const q=indexedDB.open('KuSheERP25_Core34_DB');
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
      });
      const row=await new Promise((resolve,reject)=>{
        const tx=db.transaction('erp','readonly'),t=tx.objectStore('erp');
        let data,log;
        t.get('main').onsuccess=e=>{data=e.target.result};
        t.get('store:transaction:journal:v1').onsuccess=e=>{log=e.target.result};
        tx.oncomplete=()=>resolve({data,log});
        tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });db.close();
      return {revision:row.data?.meta?.businessSnapshotRevision?.id||'',
       phase:row.log?.phase||'',
       bankCount:row.data?.bankTransactions?.length??null,
       receipts:row.data?.receipts?.length??null,
       retentionReceipts:row.data?.retentionReceipts?.length??null,
       mirrorMatches:localStorage.getItem('KuSheERP25_EMERGENCY')===
         JSON.stringify(row.data),
       tokenPresent:Boolean(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN'))
      };
    }""")


def payment(amount,key,deduction=0,fee=0):
    return {
      "receivableId":ALLOW,"date":DATE,"cashAmount":amount,
      "deductions":([{"category":"垃圾清運費","amount":deduction,
          "note":"P37-19P synthetic adjustment"}] if deduction else []),
      "fee":fee,"feePayer":"company","bankId":BANK,
      "paymentMethod":"銀行轉帳",
      "note":"P37-19P lab adjusted settlement",
      "idempotencyKey":"P37-19-SYN-P-"+key
    }


def retention(amount,key,fee=0):
    return {
      "receivableId":ALLOW,"date":DATE,"amount":amount,"bankId":BANK,
      "fee":fee,"feePayer":"company","paymentMethod":"銀行轉帳",
      "note":"P37-19P laboratory retention",
      "idempotencyKey":"P37-19-SYN-P-"+key
    }


def ticket(expected):
    return {
      "amount":40000,"number":"P37-19-SYN-P-CH-001",
      "receivedDate":DATE,"dueDate":DATE,"reminderDays":0,
      "issuerBank":"P37 SYNTHETIC BANK","drawer":"P37 SYNTHETIC DRAWER",
      "note":"P37-19P laboratory cheque",
      "deductions":[{"category":"垃圾清運費","amount":2000,
           "note":"P37 synthetic cheque deduction"}],
      "expectedSnapshot":expected,
      "idempotencyKey":"P37-19-SYN-P-CH-REGISTER"
    }


async def main():
    patched=build()
    assert len(patched)>925386
    server,origin,tmp=start()
    external=[]
    try:
        async with async_playwright() as playwright:
            browser=await playwright.chromium.launch(headless=True,
              executable_path=shutil.which("google-chrome") or
              shutil.which("chromium") or None)
            context=await browser.new_context(viewport={"width":1300,"height":800})
            async def only_local(route):
                if not route.request.url.startswith(origin+"/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*",only_local)
            page=await context.new_page()
            await page.goto(origin)
            assert "LAB-ONLY" in await page.title()
            assert await js(page,"()=>window.P37P.scope")== \
              "P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY"
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            base=await snapshot(page)
            assert base["allIdsSynthetic"]
            assert base["arOriginal"]==base["billOriginal"]==1185600,base
            assert base["arOriginalRetention"]==base["billOriginalRetention"]==124800,base
            assert base["originalInvoice"]==1310400,base
            assert base["allowanceRecord"]==27300,base
            assert base["billingOutstanding"]==1160900,base
            assert base["derivedRemainingRetention"]==122200,base
            assert base["commission"][0]["receivable"]==1160900,base
            assert base["commission"][0]["unlocked"] is False,base

            # All original Store persistence behavior is still the same.
            settings={"company":"P37-19P SANDBOX ONLY",
               "taxId":"P37-19-SYN-TAX","owner":"P37-19-SYN-OWNER",
               "phone":"0","address":"127.0.0.1, fake","defaultTax":5}
            initial_commit=await op(page,"saveSystemSettings",settings)
            assert initial_commit["ok"],initial_commit
            durable=await storage(page)
            assert durable["phase"]=="COMMIT_VERIFIED" and durable["mirrorMatches"],durable
            await page.reload()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            assert (await snapshot(page))["derivedRemainingRetention"]==122200

            # An unverified allowance (P37-19N) may never be collected.
            blocked=await op(page,"addReceipt",{
                **payment(100,"UNVERIFIED"),"receivableId":UNVERIFIED})
            assert not blocked["ok"],blocked
            assert (await snapshot(page))["receiptCount"]==0

            # Stage 1: 100k cash +10k customer deduction settles 110k principal.
            first_input=payment(100000,"PRINCIPAL-FIRST",10000,100)
            first=await op(page,"addReceipt",first_input)
            assert first["ok"],first
            s=await snapshot(page)
            assert s["received"]==110000 and s["bankIncome"]==99900,s
            assert s["receiptCount"]==1 and s["bankCount"]==1,s
            assert s["billingOutstanding"]==1050900,s
            assert s["commission"][0]["unlocked"] is False,s
            replay=await op(page,"addReceipt",first_input)
            assert replay["ok"] and (await snapshot(page))==s,replay

            # The ORIGINAL AR has 1,075,600 left but adjusted AR only
            # 1,050,900: the in-between amount MUST reject.
            exceeded=await op(page,"addReceipt",
                payment(1050901,"OVER-APPROVED"))
            assert not exceeded["ok"],exceeded
            assert (await snapshot(page))==s

            # Retention cap must use 122,200, not original 124,800.
            r=await op(page,"addRetentionReceipt",
               retention(120000,"RETENTION-FIRST",200))
            assert r["ok"],r
            t=await snapshot(page)
            assert t["retentionReceived"]==120000,t
            assert t["derivedRemainingRetention"]==2200,t
            assert t["billingRemainingRetention"]==2200,t
            assert t["bankIncome"]==99900+119800,t
            assert t["arOriginalRetention"]==124800 and t["billOriginalRetention"]==124800,t
            over_ret=await op(page,"addRetentionReceipt",
              retention(2201,"RETENTION-OVER"))
            assert not over_ret["ok"],over_ret
            assert (await snapshot(page))==t

            # Browser reload is crucial: loadState must recompute derived
            # retention from the approved amount, not original AR fields.
            await page.reload()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            restored=await snapshot(page)
            assert restored["derivedRemainingRetention"]==2200,restored
            assert restored["billingRemainingRetention"]==2200,restored
            assert restored["arOriginalRetention"]==124800,restored

            # Pending cheque reserves 40k face +2k customer deduction,
            # without a bank entry or commission release.
            ready=await op(page,"receivableChequeSnapshot",ALLOW)
            assert ready["ok"],ready
            ticket_input=ticket(ready["value"])
            registered=await op(page,"saveReceivableCheque",ALLOW,ticket_input)
            assert registered["ok"],registered
            cid=registered["value"]["id"]
            pending=await snapshot(page)
            assert pending["cheques"][0]["status"]=="pending" and pending["cheques"][0]["reserved"]==42000,pending
            assert pending["receiptCount"]==1 and pending["bankIncome"]==219700,pending
            cap=await op(page,"receivableChequeCapacity",ALLOW)
            assert cap["ok"] and cap["value"]["available"]==1008900,cap
            assert cap["value"]["outstanding"]==1050900

            # Force real Store quota failure *inside* a cheque clearance.
            clear={"date":DATE,"bankId":BANK,"fee":100,
               "feePayer":"company","note":"P37-19P cheque clear",
               "confirmed":True,"idempotencyKey":"P37-19-SYN-P-CH-CLEAR",
               "expectedSnapshot":(await op(page,"receivableChequeSnapshot",ALLOW))["value"]}
            latest=await snapshot(page)
            before_durable=await storage(page)
            failure=await js(page, """async ([receivable,cheque,values])=>{
               const original=navigator.storage.estimate;
               navigator.storage.estimate=async()=>({quota:1,usage:1});
               try{
                  try{await KuSheERPStore.clearReceivableCheque(receivable,cheque,values);
                      return {ok:true}}
                  catch(e){return {ok:false,code:String(e.code||''),
                     message:String(e.message||'')}}
               }finally{navigator.storage.estimate=original}
            }""",[ALLOW,cid,clear])
            assert not failure["ok"],failure
            assert await snapshot(page)==latest
            assert (await storage(page))["revision"]==before_durable["revision"]
            await page.reload()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            assert await snapshot(page)==latest

            # Original cheque-clearance writer is now using approved AR limit.
            clear["expectedSnapshot"]=(await op(page,"receivableChequeSnapshot",ALLOW))["value"]
            cleared=await op(page,"clearReceivableCheque",ALLOW,cid,clear)
            assert cleared["ok"],cleared
            ch=await snapshot(page)
            assert ch["received"]==152000,ch
            assert ch["billingOutstanding"]==1008900,ch
            assert ch["receiptCount"]==2 and ch["bankCount"]==3,ch
            assert ch["bankIncome"]==259600,ch
            assert ch["cheques"][0]["status"]=="cleared",ch
            assert ch["cheques"][0]["receiptId"] and ch["cheques"][0]["bankTransactionId"],ch
            duplicate=await op(page,"clearReceivableCheque",ALLOW,cid,clear)
            assert duplicate["ok"] and (await snapshot(page))==ch,duplicate

            # Collect exactly the remaining effective 1,008,900.
            finished=await op(page,"addReceipt",
                payment(1008900,"PRINCIPAL-FINAL"))
            assert finished["ok"],finished
            full=await snapshot(page)
            assert full["received"]==1160900,full
            assert full["billingOutstanding"]==0 and full["billingStatus"]=="已收",full
            assert full["commission"][0]["unlocked"] is True,full
            assert full["commission"][0]["received"]==1160900,full
            assert full["commission"][0]["receivable"]==1160900,full
            assert full["salaryPayments"]==0,full
            assert full["arOriginal"]==1185600 and full["billOriginal"]==1185600,full
            assert (await op(page,"addReceipt",payment(1,"NO-MORE")))["ok"] is False

            # Receive remaining 2,200 retention. Original retained data must
            # stay 124,800 for invoice history and legal evidence.
            last=await op(page,"addRetentionReceipt",
                retention(2200,"RETENTION-FINAL"))
            assert last["ok"],last
            closed=await snapshot(page)
            assert closed["retentionReceived"]==122200 and closed["derivedRemainingRetention"]==0,closed
            assert closed["billingRemainingRetention"]==0,closed
            assert closed["arOriginalRetention"]==closed["billOriginalRetention"]==124800,closed
            assert closed["originalInvoice"]==1310400 and closed["allowanceRecord"]==27300,closed
            assert closed["salaryPayments"]==0 and closed["allIdsSynthetic"],closed
            assert (await op(page,"addRetentionReceipt",
                retention(1,"RETENTION-NO-MORE")))["ok"] is False
            persisted=await storage(page)
            assert persisted["phase"]=="COMMIT_VERIFIED" and persisted["mirrorMatches"],persisted
            await page.reload()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            assert (await snapshot(page))==closed

            # Different/malformed linked allowance evidence must fail closed.
            for bad in ("bad-voucher","bad-money","duplicate-allowance","foreign-source"):
                separate=await browser.new_context()
                await separate.route("**/*",only_local)
                q=await separate.new_page()
                await q.goto(origin+"/?bad="+bad)
                failure=await js(q, """async ()=>{
                    try{await KuSheERPStore.load();return 'UNSAFE_LOAD_ACCEPTED'}
                    catch(e){return String(e?.message||e)}
                  }""")
                assert failure!="UNSAFE_LOAD_ACCEPTED",(bad,failure)
                # The test exception is never permitted to create bank or receipt money.
                await separate.close()

            assert not external,external
            await context.close()
            await browser.close()
            print("P37-19P lab-only patched copy of original ERP Store PASS")
            print("Approved synthetic effective AR 1,160,900 / retention 122,200,")
            print("original historical AR 1,185,600 / retention 124,800 unchanged.")
            print("Receipt, deduction, bank, retention, cheque, commission and")
            print("browser reload/recovery; malformed voucher fail closed.")
            print("No real ERP Store modification; no Supabase or production data.")
    finally:
        server.shutdown()
        server.server_close()
        tmp.cleanup()


if __name__=="__main__":
    asyncio.run(main())
