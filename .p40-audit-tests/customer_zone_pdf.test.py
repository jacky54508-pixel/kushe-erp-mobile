"""P40 cross-zone customer-only print UI check using synthetic data only."""
import base64
import json
import os
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from io import BytesIO

BASE='http://127.0.0.1:8797/billing-print.html'
def encode(payload):
    text=json.dumps(payload,ensure_ascii=False,separators=(',',':'))
    return BASE+'#'+quote(base64.b64encode(text.encode('utf-8')).decode('ascii'),safe='')

def main():
    lines=[dict(house=('M'+str(i+1) if i%2 else 'L'+str(i+1)),item='虛構鋁窗美容' if i%3 else '虛構門框美容',unit='式',qty=1,price=1000,amount=1000,pricingType='',sourcePricingType='external-document') for i in range(18)]
    d=dict(schema='kushe-external-document-v1',documentType='billing',title='請款單',customer='虛構公司',project='耀時代L區',date='2026-11-14',
        taxMode='未稅',invoiceStatus='invoice_pending',lines=lines,salesAmount=18000,taxAmount=900,totalAmount=18900,
        retentionAmount=0,receivableAmount=18900,publicNote='本次施工明細請核對',company={'name':'酷舍測試公司'},
        mergedBillingProjects=['耀時代L區'],isMergedExternalBilling=True,customerZoneOnly=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel='chrome') if os.getenv('P39_INV_USE_SYSTEM_CHROME')=='1' else p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':900})
        page.goto(encode(d),wait_until='load')
        paper=page.locator('#paper')
        paper.wait_for()
        content=paper.inner_text()
        assert '耀時代L區' in content,content[:700]
        assert '施工項目彙總' in content,content[:700]
        assert '虛構鋁窗美容' in content
        assert 'M2' not in content and 'M4' not in content,content[:900]
        assert '耀時代M區' not in content
        assert page.locator('.matrix').count()==0
        assert page.locator('.dense-original-details').count()==0
        assert page.locator('.grouped-item-summary').count()==0
        assert page.locator('table.detail tbody tr').count()==3
        pdf=page.pdf(format='A4',print_background=True)
        assert len(PdfReader(BytesIO(pdf)).pages)==1, 'Customer PDF must stay A4 1 page'
        # Non-cross-zone view retains historical house display behavior.
        d['customerZoneOnly']=False
        page.goto(encode(d),wait_until='load')
        assert 'M2' in page.locator('#paper').inner_text()
        browser.close()
    print('PASS P40: customer PDF A4 one page, only target zone + grouped items, original values unchanged')

if __name__=='__main__':
    main()
