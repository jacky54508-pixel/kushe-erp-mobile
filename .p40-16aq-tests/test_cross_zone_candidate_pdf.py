"""P40-16AQ candidate acceptance: REAL PDF bytes from the actual official
cross-zone route -> changed billing-print.html, compared to pinned main.

The test renders fictional cross-zone customer bills and independent negative
print modes in Chromium. Only 1-page complete synthetic PDFs are archived.
This DOES NOT install any in-product PDF byte gate: old window.print() remains.
No real ERP, Supabase, authentication token or company graphics are loaded.
"""
import base64
import functools
import hashlib
import http.server
import json
import re
import subprocess
import threading
from pathlib import Path
from urllib.parse import quote

import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUTPUT=ROOT/".p40-16aq-review"
OUTPUT.mkdir(exist_ok=True)
EXPERIMENT=ROOT/"billing-print.html"
ORIGINAL=ROOT/"billing-print-main-baseline-ci.html"
REAL_SOURCE=(ROOT/"assets/js/external-billing-print.js").read_text(encoding="utf-8")
assert not (ROOT/".env").exists(),"STOP: no secrets are permitted"
assert not ORIGINAL.exists(),"STOP: stale baseline file left behind"
old_bytes=subprocess.check_output(
 ["git","show","origin/main:billing-print.html"],cwd=ROOT
)
new_bytes=EXPERIMENT.read_bytes()
assert old_bytes!=new_bytes
assert b"p40aq-current-customer-zone" not in old_bytes
assert b"p40aq-current-customer-zone" in new_bytes
ORIGINAL.write_bytes(old_bytes)

# Invented document generator (identical fixture logic to previous AM test).
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


neutral_logo="""<svg xmlns="http://www.w3.org/2000/svg" width="180" height="140">
  <rect x="1" y="1" width="178" height="138" fill="#f8f8f8" stroke="#888"/></svg>"""
neutral_stamp="""<svg xmlns="http://www.w3.org/2000/svg" width="540" height="240">
  <rect x="1" y="1" width="538" height="238" fill="#f8f8f8" stroke="#888"/></svg>"""
def fake_svg(xml):
    return "data:image/svg+xml,"+quote(xml,safe="")
def reject_external(route):
    url=route.request.url
    if url.split("?")[0].endswith("/enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",body="<title>Fictional only</title>")
    if route.request.resource_type=="image":
        return route.fulfill(status=200,content_type="image/svg+xml",body=neutral_logo)
    if url.startswith(BASE) or url.startswith("data:"):
        return route.continue_()
    return route.abort()

def inspect_pdf(blob,expected,tag):
    doc=fitz.open(stream=blob,filetype="pdf")
    count=len(doc)
    dims=[(p.rect.width,p.rect.height) for p in doc]
    assert all(594.4<w<596 and 841<h<843 for w,h in dims),(tag,"NOT_A4",dims)
    texts=[p.get_text(sort=True) for p in doc]
    combined="\n".join(texts)
    compact=re.sub(r"\s+","",combined)
    assert all(word in combined for word in ["請款單","施工項目彙總","客戶簽章"]),(tag,"MISSING_SECTION")
    assert expected["project"]=="虛構M區"
    assert "虛構M區" in combined
    assert len(expected["lines"])>0
    for line in expected["lines"]:
        assert line["house"] in compact,(tag,"HOUSE_LOST",line["house"])
        assert re.sub(r"\s+","",line["item"]) in compact,(tag,"ITEM_LOST",line["item"])
    for key in ("salesAmount","taxAmount","totalAmount","retentionAmount","receivableAmount"):
        val=expected.get(key,0)
        if val:
            money=f"{val:,.0f}".replace(",","")
            assert money in compact.replace(",",""),(tag,"FINANCE_FIELD_MISSING",key,money)
    if expected.get("publicNote"):
        assert re.sub(r"\s+","",expected["publicNote"]) in compact,(tag,"NOTE_LOST")
    for secret in ("PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-SALARY",
                   "sourceSnapshots","invoiceNo","虛構L區","虛構K區","虛構S區"):
        assert secret not in combined,(tag,"PRIVACY_FAILED",secret)
    spans=[]
    for n,p in enumerate(doc):
        for block in p.get_text("dict")["blocks"]:
            for line in block.get("lines",[]):
                for s in line.get("spans",[]):
                    if not s["text"].strip():continue
                    spans.append(s)
                    x0,y0,x1,y1=s["bbox"]
                    assert x0>=-.6 and y0>=-.6 and x1<=p.rect.width+.6 and y1<=p.rect.height+.6,(
                      tag,"TEXT_OFF_PAGE",s["text"],s["bbox"])
    assert spans and min(s["size"] for s in spans)>=7.8,(tag,"TOO_SMALL_FONT")
    doc.close()
    return {"pages":count,"sha256":hashlib.sha256(blob).hexdigest(),
            "source_rows":len(expected["lines"]),"minimum_pt":round(min(s["size"] for s in spans),2)}

server=http.server.ThreadingHTTPServer(
 ("127.0.0.1",0),
 functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT))
)
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"
cases=[
 ("8-short",fixture((4,4)),True),
 ("18-six-groups",fixture((9,9),repeat_groups=6),True),
 ("18-nine-groups",fixture((9,9)),True),
 ("30-six-groups",fixture((15,15),repeat_groups=6),False),
 ("30-fifteen-groups",fixture((15,15)),False)
]
results=[]
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        for device,width,height,mobile in (
          ("desktop",1280,900,False),("mobile-sim",390,844,True)
        ):
            context=browser.new_context(
                viewport={"width":width,"height":height},
                is_mobile=mobile,has_touch=mobile
            )
            for tag,payload,should_fit in cases:
                case=device+"-"+tag
                external=context.new_page()
                external.route("**/*",reject_external)
                encoded=quote(base64.b64encode(json.dumps(
                    payload,ensure_ascii=False,separators=(",",":")
                ).encode("utf-8")).decode("ascii"),safe="")
                external.goto(BASE+"external-billing-print.html#"+encoded,wait_until="domcontentloaded")
                external.wait_for_url(re.compile(r"billing-print\.html\?"))
                external.wait_for_function("window.__billingPrintReady===true")
                assert "billing-print.html" in external.url
                assert external.evaluate(
                  "document.getElementById('paper').classList.contains('p40aq-current-customer-zone')"
                ),(case,"CURRENT_CROSS_ZONE_NOT_SCOPED")
                public_hash=external.url.split("#",1)[1]
                # Byte-identical projected public view used by official
                # baseline and candidate. No sensitive original snapshots.
                public_view=external.evaluate("""()=>{
                    const hash=decodeURIComponent(location.hash.slice(1));
                    return JSON.parse(decodeURIComponent(escape(atob(hash))));
                }""")
                assert public_view["mergedBillingProjects"]==["虛構M區"]
                assert "sourceSnapshots" not in public_view
                assert "PRIVATE-INVOICE" not in json.dumps(public_view,ensure_ascii=False)
                assert not public_view.get("sourceInvoiceReferences")
                for page in [external]:
                    page.evaluate("""({logo,stamp})=>{
                       const a=document.getElementById('formalCompanyLogo');
                       const b=document.getElementById('formalCompanySeal');
                       if(a){a.hidden=false;a.style.display='block';a.src=logo;}
                       if(b){b.hidden=false;b.src=stamp;}
                    }""",{"logo":fake_svg(neutral_logo),"stamp":fake_svg(neutral_stamp)})
                external.wait_for_function("Array.from(document.images).every(x=>!x.src||x.complete)")
                external.emulate_media(media="print")
                original=context.new_page()
                original.route("**/*",reject_external)
                original.goto(BASE+"billing-print-main-baseline-ci.html?print=0#"+public_hash,
                              wait_until="load")
                original.wait_for_function("window.__billingPrintReady===true")
                original.evaluate("""({logo,stamp})=>{
                   const a=document.getElementById('formalCompanyLogo');
                   const b=document.getElementById('formalCompanySeal');
                   if(a){a.hidden=false;a.style.display='block';a.src=logo;}
                   if(b){b.hidden=false;b.src=stamp;}
                }""",{"logo":fake_svg(neutral_logo),"stamp":fake_svg(neutral_stamp)})
                original.wait_for_function("Array.from(document.images).every(x=>!x.src||x.complete)")
                original.emulate_media(media="print")
                def geometry(p):
                    return p.evaluate("""()=>{
                       const selectors={
                          company:'.company h1',title:'.doc-title h2',
                          logo:'.company-logo-frame',stamp:'.seal-wrap',
                          original:'.dense-original-details tbody',
                          summary:'.grouped-item-summary tbody'
                       };
                       const o={};
                       for(const [k,sel] of Object.entries(selectors)){
                         const node=document.querySelector(sel);
                         if(!node){o[k]=null;continue;}
                         const c=getComputedStyle(node),r=node.getBoundingClientRect();
                         o[k]={fontPt:parseFloat(c.fontSize)*.75,
                               widthMm:r.width/96*25.4,heightMm:r.height/96*25.4};
                       }
                       o.className=document.getElementById('paper').className;
                       return o;
                    }""")
                before,after=geometry(original),geometry(external)
                for key in ("company","title","logo","stamp"):
                    assert before[key] and after[key],(case,"MISSING_BRAND",key)
                    assert abs(before[key]["fontPt"]-after[key]["fontPt"])<.02,(case,"FONT_CHANGED",key)
                    assert abs(before[key]["widthMm"]-after[key]["widthMm"])<.1,(case,"BRAND_WIDTH_CHANGED",key)
                    assert abs(before[key]["heightMm"]-after[key]["heightMm"])<.1,(case,"BRAND_HEIGHT_CHANGED",key)
                assert 20.5<=after["company"]["fontPt"]<=21.5
                assert 21<=after["title"]["fontPt"]<=22
                assert after["stamp"]["heightMm"]>=18.5
                assert bool(before["original"])==bool(after["original"])
                assert bool(before["summary"])==bool(after["summary"])
                if len(public_view["lines"])>12:
                    assert after["original"] and after["summary"],(case,"DENSE_SECTIONS_MISSING")
                pdf_opt=dict(print_background=True,prefer_css_page_size=True,
                             margin={"top":"0","right":"0","bottom":"0","left":"0"})
                baseline_blob=original.pdf(**pdf_opt)
                new_blob=external.pdf(**pdf_opt)
                base_check=inspect_pdf(baseline_blob,public_view,case+" baseline")
                now_check=inspect_pdf(new_blob,public_view,case+" candidate")
                if should_fit:
                    assert now_check["pages"]==1,(case,"EXPECTED_ONE_PAGE",now_check)
                    (OUTPUT/(case+".pdf")).write_bytes(new_blob)
                    decision="SYNTHETIC_ONE_PAGE_PASS"
                else:
                    assert now_check["pages"]>1,(case,"CAPACITY_LIMIT_GONE",now_check)
                    assert not (OUTPUT/(case+".pdf")).exists()
                    decision="NON_SINGLE_PAGE_BLOCKED"
                results.append({"case":case,"baseline_pages":base_check["pages"],
                    "candidate_pages":now_check["pages"],"disposition":decision,
                    "candidate_pdf_sha256":now_check["sha256"],
                    "source_rows":now_check["source_rows"],
                    "production_byte_gate":False})
                print("P40AQ_PDF "+json.dumps(results[-1],ensure_ascii=False),flush=True)
                original.close()
                external.close()

            # Restrict scope: standalone single bill / quotation and other
            # unrelated public views must never acquire the new print class.
            safe_view={
              "schema":"kushe-external-document-v1",
              "documentType":"billing","title":"請款單",
              "number":"FAKE-SINGLE-001",
              "customer":"虛構建商","project":"虛構M區",
              "date":"2026-11-18","taxMode":"未稅","pricingMode":"actual",
              "invoiceStatus":"invoice_pending",
              "lines":[{"house":"H01","item":"門框維修","unit":"式",
                        "qty":1,"price":100,"amount":100}],
              "salesAmount":100,"taxAmount":5,"totalAmount":105,
              "retentionAmount":0,"receivableAmount":105,
              "publicNote":"虛構文件","company":{"name":"虛構測試公司"}
            }
            for typ in ("single","quotation","legacy-merged"):
                v=json.loads(json.dumps(safe_view))
                if typ=="quotation":
                    v["documentType"]="quotation"
                    v["title"]="報價單"
                if typ=="legacy-merged":
                    v["isMergedExternalBilling"]=True
                    v["mergedBillingProjects"]=["虛構L區","虛構M區"]
                encoded=quote(base64.b64encode(json.dumps(v,ensure_ascii=False).encode()).decode(),safe="")
                check=context.new_page()
                check.route("**/*",reject_external)
                check.goto(BASE+"billing-print.html?print=0#"+encoded,wait_until="load")
                check.wait_for_function("window.__billingPrintReady===true")
                is_candidate=check.evaluate(
                    "document.getElementById('paper').classList.contains('p40aq-current-customer-zone')"
                )
                assert not is_candidate,(device,typ,"UNRELATED_PRINT_CHANGED")
                print("P40AQ_ISOLATION_PASS "+device+" "+typ,flush=True)
                check.close()
            context.close()
        browser.close()
finally:
    server.shutdown()
    ORIGINAL.unlink(missing_ok=True)

assert len(results)==len(cases)*2
assert len(list(OUTPUT.glob("*.pdf")))==sum(r["disposition"]=="SYNTHETIC_ONE_PAGE_PASS" for r in results)
assert all(r["production_byte_gate"] is False for r in results)
(OUTPUT/"manifest.json").write_text(json.dumps({
   "name":"P40-16AQ current cross-zone minimal candidate test",
   "candidate_only":True,"formal_release_allowed":False,
   "original_main_unchanged":True,"real_cloud_data_accessed":False,
   "physical_device_tested":False,"real_company_seal_used":False,
   "browser_native_print_byte_gate":"NOT_IMPLEMENTED",
   "results":results
},ensure_ascii=False,indent=2))
print("P40AQ_COMPLETE: real PDF byte verification in CI, target-only style isolation, overflow fail-closed. FORMAL NATIVE PRINT STILL UNGATED.")
