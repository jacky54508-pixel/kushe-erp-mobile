from pathlib import Path
from playwright.sync_api import sync_playwright
from functools import partial
import os,base64,json,http.server,threading,urllib.parse,copy
ROOT=Path(os.environ['QA_ROOT_DIR']);results=[]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}/'
def check(name,okay):
 if not okay:raise AssertionError(name)
 results.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
def encoded(data):return urllib.parse.quote(base64.b64encode(json.dumps(data,ensure_ascii=False).encode()).decode(),safe='')
lines=[{'house':'L'+str(i+1),'item':'合成室內鋁窗美容','unit':'戶','qty':1,'price':1800,'amount':1800} for i in range(17)]+[{'house':'M6','item':'合成木門扇','unit':'面','qty':2,'price':700,'amount':1400}]
sources=[];settlements=[]
for i,net in enumerate([12000,20000]):
 key=['billA','billB'][i];gross=net+net//20
 sources.append({'billingId':key,'projectName':['合成 A 案場','合成 B 區'][i],'customerId':'qa-customer','taxMode':'未稅','invoiceStatus':'invoiced','invoiceNo':'QA0000000'+str(i+1),'anchors':{'untaxed':net,'tax':net//20,'grossTotal':gross,'retention':0,'receivable':gross},'originalLines':[{'house':'','item':'合成原品項','unit':'處','qty':1,'price':net}]})
 settlements.append({'billingId':key,'received':0,'outstanding':gross,'retentionReceived':0,'retentionOutstanding':0,'pendingCheque':0,'availableToCollect':gross})
totals={'untaxed':32000,'tax':1600,'grossTotal':33600,'retention':0,'receivable':33600,'received':0,'outstanding':33600,'retentionReceived':0,'retentionOutstanding':0,'pendingCheque':0,'availableToCollect':33600}
company={'name':'酷舍企業有限公司','englishName':'Cool Sir Limited Company','taxId':'82980636','address':'台中市豐原區瑞興路 62 號','line':'eing0519'}
doc={'schema':'kushe-external-billing-group-v2','status':'active','revision':1,'sourceIds':['billA','billB'],'targetBillingId':'billA','displayProjectName':'合成 A 案場','customerName':'驗收金屬公司','documentDate':'2026-10-30','note':'','detailMode':'unified','unified':{'taxMode':'未稅','lines':lines,'total':32000,'target':32000,'reason':'依合成工程核對明細'},'sourceSnapshots':sources,'settlementSnapshots':settlements,'totals':totals,'updatedAt':'2026-10-30T00:00:00Z'}
payload={'schema':'kushe-external-billing-print-v1','historical':False,'document':doc,'template':{'schema':'kushe-original-billing-template-v1','billingId':'billA','company':company,'historicalDetails':False,'publicNote':''}}
view={'schema':'kushe-external-document-v1','documentType':'billing','title':'請款單','number':'','customer':'驗收金屬公司','project':'合成 A 案場','date':'2026-10-30','taxMode':'未稅','pricingMode':'','invoiceStatus':'invoice_pending','lines':[{**l,'sourcePricingType':'','pricingType':''} for l in lines],'salesAmount':32000,'taxAmount':1600,'totalAmount':33600,'retentionAmount':0,'receivableAmount':33600,'publicNote':'','company':company}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1440,'height':1200});errors=[];requests=[]
  context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
  context.add_init_script("window.qaStorageWrites=0;for(const name of ['setItem','removeItem','clear'])Storage.prototype[name]=function(){qaStorageWrites++;throw Error('Unexpected storage write')};indexedDB.open=function(){throw Error('Unexpected account database access')};")
  p=context.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.on('request',lambda r:requests.append(r.url.split('#')[0]))
  p.goto(base+'src/external-billing-print.html#'+encoded(payload));p.wait_for_url('**/billing-print.html?*');p.wait_for_function('window.__billingPrintReady===true');p.wait_for_function("[...document.querySelectorAll('#paper img')].every(x=>x.complete&&x.naturalWidth>0)");p.evaluate('document.fonts.ready')
  check('native redirect selects canonical billing template','/src/billing-print.html?' in p.url)
  check('native selected A header and original totals correct','合成 A 案場' in p.locator('.info').inner_text() and '$33,600' in p.locator('.summary').inner_text())
  check('native household matrix and item summary restored',p.locator('.matrix tbody tr:not(.grand)').count()==18 and p.locator('.detail tbody tr:not(.line-total)').count()==2)
  check('native original logo and seals load',p.locator('#formalCompanyLogo').evaluate('(n)=>n.naturalWidth>0') and p.locator('#formalCompanySeal').evaluate('(n)=>n.naturalWidth>0'))
  check('native current print excludes internal audit panels',all(s not in p.locator('#paper').inner_text() for s in ['對應原發票','保存版本','金額核對時間','本期未沖銷']))
  check('native print performs no storage writes',p.evaluate('qaStorageWrites')==0)
  p.pdf(path=str(ROOT/'evidence/native-original-template.pdf'),format='A4',print_background=True,prefer_css_page_size=True)
  q=context.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.goto(base+'baseline/billing-print.html#'+encoded(view));q.wait_for_function('window.__billingPrintReady===true');q.wait_for_function("[...document.querySelectorAll('#paper img')].every(x=>x.complete&&x.naturalWidth>0)");q.evaluate('document.fonts.ready');p.emulate_media(media='print');q.emulate_media(media='print')
  check('native canonical and equivalent original pixels match',p.locator('#paper').screenshot()==q.locator('#paper').screenshot())
  p.reload();p.wait_for_function('window.__billingPrintReady===true');check('native reload retains all data with no account access',p.locator('.matrix tbody tr:not(.grand)').count()==18 and p.evaluate('qaStorageWrites')==0)
  broken=copy.deepcopy(payload);broken['document']['totals']['grossTotal']+=1;p.goto(base+'src/external-billing-print.html#'+encoded(broken));check('native invalid totals block redirect and printing',p.locator('#print').is_disabled() and p.locator('.error').count()==1)
  historical=copy.deepcopy(payload);historical['historical']=True;hp=context.new_page();hp.on('pageerror',lambda e:errors.append(str(e)));hp.on('request',lambda r:requests.append(r.url.split('#')[0]));hp.goto(base+'src/external-billing-print.html#'+encoded(historical));check('native prior version remains reference only',hp.locator('.historic').count()==1 and '非本次付款通知' in hp.locator('.historic').inner_text())
  check('no uncaught errors or external account requests',not errors and all(x.startswith(base) for x in requests))
  browser.close()
except Exception as e:
 results.append({'name':'native suite','status':'FAIL','error':str(e)});raise
finally:
 (ROOT/'evidence/native-print-tests.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));server.shutdown()
