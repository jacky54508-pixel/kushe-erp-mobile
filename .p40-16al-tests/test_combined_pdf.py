"""P40-16AL actual local browser A4 PDF from published GENERAL combined view.

Everything is synthetic. GitHub main/beta and ERP/sync/Supabase stay unchanged.
Two device contexts are Chromium simulations, not physical phone verification.
"""
import base64, functools, hashlib, http.server, json, re, threading
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
LAB=ROOT/".p40-16ah-tests"
OUT=ROOT/".p40-16al-review"
OUT.mkdir(exist_ok=True)
for dependency in (
    LAB/"runtime-font.ttf",
    LAB/"node_modules/pdf-lib/dist/pdf-lib.min.js",
    LAB/"node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
):
    assert dependency.is_file(), ("isolated dependency missing",dependency.name)
assert not (ROOT/".env").exists(), "STOP: secrets"

srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{srv.server_port}/"

def record(billing_id,project,index=1,count=2,month="08",
           inclusive=False,retention=0,history=False,
           fractional=False,long=False,long_note=False,
           source_type=None):
    lines=[]
    for i in range(count):
        item=(f"AL{i+1:02d}-浴室牆角與門框防水層修補及油漆收邊整修"
              if long else f"AL{i+1:02d}-門框局部修補")
        row={"house":f"{billing_id[-2:]}H{i+1:02d}",
             "item":item,"unit":"式",
             "qty":1,"price":105 if inclusive else 100,
             "amount":105 if inclusive else 100,
             "invoiceNo":f"PRIVATE-INVOICE-{month}",
             "sourceSnapshots":{"bank":"PRIVATE-BANK"}}
        if fractional and i==0:
            row.update({"unit":"坪","qty":.25,"price":400.25,
                        "amount":100})
        if history and i==0:
            row.update({"qty":None,"price":None,"amount":None,
                        "subtotal":100,"sourceType":"historical-supplement"})
        if source_type and i==0:row["pricingType"]=source_type
        lines.append(row)
    sales=count*100
    tax=count*5 if month not in ("NO",) else 0
    if inclusive and tax==0:
        raise ValueError("fixture mismatch inclusive no invoice")
    total=sales+tax
    return {
      "id":billing_id,"number":f"SYNTH-{billing_id}",
      "customer":"FAKE-CUSTOMER-ID","customerName":"虛構同一建商",
      "project":f"FAKE-{project}","projectName":f"虛構{project}",
      "date":f"2026-{month if month!='NO' else '10'}-{index:02d}",
      "taxMode":"含稅" if inclusive else "未稅",
      "invoiceStatus":"no_invoice" if month=="NO" else
          "invoiced" if month=="08" else "invoice_pending",
      "lines":lines,"amount":sales,"tax":tax,"grossTotal":total,
      "total":total,"retentionAmount":retention,
      "publicNote":("虛構長備註說明施工事項及核定金額。"*30) if long_note
         else "虛構原單施工內容，非正式對外文件",
      "invoiceNo":f"PRIVATE-INVOICE-{month}",
      "bank":"PRIVATE-BANK","salary":"PRIVATE-SALARY",
      "sourceSnapshots":[{"invoiceNo":"PRIVATE-INVOICE-08"}]
    }

def inputs():
    return [
       ("two-months-two-projects",
        [record("B01","M區",1,2,"08"), record("B02","L區",5,2,"10")],
        None,True),
       ("three-originals",
        [record("B01","M區",1,2,"08"),
         record("B02","M區",5,2,"10"),
         record("B03","L區",9,2,"10")],
        None,True),
       ("decimal-and-historical",
        [record("B01","M區",1,2,"08",fractional=True),
         record("B02","L區",5,2,"10",history=True)],
        None,True),
       ("mixed-tax-approved",
        [record("B01","M區",1,2,"08",inclusive=True),
         record("B02","L區",5,2,"10")],
        None,True),
       ("protected-retention",
        [record("B01","M區",1,2,"08"),
         record("B02","L區",5,2,"10")],
        {"B01":{"protected":True,"issues":[],
                "supplement":{"taxMode":"未稅"},
                "amounts":{"untaxed":200,"tax":10,
                           "grossTotal":210,"retention":10,"receivable":200}}},True),
       ("same-project-separate-source",
        [record("B01","M區",1,2,"08"),
         record("B02","M區",5,2,"10",history=True)],
        None,True),
       ("too-many-lines",
        [record("B01","M區",1,20,"08"),
         record("B02","L區",5,20,"10")],
        None,False),
       ("too-long-notes",
        [record("B01","M區",1,2,"08",long_note=True),
         record("B02","L區",5,2,"10")],
        None,False),
       ("too-long-items",
        [record("B01","M區",1,13,"08",long=True),
         record("B02","L區",5,13,"10",long=True)],
        None,False)
    ]

def check_pdf(raw,expected,case):
    d=fitz.open(stream=raw,filetype="pdf")
    assert len(d)==1,(case,"not one A4 page",len(d))
    p=d[0]
    assert 594.4<p.rect.width<596 and 841<p.rect.height<843,(case,p.rect)
    plain=p.get_text(sort=True)
    txt=re.sub(r"\s+","",plain)
    for marker in ("一般合併請款","施工項目彙總","合併請款總計",
                   "客戶簽章","模擬LOGO","模擬大小章","保留款","應收"):
        assert marker in txt,(case,"missing layout or figure",marker)
    assert len(expected["sourceBills"])>=2
    for bill in expected["sourceBills"]:
        for tag in (bill["number"],bill["projectName"],bill["date"]):
            assert tag in txt,(case,"original identity missing",tag)
        for line in bill["original"]:
            for val in (line["house"],line["item"]):
                assert val in txt,(case,"original line missing",val)
        for k,val in bill["approvedAmounts"].items():
            formatted=f"{val:,.2f}".rstrip("0").rstrip(".")
            assert formatted.replace(",","") in txt.replace(",",""),(
                case,"source approved money missing",k,formatted)
    for group in expected["summary"]:
        assert group["item"] in txt,(case,"grouped detail missing",group["item"])
        assert group["projectName"] in txt,(case,"group source missing",group["projectName"])
    for k,val in expected["grandTotals"].items():
        text=f"{val:,.2f}".rstrip("0").rstrip(".")
        assert text.replace(",","") in txt.replace(",",""),(
            case,"grand amount missing",k,val)
    for forbidden in ("PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-SALARY",
        "sourceSnapshots","invoiceNo","PRIVATE-TOKEN","access_token",
        "原票號／狀態"):
        assert forbidden not in txt,(case,"private leak",forbidden)
    spans=[]
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines",[]):
            for sp in l.get("spans",[]):
                if not sp["text"].strip():continue
                spans.append(sp)
                x0,y0,x1,y1=sp["bbox"]
                assert x0>=-.6 and y0>=-.6 and x1<=p.rect.width+.6 and y1<=p.rect.height+.6,(
                    case,"clipping",sp["text"],sp["bbox"])
    assert spans and min(s["size"] for s in spans)>=8.0,(case,"font below 8pt")
    rectangles=[r["rect"] for r in p.get_drawings() if r.get("rect") is not None]
    assert any(abs(r.width-51)<2 and abs(r.height-40)<2 for r in rectangles),(
      case,"logo placeholder size")
    assert any(abs(r.width-154)<2 and abs(r.height-68)<2 for r in rectangles),(
      case,"seal placeholder size")
    p.get_pixmap(matrix=fitz.Matrix(1.15,1.15),alpha=False).save(
        str(OUT/(case+".png")))
    d.close()
    return {"pages":1,"font_min":round(min(s["size"] for s in spans),2),
            "source_documents":len(expected["sourceBills"]),
            "original_rows":sum(len(x["original"]) for x in expected["sourceBills"]),
            "source_aware_summary_rows":len(expected["summary"]),
            "sha256":hashlib.sha256(raw).hexdigest()}

cases=inputs()
outcomes=[]
try:
  with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for device,w,h,mob in (
      ("desktop",1280,900,False),
      ("mobile-sim",390,844,True)
    ):
      context=browser.new_context(viewport={"width":w,"height":h},
        is_mobile=mob,has_touch=mob)
      page=context.new_page()
      page.route("**/*",lambda route: route.continue_()
        if route.request.url.startswith(BASE) else route.abort())
      page.goto(BASE+".p40-16al-tests/index.html",wait_until="load")
      page.wait_for_function("!!window.P40ALPDF&&!!window.P40AL&&!!window.fontkit&&!!window.PDFLib&&!!window.KusheBillingBundlePrint")
      for label,records,protected,should_pass in cases:
        cid=f"{device}-{label}"
        response=page.evaluate("""async ({records,protected})=>{
           window.__p40alStates.clear();
           for(const [k,v] of Object.entries(protected||{}))
             window.__p40alStates.set(k,v);
           const before=JSON.stringify(records);
           try{
             const source=window.KusheBillingBundlePrint.buildCombinedView(records);
             source.company={name:'虛構測試公司',taxId:'00000000'};
             const r=await window.P40ALPDF.generate(source,{
               approvedByTrustedCaller:true,syncState:'SYNCED',
               lifecycleStatus:'active'
             });
             if(JSON.stringify(records)!==before)throw Error('SOURCE_MUTATED');
             return {ok:true,...r};
           }catch(e){return {ok:false,reason:e.code||String(e)};}
        }""",{"records":records,"protected":protected})
        if should_pass:
            assert response["ok"],(cid,"unexpected rejection",response)
            data=base64.b64decode(response["base64"])
            result=check_pdf(data,response["expected"],cid)
            (OUT/(cid+".pdf")).write_bytes(data)
            entry={"case":cid,"decision":"FIXTURE_PASS",**result}
        else:
            assert not response["ok"],(cid,"overlong PDF should block")
            assert response["reason"] in (
              "DETAIL_CAPACITY_EXCEEDED","BILLING_SECTIONS_EXCEED_A4",
              "LONG_PUBLIC_NOTE_CANNOT_FIT","NOTE_OVERLAPS_BOTTOM_SUMMARY",
              "DETAIL_DESCRIPTION_TOO_LONG","NO_SPACE_FOR_SUMMARY_AND_SEAL",
              "SUMMARY_OVERFLOW_INTO_SIGN_SPACE","GROUPED_ITEM_TOO_LONG"
            ),(cid,response)
            assert not (OUT/(cid+".pdf")).exists()
            entry={"case":cid,"decision":"BLOCKED","reason":response["reason"]}
        outcomes.append(entry)
        print("P40AL_CASE "+json.dumps(entry,ensure_ascii=False),flush=True)
      # Negative cases including cross-customer, duplicated ID, tampered grand
      # amount, wrong project, internal invoice sentinel and wrong sync.
      basic=inputs()[0][1]
      for why in ("other-customer","duplicate-id","tampered-grand",
                  "wrong-project","private-note","merged","bad-sync"):
        result=page.evaluate("""async ({why,records})=>{
           const src=JSON.parse(JSON.stringify(records));
           if(why==='other-customer')src[1].customer='FAKE-UNRELATED';
           if(why==='duplicate-id')src[1].id=src[0].id;
           if(why==='private-note')src[0].publicNote='PRIVATE-INVOICE-08';
           window.__p40alStates.clear();
           try{
             const d=window.KusheBillingBundlePrint.buildCombinedView(src);
             d.company={name:'虛構測試公司',taxId:'00000000'};
             if(why==='tampered-grand')d.totals.totalAmount+=100;
             if(why==='wrong-project')d.billings[0].projectId='FAKE-NOT-OWNED';
             if(why==='merged')d.isMergedExternalBilling=true;
             await window.P40ALPDF.generate(d,{
               approvedByTrustedCaller:true,
               syncState:why==='bad-sync'?'REMOTE_NEWER':'SYNCED',
               lifecycleStatus:'active'
             });
             return 'UNSAFE_ALLOW';
           }catch(e){return e.code||String(e);}
        }""",{"why":why,"records":basic})
        assert result!="UNSAFE_ALLOW",(device,why,"negative unexpectedly passed")
        print("P40AL_DENIED "+json.dumps({
            "device":device,"test":why,"reason":result
        }),flush=True)
      context.close()
    browser.close()
finally:
  srv.shutdown()

passed=[c for c in outcomes if c["decision"]=="FIXTURE_PASS"]
blocked=[c for c in outcomes if c["decision"]=="BLOCKED"]
assert len(outcomes)==2*len(cases)
assert len(passed)==2*sum(item[3] for item in cases)
assert len(blocked)==2*sum(not item[3] for item in cases)
assert len(list(OUT.glob("*.pdf")))==len(passed)
(OUT/"manifest.json").write_text(json.dumps({
  "lab_only":True,"production_ready":False,
  "normal_combined_only":True,"cross_zone_not_supported":True,
  "original_invoice_numbers_never_public":True,
  "results":outcomes},ensure_ascii=False,indent=2))
print("P40AL_COMPLETE: actual A4 PDFs from published ordinary combined billing builder; unsupported/overlong content blocked.")
print("FORMAL RELEASE BLOCKED: only fictitious local browser tests; no physical device and no company seals.")
