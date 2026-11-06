"""P37-19R browser acceptance: original dashboard.js/reports.js with synthetic
read-only effective preview. Loopback only, genuine unmodified ERP Store,
fake tax voucher, and NO actual settlement or customer data.
"""
import asyncio
import shutil
import sys
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from server import start,verify_originals


async def js(page,expression,arg=None):
    return await page.evaluate(expression) if arg is None else await page.evaluate(expression,arg)


async def try_store(page,method,values):
    return await js(page, """async ([method,values])=>{
      try{return {ok:true,result:await window.KuSheERPStore[method](...values)}}
      catch(e){return {ok:false,code:String(e?.code||''),message:String(e?.message||e)}}
    }""", [method,values])


async def browser_state(page):
    return await js(page, """()=>{
       const s=window.KuSheERPStore.getState();
       const approved=s.receivables.find(r=>r.id==='P37-19-SYN-AR-APPROVED');
       return {revision:s.meta.businessSnapshotRevision?.id||'',
         originalAR:approved.amount,originalRetention:approved.retentionAmount,
         billOriginal:s.billings.find(b=>b.id===approved.billingId).total,
         bankBalance:s.banks[0].balance,bankIncome:s.banks[0].income,
         bankRows:s.bankTransactions.length,receipts:s.receipts.length,
         payrollPayments:s.salaryPayments.length,invoiceGross:s.invoices[0].grossAmount,
         creditNoteFake:s.billingAllowances[0].allowance.gross,
         billings:s.billings.length,receivables:s.receivables.length,
         dateOfOctober:s.billings.find(b=>b.id==='P37-19-SYN-BILL-CLEAN').date
       };
    }""")


async def preview(page,month="2026-11"):
    return await js(page, """(month)=>{
       const x=window.P37RReadOnlyPreview.preview(month);
       return {status:x.status,mode:x.mode,sourceRevision:x.sourceRevision,
         readOnly:x.readOnly,canPost:x.canPost,
         original:x.original,adjusted:x.adjusted,deductions:x.deductions,
         bank:x.dashboard.bank,cash:x.dashboard.cash,
         collected:x.dashboard.collected,payroll:x.dashboard.payrollTotal,
         reportProjects:x.dashboard.reportProjects.map(p=>({
           id:p.id,billed:p.billed,profit:p.profit,
           outstanding:p.outstanding,margin:p.margin
         })),
         structureTotal:x.dashboard.structureTotal,
         retentionAlert:x.dashboard.attentions.find(a=>a.type==='保留款待收')?.amount,
         commissionPreview:x.commissionPreview,
         drilldownsIntegrated:x.kpiDrilldownsIntegrated,
         trendIntegrated:x.dashboardTrendChartIntegrated,
         officialTaxVoucherVerified:x.officialTaxVoucherVerified,
         productionReady:x.productionReady
       };
    }""",month)


async def main():
    assert verify_originals()==4
    server,origin=start()
    external=[]
    errors=[]
    try:
        async with async_playwright() as playwright:
            browser=await playwright.chromium.launch(headless=True,
              executable_path=shutil.which("google-chrome") or
              shutil.which("chromium") or None)
            context=await browser.new_context(viewport={"width":1280,"height":820})
            async def allow_local(route):
                if not route.request.url.startswith(origin+"/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*",allow_local)
            page=await context.new_page()
            page.on("pageerror",lambda err:errors.append(str(err)))
            await page.goto(origin)
            assert "SYNTHETIC ERP HOME" in await page.title()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")

            # Local synthetic settings are committed ONLY to a disposable
            # 127.0.0.1 Chromium profile to obtain original Store revision.
            initial=await browser_state(page)
            assert initial["billings"]==initial["receivables"]==3
            assert initial["originalAR"]==1185600
            assert initial["originalRetention"]==124800
            assert initial["creditNoteFake"]==27300
            assert initial["invoiceGross"]==1310400
            assert initial["dateOfOctober"]=="2026-10-26"
            boot=await try_store(page,"saveSystemSettings",[{
              "company":"P37-19R SYNTHETIC ONLY",
              "taxId":"P37-19-SYN-TAX","owner":"P37-19-SYN-OWNER",
              "phone":"0","address":"127.0.0.1 synthetic dashboard","defaultTax":5
            }])
            assert boot["ok"],boot
            before=await browser_state(page)
            assert before["revision"] and before["bankRows"]==0
            assert before["payrollPayments"]==0

            baseline=await js(page, """()=>{
              const vm=KusheDashboard.readSnapshot('2026-11');
              return {revenue:vm.revenue,openAR:vm.outstandingAR,
                revenueOct:KusheDashboard.readSnapshot('2026-10').revenue,
                projectBilled:vm.reportProjects[0].billed,
                projectProfit:vm.reportProjects[0].profit,
                retention:vm.attentions.find(x=>x.type==='保留款待收')?.amount,
                bank:vm.bank,payroll:vm.payrollTotal
              };
            }""")
            assert baseline["revenue"]==1348000,baseline
            assert baseline["openAR"]==1332600,baseline
            assert baseline["revenueOct"]==50000,baseline
            assert baseline["retention"]==135300,baseline
            assert baseline["projectBilled"]==1398000,baseline

            x=await preview(page)
            assert x["readOnly"] and x["canPost"] is False,x
            assert x["original"]=={
                "revenue":1348000,"outstandingAR":1332600,
                "retentionOpen":135300
            },x
            assert x["adjusted"]=={
                "revenue":1322000,"outstandingAR":1307900,
                "retentionOpen":132700
            },x
            assert x["deductions"]=={
                "untaxed":26000,"currentReceivable":24700,
                "retention":2600
            },x
            assert x["retentionAlert"]==132700,x
            assert x["reportProjects"][0]["billed"]==1372000,x
            assert x["reportProjects"][0]["profit"]==baseline["projectProfit"]-26000,x
            assert x["reportProjects"][0]["outstanding"]==1307900,x
            assert x["bank"]==baseline["bank"]
            assert x["payroll"]==baseline["payroll"]
            assert x["collected"]==0 and x["cash"]==0,x
            assert x["sourceRevision"]==before["revision"]
            assert len(x["commissionPreview"])==2
            assert all(not r["realStorePayrollUnlocked"] and not r["paymentCreated"]
                       for r in x["commissionPreview"])
            assert x["officialTaxVoucherVerified"] is False
            assert x["productionReady"] is False
            assert x["trendIntegrated"] is False and x["drilldownsIntegrated"] is False

            oct=await preview(page,"2026-10")
            assert oct["original"]["revenue"]==oct["adjusted"]["revenue"]==50000
            assert oct["deductions"]["untaxed"]==0
            assert oct["adjusted"]["outstandingAR"]==1307900
            assert (await browser_state(page))==before

            # Original dashboard DOM render and original reports render use
            # the exact same adjusted read-only view in the lab controller.
            installed=await js(page,"()=>P37RReadOnlyPreview.install()")
            assert installed["installed"] and not installed["writerInstalled"]
            rendered=await js(page,"()=>P37RReadOnlyPreview.renderDashboard()")
            assert rendered["revenue"]==1322000,rendered
            assert rendered["outstandingAR"]==1307900,rendered
            assert rendered["outstandingRetention"]==132700,rendered
            dashboard_text=await js(page,"()=>document.querySelector('#kpiGrid').innerText")
            assert "1,322,000" in dashboard_text,dashboard_text
            assert "1,307,900" in dashboard_text,dashboard_text
            retention_text=await js(page,"()=>document.querySelector('#attentionList').innerText")
            assert "132,700" in retention_text,retention_text
            assert await js(page,"()=>KusheReports.activate().then(()=>true)")
            report_text=await js(page,"()=>document.querySelector('#reportsApp').innerText")
            for amount in ("1,322,000","1,307,900","1,372,000"):
                assert amount in report_text,(amount,report_text[:1800])
            assert await js(page,"()=>KusheDashboard.readSnapshot('2026-11').revenue")==1322000

            # The underlying ERP Store is unmodified. Read-only previews may
            # NOT lift its allowance-linked settlement safety block.
            rejected=await try_store(page,"addReceipt",[{
                "receivableId":"P37-19-SYN-AR-APPROVED",
                "date":"2026-11-06","cashAmount":5000,
                "deductions":[],"fee":0,"feePayer":"company",
                "bankId":"P37-19-SYN-BANK-1",
                "paymentMethod":"銀行轉帳","idempotencyKey":"P37-19-SYN-R-UNSAFE"
            }])
            assert not rejected["ok"] and "折讓" in rejected["message"],rejected
            after=await browser_state(page)
            assert after==before, (before,after)
            audited=await js(page,"()=>P37RReadOnlyPreview.audit()")
            assert audited["readOnly"] and audited["bankWrites"]==0
            assert audited["commissionsPaid"]==0 and audited["productionReady"] is False

            # Directly call R reader on corrupt copies: fail closed without
            # changing real Store or the original dashboard snapshot.
            negative=await js(page, """()=>{
              const original=KuSheERPStore.getState(),baseline=
                P37RReadOnlyPreview.preview('2026-11').dashboard;
              const api=window.KusheP3719RLabReader,reader=window.KusheP3719CFormalReader;
              const ledger=window.KusheP3718EffectiveLedger;
              const revision=original.meta.businessSnapshotRevision.id,mode=api.MODE;
              function failing(modify,config={}){
                const copy=structuredClone(original);modify(copy);
                const base={...baseline,data:copy};
                try{api.project(copy,base,ledger,reader,{
                  mode,labOnly:true,legalTaxVoucherVerified:false,
                  selectedMonth:'2026-11',expectedRevisionId:revision,...config
                });return 'UNSAFE_PREVIEW_ACCEPTED'}
                catch(err){return String(err.message||err)}
              }
              return {
                badVoucher:failing(x=>x.billingAllowances[0].voucher.verificationReference='WRONG'),
                invalidMoney:failing(x=>x.billingAllowances[0].effective.receivable=1160901),
                duplicatedVoucher:failing(x=>x.billingAllowances.push(
                  {...structuredClone(x.billingAllowances[0]),id:'P37-19-SYN-DUPLICATE'})),
                realId:failing(x=>x.billings[0].id='REAL_CUSTOMER_BILL'),
                stale:failing(()=>{},{expectedRevisionId:'P37-19-SYN-OLD'}),
                wrongMode:failing(()=>{},{mode:'FORMAL_WRITE'}),
                taxForgery:failing(()=>{},{legalTaxVoucherVerified:true})
              };
            }""")
            assert all("UNSAFE_PREVIEW_ACCEPTED" not in str(value)
                       for value in negative.values()),negative
            assert (await browser_state(page))==before

            # Re-open original Store in a new page and recompute preview from
            # durable IndexedDB, never from a separately mutable report cache.
            fresh=await context.new_page()
            fresh.on("pageerror",lambda err:errors.append(str(err)))
            await fresh.goto(origin)
            await js(fresh,"()=>KuSheERPStore.load()")
            new_preview=await preview(fresh)
            assert new_preview["adjusted"]==x["adjusted"],new_preview
            assert new_preview["sourceRevision"]==before["revision"],new_preview
            assert (await browser_state(fresh))==before
            assert not errors,errors
            assert not external,external
            await context.close()
            await browser.close()
            print("P37-19R ORIGINAL DASHBOARD & REPORTS READ-ONLY LAB PREVIEW PASS")
            print("Nov 2026: revenue 1,348,000 -> 1,322,000; open AR "
                  "1,332,600 -> 1,307,900; retention 135,300 -> 132,700.")
            print("Project billed and gross profit -26,000; October unchanged; "
                  "bank and salary unaffected.")
            print("Malformed voucher, duplicated/foreign source, stale version, "
                  "and actual ERP receipt writer fail closed.")
            print("No company data, real tax voucher, Supabase or production patch.")
    finally:
        server.shutdown()
        server.server_close()


if __name__=="__main__":
    asyncio.run(main())
