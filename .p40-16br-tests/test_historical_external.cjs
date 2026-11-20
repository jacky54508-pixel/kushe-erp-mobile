'use strict';
// P40-16BR: FAKE fixtures only. GitHub CI requires real repository checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync,existsSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.resolve(__dirname,'../assets/js/external-billing-print.js');
const checkoutAvailable=existsSync(sourcePath);
const integration = checkoutAvailable ? test : (process.env.CI==='true' ? (()=>{throw Error('CI_MISSING_FORMAL_SOURCE')})() : test.skip);
function sources(){
 const anchors={untaxed:100,tax:5,grossTotal:105,retention:5,receivable:100};
 const make=(billingId,projectName)=>({billingId,projectName,customerId:'FAKE_CUSTOMER',taxMode:'未稅',invoiceStatus:'invoiced',invoiceNo:'PRIVATE-INVOICE-7738',originalLines:[{house:'',item:'FAKE施工',unit:'式',qty:1,price:100}],anchors:{...anchors}});
 return [make('BILL-M','FAKE_TARGET_M'),make('BILL-L','SECRET_OTHER_AREA_L')];
}
function settlement(billingId){return {billingId,received:0,outstanding:100,retentionReceived:0,retentionOutstanding:5,pendingCheque:0,availableToCollect:100,bankSecret:'PRIVATE_BANK_RECORD'};}
function fixture({historical=true,archived=false,mixed=false}={}){
 const src=sources();
 const d={schema:mixed?'kushe-external-billing-group-v1':'kushe-external-billing-group-v2',id:'FAKE_EXT_1',status:archived?'archived':'active',revision:3,documentDate:'2026-11-20',updatedAt:'2026-11-20T08:00:00+08:00',targetBillingId:'BILL-M',displayProjectName:'FAKE_TARGET_M',customerName:'FAKE建商',sourceIds:['BILL-M','BILL-L'],sourceSnapshots:src,settlementSnapshots:[settlement('BILL-M'),settlement('BILL-L')],note:'這是對外備註',totals:{untaxed:200,tax:10,grossTotal:210,retention:10,receivable:200,received:0,outstanding:200,retentionReceived:0,retentionOutstanding:10,pendingCheque:0,availableToCollect:200}};
 const line={house:'',item:'FAKE施工',unit:'式',qty:1,price:100,amount:100};
 if(mixed){d.sections=[{billingId:'BILL-M',taxMode:'未稅',lines:[{...line}]},{billingId:'BILL-L',taxMode:'含稅',lines:[{...line,price:105,amount:105}]}];}
 else{d.detailMode='unified';d.unified={taxMode:'未稅',reason:'虛構測試合併',lines:[{...line},{...line}],total:200,target:200};}
 return {schema:'kushe-external-billing-print-v1',historical,document:d};
}
function encode(o){return encodeURIComponent(Buffer.from(JSON.stringify(o),'utf8').toString('base64'));}
function execute(payload){
 if(!checkoutAvailable)throw Error('LOCAL_SOURCE_CHECKOUT_NOT_AVAILABLE');
 const paper={innerHTML:'',classList:{add(x){paper.addedClass=x;}}};
 const close={},print={disabled:true};const replaced=[];const scrubbed=[];
 const location={hash:'#'+encode(payload),href:'https://fake.example/erp/external-billing-print.html#'+encode(payload),pathname:'/erp/external-billing-print.html',search:'',replace(url){replaced.push(url)}};
 const history={replaceState(_a,_b,path){scrubbed.push(path);location.hash='';}};
 const window={close(){},print(){},KusheExternalBillingInvoice:{project(){return {rows:[]}}}};
 const document={getElementById(id){return id==='paper'?paper:id==='close'?close:id==='print'?print:null;},title:''};
 vm.runInNewContext(readFileSync(sourcePath,'utf8'),{window,document,history,location,URL,atob,btoa,encodeURIComponent,decodeURIComponent,escape,unescape,console}, {filename:'external-billing-print.js',timeout:1500});
 return {paper,close,print,replaced,scrubbed,location,document};
}
// Local tests that are meaningful even without the full private GitHub checkout.
test('fixture includes one target and one prohibited other area',()=>{const d=fixture().document;assert.equal(d.displayProjectName,'FAKE_TARGET_M');assert.equal(d.sourceSnapshots[1].projectName,'SECRET_OTHER_AREA_L');});
test('fake source financial anchors are internally consistent',()=>{const d=fixture().document;assert.equal(d.totals.untaxed+d.totals.tax,d.totals.grossTotal);assert.equal(d.totals.grossTotal-d.totals.retention,d.totals.receivable);});
test('mock URL payload intentionally demonstrates non-share-safe legacy snapshot',()=>{const text=JSON.stringify(fixture());assert.match(text,/PRIVATE-INVOICE-7738/);assert.match(text,/SECRET_OTHER_AREA_L/);});
test('historical mixed-mode fixture preserves per-section tax modes',()=>{const d=fixture({mixed:true}).document;assert.deepEqual(d.sections.map(x=>x.taxMode),['未稅','含稅']);});
// Full integrated tests run only with the exact real GitHub repository checkout.
function redirectedView(payload){
  const r=execute(payload);
  assert.equal(r.replaced.length,1,'public view must redirect to unchanged formal billing-print.html');
  const url=new URL(r.replaced[0]);
  assert.match(url.pathname,/\/billing-print\.html$/);
  const view=JSON.parse(Buffer.from(decodeURIComponent(url.hash.slice(1)),'base64').toString('utf8'));
  return {r,url,view};
}
integration('historical active bill uses original billing-print template, not alternate HTML',()=>{
  const {r,view}=redirectedView(fixture());
  assert.equal(r.paper.innerHTML,'');
  assert.equal(view.schema,'kushe-external-document-v1');
  assert.equal(view.documentType,'billing');
  assert.equal(view.title,'請款單');
  assert.equal(view.project,'FAKE_TARGET_M');
  assert.equal(view.customer,'FAKE建商');
  assert.equal(view.isMergedExternalBilling,false,'short historic bill must match normal 4-box template');
});
integration('historical only displays one selected project and saved original financial amounts',()=>{
  const {view}=redirectedView(fixture());
  assert.deepEqual(view.mergedBillingProjects,['FAKE_TARGET_M']);
  assert.equal(view.salesAmount,200);
  assert.equal(view.taxAmount,10);
  assert.equal(view.totalAmount,210);
  assert.equal(view.retentionAmount,10);
  assert.equal(view.receivableAmount,200);
  assert.equal(view.lines.length,2);
  assert.equal(view.lines[0].amount,100);
  assert.equal(view.lines[1].amount,100);
});
integration('historical URL contains only customer-safe document projection, not source invoices or bank',()=>{
  const {view,url}=redirectedView(fixture());
  const string=JSON.stringify(view);
  for(const secret of ['SECRET_OTHER_AREA_L','PRIVATE-INVOICE-7738','PRIVATE_BANK_RECORD','invoiceNo','sourceSnapshots','settlementSnapshots','sourceIds','bankSecret','原請款／發票對照']){
    assert.ok(!string.includes(secret),'leaked original source in customer projection: '+secret);
  }
  assert.ok(!url.href.includes('PRIVATE-INVOICE-7738'));
});
integration('original company logo, stamp and sign areas stay owned by formal billing-print.html',()=>{
  const template=readFileSync(path.resolve(__dirname,'../billing-print.html'),'utf8');
  for(const required of ['formalCompanyLogo','formalCompanySeal','戶別施工統計','施工項目彙總','客戶簽章','公司大小章','class="info"']){
    assert.ok(template.includes(required),'original billing template lacks '+required);
  }
  assert.ok(template.includes('esc(d.publicNote)'),'formal template must HTML-escape note');
  const {view}=redirectedView(fixture());
  assert.equal(view.company.name,'酷舍企業有限公司');
});
integration('archived historical version keeps native invoice layout and explicit read-only warning',()=>{
  const {view}=redirectedView(fixture({archived:true}));
  assert.match(view.publicNote,/歷史保存版本/);
  assert.match(view.publicNote,/非本次付款通知/);
  assert.match(view.fileName,/歷史保存v3\.pdf$/);
  assert.equal(view.isMergedExternalBilling,false);
});
integration('historical input fragment is scrubbed after read even if projection fails',()=>{
  const {r}=redirectedView(fixture());
  assert.equal(r.scrubbed[0],'/erp/external-billing-print.html');
  assert.equal(r.location.hash,'');
  const invalid=fixture(); invalid.document.totals.tax=55;
  const fail=execute(invalid);
  assert.equal(fail.replaced.length,0);
  assert.equal(fail.paper.addedClass,'empty');
  assert.equal(fail.location.hash,'');
});
integration('draft and archived non-historical documents fail closed',()=>{
  let p=fixture();p.document.status='draft';let r=execute(p);
  assert.equal(r.replaced.length,0);assert.match(r.paper.innerHTML,/無法匯出/);
  p=fixture({archived:true,historical:false});r=execute(p);
  assert.equal(r.replaced.length,0);assert.match(r.paper.innerHTML,/無法匯出/);
});
integration('current active document still uses the original merged print behavior',()=>{
  const {view}=redirectedView(fixture({historical:false}));
  assert.equal(view.isMergedExternalBilling,true);
  assert.equal(view.publicNote,'這是對外備註');
  assert.equal(view.totalAmount,210);
  assert.ok(!JSON.stringify(view).includes('PRIVATE-INVOICE-7738'));
});
integration('historical mixed tax mode stops instead of silently recomputing legacy totals',()=>{
  const r=execute(fixture({mixed:true}));
  assert.equal(r.replaced.length,0);
  assert.match(r.paper.innerHTML,/不同單價稅別/);
});
integration('invalid line amount stops original-template handoff',()=>{
  const p=fixture();p.document.unified.lines[0].amount=5000;
  const r=execute(p);assert.equal(r.replaced.length,0);
  assert.match(r.paper.innerHTML,/無法匯出/);
});
integration('native template securely escapes public note and does not invent new HTML renderer',()=>{
  const p=fixture();p.document.note='<img src=x onerror=alert(1)>';
  const {view}=redirectedView(p);assert.ok(view.publicNote.includes('<img src=x'));
  const native=readFileSync(path.resolve(__dirname,'../billing-print.html'),'utf8');
  assert.ok(native.includes('esc(d.publicNote)'));
  const source=readFileSync(sourcePath,'utf8');
  assert.ok(!source.includes('paper.innerHTML=\'<header class="masthead"'));
  assert.ok(!source.includes('const invoices='));
  assert.ok(!source.includes('const workSummary='));
  assert.ok(source.includes('P40-16BT: route ALL'));
});
