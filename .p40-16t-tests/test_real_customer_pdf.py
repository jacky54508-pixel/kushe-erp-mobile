"""P40-16T: Synthetic browser/PDF renderer smoke tests only. No production login or data."""
import base64
import functools
import http.server
import io
import json
import os
import threading
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parent.parent
assert not (ROOT/'.env').exists(), 'STOP: local secret file must not be present'
server=http.server.ThreadingHTTPServer(('127.0.0.1', 0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
base=f'http://127.0.0.1:{server.server_port}/'

def encoded(d):
    return quote(base64.b64encode(json.dumps(d,ensure_ascii=False,separators=(',',':')).encode()).decode(),safe='')

def fixture():
    lines=[
        dict(house='SYNTH-1',item='SYNTH-牆面美容',unit='式',qty=2,price=1000,amount=2000,sourcePricingType='external-document',pricingType=''),
        dict(house='SYNTH-2',item='SYNTH-地坪修補',unit='式',qty=1,price=1500,amount=1500,sourcePricingType='external-document',pricingType=''),
        dict(house='SYNTH-3',item='SYNTH-門框美容',unit='式',qty=1,price=500,amount=500,sourcePricingType='external-document',pricingType='')
    ]
    return {
        'schema':'kushe-external-document-v1','documentType':'billing','title':'請款單',
        'number':'','customer':'SYNTH-建商','project':'SYNTH-M區','date':'2026-11-17',
        'taxMode':'未稅','pricingMode':'','invoiceStatus':'invoice_pending',
        'lines':lines,'salesAmount':4000,'taxAmount':200,'totalAmount':4200,
        'retentionAmount':0,'receivableAmount':4200,'publicNote':'SYNTH-純測試文件',
        'company':{'name':'酷舍企業有限公司','englishName':'Cool Sir Limited Company',
                   'taxId':'00000000','address':'SYNTH-測試地址','line':'SYNTH'},
        'fileName':'SYNTH-TEST.pdf','mergedBillingProjects':['SYNTH-M區'],'isMergedExternalBilling':True
    }

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':900},device_scale_factor=1)
        # Hard network boundary: no external resources, authentication or Supabase.
        def restrict(route):
            if route.request.url.startswith(base):
                route.continue_()
            else:
                route.abort()
        page.route('**/*',restrict)
        page.goto(base+'billing-print.html?v=p40-16t-synthetic&print=0#'+encoded(fixture()),wait_until='load')
        page.locator('#paper').wait_for()
        content=page.locator('#paper').inner_text()
        assert 'SYNTH-M區' in content
        assert 'SYNTH-L區' not in content
        for item in ['SYNTH-牆面美容','SYNTH-地坪修補','SYNTH-門框美容','施工項目彙總']:
            assert item in content,(item,content[:1500])
        for secret in ['SYNTH-PRIVATE-INVOICE-08','SYNTH-PRIVATE-INVOICE-10','原票號／狀態']:
            assert secret not in content
        assert page.locator('table.detail tbody tr').count()>=4
        pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
        pages=len(PdfReader(io.BytesIO(pdf)).pages)
        assert pages==1,f'Synthetic short document rendered {pages} A4 pages'
        print('PASS synthetic current customer-print renderer: selected project, 3 line items, privacy and A4 1 page')
        print('LIMITATION: this does not verify full external-billing-print.html adapter, historical UI, long invoices, mobile or actual ERP data')
        browser.close()
finally:
    server.shutdown()
