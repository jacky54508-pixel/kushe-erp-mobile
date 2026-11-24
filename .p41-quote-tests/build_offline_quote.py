#!/usr/bin/env python3
"""Build a local quotation-only exporter from the reviewed print renderer.

The generated file imports an existing preview URL fragment in the browser.
It performs no fetch, ERP writes, storage writes, or financial recalculation.
"""
import argparse
import base64
import json
from pathlib import Path
import re
import struct
import zlib


def synthetic_png(seed):
    width, height = 160, 110
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.extend(((x * 7 + y * 3 + seed) % 256,
                         (x * 3 + y * 11 + seed) % 256,
                         (x * 13 + y * 5 + seed) % 256, 255))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0))
    raw += chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')


def assets_from_source(root, asset_dir, synthetic):
    names = ('companyLogoAsset', 'companySealAsset')
    if synthetic:
        return {name: synthetic_png(31 + i * 101) for i, name in enumerate(names)}
    if asset_dir:
        return {name: (asset_dir / (name + '.txt')).read_text('utf-8') for name in names}
    source = (root / 'enterprise/index.html').read_text('utf-8')
    result = {}
    for name in names:
        start = source.index('const ' + name + '=')
        end = re.search(r';\r?\n', source[start:])
        if not end:
            raise ValueError('Incomplete original asset: ' + name)
        result[name] = ''.join(re.findall(r"'([^']*)'", source[start:start + end.start()]))
    return result


def script_json(value):
    return json.dumps(value, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def build(root, output, asset_dir=None, synthetic=False):
    template = (root / 'billing-print.html').read_text('utf-8')
    for relative in ('assets/css/p40-16cd-mint-quotation-billing.css',
                     'assets/css/p41-quote-pagination.css'):
        pattern = r'<link\s+rel="stylesheet"\s+href="' + re.escape(relative) + r'[^\"]*">'
        template, count = re.subn(pattern, lambda _: '<style>\n' + (root / relative).read_text('utf-8') + '\n</style>', template)
        if count != 1:
            raise ValueError('Missing stylesheet ' + relative)
    for relative in ('assets/js/display-sort.js', 'assets/js/external-billing-invoice.js',
                     'assets/js/p41-quote-pagination.js'):
        pattern = r'<script\s+src="' + re.escape(relative) + r'[^\"]*"></script>'
        code = (root / relative).read_text('utf-8').replace('</script', '<\\/script')
        template, count = re.subn(pattern, lambda _: '<script>\n' + code + '\n</script>', template)
        if count != 1:
            raise ValueError('Missing script ' + relative)
    start = template.index('    let d={};try{')
    end = template.index('    const lines=', start)
    template = template[:start] + '    let d=__QUOTE_OFFLINE_PAYLOAD_JSON__;\n' + template[end:]
    start = template.index('      const enterpriseUrl=')
    end = template.index('      for(const [name,id]', start)
    assets = assets_from_source(root, asset_dir, synthetic)
    for name, value in assets.items():
        if not value.startswith('data:image/png;base64,') or len(value) < 1024:
            raise ValueError('Invalid company asset: ' + name)
    source = ''.join("const " + name + "='" + value + "';\n" for name, value in assets.items())
    template = template[:start] + '      const source=' + script_json(source) + ';\n' + template[end:]
    template = template.replace("const autoPrint=new URLSearchParams(location.search).get('print')==='1';", 'const autoPrint=false;')
    template = re.sub(r'    function closePrintView\(\)\{[^\n]+',
                      "    function closePrintView(){window.parent.postMessage({type:'kushe-quote-close'},'*')}", template, count=1)
    policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    template = template.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">', 1)
    if re.search(r'<(?:script[^>]+src|link[^>]+href)=', template):
        raise ValueError('Offline template still has an external dependency')
    shell = '''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' about:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>酷舍報價單｜A4 分頁匯出</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#edf3f4;color:#143044;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}
.import-panel{max-width:900px;margin:28px auto 18px;padding:26px;background:white;border:1px solid #c9dfe0;border-radius:14px}
h1{margin:0 0 12px;color:#078a80;font-size:23px}p{line-height:1.7;margin:8px 0;font-size:14px}label{display:block;font-weight:700;margin:16px 0 8px}
textarea{width:100%;min-height:100px;resize:vertical;padding:12px;border:1px solid #a7bec4;border-radius:8px;font:13px/1.5 monospace;overflow-wrap:anywhere}
button{margin-top:12px;padding:12px 20px;border:0;border-radius:8px;color:#fff;background:#078a80;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}#importStatus{min-height:24px;color:#3b5d66}#importStatus.error{color:#a32121}iframe{display:block;width:100%;height:calc(100vh - 40px);border:0;background:#edf1f4}iframe[hidden]{display:none}.hint{color:#516b74;font-size:13px}
@media(max-width:650px){.import-panel{margin:12px;padding:18px}h1{font-size:20px}}
@media print{.import-panel{display:none}iframe{height:auto}}
</style></head><body>
<section class="import-panel"><h1>報價單 A4 分頁匯出</h1>
<p>在 ERP 開啟這份報價單的「預覽」，按 <b>Ctrl＋L</b>、<b>Ctrl＋C</b> 複製預覽網址，再貼到下方。產生後，使用報價預覽中的「匯出 PDF／列印」。</p>
<p class="hint">保留原報價項目、數量、單價、金額與備註全文；長內容會接續到下一頁。內容只在這個本機頁面處理。</p>
<label for="quotationUrl">報價單預覽網址</label><textarea id="quotationUrl" spellcheck="false" placeholder="貼上包含 # 文件資料的報價單預覽網址"></textarea>
<button id="renderQuotation" type="button">產生分頁報價單</button><p id="importStatus" role="status" aria-live="polite"></p>
</section>
<iframe id="quotationPreview" title="報價單分頁預覽" hidden></iframe>
<script>
'use strict';
const TEMPLATE=__TEMPLATE_JSON__;
const field=document.getElementById('quotationUrl'),button=document.getElementById('renderQuotation'),frame=document.getElementById('quotationPreview'),status=document.getElementById('importStatus');
const safeJson=value=>JSON.stringify(value).replaceAll('<',String.fromCharCode(92)+'u003c').replaceAll(String.fromCharCode(8232),String.fromCharCode(92)+'u2028').replaceAll(String.fromCharCode(8233),String.fromCharCode(92)+'u2029');
button.addEventListener('click',()=>{
  status.className='';status.textContent='';
  try{
    const input=field.value.trim(),hash=input.indexOf('#');
    if(hash<0||hash===input.length-1)throw new Error('請複製「報價單預覽」的完整網址，網址需要包含 # 後方的文件資料。');
    const encoded=decodeURIComponent(input.slice(hash+1));
    if(encoded.length>3000000)throw new Error('文件內容過大，請保留原報價並回報。');
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!payload||payload.documentType!=='quotation'||!Array.isArray(payload.lines))throw new Error('這個網址不是報價單預覽，請回到 ERP 的報價單重新複製。');
    frame.hidden=false;frame.srcdoc=TEMPLATE.replace('__QUOTE_OFFLINE_PAYLOAD_JSON__',()=>safeJson(payload));
    status.textContent='正在整理分頁。完成後請在下方預覽按「匯出 PDF／列印」。';
  }catch(error){frame.hidden=true;frame.removeAttribute('srcdoc');status.className='error';status.textContent=error.message||'無法讀取報價資料，請重新複製完整預覽網址。';}
});
frame.addEventListener('load',()=>{
  if(frame.hidden)return;
  const started=Date.now();
  const timer=setInterval(()=>{
    const child=frame.contentWindow;
    if(child.__billingPrintReady){clearInterval(timer);status.className='';status.textContent='分頁已完成。請核對原報價內容，再按下方「匯出 PDF／列印」。';}
    else if(child.__billingPrintError||Date.now()-started>20000){clearInterval(timer);status.className='error';status.textContent='分頁或公司圖片未完成，請查看下方訊息並保留此頁回報。';}
  },100);
});
window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='kushe-quote-close'){frame.hidden=true;field.focus();}});
</script></body></html>'''
    shell = shell.replace('__TEMPLATE_JSON__', script_json(template))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(shell, encoding='utf-8')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--asset-dir', type=Path)
    parser.add_argument('--synthetic-assets', action='store_true')
    args = parser.parse_args()
    print(build(args.root, args.output, args.asset_dir, args.synthetic_assets))
