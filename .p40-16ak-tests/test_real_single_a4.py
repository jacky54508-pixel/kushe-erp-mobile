"""P40-16AK: real browser-local A4 PDFs from approved published SINGLE billing
view -> isolated AJ adapter -> AK PDF renderer -> independent PyMuPDF checks.

No real ERP rows, Supabase, external URLs, live tokens or company logo/seal.
All inputs are fictitious. Main/beta and formal PDF files stay unchanged.
Desktop and mobile are simulated contexts, not physical device QA.
"""
import base64, functools, hashlib, http.server, json, re, threading
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16ak-review"
OUT.mkdir(exist_ok=True)
LAB=ROOT/".p40-16ah-tests"
assert not (ROOT/".env").exists(),"STOP production secrets"
for f in (LAB/"runtime-font.ttf",
          LAB/"node_modules/pdf-lib/dist/pdf-lib.min.js",
          LAB/"node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js"):
    assert f.is_file(),f"Missing ephemeral browser test dependency {f.name}"
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{srv.server_port}/"

def row(count=1,mode="plain",groups=None):
    lines=[]
    for k in range(count):
        number=k+1
        item_index=number if groups is None else k%groups+1
        title=f"AK{item_index:02d}-門框局部修補"
        if mode=="long":
            title=f"AK{item_index:02d}-浴室門檻與牆角防水層修補及油漆收邊整修，含大量牆面補漆修復"
        if mode=="medium":
            title=f"AK{item_index:02d}-地坪破損美容及收邊"
        line={"house":f"H{number:02d}","item":title,
              "unit":"式","qty":1,"price":100,"amount":100,
              "invoiceNo":"PRIVATE-INVOICE-08","bank":"PRIVATE-BANK"}
        if mode=="fractional" and k==0:
            line.update({"qty":.25,"price":400.25,"amount":100,"unit":"坪"})
        if mode=="history" and k==0:
            line.update({"qty":None,"price":None,"amount":None,
                         "subtotal":100,"sourceType":"historical-supplement"})
        lines.append(line)
    if mode=="types":
        lines=[
          {"house":"H01","item":"同施工項目-虛構修補","unit":"式",
           "qty":1,"price":100,"amount":100,"pricingType":"actual"},
          {"house":"H02","item":"同施工項目-虛構修補","unit":"式",
           "qty":1,"price":100,"amount":100,"sourceType":"historical-supplement",
           "subtotal":100}
        ]
        count=2
    inclusive=mode=="inclusive"
    if inclusive:
        for l in lines:
            l["price"]=105
            l["amount"]=105
    sales=count*100
    tax=count*5
    gross=sales+tax
    return {
      "id":"SYNTH-AK-001","number":"SYNTH-AK-001",
      "customer":"FAKE-CUST","customerName":"虛構建商",
      "project":"FAKE-M","projectName":"虛構M區",
      "date":"2026-11-18","taxMode":"含稅" if inclusive else "未稅",
      "invoiceStatus":"invoice_pending","pricingMode":"",
      "lines":lines,"amount":sales,"tax":tax,"grossTotal":gross,
      "total":gross,"retentionAmount":0,
      "publicNote":"僅供虛構 A4 PDF 測試，不得寄送建商"
    }

def planned_cases():
    return [
      ("single-18",row(18),None,True),
      ("fractional-6",row(6,"fractional"),None,True),
      ("inclusive-6",row(6,"inclusive"),None,True),
      ("historical-6",row(6,"history"),None,True),
      ("protected-retention-6",row(6),
       {"protected":True,"issues":[],"supplement":{"taxMode":"未稅"},
        "amounts":{"untaxed":600,"tax":30,"grossTotal":630,
                   "retention":30,"receivable":600}},True),
      ("two-source-types",row(2,"types"),None,True),
      ("30-six-groups",row(30,"plain",6),None,True),
      ("30-long-description",row(30,"long"),None,False),
      ("30-long-note",dict(row(30),publicNote="虛構長備註及施工說明測試。"*35),
       None,False)
    ]

def verify_bytes(data,expected,case):
    doc=fitz.open(stream=data,filetype="pdf")
    assert len(doc)==1,(case,"NOT_ONE_A4",len(doc))
    p=doc[0]
    assert 594.5<p.rect.width<596 and 841<p.rect.height<843,(case,p.rect)
    content="".join(page.get_text(sort=True) for page in doc)
    no_space=re.sub(r"\s+","",content)
    for token in ("原始明細","施工項目彙總","原施工明細合計",
                  "保留款","應收","客戶簽章","模擬LOGO","模擬大小章","虛構M區"):
        assert token in no_space,(case,"MISSING_TOKEN",token)
    assert "虛構L區" not in no_space
    for line in expected["original"]:
        assert line["house"] in no_space,(case,"MISSING_HOUSE",line["house"])
        assert line["item"].replace(" ","") in no_space,(case,"MISSING_ITEM",line["item"])
        for key in ("qtyText","priceText","amountText"):
            assert line[key].replace(",","") in no_space.replace(",",""),(
                case,"MISSING_DECIMAL_OR_AMOUNT",line[key],key)
    # Both original line list and bottom grouped summary must be present.
    for grp in expected["summary"]:
        assert grp["item"].replace(" ","") in no_space,(case,"MISSING_SUMMARY",grp["item"])
    for key,val in expected["amounts"].items():
        rendered=format(val,",.2f").rstrip("0").rstrip(".")
        assert rendered.replace(",","") in no_space.replace(",",""),(
            case,"MISSING_AMOUNT",key,rendered)
    if expected["taxMode"]=="含稅":
        assert expected["display"]["originalDetailTotal"]==expected["amounts"]["totalAmount"]
    if expected["invoiceStatus"]=="no_invoice":
        assert "稅額：" not in content
    for forbidden in ("PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-PAYROLL","PRIVATE-TOKEN",
        "sourceSnapshots","invoiceNo","access_token","原票號／狀態"):
        assert forbidden not in content,(case,"INTERNAL_FIELD_LEAK",forbidden)
    spans=[]
    for block in p.get_text("dict")["blocks"]:
        for line in block.get("lines",[]):
            for s in line.get("spans",[]):
                if not s["text"].strip():continue
                spans.append(s)
                x0,y0,x1,y1=s["bbox"]
                assert x0>=-.6 and y0>=-.6 and x1<=p.rect.width+.6 and y1<=p.rect.height+.6,(
                    case,"CLIPPED",s["text"],s["bbox"])
    assert spans and min(s["size"] for s in spans)>=8.0,(case,"TEXT_BELOW_8PT")
    rects=[v["rect"] for v in p.get_drawings() if v.get("rect") is not None]
    assert any(abs(r.width-51)<2 and abs(r.height-40)<2 for r in rects),(
        case,"MOCK_LOGO_MISSING")
    assert any(abs(r.width-154)<2 and abs(r.height-68)<2 for r in rects),(
        case,"MOCK_STAMP_MISSING")
    p.get_pixmap(matrix=fitz.Matrix(1.05,1.05),alpha=False).save(str(OUT/(case+".png")))
    doc.close()
    return {"a4_pages":1,"font_min":round(min(s["size"] for s in spans),2),
            "original_rows":len(expected["original"]),
            "summary_rows":len(expected["summary"]),
            "sha256":hashlib.sha256(data).hexdigest()}

cases=planned_cases()
results=[]
try:
    with sync_playwright() as play:
        browser=play.chromium.launch(headless=True)
        for device,w,h,mobile in (
            ("desktop",1280,900,False),
            ("mobile-sim",390,844,True)
        ):
            context=browser.new_context(viewport={"width":w,"height":h},
                is_mobile=mobile,has_touch=mobile)
            page=context.new_page()
            page.route("**/*",lambda route: route.continue_()
                if route.request.url.startswith(BASE) else route.abort())
            page.goto(BASE+".p40-16ak-tests/index.html",wait_until="load")
            page.wait_for_function("!!window.PDFLib&&!!window.fontkit&&!!window.P40AK&&!!window.P40AJ&&!!window.KusheBillingPrint")
            for label,fixture,protected,allowed in cases:
                case=f"{device}-{label}"
                result=page.evaluate("""async ({row,protectedState}) => {
                    window.__syntheticProtected.clear();
                    if(protectedState)window.__syntheticProtected.set(row.id,protectedState);
                    const trust={approvedByTrustedCaller:true,
                                 lifecycleStatus:'active',syncState:'SYNCED'};
                    const original=JSON.stringify(row);
                    try {
                      const view=window.KusheBillingPrint.buildExternalView(row);
                      // The published builder contains public company identity.
                      // Replace ONLY mock branding fields, not any billing data.
                      view.company={name:'虛構公司',taxId:'00000000',address:'虛構地點'};
                      const output=await window.P40AK.generatePublishedSingle(
                          view,trust,view.project);
                      if(JSON.stringify(row)!==original)throw Error('SOURCE_MUTATED');
                      return {ok:true,...output};
                    } catch(e){return {ok:false,why:e.code||String(e)};}
                }""",{"row":fixture,"protectedState":protected})
                if allowed:
                    assert result["ok"],(case,"SHOULD_ALLOW",result)
                    pdf_data=base64.b64decode(result["base64"])
                    check=verify_bytes(pdf_data,result["expected"],case)
                    (OUT/(case+".pdf")).write_bytes(pdf_data)
                    r={"case":case,"decision":"FIXTURE_PASS",**check}
                else:
                    assert not result["ok"],(case,"UNSAFE_PDF_WAS_ALLOWED")
                    assert result["why"] in {
                      "SOURCE_DESCRIPTION_TOO_LONG","SUMMARY_DESCRIPTION_TOO_LONG",
                      "SOURCE_A4_CAPACITY_EXCEEDED","FOOTER_OR_STAMP_A4_OVERFLOW",
                      "NOTE_TOO_LONG","TEXT_EXCEEDS_RIGHT_EDGE"
                    },(case,"UNEXPECTED_REJECT",result)
                    assert not (OUT/(case+".pdf")).exists()
                    r={"case":case,"decision":"BLOCKED","reason":result["why"]}
                results.append(r)
                print("P40AK_CASE "+json.dumps(r,ensure_ascii=False),flush=True)
            # Strong denial tests: no production rights are conferred by the
            # fake trust flag; all unrelated doc types and wrong sync must block.
            for label,alter,trust in [
                ("wrong-zone","wrong-zone","valid"),
                ("expired-sync","none","REMOTE_NEWER"),
                ("combined","combined","valid"),
                ("merged","merged","valid"),
                ("tampered-total","tampered","valid"),
                ("private-note","private","valid")
            ]:
                verdict=page.evaluate("""async ({alter,trustCode,base}) => {
                    window.__syntheticProtected.clear();
                    const v=window.KusheBillingPrint.buildExternalView(base);
                    v.company={name:'虛構公司',taxId:'00000000'};
                    let target=v.project;
                    if(alter==='wrong-zone')target='虛構L區';
                    if(alter==='combined')v.documentType='combined-billing';
                    if(alter==='merged')v.isMergedExternalBilling=true;
                    if(alter==='tampered')v.salesAmount+=100;
                    if(alter==='private')v.publicNote='PRIVATE-INVOICE-08';
                    try {
                        await window.P40AK.generatePublishedSingle(v,{
                          approvedByTrustedCaller:true,lifecycleStatus:'active',
                          syncState:trustCode==='REMOTE_NEWER'?'REMOTE_NEWER':'SYNCED'
                        },target);
                        return 'IMPROPER_ALLOW';
                    } catch(e){return e.code||String(e);}
                }""",{"alter":alter,"trustCode":trust,"base":row(1)})
                assert verdict!="IMPROPER_ALLOW",(device,label,"negative test allowed")
                print("P40AK_DENIED "+json.dumps({"device":device,
                    "attack":label,"reason":verdict}),flush=True)
            context.close()
        browser.close()
finally:
    srv.shutdown()

pass_cases=[c for c in results if c["decision"]=="FIXTURE_PASS"]
blocked_cases=[c for c in results if c["decision"]=="BLOCKED"]
assert len(results)==len(cases)*2
assert len(pass_cases)==sum(c[3] for c in cases)*2
assert len(blocked_cases)==sum(not c[3] for c in cases)*2
assert len(list(OUT.glob("*.pdf")))==len(pass_cases)
manifest={"lab_only":True,"release_ready":False,"result":results,
          "warning":"Synthetic browser-side PDF only; real company graphics, production accounting and physical mobile not certified"}
(OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print("P40AK_TEST_COMPLETE: actual local PDF byte checks and negative overflow tests passed.")
print("NO PRODUCTION DEPLOYMENT: source adapter is not connected to ERP, sync or real finance.")
