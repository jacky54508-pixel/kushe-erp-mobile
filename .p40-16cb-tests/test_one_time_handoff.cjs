'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{randomUUID}=require('node:crypto');
const group=fs.readFileSync(path.join(__dirname,'../assets/js/billing-groups.js'),'utf8');
const print=fs.readFileSync(path.join(__dirname,'../assets/js/external-billing-print.js'),'utf8');
const form=fs.readFileSync(path.join(__dirname,'../billing-print.html'),'utf8');
const anchor={untaxed:100,tax:5,grossTotal:105,retention:5,receivable:100};
const source=(id,area)=>({billingId:id,projectName:area,customerId:'FAKE_CUST',taxMode:'未稅',invoiceStatus:'invoiced',invoiceNo:'SECRET_INV_987',originalLines:[{house:'1F',item:'施工',unit:'座',qty:1,price:100}],anchors:{...anchor}});
const settle=id=>({billingId:id,received:0,outstanding:100,retentionReceived:0,retentionOutstanding:5,pendingCheque:0,availableToCollect:100,bankSecret:'SECRET_BANK'});
function doc(){
 return {schema:'kushe-external-billing-group-v2',id:'FAKE_DOC',status:'active',revision:3,documentDate:'2026-11-20',
 targetBillingId:'B-M',displayProjectName:'FAKE_M',customerName:'FAKE_CUSTOMER',
 sourceIds:['B-M','B-L'],sourceSnapshots:[source('B-M','FAKE_M'),source('B-L','SECRET_L')],
 settlementSnapshots:[settle('B-M'),settle('B-L')],note:'公開備註',
 totals:{untaxed:200,tax:10,grossTotal:210,retention:10,receivable:200,received:0,outstanding:200,retentionReceived:0,retentionOutstanding:10,pendingCheque:0,availableToCollect:200},
 detailMode:'unified',unified:{taxMode:'未稅',reason:'FAKE',lines:[{house:'1F',item:'施工',unit:'座',qty:1,price:100,amount:100},{house:'2F',item:'施工',unit:'座',qty:1,price:100,amount:100}],total:200,target:200}};
}
class Wire {
 constructor(){this.channels=new Map();this.messages=[]}
 channel(){const w=this;return class {
  constructor(name){this.name=name;this.closed=false;if(!w.channels.has(name))w.channels.set(name,new Set());w.channels.get(name).add(this)}
  postMessage(data){w.messages.push(data);for(const peer of w.channels.get(this.name)||[])if(peer!==this&&!peer.closed)queueMicrotask(()=>{if(!peer.closed)peer.onmessage?.({data})})}
  close(){this.closed=true;w.channels.get(this.name)?.delete(this)}
 }}
}
function parent({historical=true,broken=false}={}){
 const wire=new Wire(),BroadcastChannel=wire.channel(),d=doc(),links=[];
 if(broken)d.totals.tax=400;
 const state={billings:[{id:'B-M'}]};
 const store={getState(){return state},externalBillingDocumentIndex(){return {documents:[{document:d,issues:[],termsChanged:false,settlementChanged:false}]}}};
 const window={KuSheERPStore:store,crypto:{randomUUID},BroadcastChannel,setTimeout(){},
 KusheBillingPrint:{buildExternalView(){return {company:{name:'酷舍企業有限公司'},publicNote:'',lines:[]}}},dispatchEvent(){}};
 const document={createElement(){return {href:'',target:'',rel:'',click(){links.push(this.href)},remove(){}}},body:{append(){}},querySelector(){return null},querySelectorAll(){return []}};
 vm.runInNewContext(group,{window,document,URL,location:{href:'https://fake.invalid/app/index.html'},CustomEvent:class{},console},{timeout:5000});
 window.KusheBillingGroups.printSaved('FAKE_DOC',0,historical);
 assert.equal(links.length,1);
 return {url:links[0],wire,BroadcastChannel};
}
async function child(session,url=session.url){
 const u=new URL(url),paper={innerHTML:'',classList:{add(x){paper.className=x}}},printBtn={disabled:true},historyUrls=[],routes=[];
 const location={search:u.search,pathname:u.pathname,hash:u.hash,href:u.href,replace(x){routes.push(x)}};
 const history={replaceState(_a,_b,x){historyUrls.push(x);location.search=new URL(x,'https://fake.invalid').search;location.hash=''}};
 const document={getElementById(id){return id==='paper'?paper:id==='close'?{}:id==='print'?printBtn:null},title:''};
 const window={BroadcastChannel:session.BroadcastChannel,setTimeout(){},close(){},KusheExternalBillingInvoice:{project(){return {rows:[]}}}};
 await vm.runInNewContext(print,{window,document,location,history,URL,URLSearchParams,console,atob,btoa,encodeURIComponent,decodeURIComponent,escape,unescape},{timeout:5000});
 return {paper,printBtn,historyUrls,routes,location};
}
function view(r){assert.equal(r.routes.length,1);let u=new URL(r.routes[0]);assert.match(u.pathname,/\/billing-print\.html$/);return JSON.parse(Buffer.from(decodeURIComponent(u.hash.slice(1)),'base64').toString('utf8'))}
test('protected fake fixture contains two areas and private invoice',()=>{const d=doc();assert.equal(d.sourceSnapshots.length,2);assert.equal(d.sourceSnapshots[1].projectName,'SECRET_L')});
test('source validation amounts match without recomputation',()=>{const d=doc();assert.equal(d.totals.untaxed+d.totals.tax,d.totals.grossTotal)});
test('UUID ticket is unguessable format',()=>assert.match(randomUUID(),/^[\da-f-]{36}$/));
test('the original billing template owns all formal layout elements',()=>{for(const w of ['戶別施工統計','施工項目彙總','formalCompanyLogo','formalCompanySeal','客戶簽章','公司大小章'])assert.ok(form.includes(w))});
test('URL contains ticket only, no whole source snapshot',()=>{const p=parent();const u=new URL(p.url);assert.match(u.search,/ksprint=/);assert.equal(u.hash,'');assert.doesNotMatch(p.url,/SECRET_L|sourceSnapshots|SECRET_INV_987/)});
test('historical preview transfers once, uses original customer template',async()=>{const p=parent(),r=await child(p),v=view(r);assert.equal(v.project,'FAKE_M');assert.equal(v.totalAmount,210);assert.equal(v.lines.length,2);assert.match(v.publicNote,/歷史保存版本/);assert.equal(v.isMergedExternalBilling,false)});
test('public projection excludes source invoices, other areas and banking',async()=>{const p=parent(),v=view(await child(p));for(const secret of ['SECRET_L','SECRET_INV_987','SECRET_BANK','sourceSnapshots','settlementSnapshots'])assert.ok(!JSON.stringify(v).includes(secret),secret)});
test('parent serves source once and child removes temporary token',async()=>{const p=parent(),r=await child(p);assert.equal(p.wire.messages.filter(m=>m.type==='KUSHE_PRINT_DATA').length,1);assert.equal(r.historyUrls.length,1);assert.doesNotMatch(r.location.search,/ksprint/)});
test('invalid old-style snapshot URL is rejected before decode',async()=>{const p=parent(),r=await child(p,p.url+'#'+Buffer.from(JSON.stringify(doc())).toString('base64'));assert.equal(r.routes.length,0);assert.match(r.paper.innerHTML,/不安全/)});
test('invalid / expired ticket rejects non-ERP share link',async()=>{const p=parent(),r=await child(p,'https://fake.invalid/app/external-billing-print.html?v=x');assert.equal(r.routes.length,0);assert.match(r.paper.innerHTML,/安全列印憑證/)});
test('current billing preview remains on unchanged formal renderer',async()=>{const p=parent({historical:false}),v=view(await child(p));assert.equal(v.isMergedExternalBilling,true);assert.equal(v.publicNote,'公開備註')});
test('corrupted original tax totals fail closed',async()=>{const p=parent({broken:true}),r=await child(p);assert.equal(r.routes.length,0);assert.match(r.paper.innerHTML,/無法匯出/)});
test('no storage / URL snapshot transfer in parent after patch',()=>{const x=group.slice(group.indexOf('function printSaved('));assert.match(x,/BroadcastChannel/);assert.doesNotMatch(x,/localStorage\.setItem|sessionStorage\.setItem|url\.hash=encodeURIComponent/)});
test('child only forwards public projection to unchanged formal renderer',()=>{assert.match(print,/receiveOneTimePrint/);assert.doesNotMatch(print,/location\.hash\.slice\(1\)|原請款／發票對照（原帳款不變）/);assert.match(print,/billing-print\.html/)});
