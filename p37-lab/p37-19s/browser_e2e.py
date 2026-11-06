"""P37-19S real Chromium: original P21 KPI drawer and original dashboard
trend canvas (strict lab copies), using a single synthetic approved ledger.
No ERP account, remote source, official voucher or financial write.
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
from lab_ui_overlay import build


async def js(page,expression,arg=None):
    return await page.evaluate(expression) if arg is None else await page.evaluate(expression,arg)


def numbers(model,column):
    def amount(row):
        return int(str(row["cells"][column]).replace("$","").replace(",",""))
    return sum(amount(row) for row in model["rows"])


async def store_view(page):
    return await js(page, """()=>{
       const s=window.KuSheERPStore.getState(),
        ar=s.receivables.find(x=>x.id==='P37-19-SYN-AR-APPROVED'),
        bill=s.billings.find(x=>x.id==='P37-19-SYN-BILL-APPROVED');
       return {revision:s.meta?.businessSnapshotRevision?.id||'',
        bankRows:s.bankTransactions.length,bankBalance:s.banks[0].balance,
        salaryPayments:s.salaryPayments.length,receipts:s.receipts.length,
        invoiceGross:s.invoices[0].grossAmount,
        adjustedFakeVoucher:s.billingAllowances[0].allowance.gross,
        originalAR:ar.amount,originalRetention:ar.retentionAmount,
        originalBillGross:bill.grossTotal,
        originalBillRetention:bill.retentionAmount,
        billings:s.billings.length,arCount:s.receivables.length};
    }""")


async def model(page,key):
    return await js(page,"key=>window.KusheKpi.model(key)",key)


async def close_drawer(page):
    await js(page,"()=>window.KusheKpi.close()")
    assert await page.locator("dialog#kushe-kpi-detail[open]").count()==0


async def main():
    dashboard_src,reports_src=build()
    assert len(dashboard_src)>37001 and len(reports_src)>9400
    server,origin,temporary=start()
    unexpected=[]
    exceptions=[]
    try:
        async with async_playwright() as playwright:
            browser=await playwright.chromium.launch(headless=True,
              executable_path=shutil.which("google-chrome") or
              shutil.which("chromium") or None)
            context=await browser.new_context(viewport={"width":1280,"height":900})

            async def local_only(route):
                if not route.request.url.startswith(origin+"/"):
                    unexpected.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()

            await context.route("**/*",local_only)
            page=await context.new_page()
            page.on("pageerror",lambda e:exceptions.append(str(e)))
            await page.goto(origin)
            assert "ORIGINAL CHART AND KPI DRAWER" in await page.title()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            init=await store_view(page)
            assert init["billings"]==init["arCount"]==3
            assert init["originalAR"]==1185600 and init["originalRetention"]==124800
            assert init["originalBillGross"]==1310400
            assert init["invoiceGross"]==1310400
            assert init["adjustedFakeVoucher"]==27300
            boot=await js(page, """async ()=>{
              try{return {ok:true,result:await KuSheERPStore.saveSystemSettings({
               company:'P37-19R SYNTHETIC ONLY',taxId:'P37-19-SYN-ONLY',
               owner:'P37-19-SYN-OWNER',phone:'0',address:'127.0.0.1',
               defaultTax:5})}}catch(e){return {ok:false,message:String(e.message)}}
            }""")
            assert boot["ok"],boot
            before=await store_view(page)
            assert before["revision"] and before["bankRows"]==0
            assert before["salaryPayments"]==0 and before["receipts"]==0

            installed=await js(page,"()=>P37SReadOnlyDrilldown.install()")
            assert installed["installed"] and not installed["canPost"]
            assert await js(page,"()=>KusheDashboard.init()") is None
            display=await js(page, """()=>{
              const x=KusheDashboard.getState();
              return {revenue:x.revenue,ar:x.outstandingAR,
               retention:x.attentions.find(a=>a.type==='保留款待收')?.amount,
               sourceRevision:KuSheERPStore.getState().meta.businessSnapshotRevision.id};
            }""")
            assert display["revenue"]==1322000,display
            assert display["ar"]==1307900 and display["retention"]==132700,display
            assert display["sourceRevision"]==before["revision"]
            dom=await page.locator("#kpiGrid").inner_text()
            assert "1,322,000" in dom and "1,307,900" in dom,dom

            # The actual original dashboard renderChart must consume the
            # approved source, not the old untaxed billing data.
            original_chart=await js(page,"()=>P37SReadOnlyDrilldown.observation()")
            assert original_chart["chartCalls"]>=1,original_chart
            chart=original_chart["lastChart"]
            assert chart["range"]==12 and chart["selectedMonth"]=="2026-11",chart
            chart_data={x["key"]:x["value"] for x in chart["points"]}
            assert chart_data["2026-10"]==50000 and chart_data["2026-11"]==1322000,chart
            assert sum(chart_data.values())==1372000,chart
            canvas=await js(page, """()=>{
              const c=document.getElementById('trendChart');
              const ctx=c.getContext('2d'),data=ctx.getImageData(0,0,
                Math.max(1,c.width),Math.max(1,c.height)).data;
              let nonzero=0;
              for(let i=3;i<data.length;i+=4)if(data[i])nonzero++;
              return {width:c.width,height:c.height,nonzero};
            }""")
            assert canvas["width"]>50 and canvas["height"]>50,canvas
            assert canvas["nonzero"]>0,canvas

            await page.locator("#trendRange [data-range='4']").click()
            quarter=await js(page,"()=>P37SReadOnlyDrilldown.observation().lastChart")
            assert quarter["range"]==4 and quarter["points"][-1]["key"]=="2026 Q4",quarter
            assert quarter["points"][-1]["value"]==1372000,quarter
            await page.locator("#trendRange [data-range='3']").click()
            years=await js(page,"()=>P37SReadOnlyDrilldown.observation().lastChart")
            assert years["range"]==3
            assert years["points"][-1]["key"]=="2026"
            assert years["points"][-1]["value"]==1372000
            await page.locator("#trendRange [data-range='12']").click()
            again=await js(page,"()=>P37SReadOnlyDrilldown.observation().lastChart")
            assert again["points"][-1]["value"]==1322000

            # Use the genuine P21 registered model and its real DOM drawer:
            # every displayed numeric detail must match its top-level KPI.
            rev=await model(page,"preview.revenue")
            ar=await model(page,"preview.ar")
            retention=await model(page,"preview.retention")
            assert len(rev["rows"])==2 and numbers(rev,4)==1322000,rev
            assert len(ar["rows"])==3 and numbers(ar,4)==1307900,ar
            assert len(retention["rows"])==3 and numbers(retention,4)==132700,retention
            assert numbers(rev,3)==26000 and numbers(rev,2)==1348000
            assert rev["readOnly"] and not rev["canPost"],rev
            assert retention["syntheticTotal"]==132700

            revenue_button=page.locator("#kpiGrid button[data-kpi='preview.revenue']")
            assert await revenue_button.count()==1
            await revenue_button.focus()
            await revenue_button.press("Enter")
            drawer=page.locator("dialog#kushe-kpi-detail[open]")
            assert await drawer.count()==1
            assert await drawer.get_attribute("data-kpi-detail")=="preview.revenue"
            assert await drawer.get_attribute("data-row-count")=="2"
            drawer_text=await drawer.inner_text()
            assert "1,222,000" in drawer_text and "100,000" in drawer_text
            assert "26,000" in drawer_text
            await close_drawer(page)

            retain_button=page.locator("#attentionList button[data-kpi='preview.retention']")
            assert await retain_button.count()==1
            await retain_button.focus()
            await retain_button.press("Enter")
            drawer=page.locator("dialog#kushe-kpi-detail[open]")
            assert await drawer.count()==1
            assert await drawer.get_attribute("data-kpi-detail")=="preview.retention"
            assert "122,200" in await drawer.inner_text()
            await close_drawer(page)

            # The original Reports rendering and the original P21 engine
            # share the same source with Dashboard, not stale raw billings.
            assert await js(page,"()=>KusheReports.activate().then(()=>true)")
            report_text=await page.locator("#reportsApp").inner_text()
            for number in ("1,322,000","1,307,900","1,372,000"):
                assert number in report_text,(number,report_text[:1600])
            report_revenue=await model(page,"reports.revenue")
            report_ar=await model(page,"reports.ar")
            assert numbers(report_revenue,4)==1322000
            assert numbers(report_ar,4)==1307900
            assert len(report_revenue["rows"])==2
            assert report_revenue["syntheticTotal"]==rev["syntheticTotal"]
            await page.locator("#reportsApp [data-kpi='reports.revenue']").click()
            drawer=page.locator("dialog#kushe-kpi-detail[open]")
            assert await drawer.count()==1
            assert await drawer.get_attribute("data-kpi-detail")=="reports.revenue"
            assert "1,222,000" in await drawer.inner_text()
            await close_drawer(page)

            # Month selection is real original Reports onchange flow;
            # October source must stay 50,000 and have zero discount.
            await page.locator("#reportsMonth").fill("2026-10")
            await page.locator("#reportsMonth").dispatch_event("change")
            october=await model(page,"reports.revenue")
            assert len(october["rows"])==1
            assert numbers(october,4)==50000
            assert numbers(october,3)==0
            assert "50,000" in await page.locator("#reportsApp").inner_text()
            await page.locator("#reportsMonth").fill("2026-11")
            await page.locator("#reportsMonth").dispatch_event("change")
            assert numbers(await model(page,"reports.revenue"),4)==1322000

            # Unexpected KPI path fails closed and cannot change the original
            # Store; no synthetic allowance approval can authorize money.
            error=await js(page, """()=>{
              try{P37SReadOnlyDrilldown.details('payroll','2026-11');
                  return 'UNSAFE_ALLOWED'}
              catch(e){return String(e.message)}
            }""")
            assert error!="UNSAFE_ALLOWED" and "UNREGISTERED" in error,error
            denied=await js(page, """async()=>{
              try{await KuSheERPStore.addReceipt({
                receivableId:'P37-19-SYN-AR-APPROVED',date:'2026-11-06',
                cashAmount:1,fee:0,feePayer:'company',
                bankId:'P37-19-SYN-BANK-1',
                idempotencyKey:'P37-19-SYN-S-UNAUTHORIZED'
              });return 'UNSAFE_MONEY_POST'}
              catch(e){return String(e.message)}
            }""")
            assert denied!="UNSAFE_MONEY_POST" and "折讓" in denied,denied
            after=await store_view(page)
            assert after==before,(before,after)
            observed=await js(page,"()=>P37SReadOnlyDrilldown.observation()")
            assert observed["lastChart"]["range"]==12
            assert observed["chartCalls"]>=4
            assert observed["detailCalls"]>=7
            assert observed["productionReady"] is False
            assert observed["realFinancialWriterEnabled"] is False
            assert not unexpected,unexpected
            assert not exceptions,exceptions

            # Browser reload uses durable, unmodified original Store, rather
            # than trusting a detached presentation cache.
            await page.reload()
            await js(page,"()=>KuSheERPStore.load()")
            assert await store_view(page)==before
            assert (await js(page,"()=>P37SReadOnlyDrilldown.install()"))["installed"]
            await js(page,"()=>KusheDashboard.init()")
            assert (await js(page,"()=>KusheDashboard.getState().revenue"))==1322000
            assert numbers(await model(page,"preview.revenue"),4)==1322000
            assert not exceptions,exceptions
            await context.close()
            await browser.close()
            print("P37-19S REAL P21 KPI DRAWER + CANVAS TREND + ORIGINAL REPORTS PASS")
            print("Nov adjusted revenue 1,322,000; Oct 50,000; 2026Q4 and year 1,372,000.")
            print("Open AR 1,307,900 and retention 132,700 match detailed sources.")
            print("No official invoice, cloud request, payment, or financial Store write.")
    finally:
        server.shutdown()
        server.server_close()
        temporary.cleanup()


if __name__=="__main__":
    asyncio.run(main())
