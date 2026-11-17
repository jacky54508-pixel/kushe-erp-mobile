"""P40-16AH: actual browser-side pdf-lib PDF bytes, isolated synthetic test.

The HTML/JS runs in localhost Chromium, generates new PDF bytes on the browser
client. Python checks the bytes using PyMuPDF. Strictly fake company, no genuine
company logo/seal, ERP data, live auth, Supabase, storage, or remote traffic.
CJK TTF is provisioned ephemerally from OS fonts, never committed/uploaded.
"""
import base64, functools, http.server, json, re, threading
from pathlib import Path
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
LAB=ROOT/".p40-16ah-tests"
OUT=ROOT/".p40-16ah-review"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(), "STOP: production secrets"
assert (LAB/"runtime-font.ttf").is_file(), "STOP: local CJK font was not provisioned"
assert (LAB/"node_modules/pdf-lib/dist/pdf-lib.min.js").is_file(), "STOP: pinned local PDF library missing"
assert (LAB/"node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js").is_file(), "STOP: pinned local fontkit missing"

httpd=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT))
)
threading.Thread(target=httpd.serve_forever,daemon=True).start()
ORIGIN=f"http://127.0.0.1:{httpd.server_port}/"

def lines_for(count,kind,groups=None):
    lines=[]
    for index in range(count):
        item_index=index+1 if groups is None else index%groups+1
        code=f"AH{item_index:02}"
        if kind=="short":
            item=code+"-門框局部修補"
        elif kind=="medium":
            item=code+"-地坪破損美容及收邊"
        else:
            item=code+"-浴室門檻與牆角防水層修補及油漆收邊整修，包含多處牆面修復與清潔"
        lines.append({
            "house":f"H{index+1:02}","item":item,"unit":"式",
            "qty":1,"price":100,"amount":100,
            "invoiceNo":"PRIVATE-INVOICE-08",
            "sourceSnapshots":{"payroll":"PRIVATE-PAYROLL"},
            "bank":"PRIVATE-BANK"
        })
    return lines

def specimen(count,kind,long_note=False,groups=None):
    source={
        "schema":"kushe-external-document-v1",
        "documentType":"billing","title":"請款單",
        "customer":"虛構建商", "project":"虛構M區","date":"2026-11-18",
        "taxMode":"未稅","status":"active",
        "lines":lines_for(count,kind,groups),
        "salesAmount":count*100,"taxAmount":count*5,
        "totalAmount":count*105,"retentionAmount":0,
        "receivableAmount":count*105,
        "publicNote":("這是虛構的測試長備註，用於確認列印頁數及金額內容是否完整，"
                      "不代表任何真實工程或帳務資料。"*8)
                     if long_note else "僅限虛構測試，禁止對外寄送",
        "company":{"name":"虛構測試公司","taxId":"00000000",
                   "address":"虛構地點","bank":"PRIVATE-BANK"},
        "sourceSnapshots":[{"invoiceNo":"PRIVATE-INVOICE-08"}],
        "auth":{"token":"PRIVATE-TOKEN"},
        "salary":"PRIVATE-PAYROLL"
    }
    return source

def verify_pdf(payload,expected,case):
    doc=fitz.open(stream=payload,filetype="pdf")
    assert len(doc)==1, (case,"page_count",len(doc))
    p=doc[0]
    assert 594.5<p.rect.width<596 and 841<p.rect.height<843, (case,"not A4",p.rect)
    contents="".join(pg.get_text(sort=True) for pg in doc)
    text=re.sub(r"\s+","",contents)
    assert contents and "原施工明細" in contents, (case,"source title missing",contents[:700])
    assert "施工項目彙總" in contents and "明細合計" in contents
    assert "虛構M區" in text and "虛構L區" not in text
    assert "模擬LOGO" in text and "模擬大小章" in text
    for house in expected["originalLabels"]:
        assert house in text, (case,"missing house",house)
    for item in expected["itemLabels"]:
        assert item.replace(" ","") in text, (case,"missing grouped item",item)
    assert str(expected["totals"]["gross"]) in text.replace(",",""),(
        case,"gross total missing",expected["totals"])
    for forbidden in (
        "PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-PAYROLL","PRIVATE-TOKEN",
        "sourceSnapshots","access_token","原票號／狀態"
    ):
        assert forbidden not in contents, (case,"private data in PDF",forbidden)
    span_sizes=[]
    clipped=[]
    for blk in p.get_text("dict")["blocks"]:
        for line in blk.get("lines",[]):
            for span in line.get("spans",[]):
                if not span["text"].strip():continue
                span_sizes.append(span["size"])
                x0,y0,x1,y1=span["bbox"]
                if x0<-.5 or y0<-.5 or x1>p.rect.width+.5 or y1>p.rect.height+.5:
                    clipped.append(span["text"])
    assert span_sizes and min(span_sizes)>=8.0-0.06,(case,"small font",min(span_sizes))
    assert not clipped, (case,"clipped",clipped[:6])
    # Neutral mock placeholders: page has outlines roughly 18x14 mm and 54x24 mm.
    rectangles=[r["rect"] for r in p.get_drawings() if r.get("rect") is not None]
    assert any(abs(r.width-51)<2 and abs(r.height-40)<2 for r in rectangles), (
        case,"mock logo geometry missing")
    assert any(abs(r.width-154)<2 and abs(r.height-68)<2 for r in rectangles), (
        case,"mock seal geometry missing")
    p.get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False).save(
        str(OUT/(case+".png")))
    doc.close()
    return {"pages":1,"font_min":round(min(span_sizes),2),
            "original_lines":expected["original"],
            "summary_items":expected["summary"],
            "mock_logo":"18x14mm","mock_seal":"54x24mm","text_complete":True}

CASES=[
    ("18-short",18,"short",False,None,True),
    ("30-short",30,"short",False,None,True),
    ("30-medium",30,"medium",False,None,True),
    ("30-six-groups",30,"short",False,6,True),
    ("30-long",30,"long",False,None,False),
    ("30-long-note",30,"short",True,None,False),
]
RESULTS=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        for device,width,height,mobile in (
            ("desktop",1280,900,False),
            ("mobile-sim",390,844,True)
        ):
            ctx=browser.new_context(
                viewport={"width":width,"height":height},
                is_mobile=mobile,has_touch=mobile
            )
            page=ctx.new_page()
            page.route("**/*",lambda route: route.continue_()
                       if route.request.url.startswith(ORIGIN) else route.abort())
            page.goto(ORIGIN+".p40-16ah-tests/index.html",wait_until="load")
            page.wait_for_function("!!window.P40AH && !!window.PDFLib && !!window.fontkit")
            for name,n,kind,long_note,groups,allowed in CASES:
                source=specimen(n,kind,long_note,groups)
                case=device+"-"+name
                result=page.evaluate("""async ({data}) => {
                    try {const out=await P40AH.generate(data,"虛構M區");
                        return {ok:true,...out};
                    } catch(e) {return {ok:false,reason:e.code||String(e)};}
                }""",{"data":source})
                if allowed:
                    assert result["ok"],(case,"unexpected refusal",result)
                    pdf_bytes=base64.b64decode(result["base64"])
                    stats=verify_pdf(pdf_bytes,result["expected"],case)
                    (OUT/(case+".pdf")).write_bytes(pdf_bytes)
                    rec={"case":case,"decision":"FIXTURE_PASS",**stats}
                else:
                    assert not result["ok"],(case,"long content silently accepted")
                    assert result["reason"] in {
                        "LONG_SUMMARY_ITEM","ORIGINAL_DESCRIPTION_TOO_LONG",
                        "NOTE_EXCEEDS_SAFE_ZONE","A4_LAYOUT_OVERFLOW",
                        "STAMP_AREA_OVERFLOW","SOURCE_TABLE_EXCEEDS_A4"
                    },(case,"unknown rejection",result)
                    assert not (OUT/(case+".pdf")).exists(),(case,"rejected PDF delivered")
                    rec={"case":case,"decision":"BLOCK","reason":result["reason"]}
                print("P40AH_CASE "+json.dumps(rec,ensure_ascii=False),flush=True)
                RESULTS.append(rec)
            # Adversarial public data: wrong zone, private sentinel in an allowed
            # public field, inconsistent amount and missing original detail.
            negative=[
                ("wrong-zone",specimen(18,"short"),"虛構L區"),
                ("wrong-price",specimen(18,"short"),"虛構M區"),
                ("missing-row",specimen(18,"short"),"虛構M區"),
                ("private-public-note",specimen(18,"short"),"虛構M區")
            ]
            negative[1][1]["lines"][0]["price"]=999
            negative[2][1]["lines"]=[]
            negative[3][1]["publicNote"]="PRIVATE-INVOICE-08"
            for label,source,target in negative:
                r=page.evaluate("""async ({source,target}) => {
                    try {await P40AH.generate(source,target); return "ALLOW";}
                    catch(e){return e.code||String(e)}
                }""",{"source":source,"target":target})
                assert r!="ALLOW",(device,label,"invalid payload passed")
                print("P40AH_DENIED "+json.dumps({"device":device,"attack":label,"reason":r}),flush=True)
            ctx.close()
        browser.close()
finally:
    httpd.shutdown()

assert len(RESULTS)==12
assert sum(r["decision"]=="FIXTURE_PASS" for r in RESULTS)==8
assert sum(r["decision"]=="BLOCK" for r in RESULTS)==4
(OUT/"result-manifest.json").write_text(
    json.dumps({"status":"synthetic-only","ready_for_production":False,
                "client_side_pdf_bytes":True,"cases":RESULTS},
               indent=2,ensure_ascii=False))
print("P40AH_COMPLETE: 8 actual device-browser one-page CJK PDF fixtures; 4 overflow cases blocked.")
print("NOT PRODUCTION: physical mobile, true company logo/seal, ERP adapters, auth and finance remain UNTESTED.")
