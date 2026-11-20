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
// Full integration only in repository checkout. Do not count any skipped test as CI PASS.
integration('historical active print shows one target, all lines and bottom work summary without invoice or bank',()=>{
 const r=execute(fixture()); const html=r.paper.innerHTML;
 assert.equal(r.replaced.length,0);assert.equal(r.print.disabled,false);assert.match(html,/FAKE_TARGET_M/);assert.match(html,/施工項目彙總/);assert.match(html,/保存版本/);assert.equal((html.match(/FAKE施工/g)||[]).length,3);
 for(const secret of ['SECRET_OTHER_AREA_L','PRIVATE-INVOICE-7738','PRIVATE_BANK_RECORD','原票號','原請款／發票對照','待兌現'])assert.ok(!html.includes(secret),'historical public HTML leaked '+secret);
});
integration('archived historical document remains readable and marked not a current demand',()=>{const r=execute(fixture({archived:true}));assert.equal(r.print.disabled,false);assert.match(r.paper.innerHTML,/非本次付款通知/);});
integration('legacy v1 mixed-mode historical detail is preserved',()=>{const r=execute(fixture({mixed:true}));assert.equal(r.print.disabled,false);assert.match(r.paper.innerHTML,/FAKE施工/);assert.match(r.paper.innerHTML,/施工項目彙總/);assert.match(r.paper.innerHTML,/105/);});
integration('historical amounts remain saved values, without invoice ledger',()=>{const r=execute(fixture());assert.match(r.paper.innerHTML,/210/);assert.match(r.paper.innerHTML,/200/);assert.match(r.paper.innerHTML,/保留款/);assert.doesNotMatch(r.paper.innerHTML,/原發票稅額合計/);});
integration('historical URL fragment is scrubbed after loading, even on validation failure',()=>{const r=execute(fixture());assert.deepEqual(r.scrubbed,['/erp/external-billing-print.html']);assert.equal(r.location.hash,'');const p=fixture();p.document.totals.tax=55;const fail=execute(p);assert.equal(fail.replaced.length,0);assert.equal(fail.paper.addedClass,'empty');assert.equal(fail.location.hash,'');});
integration('draft document fails closed, not printed',()=>{const p=fixture();p.document.status='draft';const r=execute(p);assert.equal(r.print.disabled,true);assert.match(r.paper.innerHTML,/無法匯出/);});
integration('archived document with current-only flag fails closed',()=>{const r=execute(fixture({archived:true,historical:false}));assert.equal(r.replaced.length,0);assert.match(r.paper.innerHTML,/無法匯出/);});
integration('current active print flow still redirects to original external billing view',()=>{const r=execute(fixture({historical:false}));assert.equal(r.replaced.length,1);assert.match(r.replaced[0],/billing-print\.html/);const url=new URL(r.replaced[0]);const view=JSON.parse(Buffer.from(decodeURIComponent(url.hash.slice(1)),'base64').toString('utf8'));assert.equal(view.project,'FAKE_TARGET_M');assert.equal(view.isMergedExternalBilling,true);assert.equal(view.lines.length,2);assert.equal(view.totalAmount,210);assert.ok(!JSON.stringify(view).includes('PRIVATE-INVOICE-7738'));assert.ok(!JSON.stringify(view).includes('SECRET_OTHER_AREA_L'));});
integration('invalid unified line amount rejects historical print',()=>{const p=fixture();p.document.unified.lines[0].amount=5000;const r=execute(p);assert.equal(r.print.disabled,true);assert.match(r.paper.innerHTML,/無法匯出/);});
integration('dangerous markup in history public note is escaped',()=>{const p=fixture();p.document.note='<img src=x onerror=alert(1)>';const r=execute(p);assert.equal(r.print.disabled,false);assert.doesNotMatch(r.paper.innerHTML,/<img src=x/);assert.match(r.paper.innerHTML,/&lt;img/);});
integration('no source invoice rows or reference list in historical renderer source',()=>{const s=readFileSync(sourcePath,'utf8');for(const word of ['const invoices=','原請款／發票對照（原帳款不變）','sourceInvoiceReferences','row.invoiceNo'])assert.ok(!s.includes(word),'private historical path still contains '+word);assert.match(s,/if\(!payload\.historical\)/);assert.match(s,/workSummary/);});
