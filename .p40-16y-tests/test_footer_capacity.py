"""P40-16Y isolated A4 footer capacity experiment, strictly synthetic.

Transforms ONLY the ephemeral Chromium DOM (not GitHub production HTML/JS).
Starts with the previously tested P40-16X two-column summary. Reserves a
54mm x 24mm neutral fake stamp box, a usable customer-signature zone, full
amounts, note, and all construction lines, and compares footer layouts.
No live login, Supabase, real ERP data, or real company stamp.
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
OUT=ROOT/".p40-16y-artifacts"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(), "STOP: project secrets detected"
def constants(path):
    tree=ast.parse(path.read_text())
    out={}
    for node in tree.body:
        if isinstance(node,ast.Assign):
            for target in node.targets:
                if isinstance(target,ast.Name) and target.id in (
                    "TWOCOL_JS","COL_CSS","PROFILES"
                ):
                    out[target.id]=ast.literal_eval(node.value)
    return out
x=constants(ROOT/".p40-16x-tests/test_two_column_summary.py")
v=constants(ROOT/".p40-16v-tests/test_print_style_profiles.py")
assert x["TWOCOL_JS"] and x["COL_CSS"] and v["PROFILES"]["compact-a4-dense"]
COMPACT=v["PROFILES"]["compact-a4-dense"]
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def payload(count, unique=True, long=False, long_note=False):
    lines=[]
    for i in range(count):
        number=i+1 if unique else (i%6)+1
        item=f"SYNTH-ITEM-{number:02d}"
        if long: item += "-LONG-SERVICE-DESCRIPTION"
        lines.append({"house":f"SYNTH-H-{i+1:02d}","item":item,
                      "unit":"式","qty":1,"price":100,"amount":100,
                      "sourcePricingType":"external-document",
                      "pricingType":""})
    return {
       "schema":"kushe-external-document-v1", "documentType":"billing",
       "title":"請款單","number":"","customer":"SYNTH-TEST-CUSTOMER",
       "project":"SYNTH-TARGET-M","date":"2026-11-17",
       "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
       "lines":lines,"salesAmount":count*100,"taxAmount":count*5,
       "totalAmount":count*105,"retentionAmount":0,"receivableAmount":count*105,
       "publicNote":("SYNTHETIC ONLY " * 21) if long_note else "SYNTHETIC ONLY -- NOT FOR CUSTOMERS",
       "company":{"name":"SYNTH-TEST-COMPANY","englishName":"SYNTHETIC ONLY",
                  "taxId":"00000000","address":"SYNTH-LOCATION","line":"SYNTH"},
       "fileName":"SYNTH-DO-NOT-SEND.pdf",
       "mergedBillingProjects":["SYNTH-TARGET-M"],
       "isMergedExternalBilling":True
    }
def hash_payload(data):
    return quote(base64.b64encode(
        json.dumps(data,ensure_ascii=False,separators=(",",":")).encode()
    ).decode(),safe="")

# Deliberately do NOT load actual corporate logo or stamped company seal.
def only_local(route):
    u=route.request.url
    if u.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
          body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    return route.continue_() if u.startswith(BASE) else route.abort()

STAMP_JS=r"""() => {
 const image=document.querySelector('#formalCompanySeal');
 if(image) image.removeAttribute('src');
 const wrap=document.querySelector('.seal-wrap');
 if(!wrap) throw Error('formal seal space missing');
 wrap.replaceChildren();
 const b=document.createElement('div');
 b.className='p40y-neutral-placeholder';
 b.textContent='SYNTH-SEAL-BOX';
 wrap.appendChild(b);
 const logo=document.querySelector('#formalCompanyLogo');
 if(logo){logo.removeAttribute('src');logo.style.display='none'}
 return true;
}"""
FOOT_JS=r"""() => {
 const root=document.querySelector('#paper');
 const sum=root?.querySelector(':scope > .summary');
 const note=root?.querySelector(':scope > .note');
 const sign=root?.querySelector(':scope > .sign');
 const client=sign?.querySelector(':scope > .client-sign');
 const seals=sign?.querySelector(':scope > .company-seals');
 if(!root||!sum||!note||!sign||!client||!seals) throw Error('footer structure changed');
 const prior={summary:sum.innerText,note:note.innerText,
              client:client.innerText,seal:seals.innerText};
 const footer=document.createElement('section');
 footer.className='p40y-footer';
 footer.append(client,note,sum,seals);
 sign.remove();
 root.append(footer);
 const after={summary:sum.innerText,note:note.innerText,
              client:client.innerText,seal:seals.innerText};
 if(JSON.stringify(prior)!==JSON.stringify(after)) throw Error('footer content changed');
 return prior;
}"""
STAMP_CSS=r"""
@media print {
 .paper.invoice-group-document .company-seals .seal-wrap{
    height:26mm!important;min-height:26mm!important;
    display:flex!important;align-items:center!important;justify-content:center!important;
 }
 .p40y-neutral-placeholder {
    box-sizing:border-box;width:54mm;height:24mm;
    border:1px dashed #9ba8b0;background:#fafafa;color:#555;
    display:flex;justify-content:center;align-items:center;font-size:8.3pt;
 }
 .paper.invoice-group-document .client-sign {min-height:13mm!important;padding-top:8mm!important}
}
"""
FOUR=r"""
@media print {
 .paper.invoice-group-document .p40y-footer {
   display:grid!important;grid-template-columns:23fr 21fr 24fr 32fr;
   gap:1.4mm;align-items:start;margin-top:1.1mm;
   break-inside:avoid!important;page-break-inside:avoid!important;
 }
 .paper.invoice-group-document .p40y-footer .client-sign {width:100%;margin:0;min-height:13mm!important}
 .paper.invoice-group-document .p40y-footer .note {
   width:100%;margin:0!important;min-width:0;
   padding:.7mm 1mm!important;font-size:8.2pt!important;line-height:1.25!important;
 }
 .paper.invoice-group-document .p40y-footer .summary {
   width:100%!important;min-width:0;margin:0!important;
 }
 .paper.invoice-group-document .p40y-footer .summary-row {
   min-height:5.8mm!important;padding:.4mm .8mm!important;
   gap:.5mm!important;font-size:8.2pt!important;
 }
 .paper.invoice-group-document .p40y-footer .summary-row strong {
   font-size:8.8pt!important;white-space:nowrap!important;
 }
 .paper.invoice-group-document .p40y-footer .company-seals {
   text-align:center!important;min-width:0;
 }
 .paper.invoice-group-document .p40y-footer .seal-wrap{height:26mm!important;min-height:26mm!important}
 .paper.invoice-group-document .p40y-footer .p40y-neutral-placeholder {
   max-width:100%;width:54mm;height:24mm;
 }
}
"""
TWO=r"""
@media print {
 .paper.invoice-group-document .p40y-footer{
   display:grid!important;grid-template-columns:1fr 1fr;gap:1mm 4mm;
   grid-template-areas:"note summary" "client seals";
   margin-top:1mm;break-inside:avoid!important
 }
 .paper.invoice-group-document .p40y-footer .note{grid-area:note;width:100%;margin:0!important}
 .paper.invoice-group-document .p40y-footer .summary{grid-area:summary;width:100%;margin:0!important}
 .paper.invoice-group-document .p40y-footer .client-sign{grid-area:client;width:100%;margin:0}
 .paper.invoice-group-document .p40y-footer .company-seals{grid-area:seals}
 .paper.invoice-group-document .p40y-footer .seal-wrap{height:26mm!important;min-height:26mm!important}
}
"""

# Include a long note for a meaningful stress check.
cases=[("30-short",False,False,True),
       ("30-long",True,False,True),
       ("30-long-note",False,True,True),
       ("30-six-groups",False,False,False)]
profiles=("baseline-with-stamp","two-column-footer","four-column-footer")
reports=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={"width":1280,"height":900})
        page.route("**/*",only_local)
        for label,long,long_note,unique in cases:
            fixture=payload(30,unique=unique,long=long,long_note=long_note)
            for profile in profiles:
                page.goto(BASE+f"billing-print.html?print=0&case={label}&footer={profile}#"+
                          hash_payload(fixture),wait_until="load")
                page.locator(".dense-original-details .dense-line-table").wait_for()
                page.add_style_tag(content=COMPACT)
                if unique:
                    conv=page.evaluate(x["TWOCOL_JS"])
                    assert conv["rows"]==30 and conv["twoColumns"]==2
                    page.add_style_tag(content=x["COL_CSS"])
                page.evaluate(STAMP_JS)
                page.add_style_tag(content=STAMP_CSS)
                if profile!="baseline-with-stamp":
                    page.evaluate(FOOT_JS)
                    page.add_style_tag(content=FOUR if profile=="four-column-footer" else TWO)
                page.emulate_media(media="print")
                orig=page.locator(".dense-original-details .dense-line-table tbody tr")
                assert orig.count()==31, "source line count differs"
                summary_selector=(".p40x-two-column-summary tbody tr" if unique
                                  else ".grouped-item-summary-table tbody tr")
                sc=page.locator(summary_selector).count()
                assert sc==(30 if unique else 7),("summary rows",label,sc)
                pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
                doc=fitz.open(stream=pdf,filetype="pdf")
                stem=f"{label}-{profile}"
                (OUT/f"{stem}.pdf").write_bytes(pdf)
                alltext=re.sub(r"\s+","", "".join(pg.get_text(sort=True) for pg in doc))
                missing=[]
                for i in range(1,31):
                    if f"SYNTH-H-{i:02d}" not in alltext: missing.append(f"SYNTH-H-{i:02d}")
                for i in range(1,(31 if unique else 7)):
                    if f"SYNTH-ITEM-{i:02d}" not in alltext: missing.append(f"SYNTH-ITEM-{i:02d}")
                for term in ("SYNTH-TARGET-M","原施工明細合計","明細合計",
                             "請款金額","SYNTH-SEAL-BOX","客戶簽章","公司大小章"):
                    if term not in alltext: missing.append(term)
                minfont=page.eval_on_selector_all(
                   ".dense-line-table th,.dense-line-table td,"
                   ".grouped-item-summary-table th,.grouped-item-summary-table td",
                   "(nodes)=>Math.min(...nodes.map(e=>parseFloat(getComputedStyle(e).fontSize)*72/96))")
                spills=[]
                for index,pg in enumerate(doc):
                    assert 590<=pg.rect.width<=597 and 839<=pg.rect.height<=844,"non-A4 dimensions"
                    for block in pg.get_text("dict")["blocks"]:
                        for line in block.get("lines",[]):
                            for span in line.get("spans",[]):
                                if not span["text"].strip():continue
                                x0,y0,x1,y1=span["bbox"]
                                if x0<-.5 or y0<-.5 or x1>pg.rect.width+.5 or y1>pg.rect.height+.5:
                                    spills.append((index,span["text"][:30]))
                    pg.get_pixmap(matrix=fitz.Matrix(1.2,1.2),alpha=False).save(
                         str(OUT/f"{stem}-page{index+1}.png"))
                total_amount_present=("3,150" in alltext or "3150" in alltext)
                if not total_amount_present:missing.append("gross total 3150")
                record={"case":label,"profile":profile,"pages":len(doc),
                        "font_pt":round(minfont,2),"missing":missing,
                        "clipped":spills,"one_page":len(doc)==1}
                reports.append(record)
                print("P40Y_RESULT "+json.dumps(record,ensure_ascii=False),flush=True)
                doc.close()
        browser.close()
finally:
    server.shutdown()
(OUT/"results.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2))
hard_errors=[r for r in reports if r["missing"] or r["clipped"] or r["font_pt"]<8]
if hard_errors: raise AssertionError("CONTENT OR READABILITY BLOCKED "+json.dumps(hard_errors,ensure_ascii=False))
for r in reports:
    if not r["one_page"]:
        print("P40Y_A4_BLOCKED "+r["case"]+" "+r["profile"]+" pages="+str(r["pages"]),flush=True)
print("P40Y_DIAGNOSTIC_COMPLETE: ONE PAGE only for cases explicitly marked one_page=true.")
print("No production files/data were changed. Real seal dimensions still need real human verification.")
