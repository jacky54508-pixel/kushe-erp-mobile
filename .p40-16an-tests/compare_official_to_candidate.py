"""P40-16AN: render the *unchanged official* billing-print.html and the
P40-16AM local browser-generated PDF from the exact SAME SYNTHETIC public view.

This is a visual-parity **diagnostic**: a green CI must leave production
compatibility BLOCKED if layout or content differs. Uses only localhost,
no ERP storage, no Supabase, and no genuine logos or seals.
"""
import ast
import base64
import functools
import hashlib
import http.server
import json
import re
import threading
from pathlib import Path
from urllib.parse import quote

import fitz
from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
TEST=ROOT/".p40-16am-tests"
OUT=ROOT/".p40-16an-review"
OUT.mkdir(exist_ok=True)
FONT=ROOT/".p40-16ah-tests/runtime-font.ttf"
assert FONT.exists(),"STOP: ephemeral CJK font absent"
assert not (ROOT/".env").exists(),"STOP: .env not authorized"
for p in (
    ROOT/".p40-16ah-tests/node_modules/pdf-lib/dist/pdf-lib.min.js",
    ROOT/".p40-16ah-tests/node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
    ROOT/"billing-print.html",
    ROOT/"assets/js/external-billing-print.js"
):
    assert p.is_file(),("MISSING_SOURCE",p)

# To avoid redefining/guessing P40-16AM's synthetic contract, load ONLY
# its fixture function definition from the original checked-in source tree.
original_fixture_code=(TEST/"test_cross_zone_customer_pdf.py").read_text(encoding="utf-8")
tree=ast.parse(original_fixture_code)
fixture_ast=next(node for node in tree.body if isinstance(node,ast.FunctionDef)
                 and node.name=="fixture")
namespace={}
exec(compile(ast.fix_missing_locations(ast.Module(
     body=[fixture_ast],type_ignores=[])),"synthetic-fixture-only","exec"),namespace)
fixture=namespace["fixture"]

# Verbatim production validate/transform routines, as in P40-16AM.
source=(ROOT/"assets/js/external-billing-print.js").read_text()
a=source.index("  function validate(payload){")
b=source.index("  // P31-4:",a)
c=source.index("  function originalTemplateView(payload,d){")
d=source.index("  document.getElementById('close')",c)
assert 1400<b-a<9000 and 900<d-c<6000,"STOP official source signature changed"
runtime=TEST/"runtime_official_extract.js"
runtime.write_text(
    "(function(){'use strict';\n"+source[a:b]+"\n"+source[c:d]+"\n"+
    "window.P40AMOfficial={validate,originalTemplateView};\n})();",
    encoding="utf-8"
)
server=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"
svg_logo='''<svg xmlns="http://www.w3.org/2000/svg" width="180" height="140">
<rect width="178" height="138" x="1" y="1" fill="#f4f4f4" stroke="#777"/></svg>'''
svg_seal='''<svg xmlns="http://www.w3.org/2000/svg" width="540" height="240">
<rect width="536" height="236" x="2" y="2" fill="#f8f8f8" stroke="#777"/></svg>'''
def data_svg(s):
    return "data:image/svg+xml,"+quote(s,safe="")

def harmless_route(route):
    url=route.request.url
    # Never permit the original HTML to fetch genuine corporate logo/stamp
    # source from enterprise/index.html, or other image resources.
    if url.split("?")[0].endswith("/enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
                             body="<!doctype html><title>isolated blank enterprise</title>")
    if route.request.resource_type=="image":
        return route.fulfill(status=200,content_type="image/svg+xml",body=svg_logo)
    if url.startswith(BASE) or url.startswith("data:"):
        return route.continue_()
    return route.abort()

def read_pdf(pdf_bytes):
    pdf=fitz.open(stream=pdf_bytes,filetype="pdf")
    pages=len(pdf)
    text="\n".join(p.get_text(sort=True) for p in pdf)
    spans=[]
    for page_idx,page in enumerate(pdf):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines",[]):
                for span in line.get("spans",[]):
                    if not span["text"].strip():continue
                    spans.append({
                        "page":page_idx,"size":round(float(span["size"]),2),
                        "text":span["text"],"bbox":span["bbox"]
                    })
    first=pdf[0].get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False)
    image=Image.frombytes("RGB",[first.width,first.height],first.samples)
    dim=[[round(x.rect.width,2),round(x.rect.height,2)] for x in pdf]
    pdf.close()
    return {"pages":pages,"text":text,"spans":spans,"image":image,"dimensions":dim}

def find_text_size(info,term):
    found=[a["size"] for a in info["spans"] if term in a["text"]]
    return max(found) if found else None

def images_side_by_side(case,left,right):
    # Same physical page output scale. This is a proof of DIFFERENCE, not a
    # pixel-perfect acceptance test and no real logo/stamp is present.
    w=max(left.width,right.width)
    h=max(left.height,right.height)
    size=(w*2+24,h+52)
    canvas=Image.new("RGB",size,"#efefef")
    canvas.paste(left,(0,36))
    canvas.paste(right,(w+24,36))
    d=ImageDraw.Draw(canvas)
    d.text((12,12),"OFFICIAL HTML -> Chrome page.pdf (fictitious)",fill="#111111")
    d.text((w+36,12),"ISOLATED AM pdf-lib -> PDF bytes",fill="#111111")
    canvas.save(OUT/(case+"-side-by-side.png"))
    a=left.convert("L").resize((300,424))
    b=right.convert("L").resize((300,424))
    mask=ImageChops.difference(a,b)
    hist=mask.histogram()
    diff=sum(hist[6:])/sum(hist)
    return round(diff,4)

CASES=[
    ("cross-zone-8-lines",fixture((4,4))),
    ("cross-zone-18-lines",fixture((9,9))),
    ("cross-zone-30-six-groups",fixture((15,15),repeat_groups=6)),
]
report=[]
try:
  with sync_playwright() as browser_client:
    browser=browser_client.chromium.launch(headless=True)
    for context_name,width,height,sim_mobile in (
      ("desktop",1280,900,False),("mobile-sim",390,844,True)
    ):
      ctx=browser.new_context(
        viewport={"width":width,"height":height},
        is_mobile=sim_mobile,has_touch=sim_mobile
      )
      case_page=ctx.new_page()
      case_page.route("**/*",harmless_route)
      case_page.goto(BASE+".p40-16am-tests/index.html",wait_until="load")
      case_page.wait_for_function(
        "!!window.P40AMOfficial&&!!window.P40AMPDF&&!!window.KusheExternalBillingInvoice"
      )
      for label,payload in CASES:
        name=context_name+"-"+label
        raw=case_page.evaluate("""async payload=>{
          const source=JSON.stringify(payload);
          const officialValidated=P40AMOfficial.validate(payload);
          const officialView=P40AMOfficial.originalTemplateView(payload,officialValidated);
          const amended=P40AM.normalizeCustomerOnly(payload);
          const newer=await P40AMPDF.generate(payload);
          if(JSON.stringify(payload)!==source)throw Error('SOURCE_MUTATED');
          return {view:officialView,contract:amended,...newer};
        }""",payload)
        assert raw["view"]["project"]=="虛構M區"
        assert raw["contract"]["project"]=="虛構M區"
        assert raw["view"]["lines"]==payload["document"]["unified"]["lines"] or (
          len(raw["view"]["lines"])==len(payload["document"]["unified"]["lines"])
        )
        # Real browser-side PDF produced in page memory, not Playwright.
        candidate_pdf=base64.b64decode(raw["base64"])
        candidate=read_pdf(candidate_pdf)
        assert candidate["pages"]==1,(name,"NEW_PDF_NOT_ONE_A4")
        assert all(594.4<r[0]<596 and 841<r[1]<843
                   for r in candidate["dimensions"]),(name,"NEW_NOT_A4")
        # Original HTML printed by Chrome with the SAME OFFICIAL public view.
        encoded=base64.b64encode(json.dumps(
            raw["view"],ensure_ascii=False,separators=(",",":")
        ).encode("utf-8")).decode("ascii")
        url=BASE+"billing-print.html?print=0#"+quote(encoded,safe="")
        official_page=ctx.new_page()
        official_page.route("**/*",harmless_route)
        official_page.goto(url,wait_until="load")
        official_page.wait_for_function("window.__billingPrintReady===true")
        official_page.evaluate("""({logo,seal})=>{
          // Replace genuine images with neutral in-memory SVG placeholders
          // and keep the formal HTML/CSS fully unchanged.
          const mark=document.getElementById('formalCompanyLogo');
          const stamp=document.getElementById('formalCompanySeal');
          mark.hidden=false;mark.style.display='block';mark.src=logo;
          stamp.hidden=false;stamp.src=seal;
        }""",{"logo":data_svg(svg_logo),"seal":data_svg(svg_seal)})
        official_page.wait_for_function("""()=>
          [...document.images].every(i=>!i.src || i.complete)
        """)
        official_page.emulate_media(media="print")
        official_page.evaluate("""()=>
          document.fonts && document.fonts.ready
        """)
        geom=official_page.evaluate("""()=>{
          const all=(query)=>{
            const el=document.querySelector(query);
            if(!el)return null;
            const r=el.getBoundingClientRect(),css=getComputedStyle(el);
            return {left_pt:r.left*.75,top_pt:r.top*.75,
              width_mm:r.width*25.4/96,height_mm:r.height*25.4/96,
              font_pt:parseFloat(css.fontSize)*.75,
              text:el.innerText?.slice(0,100)};
          };
          return {
            head:all('.head'),
            company_title:all('.company h1'),
            doc_title:all('.doc-title h2'),
            logo_frame:all('.company-logo-frame'),
            detail:all('.dense-original-details'),
            group:all('.grouped-item-summary'),
            ordinary_summary:all('.section:not(.dense-original-details):not(.grouped-item-summary)'),
            money:all('.summary'),
            note:all('.note'),
            sign:all('.sign'),
            seal_wrap:all('.seal-wrap'),
            seal_image:all('.seal'),
            original_item_row_count:document.querySelectorAll('.dense-original-details tbody tr:not(.line-total)').length,
            original_group_count:document.querySelectorAll('.grouped-item-summary tbody tr:not(.line-total)').length,
            form_area:document.querySelector('#paper')?.className,
            original_is_dense:!!document.querySelector('.dense-original-details'),
            original_has_grouped_summary:!!document.querySelector('.grouped-item-summary')
          };
        }""")
        official_bytes=official_page.pdf(
          print_background=True,prefer_css_page_size=True,
          margin={"top":"0","right":"0","bottom":"0","left":"0"}
        )
        official=read_pdf(official_bytes)
        # Both PDFs are correct-bytes evidence; neither can authorize formal
        # release. Persist no genuine company artwork or source snapshot.
        (OUT/(name+"-official-synthetic.pdf")).write_bytes(official_bytes)
        (OUT/(name+"-candidate-synthetic.pdf")).write_bytes(candidate_pdf)
        pixel_diff=images_side_by_side(name,official["image"],candidate["image"])
        official_words=re.sub(r"\s+","",official["text"])
        candidate_words=re.sub(r"\s+","",candidate["text"])
        original_houses=[x["house"] for x in raw["expected"]["original"]]
        all_candidate_houses=all(h in candidate_words for h in original_houses)
        all_original_houses=all(h in official_words for h in original_houses)
        assert all_candidate_houses,(name,"NEW_LOST_HOUSE")
        private=[
          "PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-TOKEN",
          "虛構L區","虛構K區","虛構S區",
          "sourceSnapshots","invoiceNo"
        ]
        for leak in private:
            assert leak not in official["text"],(name,"official print disclosed",leak)
            assert leak not in candidate["text"],(name,"candidate print disclosed",leak)
        divergences=[]
        if official["pages"]!=candidate["pages"]:
            divergences.append("PAGE_COUNT_DIFFERENT")
        if geom["company_title"] and abs(geom["company_title"]["font_pt"]-11.3)>2:
            divergences.append("COMPANY_HEADING_FONT_DIFFERENT")
        if geom["doc_title"] and geom["doc_title"]["font_pt"]>15:
            divergences.append("OFFICIAL_SEPARATE_TITLE_MISSING_FROM_CANDIDATE")
        if geom["seal_wrap"] and abs(geom["seal_wrap"]["height_mm"]-24)>2:
            divergences.append("STAMP_RESERVED_HEIGHT_DIFFERENT")
        if geom["note"] and geom["note"]["width_mm"]>110:
            divergences.append("PUBLIC_NOTE_PANEL_WIDTH_DIFFERENT")
        if all_original_houses!=all_candidate_houses:
            divergences.append("ORIGINAL_HOUSES_VISIBILITY_DIFFERS")
        if not geom["original_has_grouped_summary"]:
            divergences.append("OFFICIAL_CONDITIONAL_BOTTOM_SUMMARY")
        if pixel_diff>.05:
            divergences.append("VISIBLE_LAYOUT_PIXEL_DIFFERENCE")
        assert "COMPANY_HEADING_FONT_DIFFERENT" in divergences,(
            name,"unexpected equivalence: re-evaluate parity gate")
        assert "OFFICIAL_SEPARATE_TITLE_MISSING_FROM_CANDIDATE" in divergences
        outcome={
          "case":name,
          "official_pdf_pages":official["pages"],
          "candidate_pdf_pages":candidate["pages"],
          "official_A4_pages":all(594.4<r[0]<596 and 841<r[1]<843
                                  for r in official["dimensions"]),
          "all_house_labels_official":all_original_houses,
          "all_house_labels_candidate":all_candidate_houses,
          "official_company_font_pt":round(geom["company_title"]["font_pt"],1),
          "candidate_heading_font_pt":11.3,
          "official_doc_title_font_pt":round(geom["doc_title"]["font_pt"],1),
          "official_logo_frame_mm":(
             [round(geom["logo_frame"]["width_mm"],1),
              round(geom["logo_frame"]["height_mm"],1)]
             if geom["logo_frame"] else None
          ),
          "candidate_logo_frame_mm":[18,14],
          "official_seal_wrap_height_mm":round(geom["seal_wrap"]["height_mm"],1)
             if geom["seal_wrap"] else None,
          "candidate_mock_seal_height_mm":24,
          "official_has_original_detail":geom["original_is_dense"],
          "official_has_bottom_grouped_summary":geom["original_has_grouped_summary"],
          "official_detail_rows":geom["original_item_row_count"],
          "official_summary_rows":geom["original_group_count"],
          "visual_pixel_diff_fraction":pixel_diff,
          "privacy_sentinels_absent":True,
          "sha256_official":hashlib.sha256(official_bytes).hexdigest(),
          "sha256_candidate":hashlib.sha256(candidate_pdf).hexdigest(),
          "divergence_codes":divergences,
          "production_visual_parity":"BLOCKED"
        }
        report.append(outcome)
        print("P40AN_COMPARE "+json.dumps(outcome,ensure_ascii=False),flush=True)
        official_page.close()
      ctx.close()
    browser.close()
finally:
  server.shutdown()
  runtime.unlink(missing_ok=True)

assert len(report)==len(CASES)*2
assert all(r["privacy_sentinels_absent"] for r in report)
assert all(r["production_visual_parity"]=="BLOCKED" for r in report)
assert all("VISIBLE_LAYOUT_PIXEL_DIFFERENCE" in r["divergence_codes"] for r in report)
(OUT/"comparison.json").write_text(json.dumps({
  "disposition":"BLOCKED",
  "category":"READ_ONLY_VISUAL_DIAGNOSTIC",
  "actual_company_assets_used":False,
  "actual_ERP_data_used":False,
  "real_mobile_tested":False,
  "production_ready":False,
  "note":"A green CI means differences were detected, NOT parity.",
  "cases":report
},indent=2,ensure_ascii=False))
with (OUT/"COMPARISON.md").open("w") as f:
    f.write("# P40-16AN: official vs candidate PDF — isolated visual comparison\n\n")
    f.write("**NOT PRODUCTION EQUIVALENT. Differences are expected and remain blockers.**\n\n")
    f.write("| Fixture | Original A4 pages | Candidate A4 pages | Original houses all shown? | Differences |\n")
    f.write("|---|---:|---:|---|---|\n")
    for item in report:
        f.write(f"| {item['case']} | {item['official_pdf_pages']} | "
                f"{item['candidate_pdf_pages']} | "
                f"{item['all_house_labels_official']} | "
                f"{', '.join(item['divergence_codes'])} |\n")
    f.write("\nOfficial CSS company heading is ~21pt, separate document title ~21.5pt; "
            "candidate heading is 11.3pt and does not match. "
            "Original seal display zone uses its own print CSS; candidate has a fixed mock 24mm zone. "
            "Official bottom grouped summary may be conditional on dense billing. "
            "The preview's fake images are neutral placeholders only. "
            "This exercise does not compare or disclose genuine company logo or seal.\n")
print("P40AN_COMPLETE: official and candidate synthetic PDFs rendered in same browser; production parity remains BLOCKED.")
