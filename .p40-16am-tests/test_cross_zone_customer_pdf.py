"""P40-16AM: published validated cross-zone customer view -> actual local A4 PDF.
No real accounts, customer records, Supabase, or production deployment.
The official validate/originalTemplateView functions are extracted verbatim
from current main and loaded into an isolated localhost test browser.
"""
import base64, functools, hashlib, http.server, json, re, threading
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
TEST=ROOT/".p40-16am-tests"
OUT=ROOT/".p40-16am-review"
OUT.mkdir(exist_ok=True)
for dep in (
    ROOT/".p40-16ah-tests/runtime-font.ttf",
    ROOT/".p40-16ah-tests/node_modules/pdf-lib/dist/pdf-lib.min.js",
    ROOT/".p40-16ah-tests/node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
):
    assert dep.is_file(),("missing temporary dependency",dep.name)
assert not (ROOT/".env").exists(),"STOP: secrets"
source=(ROOT/"assets/js/external-billing-print.js").read_text()
start_validate=source.index("  function validate(payload){")
end_validate=source.index("  // P31-4:",start_validate)
start_template=source.index("  function originalTemplateView(payload,d){")
end_template=source.index("  document.getElementById('close')",start_template)
assert 1400<end_validate-start_validate<9000
assert 900<end_template-start_template<6000
generated=(TEST/"runtime_official_extract.js")
generated.write_text(
    "(function(){ 'use strict';\n"+
    source[start_validate:end_validate]+"\n"+
    source[start_template:end_template]+"\n"+
    "window.P40AMOfficial={validate,originalTemplateView};\n})();",
    encoding="utf-8"
)
print("P40AM_OFFICIAL_SOURCE_EXTRACTED (verbatim; ephemeral and no ERP writes)")

def fixture(sizes=(4,4),mode="normal",repeat_groups=None):
    # IDs and public project names are entirely invented, not real customer
    # records. Source invoice numbers are planted ONLY as privacy sentinels.
    sourceSnapshots=[]
    settlements=[]
    all_lines=[]
    totals={k:0 for k in (
        "untaxed","tax","grossTotal","retention","receivable","received",
        "outstanding","retentionReceived","retentionOutstanding",
        "pendingCheque","availableToCollect"
    )}
    for idx,n in enumerate(sizes):
        billing_id=f"FAKE-B{idx+1:02d}"
        other_names=["虛構L區","虛構K區","虛構S區"]
        project="虛構M區" if idx==len(sizes)-1 else other_names[idx]
        invoice=("invoiced" if idx==0 else "invoice_pending")
        if mode=="no-invoice":invoice="no_invoice"
        lines=[]
        for k in range(n):
            identity=k+1 if repeat_groups is None else k%repeat_groups+1
            item=f"AM{identity:02d}-地坪門框局部修補"
            if mode=="long-item":
                item=f"AM{identity:02d}-浴室牆角與門檻防水層整理修復及油漆收邊整修，包含多處牆面"
            qty=1
            price=105 if mode=="inclusive" else 100
            if mode=="fractional" and idx==0 and k==0:
                qty,price=0.5,200
            line={"house":f"H{idx+1:02d}-{k+1:02d}","item":item,
                  "unit":"式","qty":qty,"price":price,
                  "amount":round(qty*price),
                  "invoiceNo":f"PRIVATE-INVOICE-{idx+1:02d}"}
            lines.append(line)
        all_lines.extend(lines)
        untaxed=n*100
        tax=0 if mode=="no-invoice" else n*5
        gross=untaxed+tax
        retention=10 if idx==0 else 0
        recv=gross-retention
        a={"untaxed":untaxed,"tax":tax,"grossTotal":gross,
           "retention":retention,"receivable":recv}
        rest={
            "received":0,"outstanding":recv,
            "retentionReceived":0,"retentionOutstanding":retention,
            "pendingCheque":0,"availableToCollect":recv}
        s={
            "billingId":billing_id,"receivableId":f"FAKE-AR-{idx+1}",
            "customerId":"FAKE-CUSTOMER-1",
            "number":f"SYNTH-{idx+1:03d}",
            "projectName":project,
            "date":f"2026-{8 if idx==0 else 10:02d}-12",
            "taxMode":"含稅" if mode=="inclusive" else "未稅",
            "invoiceStatus":invoice,
            "invoiceNo":f"PRIVATE-INVOICE-0{idx+1}" if invoice=="invoiced" else "",
            "invoiceDate":"2026-08-16" if invoice=="invoiced" else "",
            "anchors":a,"originalLines":lines
        }
        sourceSnapshots.append(s)
        settlements.append({"billingId":billing_id,**rest})
        for key,value in {**a,**rest}.items():totals[key]+=value
    taxMode="含稅" if mode=="inclusive" else "未稅"
    total=totals["grossTotal"] if mode=="inclusive" else totals["untaxed"]
    unified={
        "taxMode":taxMode,"lines":all_lines,"target":total,"total":total,
        "reason":"全虛構跨區合併重排，統一只顯示指定區，不調整原帳款"
    }
    d={
        "schema":"kushe-external-billing-group-v2",
        "status":"active","detailMode":"unified",
        "targetBillingId":sourceSnapshots[-1]["billingId"],
        "displayProjectName":"虛構M區","customerName":"虛構建商",
        "documentDate":"2026-11-18","note":"測試用施工備註，不得寄送建商",
        "sourceSnapshots":sourceSnapshots,
        "settlementSnapshots":settlements,
        "sourceIds":[s["billingId"] for s in sourceSnapshots],
        "unified":unified,"totals":totals
    }
    if mode=="long-note":d["note"]="虛構備註：施工位置與材料整理應依單據核對。"*18
    return {
        "schema":"kushe-external-billing-print-v1",
        "historical":False,
        "document":d,
        "template":{
            "schema":"kushe-original-billing-template-v1",
            "billingId":d["targetBillingId"],
            "historicalDetails":False,
            "company":{"name":"虛構測試公司","englishName":"SYNTHETIC ONLY",
                        "taxId":"00000000","address":"虛構地址"}
        }
    }

def pdf_check(raw,expected,case):
    doc=fitz.open(stream=raw,filetype="pdf")
    assert len(doc)==1,(case,"not exactly one page",len(doc))
    page=doc[0]
    assert 594.4<page.rect.width<596 and 841<page.rect.height<843,(case,page.rect)
    text=page.get_text(sort=True)
    condensed=re.sub(r"\s+","",text)
    for marker in (
        "虛構M區","跨區合併對外請款","原施工明細",
        "施工項目彙總","原施工明細合計","施工彙總合計",
        "保留款","應收","客戶簽章","模擬LOGO","模擬大小章"
    ):
        assert marker in condensed,(case,"missing printed field",marker)
    # Customer-facing output must never expose any other source area's name.
    for forbidden in (
        "虛構L區","虛構K區","虛構S區","PRIVATE-INVOICE",
        "原票號／狀態","sourceSnapshots","settlementSnapshots",
        "invoiceNo","PRIVATE-BANK","PRIVATE-SALARY","PRIVATE-TOKEN"
    ):
        assert forbidden not in text,(case,"private/source area exposed",forbidden)
    assert expected["targetOnly"]=="虛構M區"
    for detail in expected["original"]:
        assert detail["house"] in condensed,(case,"house lost",detail["house"])
        assert detail["item"] in condensed,(case,"original item lost",detail["item"])
    for group in expected["summary"]:
        assert group["item"] in condensed,(case,"summary item lost",group["item"])
    for key,val in expected["amounts"].items():
        assert f"{val:,}" in text,(case,"approved amount lost",key,val)
    assert expected["originalSourceCount"]>=2
    spans=[]
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines",[]):
            for span in line.get("spans",[]):
                if not span["text"].strip():continue
                spans.append(span)
                x0,y0,x1,y1=span["bbox"]
                assert x0>=-.6 and y0>=-.6 and x1<=page.rect.width+.6 and y1<=page.rect.height+.6,(
                    case,"text clipped outside page",span["text"],span["bbox"])
    assert spans and min(span["size"] for span in spans)>=8.0,(case,"font under 8 pt")
    rects=[r["rect"] for r in page.get_drawings() if r.get("rect") is not None]
    assert any(abs(r.width-51)<2 and abs(r.height-40)<2 for r in rects),(case,"mock logo missing")
    assert any(abs(r.width-154)<2 and abs(r.height-68)<2 for r in rects),(case,"mock seal missing")
    page.get_pixmap(matrix=fitz.Matrix(1.15,1.15),alpha=False).save(
        str(OUT/(case+".png")))
    doc.close()
    return {"pages":1,"font_min_pt":round(min(s["size"] for s in spans),2),
            "original_count":len(expected["original"]),
            "summary_count":len(expected["summary"]),
            "source_count":expected["originalSourceCount"],
            "sha256":hashlib.sha256(raw).hexdigest()}

cases=[
    ("two-zones-different-invoice-months",fixture((4,4)),True),
    ("three-source-areas",fixture((4,4,4)),True),
    ("18-original-lines",fixture((9,9)),True),
    ("30-lines-six-item-groups",fixture((15,15),repeat_groups=6),True),
    ("tax-inclusive",fixture((3,3),mode="inclusive"),True),
    ("decimal-quantity",fixture((3,3),mode="fractional"),True),
    ("all-no-invoice",fixture((3,3),mode="no-invoice"),True),
    ("long-40-lines",fixture((20,20)),False),
    ("overlong-note",fixture((4,4),mode="long-note"),False),
    ("overlong-item",fixture((15,15),mode="long-item"),False),
]
results=[]
srv=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT))
)
threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{srv.server_port}/"
try:
  with sync_playwright() as browser_runner:
    browser=browser_runner.chromium.launch(headless=True)
    for device,w,h,mobile in (("desktop",1280,900,False),("mobile-sim",390,844,True)):
      context=browser.new_context(
          viewport={"width":w,"height":h},is_mobile=mobile,has_touch=mobile
      )
      page=context.new_page()
      page.route("**/*",lambda route: route.continue_()
        if route.request.url.startswith(BASE) else route.abort())
      page.goto(BASE+".p40-16am-tests/index.html",wait_until="load")
      page.wait_for_function(
          "!!window.P40AMOfficial&&!!window.KusheExternalBillingInvoice&&!!window.P40AMPDF&&!!window.PDFLib&&!!window.fontkit"
      )
      for label,payload,allow in cases:
        case=device+"-"+label
        r=page.evaluate("""async p=>{
          const prev=JSON.stringify(p);
          try {
            const generated=await P40AMPDF.generate(p);
            if(JSON.stringify(p)!==prev)throw Error('INPUT_WAS_MUTATED');
            return {ok:true,...generated};
          } catch(e){return {ok:false,reason:e.code||String(e)};}
        }""",payload)
        if allow:
          assert r["ok"],(case,"expected PDF rejected",r)
          raw=base64.b64decode(r["base64"])
          check=pdf_check(raw,r["expected"],case)
          (OUT/(case+".pdf")).write_bytes(raw)
          report={"case":case,"result":"FIXTURE_PASS",**check}
        else:
          assert not r["ok"],(case,"unfit PDF was allowed")
          assert r["reason"] in (
              "ORIGINAL_DETAILS_EXCEED_CAPACITY",
              "ORIGINAL_ITEM_TOO_LONG",
              "SUMMARY_ITEM_TOO_LONG",
              "SUMMARY_OVERLAPS_FOOTER",
              "PUBLIC_NOTE_TOO_LONG",
              "ORIGINAL_DETAIL_COUNT_CHANGED_OR_EXCESSIVE"
          ),(case,"unexpected stop",r)
          assert not (OUT/(case+".pdf")).exists()
          report={"case":case,"result":"BLOCKED","reason":r["reason"]}
        results.append(report)
        print("P40AM_CASE "+json.dumps(report,ensure_ascii=False),flush=True)
      original=fixture((3,3))
      for attack in (
          "wrong-target-name","missing-target-billing-id","duplicate-billing-id",
          "tampered-amount","tampered-line","changed-original-no-reason",
          "archive-historical","private-public-note","wrong-template",
          "legacy-section-schema"
      ):
        verdict=page.evaluate("""({base,attack})=>{
          const p=JSON.parse(JSON.stringify(base)),d=p.document;
          if(attack==='wrong-target-name')d.displayProjectName='虛構不存在區';
          if(attack==='missing-target-billing-id')d.targetBillingId='FAKE-MISSING';
          if(attack==='duplicate-billing-id')d.sourceSnapshots[1].billingId=d.sourceSnapshots[0].billingId;
          if(attack==='tampered-amount')d.totals.grossTotal+=100;
          if(attack==='tampered-line')d.unified.lines[0].amount+=200;
          if(attack==='changed-original-no-reason'){
            d.unified.lines[0].item='未核准的更改';
            d.unified.reason='';
          }
          if(attack==='archive-historical'){d.status='archived';p.historical=true;}
          if(attack==='private-public-note')d.note='PRIVATE-INVOICE-01';
          if(attack==='wrong-template')p.template.billingId='UNRELATED';
          if(attack==='legacy-section-schema'){
            d.schema='kushe-external-billing-group-v1';
            d.detailMode='sections';
          }
          try{P40AM.normalizeCustomerOnly(p);return 'UNSAFE_ALLOWED';}
          catch(e){return e.code||String(e);}
        }""",{"base":original,"attack":attack})
        assert verdict!="UNSAFE_ALLOWED",(device,attack,"negative passed")
        print("P40AM_DENIED "+json.dumps({
            "device":device,"attack":attack,"reason":verdict
        },ensure_ascii=False),flush=True)
      context.close()
    browser.close()
finally:
  srv.shutdown()
  generated.unlink(missing_ok=True)

passed=[r for r in results if r["result"]=="FIXTURE_PASS"]
blocked=[r for r in results if r["result"]=="BLOCKED"]
assert len(passed)==sum(c[2] for c in cases)*2
assert len(blocked)==sum(not c[2] for c in cases)*2
assert len(list(OUT.glob("*.pdf")))==len(passed)
(OUT/"manifest.json").write_text(
    json.dumps({"synthetic_only":True,"release_ready":False,
                "cross_zone_customer_only":True,
                "historical_invoice_reference_not_tested_for_public_export":True,
                "results":results},ensure_ascii=False,indent=2))
print("P40AM_COMPLETE: official validation and customer-only cross-zone A4 PDF simulation verified.")
print("NO RELEASE: true real-device, auth, brand assets, historical business details and full financial reconciliation are untested.")
