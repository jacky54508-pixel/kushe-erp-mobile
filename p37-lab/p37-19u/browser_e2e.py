"""P37-19U: genuine Chromium acceptance of the stand-alone P37-19T candidate
against the original Store, Dashboard, Reports and P21 KPI engine.
All sources fake in disposable localhost. No legal voucher or real login.
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
from lab_presentation_overlay import generate


async def js(page,script,arg=None):
    return await page.evaluate(script) if arg is None else await page.evaluate(script,arg)


async def store_snapshot(page):
    return await js(page, """()=>{
      const s=KuSheERPStore.getState();
      const ar=s.receivables.find(r=>r.id==='P37-19-SYN-AR-APPROVED');
      return {revision:s.meta.businessSnapshotRevision?.id||'',
        billings:s.billings.length,receivables:s.receivables.length,
        receipts:s.receipts.length,retentionReceipts:s.retentionReceipts.length,
        bankRows:s.bankTransactions.length,bankBalance:s.banks[0].balance,
        salaryPayments:s.salaryPayments.length,
        originalAR:ar.amount,originalRetention:ar.retentionAmount,
        originalInvoice:s.invoices[0].grossAmount,
        fakeCredit:s.billingAllowances[0].allowance.gross};
    }""")


async def page_candidate(page,month="2026-11"):
    return await js(page, """(month)=>{
      const r=P37UReviewAdapter.view(month),c=r.chart(12,month),
        ar=r.details('ar'),ret=r.details('retention');
      return {sourceRevision:r.sourceRevision,mode:r.mode,status:r.status,
        readOnly:r.readOnly,mayMountProduction:r.mayMountProduction,
        releaseGate:r.releaseGate,canPost:r.canPost,
        bankWrites:r.bankEntriesAdded,cloudWrites:r.cloudWrites,
        officialVoucherVerified:r.officialVoucherVerified,
        serverSignatureVerified:r.authorization.serverSignatureVerified,
        original:r.original,adjusted:r.adjusted,reductions:r.reductions,
        chart:c.map(x=>({key:x.key,value:x.value})),
        arDetailTotal:ar.total,retentionDetailTotal:ret.total,
        projectBilled:r.dashboard.reportProjects[0].billed,
        projectProfit:r.dashboard.reportProjects[0].profit,
        commissions:r.commissionReview.map(x=>({id:x.id,
          formalPayrollReleased:x.formalPayrollReleased}))};
    }""",month)


async def source_admission_tests(page):
    return await js(page, """()=>{
      const S=KuSheERPStore.getState(),reader=KusheP3719TReadOnlyCandidate;
      const original=KusheDashboard.readSnapshot('2026-11');
      const fake=()=>({user:()=>({id:'P37-19-SYN-OWNER'}),
        companyContext:()=>({companyId:'P37-19-SYN-COMPANY',
          userId:'P37-19-SYN-OWNER',legacySourceUserId:'P37-19-SYN-OWNER'}),
        canWrite:x=>x==='billings'});
      const make=(data,b,opts={})=>({
        mode:reader.MODE,officialVoucherIndependentlyVerified:false,
        allowFinancialWrites:false,auth:fake(),state:data,
        originalDashboard:{...b,data},month:'2026-11',
        expectedRevisionId:data.meta.businessSnapshotRevision.id,
        effectiveLedger:KusheP3718EffectiveLedger,
        formalReadOnlyLedger:KusheP3719CFormalReader,...opts
      });
      const cases={
        orphanHistoricalBill:s=>s.billings.push({
          ...s.billings[1],id:'P37-19-SYN-HISTORIC-ORPHAN',
          number:'P37-19-SYN-HISTORIC-ORPHAN-NO',
          receivableId:'P37-19-SYN-MISSING-AR',
          sourceType:'legacy-ar-invoice-rebuild'
        }),
        orphanHistoricalAR:s=>s.receivables.push({
          ...s.receivables[1],id:'P37-19-SYN-ORPHAN-AR',
          billingId:'P37-19-SYN-NO-HIST-BILL',sourceNo:'P37-19-SYN-NO-BILL'
        }),
        duplicateBill:s=>s.billings.push({...s.billings[1]}),
        duplicateAR:s=>s.receivables.push({
          ...s.receivables[1],id:'P37-19-SYN-DUPLICATE-AR'
        }),
        brokenLegacySourceNo:s=>s.receivables[1].sourceNo='P37-19-SYN-WRONG-SOURCE',
        missingInvoicedSource:s=>s.invoices=[],
        duplicateVoucher:s=>s.billingAllowances.push({
          ...s.billingAllowances[0],id:'P37-19-SYN-SECOND-VOUCHER'
        }),
        wrongDiscountTax:s=>s.billingAllowances[0].allowance.tax+=1
      };
      const results={};
      for(const [name,fn] of Object.entries(cases)){
        const data=structuredClone(S);fn(data);
        try{
          reader.project(make(data,original));
          results[name]='UNSAFE_ACCEPTED';
        }catch(e){results[name]=String(e.message||e)}
      }
      for(const [name,options] of Object.entries({
        invalidOwner:{auth:{...fake(),user:()=>({id:'ANOTHER-OWNER'})}},
        noPermission:{auth:{...fake(),canWrite:()=>false}},
        staleRevision:{expectedRevisionId:'P37-19-SYN-STALE'},
        fakeOfficialTax:{officialVoucherIndependentlyVerified:true},
        writerEnabled:{allowFinancialWrites:true}
      })){
        try{reader.project(make(S,original,options));results[name]='UNSAFE_ACCEPTED'}
        catch(e){results[name]=String(e.message||e)}
      }
      return results;
    }""")


async def main():
    dash,reports=generate()
    assert len(dash)>37001 and len(reports)>9466
    server,origin,temp=start()
    external=[]
    errors=[]
    try:
        async with async_playwright() as playwright:
            browser=await playwright.chromium.launch(headless=True,
              executable_path=shutil.which("google-chrome") or
              shutil.which("chromium") or None)
            context=await browser.new_context(viewport={"width":1280,"height":900})
            async def local_only(route):
                if not route.request.url.startswith(origin+"/"):
                    external.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*",local_only)
            page=await context.new_page()
            page.on("pageerror",lambda e:errors.append(str(e)))
            await page.goto(origin)
            assert "READ ONLY CANDIDATE" in await page.title()
            assert await js(page,"()=>KuSheERPStore.load().then(()=>true)")
            first=await store_snapshot(page)
            assert first["billings"]==first["receivables"]==3
            assert first["originalAR"]==1185600
            assert first["originalRetention"]==124800
            assert first["originalInvoice"]==1310400
            assert first["fakeCredit"]==27300
            assert first["receipts"]==first["bankRows"]==0

            saved=await js(page, """async()=>{
              try{return {ok:true,result:await KuSheERPStore.saveSystemSettings({
                company:'P37-19R SYNTHETIC ONLY',taxId:'P37-19-SYN-TAX',
                owner:'P37-19-SYN-OWNER',phone:'0',
                address:'P37-19U LOCALHOST REVIEW',defaultTax:5})}}
              catch(e){return {ok:false,error:String(e.message||e)}}
            }""")
            assert saved["ok"],saved
            before=await store_snapshot(page)
            assert before["revision"] and before["bankRows"]==0

            # Fail-closed source admission is checked by the REAL T module,
            # not simulated in a separate test-only reader.
            rejected=await source_admission_tests(page)
            assert len(rejected)==13,rejected
            assert all(v!="UNSAFE_ACCEPTED" and "P37" in v
                       for v in rejected.values()),rejected
            assert "BILLING_AR_RELATION_NOT_UNIQUE" in rejected["orphanHistoricalBill"],rejected
            assert "UNMATCHED_RECEIVABLES" in rejected["orphanHistoricalAR"],rejected
            assert "DUPLICATE_BILL_ID_OR_NUMBER" in rejected["duplicateBill"],rejected
            assert "BILLING_AR_RELATION_NOT_UNIQUE" in rejected["duplicateAR"],rejected
            assert (await store_snapshot(page))==before

            # This isn't real login proof: fake authorization can only
            # feed a disabled read-only candidate on localhost.
            ui=await js(page,"()=>P37UReviewAdapter.install()")
            assert ui["installed"] and not ui["canPost"]
            assert ui["realSignedSession"] is False
            report=await page_candidate(page)
            assert report["readOnly"] and report["canPost"] is False
            assert report["releaseGate"]=="NO_GO"
            assert report["mayMountProduction"] is False
            assert report["serverSignatureVerified"] is False
            assert report["officialVoucherVerified"] is False
            assert report["sourceRevision"]==before["revision"]
            assert report["original"]=={
              "revenue":1348000,"outstandingAR":1332600,"retentionOpen":135300},report
            assert report["adjusted"]=={
              "revenue":1322000,"outstandingAR":1307900,"retentionOpen":132700},report
            assert report["reductions"]=={
              "untaxed":26000,"receivable":24700,"retention":2600},report
            assert report["projectBilled"]==1372000,report
            assert report["arDetailTotal"]==1307900
            assert report["retentionDetailTotal"]==132700
            assert report["chart"][-1]["value"]==1322000
            assert report["chart"][-2]["value"]==50000
            assert all(not c["formalPayrollReleased"] for c in report["commissions"])

            # Unmodified original Store is the sole data source; the temporary
            # UI copies only consume T.project output.
            await js(page,"()=>KusheDashboard.init()")
            dom=await page.locator("#kpiGrid").inner_text()
            assert "1,322,000" in dom and "1,307,900" in dom,dom
            retention=await page.locator("#attentionList").inner_text()
            assert "132,700" in retention,retention
            chart=await js(page,"()=>P37UReviewAdapter.observation().lastChart")
            assert chart and chart["range"]==12
            assert chart["points"][-1]["value"]==1322000
            canvas=await js(page, """()=>{
              const c=document.getElementById('trendChart'),bytes=c.getContext('2d')
                .getImageData(0,0,c.width,c.height).data;
              let pixels=0;
              for(let i=3;i<bytes.length;i+=4)if(bytes[i]>0)pixels++;
              return {w:c.width,h:c.height,pixels}
            }""")
            assert canvas["w"]>0 and canvas["h"]>0 and canvas["pixels"]>0,canvas

            await page.locator("#trendRange [data-range='4']").click()
            quarter=await js(page,"()=>P37UReviewAdapter.observation().lastChart")
            assert quarter["points"][-1]["value"]==1372000,quarter
            await page.locator("#trendRange [data-range='3']").click()
            annual=await js(page,"()=>P37UReviewAdapter.observation().lastChart")
            assert annual["points"][-1]["value"]==1372000,annual
            await page.locator("#trendRange [data-range='12']").click()
            assert (await js(page,"()=>P37UReviewAdapter.observation().lastChart"))["points"][-1]["value"]==1322000

            # Read the actual P21 drilldown registry rather than a mock UI.
            rev=await js(page,"()=>KusheKpi.model('u-preview.revenue')")
            ar=await js(page,"()=>KusheKpi.model('u-preview.ar')")
            ret=await js(page,"()=>KusheKpi.model('u-preview.retention')")
            assert len(rev["rows"])==2 and len(ar["rows"])==len(ret["rows"])==3
            def sum_col(model):
                return sum(int(row["cells"][-1].replace("$","").replace(",",""))
                           for row in model["rows"])
            assert sum_col(rev)==1322000
            assert sum_col(ar)==1307900
            assert sum_col(ret)==132700
            button=page.locator("#kpiGrid button[data-kpi='u-preview.revenue']")
            assert await button.count()==1
            await button.focus()
            await button.press("Enter")
            dialog=page.locator("dialog#kushe-kpi-detail[open]")
            assert await dialog.count()==1
            assert await dialog.get_attribute("data-kpi-detail")=="u-preview.revenue"
            assert "1,222,000" in await dialog.inner_text()
            await js(page,"()=>KusheKpi.close()")
            attention=page.locator("#attentionList button[data-kpi='u-preview.retention']")
            assert await attention.count()==1
            await attention.focus()
            await attention.press("Enter")
            dialog=page.locator("dialog#kushe-kpi-detail[open]")
            assert await dialog.count()==1
            assert "122,200" in await dialog.inner_text()
            await js(page,"()=>KusheKpi.close()")

            # Original reports renderer still uses shared dashboard snapshot,
            # while only its TEMPORARY detail functions route to T.
            assert await js(page,"()=>KusheReports.activate().then(()=>true)")
            text=await page.locator("#reportsApp").inner_text()
            for value in ("1,322,000","1,307,900","1,372,000"):
                assert value in text,(value,text[:1200])
            report_rev=await js(page,"()=>KusheKpi.model('reports.revenue')")
            report_ar=await js(page,"()=>KusheKpi.model('reports.ar')")
            assert sum_col(report_rev)==1322000
            assert sum_col(report_ar)==1307900
            await page.locator("#reportsMonth").fill("2026-10")
            await page.locator("#reportsMonth").dispatch_event("change")
            october=await js(page,"()=>KusheKpi.model('reports.revenue')")
            assert sum_col(october)==50000 and len(october["rows"])==1
            await page.locator("#reportsMonth").fill("2026-11")
            await page.locator("#reportsMonth").dispatch_event("change")
            assert sum_col(await js(page,"()=>KusheKpi.model('reports.revenue')"))==1322000

            # Actual Store remains unchanged and still protects allowance
            # from an unauthorized real Store receipt post.
            blocked=await js(page, """async()=>{
             try{await KuSheERPStore.addReceipt({
               receivableId:'P37-19-SYN-AR-APPROVED',date:'2026-11-06',
               cashAmount:5000,fee:0,feePayer:'company',
               bankId:'P37-19-SYN-BANK-1',paymentMethod:'銀行轉帳',
               idempotencyKey:'P37-19-SYN-U-NO-POST'});
               return 'UNSAFE_WRITER_ACCEPTED';
             }catch(e){return String(e.message||e)}
            }""")
            assert blocked!="UNSAFE_WRITER_ACCEPTED" and "折讓" in blocked,blocked
            assert (await store_snapshot(page))==before

            # Reload from IndexedDB: re-run same T projection independently.
            await page.reload()
            await js(page,"()=>KuSheERPStore.load()")
            assert (await store_snapshot(page))==before
            assert (await js(page,"()=>P37UReviewAdapter.install()"))["installed"]
            await js(page,"()=>KusheDashboard.init()")
            again=await page_candidate(page)
            assert again["adjusted"]==report["adjusted"]
            assert again["sourceRevision"]==before["revision"]
            assert not external,external
            assert not errors,errors
            await context.close()
            await browser.close()
            print("P37-19U ORIGINAL STORE + STANDALONE T + DASHBOARD/REPORTS/P21 BROWSER PASS")
            print("Nov revenue 1,322,000; AR 1,307,900; retention 132,700")
            print("Orphan/duplicate legacy source and stale/revoked permission fail closed")
            print("No real Auth, legal voucher, company bank, live cloud or formal ERP write")
    finally:
        server.shutdown()
        server.server_close()
        temp.cleanup()


if __name__=="__main__":
    asyncio.run(main())
