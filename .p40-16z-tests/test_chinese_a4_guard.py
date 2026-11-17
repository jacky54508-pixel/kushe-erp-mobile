"""P40-16Z: Chinese construction descriptions + A4 real-size neutral logo/stamp.

Entirely fictitious, localhost-only Chromium. Read-only use of published
billing-print.html. Styling and DOM composition are injected only at runtime
in a disposable browser. Actual corporate seal/logo and real ERP records are
deliberately inaccessible. FAIL CLOSED on content loss or unreadable text.

A green diagnostic job does NOT mean every scenario fits one A4 page.
"""
import ast
import base64
import functools
import http.server
import json
import re
import threading
from pathlib import Path
from urllib.parse import quote

import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16z-artifacts"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(), "STOP forbidden secrets"

def constants(path, names):
    tree=ast.parse(path.read_text())
    found={}
    for stmt in tree.body:
        if isinstance(stmt,ast.Assign):
            for target in stmt.targets:
                if isinstance(target,ast.Name) and target.id in names:
                    found[target.id]=ast.literal_eval(stmt.value)
    assert set(found)==set(names),("Missing source constants",names,found.keys())
    return found

v=constants(ROOT/".p40-16v-tests/test_print_style_profiles.py",("PROFILES",))
x=constants(ROOT/".p40-16x-tests/test_two_column_summary.py",("TWOCOL_JS","COL_CSS"))
y=constants(ROOT/".p40-16y-tests/test_footer_capacity.py",("FOOT_JS","STAMP_JS","FOUR","STAMP_CSS"))
COMPACT=v["PROFILES"]["compact-a4-dense"]

server=http.server.ThreadingHTTPServer(("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def encode(obj):
    return quote(base64.b64encode(
        json.dumps(obj,ensure_ascii=False,separators=(",",":")).encode()).decode(),safe="")

def fixture(count, kind, long_note=False, grouping=False):
    lines=[]
    for i in range(count):
        num=i%6+1 if grouping else i+1
        if kind=="short":
            item=f"ZA{num:02d}-門框局部修補"
        elif kind=="medium":
            item=f"ZA{num:02d}-地坪破損美容及收邊"
        else:
            item=f"ZA{num:02d}-浴室門檻與牆角防水層修補及油漆收邊整修"
        lines.append({"house":f"HB{i+1:02d}",
                      "item":item,"unit":"式","qty":1,
                      "price":100,"amount":100,
                      "sourcePricingType":"external-document","pricingType":""})
    # Completely fabricated, not extracted from any billing record.
    note=("測試用途：本次工程包含施工位置整理、表面處理、修繕說明及數量核對；"
          "請先核對所有施工項目與計價內容，確認後再進行簽認。" * 3) if long_note else "虛構測試資料，禁止寄送建商"
    return {
      "schema":"kushe-external-document-v1","documentType":"billing",
      "title":"請款單","number":"","customer":"虛構測試建商",
      "project":"SYNTH-指定M區","date":"2026-11-17",
      "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
      "lines":lines,"salesAmount":count*100,"taxAmount":count*5,
      "totalAmount":count*105,"retentionAmount":0,
      "receivableAmount":count*105,"publicNote":note,
      "company":{"name":"虛構測試公司","englishName":"SYNTHETIC ONLY",
                 "taxId":"00000000","address":"虛構測試地址","line":"SYNTH"},
      "fileName":"SYNTHETIC-DO-NOT-SEND.pdf",
      "mergedBillingProjects":["SYNTH-指定M區"],
      "isMergedExternalBilling":True
    }

def local_only(route):
    url=route.request.url
    if url.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
            body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    return route.continue_() if url.startswith(BASE) else route.abort()

LOGO_JS=r"""() => {
 const frame=document.querySelector('.company-logo-frame');
 const img=document.querySelector('#formalCompanyLogo');
 if(!frame||!img)throw Error('Logo frame not present');
 img.removeAttribute('src');img.style.display='none';
 const t=document.createElement('span');
 t.className='p40z-fake-logo';
 t.textContent='MOCK-LOGO';
 frame.appendChild(t);
 return true;
}"""
LOGO_CSS=r"""
@media print {
 .paper.invoice-group-document .company-logo-frame{
   width:18mm!important;height:14mm!important;min-width:18mm!important;
   overflow:visible!important;display:flex!important;align-items:center!important;
   justify-content:center!important;
 }
 .paper.invoice-group-document .p40z-fake-logo{
   display:flex!important;align-items:center;justify-content:center;
   box-sizing:border-box;width:18mm;height:14mm;border:.2mm dashed #687c89;
   background:#f8f9fa;color:#28333a;
   font-size:5.5pt!important;line-height:1!important;text-align:center;
 }
}
"""

# All cases include the 18x14 mm neutral logo and 54x24 mm neutral seal.
CASES=[
    ("18-short-cn",18,"short",False,False),
    ("30-short-cn",30,"short",False,False),
    ("30-medium-cn",30,"medium",False,False),
    ("30-long-cn",30,"long",False,False),
    ("30-long-note-cn",30,"short",True,False),
    ("30-six-groups-cn",30,"short",False,True)
]
records=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={"width":1280,"height":900})
        page.route("**/*",local_only)
        for case,n,kind,long_note,grouping in CASES:
            data=fixture(n,kind,long_note,grouping)
            page.goto(BASE+f"billing-print.html?print=0&zcase={case}#"+
                      encode(data),wait_until="load")
            page.locator(".dense-original-details .dense-line-table").wait_for()
            page.add_style_tag(content=COMPACT)
            if n==30 and not grouping:
                changed=page.evaluate(x["TWOCOL_JS"])
                assert changed["rows"]==30 and changed["twoColumns"]==2
                page.add_style_tag(content=x["COL_CSS"])
            page.evaluate(y["STAMP_JS"])
            page.add_style_tag(content=y["STAMP_CSS"])
            page.evaluate(y["FOOT_JS"])
            page.add_style_tag(content=y["FOUR"])
            page.evaluate(LOGO_JS)
            page.add_style_tag(content=LOGO_CSS)
            page.emulate_media(media="print")
            page.evaluate("async()=>{if(document.fonts?.ready)await document.fonts.ready}")
            lines=page.locator(".dense-original-details .dense-line-table tbody tr")
            assert lines.count()==n+1, (case,"lost original lines",lines.count())
            expected=6 if grouping else n
            selector=(".p40x-two-column-summary tbody tr" if n==30 and not grouping
                      else ".grouped-item-summary-table tbody tr")
            groups=page.locator(selector)
            assert groups.count()==expected+(0 if n==30 and not grouping else 1), (
                case,"lost grouped summary",groups.count())
            screen_text=page.locator("#paper").inner_text()
            assert "施工項目彙總" in screen_text and "原施工明細合計" in screen_text
            assert "SYNTH-指定M區" in screen_text and "SYNTH-其他L區" not in screen_text
            assert "原票號／狀態" not in screen_text
            assert "MOCK-LOGO" in screen_text and "SYNTH-SEAL-BOX" in screen_text
            font=page.eval_on_selector_all(
                ".dense-line-table th,.dense-line-table td,"
                ".grouped-item-summary-table th,.grouped-item-summary-table td",
                "(nodes)=>Math.min(...nodes.map(e=>parseFloat(getComputedStyle(e).fontSize)*72/96))")
            assert font>=8.0,(case,"less than 8pt",font)
            sizes=page.evaluate("""() => {
              const mm=96/25.4;
              const a=document.querySelector('.p40z-fake-logo').getBoundingClientRect();
              const b=document.querySelector('.p40y-neutral-placeholder').getBoundingClientRect();
              return {logo:[a.width/mm,a.height/mm],seal:[b.width/mm,b.height/mm]};
            }""")
            geom_error=[]
            for key,target in (("logo",(18,14)),("seal",(54,24))):
                actual=sizes[key]
                if any(abs(actual[k]-target[k])>0.8 for k in (0,1)):
                    geom_error.append({"item":key,"wanted":target,"actual":actual})
            pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
            doc=fitz.open(stream=pdf,filetype="pdf")
            (OUT/f"{case}.pdf").write_bytes(pdf)
            extracted=re.sub(r"\s+","", "".join(pg.get_text(sort=True) for pg in doc))
            missing=[]
            for i in range(1,n+1):
                if f"HB{i:02d}" not in extracted:
                    missing.append(f"source HB{i:02d}")
            for i in range(1,expected+1):
                if f"ZA{i:02d}" not in extracted:
                    missing.append(f"item ZA{i:02d}")
            for term in ("施工項目彙總","原施工明細合計","明細合計",
                         "客戶簽章","公司大小章","MOCK-LOGO","SYNTH-SEAL-BOX",
                         "指定M區","請款金額"):
                if term not in extracted:
                    missing.append(term)
            if "門框局部修補" not in extracted and kind=="short":
                missing.append("Chinese item glyphs")
            if "3150" not in extracted.replace(",","") and n==30:
                missing.append("gross 3150")
            if long_note and "修繕說明及數量核對" not in extracted:
                missing.append("complete Chinese public note")
            clipped=[]
            for pi,pg in enumerate(doc):
                assert 590<pg.rect.width<598 and 839<pg.rect.height<844, "Not A4"
                for block in pg.get_text("dict")["blocks"]:
                    for line in block.get("lines",[]):
                        for span in line.get("spans",[]):
                            if not span.get("text","").strip():continue
                            x0,y0,x1,y1=span["bbox"]
                            if x0<-.5 or y0<-.5 or x1>pg.rect.width+.5 or y1>pg.rect.height+.5:
                                clipped.append([pi,span["text"][:30]])
                pg.get_pixmap(matrix=fitz.Matrix(1.3,1.3),alpha=False).save(
                    str(OUT/f"{case}-page{pi+1}.png"))
            # Document-only validation. A not-one-page case MUST be treated
            # as blocked for any possible future release candidate.
            onepage=len(doc)==1
            hard_ok=(not missing and not clipped and not geom_error and font>=8)
            blocked=(not onepage or not hard_ok)
            record={"case":case,"a4_pages":len(doc),
                    "original_lines":n,"summary_groups":expected,
                    "min_table_pt":round(font,2),
                    "logo_mm":[round(x,2) for x in sizes["logo"]],
                    "seal_mm":[round(x,2) for x in sizes["seal"]],
                    "geometry_mismatch":geom_error,
                    "missing_pdf_text":missing,"clipped_pdf_text":clipped,
                    "a4_single_page":onepage,
                    "candidate_decision":"BLOCK" if blocked else "FIXTURE_ONLY_PASS"}
            records.append(record)
            print("P40Z_RESULT "+json.dumps(record,ensure_ascii=False),flush=True)
            doc.close()
        browser.close()
finally:
    server.shutdown()

(OUT/"results.json").write_text(json.dumps(records,ensure_ascii=False,indent=2))
hard_fail=[r for r in records if r["missing_pdf_text"] or r["clipped_pdf_text"] or
           r["geometry_mismatch"] or r["min_table_pt"]<8]
if hard_fail:
    print("P40Z_HARD_FAIL_CONTENT_OR_GEOMETRY "+json.dumps(hard_fail,ensure_ascii=False),flush=True)
    raise AssertionError("The Chinese PDF cannot be considered complete and readable")
for r in records:
    if r["candidate_decision"]=="BLOCK":
        print("P40Z_BLOCKED "+r["case"]+" A4 pages="+str(r["a4_pages"]),flush=True)
print("P40Z_DIAGNOSTIC_COMPLETE: candidate decisions are per case; not permission to publish.")
print("No formal main/beta/pdf code or real data modified. Actual stamp/logo images NOT tested.")
