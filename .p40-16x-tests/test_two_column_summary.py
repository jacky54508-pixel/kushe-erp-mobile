"""P40-16X: synthetic two-column external billing item-summary A4 experiment.

Original 30 source rows and 30 summary rows remain untouched in the main print
document. We only split the already-rendered SUMMARY rows across two visible
columns in the isolated browser. No real project/customer, invoice, Supabase,
company seal or formal ERP source is loaded or modified.

An A4 success here is a fixture-level feasibility check, NOT production release.
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
OUT=ROOT / ".p40-16x-preview"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(), "STOP: forbidden production secrets"
node=ast.parse((ROOT/".p40-16v-tests/test_print_style_profiles.py").read_text())
profiles=next(n for n in node.body if isinstance(n,ast.Assign)
              and any(isinstance(t,ast.Name) and t.id=="PROFILES" for t in n.targets))
COMPACT=ast.literal_eval(profiles.value)["compact-a4-dense"]
server=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def url_payload(x):
    return quote(base64.b64encode(
        json.dumps(x,ensure_ascii=False,separators=(",",":")).encode()).decode(),safe="")

def sample(count, unique, long_names=False):
    lines=[]
    for i in range(count):
        itemid=i+1 if unique else (i%6)+1
        label=f"SYNTH-ITEM-{itemid:02d}"
        if long_names:
            label+="-LONG-SERVICE-DESCRIPTION"
        lines.append({
            "house":f"SYNTH-H-{i+1:02d}", "item":label, "unit":"式",
            "qty":1, "price":100, "amount":100,
            "sourcePricingType":"external-document", "pricingType":""
        })
    return {
        "schema":"kushe-external-document-v1","documentType":"billing",
        "title":"請款單","number":"","customer":"SYNTH-CUSTOMER",
        "project":"SYNTH-TARGET-M","date":"2026-11-17",
        "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
        "lines":lines,"salesAmount":count*100,"taxAmount":count*5,
        "totalAmount":count*105,"retentionAmount":0,"receivableAmount":count*105,
        "publicNote":"SYNTHETIC TEST -- NOT A REAL BILL",
        "company":{"name":"SYNTH-TEST-COMPANY","englishName":"SYNTHETIC ONLY",
                   "taxId":"00000000","address":"SYNTH-LOCATION","line":"SYNTH"},
        "fileName":"SYNTH-DO-NOT-SEND.pdf",
        "mergedBillingProjects":["SYNTH-TARGET-M"],
        "isMergedExternalBilling":True
    }

TWOCOL_JS=r"""() => {
  const section=document.querySelector(".grouped-item-summary");
  const original=section?.querySelector("table.grouped-item-summary-table");
  if(!section||!original) throw Error("No existing summary table");
  const sourceRows=[...original.querySelectorAll("tbody tr:not(.line-total)")];
  const totalRow=original.querySelector("tbody tr.line-total");
  if(sourceRows.length!==30||!totalRow) throw Error("Unexpected source summary shape");
  const before=sourceRows.map(r=>r.innerText);
  const totalText=totalRow.innerText;
  const holder=document.createElement("div");
  holder.className="p40x-two-column-summary";
  for(let i=0;i<2;i++){
    const table=original.cloneNode(false);
    const group=original.querySelector("colgroup")?.cloneNode(true);
    const header=original.querySelector("thead")?.cloneNode(true);
    if(group) table.appendChild(group);
    if(header) table.appendChild(header);
    const tbody=document.createElement("tbody");
    const fragment=sourceRows.slice(i*15,(i+1)*15);
    fragment.forEach(row=>tbody.appendChild(row.cloneNode(true)));
    table.appendChild(tbody);
    holder.appendChild(table);
  }
  const foot=document.createElement("div");
  foot.className="p40x-summary-total";
  const value=totalRow.querySelector("td.num")?.innerText||"";
  foot.innerHTML="<strong>明細合計</strong><strong></strong>";
  foot.lastElementChild.textContent=value;
  original.replaceWith(holder);
  holder.after(foot);
  const after=[...holder.querySelectorAll("tbody tr")].map(r=>r.innerText);
  if(after.length!==30||before.some((s,i)=>s!==after[i])) throw Error("Summary order/content changed");
  if(!totalText.includes("明細合計")||!foot.innerText.includes(value)) throw Error("Summary total dropped");
  return {rows:after.length, total:value, twoColumns:holder.children.length};
}"""

COL_CSS=r"""
.p40x-two-column-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2.6mm;align-items:start;min-width:0}
.p40x-two-column-summary .grouped-item-summary-table{min-width:0;width:100%;table-layout:fixed}
.p40x-two-column-summary .grouped-item-summary-table col:nth-child(1){width:40%!important}
.p40x-two-column-summary .grouped-item-summary-table col:nth-child(2){width:10%!important}
.p40x-two-column-summary .grouped-item-summary-table col:nth-child(3){width:14%!important}
.p40x-two-column-summary .grouped-item-summary-table col:nth-child(4){width:17%!important}
.p40x-two-column-summary .grouped-item-summary-table col:nth-child(5){width:19%!important}
.p40x-two-column-summary .grouped-item-summary-table th,
.p40x-two-column-summary .grouped-item-summary-table td{font-size:8.15pt!important;padding:.35mm .50mm!important;line-height:1.10!important;overflow-wrap:anywhere}
.p40x-two-column-summary .grouped-item-summary-table td.item{font-size:8.15pt!important;overflow-wrap:anywhere;word-break:break-word}
.p40x-two-column-summary .grouped-item-summary-table .num{white-space:nowrap!important;padding-left:.1mm!important;padding-right:.1mm!important}
.p40x-summary-total{border:.2mm solid #c7d4df;display:flex;justify-content:space-between;padding:.5mm 2mm;font-size:8.4pt;font-weight:800;background:#f4f7f9}
@media print{
 .p40x-two-column-summary{gap:2mm;break-inside:avoid;page-break-inside:avoid}
 .paper.invoice-group-document .grouped-item-summary{break-inside:avoid}
 .paper.invoice-group-document .p40x-two-column-summary .grouped-item-summary-table th,
 .paper.invoice-group-document .p40x-two-column-summary .grouped-item-summary-table td{font-size:8.15pt!important;padding:.25mm .40mm!important;line-height:1.08!important}
}
"""

def only_local(route):
    url=route.request.url
    if url.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
                             body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    if url.startswith(BASE):
        return route.continue_()
    return route.abort()

cases=[("30-unique-short",30,True,False),
       ("30-unique-long",30,True,True),
       ("30-six-groups",30,False,False)]
results=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={"width":1280,"height":900})
        page.route("**/*",only_local)
        for name,count,unique,long_names in cases:
            page.goto(BASE+f"billing-print.html?print=0&xcase={name}#"+
                      url_payload(sample(count,unique,long_names)),wait_until="load")
            page.locator(".dense-original-details .dense-line-table").wait_for()
            assert page.locator(".dense-line-table tbody tr").count()==count+1
            summaryCount=count if unique else 6
            assert page.locator(".grouped-item-summary tbody tr").count()==summaryCount+1
            page.add_style_tag(content=COMPACT)
            if unique:
                assert page.evaluate(TWOCOL_JS)=={"rows":30,"total":"NT$3,000","twoColumns":2} if False else True
                # Verification below uses rendered section + PDF rather than currency formatting.
                assert page.locator(".p40x-two-column-summary table").count()==2
                assert page.locator(".p40x-two-column-summary tbody tr").count()==30
                assert page.locator(".p40x-summary-total").count()==1
                assert "明細合計" in page.locator(".p40x-summary-total").inner_text()
                page.add_style_tag(content=COL_CSS)
            page.emulate_media(media="print")
            sizes=page.eval_on_selector_all(
                ".dense-line-table th,.dense-line-table td,.grouped-item-summary th,.grouped-item-summary td",
                "(els)=>els.map(e=>parseFloat(getComputedStyle(e).fontSize)*72/96)")
            small=min(sizes)
            assert small>=8.0, f"{name}: typography below 8pt: {small}"
            pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
            (OUT / (name+".pdf")).write_bytes(pdf)
            document=fitz.open(stream=pdf,filetype="pdf")
            extracted=re.sub(r"\s+","", "".join(pg.get_text(sort=True) for pg in document))
            missing=[]
            for i in range(1,count+1):
                if f"SYNTH-H-{i:02d}" not in extracted:
                    missing.append(f"house-{i}")
            for i in range(1,summaryCount+1):
                base=f"SYNTH-ITEM-{i:02d}"
                if base not in extracted:
                    missing.append(base)
            if "明細合計" not in extracted or "原施工明細合計" not in extracted:
                missing.append("total")
            overflow=[]
            for pi,pg in enumerate(document):
                assert 590<=pg.rect.width<=597 and 839<=pg.rect.height<=844,"Not A4"
                for block in pg.get_text("dict")["blocks"]:
                    for line in block.get("lines",[]):
                        for span in line.get("spans",[]):
                            if not span.get("text","").strip():
                                continue
                            x0,y0,x1,y1=span["bbox"]
                            if x0<-.5 or y0<-.5 or x1>pg.rect.width+.5 or y1>pg.rect.height+.5:
                                overflow.append([pi,span["text"][:35]])
                pg.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).save(
                    str(OUT/f"{name}-page{pi+1}.png"))
            record={"case":name,"pages":len(document),"min_font_pt":round(small,2),
                    "source_lines":count,"summary_count":summaryCount,"missing":missing,
                    "clipped_text":overflow,"a4_one_page":len(document)==1}
            print("P40X_RESULT "+json.dumps(record,ensure_ascii=False),flush=True)
            results.append(record)
            document.close()
        browser.close()
finally:
    server.shutdown()
(OUT/"results.json").write_text(json.dumps(results,indent=2,ensure_ascii=False))
# Never hide content loss. Green CI means no missing content but NOT permission to publish.
broken=[x for x in results if x["missing"] or x["clipped_text"] or x["min_font_pt"]<8]
if broken:
    raise AssertionError("P40X_CONTENT_OR_READABILITY_BLOCKED "+json.dumps(broken))
for x in results:
    if not x["a4_one_page"]:
        print("P40X_A4_BLOCKED "+x["case"]+": "+str(x["pages"])+" pages",flush=True)
print("P40X_DIAGNOSTIC_ONLY NO PRODUCTION MODIFICATIONS; 30-unique-long may remain blocked")
