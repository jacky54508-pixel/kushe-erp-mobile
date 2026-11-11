"""P39-3C: isolated synthetic Store posting tests. No production cloud, no real documents."""
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8796/p39-candidate/posting-store-fixture.html"

def params(mode):
    has_invoice=mode=="invoiced"
    voucher={"synthetic": True,"issued": True,"testVerified": True,
             "type":"electronic","number":"SYN-ALL-0001","date":"2026-11-11"} if has_invoice else None
    evidence={"synthetic":True,"agreementRef":"SYN-AGREEMENT-0001",
              "reviewerRef":"SYN-OWNER-0001","reviewedAt":"2026-11-11"}
    if has_invoice:
        evidence["externalAllowance"]={
            "synthetic":True,"number":"SYN-ALL-0001","date":"2026-11-11",
            "type":"electronic","originalInvoiceNo":"SYN-INV-0001",
            "transport":"SIMULATED_ELECTRONIC_FLOW"}
    return {"approvedGross":90000 if mode=="no_invoice" else 94500,
            "reason":"虛構建商議價","evidence":evidence,
            **({"voucher":voucher} if voucher else {})}

def read(page):
    return page.evaluate("""() => JSON.parse(JSON.stringify(window.KuSheERPStore.getState()))""")

def open_page(context,mode="invoice_pending"):
    page=context.new_page()
    page.goto(URL+"?invoiceMode="+mode)
    page.wait_for_function("""() => !!window.KuSheERPStore &&
       !!window.KusheP393VoucherReview && !!window.KusheP393CandidateCore""")
    page.evaluate("async()=>{await window.KuSheERPStore.load()}")
    return page

def preview(page,values):
    return page.evaluate("""v => {
      const s=window.KuSheERPStore;
      return s.p39SyntheticAllowancePreflight('syn-b',v);
    }""",values)

def commit(page,values,stamp,extra=None):
    payload={**values,"confirmSyntheticFixture":True,
             "expectedDocumentSnapshot":stamp["documentSnapshot"],
             "expectedPlanSnapshot":stamp["planSnapshot"],
             "expectedStoreRevisionId":stamp["storeRevisionId"],
             "idempotencyKey":stamp["preview"]["idempotencyKey"],
             **(extra or {})}
    return page.evaluate("""async v => {
      try {
        const result=await window.KuSheERPStore.p39CommitSyntheticAllowance('syn-b',v);
        return {ok:true,result};
      }catch(err){
        return {ok:false,code:err.code||'',message:err.message||String(err),
                status:err.transactionStatus||'',rollback:err.rollbackVerified===true};
      }
    }""",payload)

def run_one(browser,mode):
    ctx=browser.new_context()
    requests=[]
    page=open_page(ctx,mode)
    page.on("request",lambda r:requests.append(r.url) if not r.url.startswith("http://127.0.0.1:8796/") else None)
    values=params(mode)
    original=read(page)
    pre=preview(page,values)
    assert pre["syntheticOnly"] is True and pre["productionPostingAllowed"] is False
    assert pre["evidence"]["productionPostingAllowed"] is False
    assert original==read(page),"preview must be truly read-only"
    tampered=commit(page,values,pre,{"expectedPlanSnapshot":"STALE"})
    assert not tampered["ok"] and tampered["code"]=="P39_ALLOWANCE_STALE_VERSION",tampered
    assert original==read(page),"stale operation modified state"

    failed=commit(page,values,pre,{"syntheticFailBeforeCommit":True})
    assert not failed["ok"] and failed["code"]=="P39_SYNTHETIC_INJECTED_FAILURE",failed
    assert original==read(page),"precommit injected failure must rollback without mutation"
    result=commit(page,values,pre)
    assert result["ok"],result
    assert result["result"]["status"]=="SYNTHETIC_ONLY",result
    after=read(page)
    assert len(after["billingAllowances"])==1
    assert after["billingAllowances"][0]["productionAuthorized"] is False
    assert after["billingAllowances"][0]["officialVoucherVerified"] is False
    assert after["billingAllowances"][0]["evidenceReview"]["externallyVerified"] is False
    assert after["meta"]["revision"]==2
    for key in ("billings","receivables","invoices","bankTransactions","banks",
                "receipts","retentionReceipts","commissions","payroll","salaryPayments",
                "dailyLogs","attendance","projectCosts"):
        assert after[key]==original[key],f"protected accounting collection changed: {key}"
    view=page.evaluate("""()=>{
      const s=window.KuSheERPStore;
      return {
        view:s.p39ReceivableEffectiveAmounts('syn-ar'),
        bank:s.getState().bankTransactions.length,
        allowance:s.p39BillingAllowanceSummary()
      };
    }""")
    assert view["bank"]==0
    assert view["allowance"]["count"]==1
    assert view["view"]["hasAllowance"] is True
    assert view["view"]["receivable"] == (85500 if mode=="no_invoice" else 90000)
    assert view["view"]["retention"] == 4500
    repeated=commit(page,values,pre)
    assert not repeated["ok"],repeated
    assert len(read(page)["billingAllowances"])==1
    assert not requests,requests
    ctx.close()
    return {"case":mode,"syntheticPosting":True,"rollback":True,"originalsUntouched":True,
            "noDuplicate":True,"noExternalRequests":True}

def concurrent(browser):
    ctx=browser.new_context()
    first=open_page(ctx)
    second=open_page(ctx)
    values=params("invoice_pending")
    pre_a=preview(first,values)
    pre_b=preview(second,values)
    assert pre_a["planSnapshot"]==pre_b["planSnapshot"]
    passed=commit(first,values,pre_a)
    assert passed["ok"],passed
    stale=commit(second,values,pre_b)
    assert not stale["ok"],stale
    assert len(read(first)["billingAllowances"])==1
    assert len(read(second)["billingAllowances"])==0
    ctx.close()
    return {"case":"two-tab-stale","firstCommitted":True,"staleRejected":True}

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        results=[run_one(browser,mode) for mode in ("invoice_pending","invoiced","no_invoice")]
        results.append(concurrent(browser))
        browser.close()
        print("P39-3C SYNTHETIC STORE POSTING PASS:",results)

if __name__=="__main__":
    main()
