'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ext=fs.readFileSync('assets/js/external-billing-print.js','utf8');
function functionText(source,name,endToken){const start=source.indexOf(name),end=source.indexOf(endToken,start);assert.ok(start>=0&&end>start,'Missing function '+name);return source.slice(start,end);}
test('Customer PDF target zone projection works but original house identifiers still appear',()=>{
 const source=functionText(ext,'function originalTemplateView(payload,d){',"  document.getElementById('close').onclick=");
 const window={KusheExternalBillingInvoice:{project(sources){return{rows:sources.map(s=>({projectName:s.projectName}))};}}};
 const build=new Function('window',source+';return originalTemplateView;')(window);
 const lines=[{house:'L1',item:'施工一',unit:'式',qty:1,price:20000,amount:20000},{house:'M5',item:'施工二',unit:'式',qty:1,price:30000,amount:30000}];
 const document={
  schema:'kushe-external-billing-group-v2',targetBillingId:'target-a',
  sourceSnapshots:[{billingId:'target-a',projectName:'虛構 L 區',invoiceStatus:'invoice_pending'},{billingId:'source-b',projectName:'虛構 M 區',invoiceStatus:'invoice_pending'}],
  displayProjectName:'虛構 L 區',customerName:'虛構公司',documentDate:'2026-11-14',note:'',unified:{taxMode:'未稅',lines},
  totals:{untaxed:50000,tax:2500,grossTotal:52500,retention:0,receivable:52500}
 };
 const before=JSON.stringify(document);
 const view=build({},document);
 assert.equal(JSON.stringify(document),before);
 assert.equal(view.project,'虛構 L 區');
 assert.deepEqual(view.mergedBillingProjects,['虛構 L 區']);
 assert.equal(view.totalAmount,52500);
 assert.deepEqual(view.lines.map(l=>l.house),['','']);
 assert.equal(view.customerZoneOnly,true);
 assert.equal(view.lines.reduce((sum,l)=>sum+l.amount,0),50000);
 assert.ok(!JSON.stringify(view).includes('M5'));
 assert.ok(!JSON.stringify(view).includes('虛構 M 區'));
 console.log('PASS: cross-zone customer print model omits original source houses without changing amounts');
});

test('Customer PDF rejects foreign source zone disclosures in public note or item',()=>{
 const source=functionText(ext,'function originalTemplateView(payload,d){',"  document.getElementById('close').onclick=");
 const window={KusheExternalBillingInvoice:{project(sources){return{rows:sources.map(s=>({projectName:s.projectName}))};}}};
 const build=new Function('window',source+';return originalTemplateView;')(window);
 const original={schema:'kushe-external-billing-group-v2',targetBillingId:'target',displayProjectName:'耀時代L區',documentDate:'2026-11-14',customerName:'虛構客戶',note:'',
   sourceSnapshots:[{billingId:'target',projectName:'耀時代L區',invoiceStatus:'no_invoice',originalLines:[{house:'L1'}]},{billingId:'other',projectName:'耀時代M區',invoiceStatus:'no_invoice',originalLines:[{house:'M5'}]}],
   unified:{taxMode:'未稅',lines:[{house:'M5',item:'牆面修補',unit:'式',qty:1,price:500,amount:500}]},
   totals:{untaxed:500,tax:0,grossTotal:500,retention:0,receivable:500}};
 const before=JSON.stringify(original);
 assert.equal(build({},original).lines[0].house,'');
 for(const text of ['耀時代M區','M區','M5'])assert.throws(()=>build({},{...original,note:text}),/來源區域資訊/);
 assert.throws(()=>build({},{...original,unified:{...original.unified,lines:[{house:'M5',item:'M區施工',unit:'式',qty:1,price:500,amount:500}]}}),/來源區域資訊/);
 assert.equal(JSON.stringify(original),before);
});
test('Cross-zone customer render excludes matrix and original-house detail when flag set',()=>{
 const html=fs.readFileSync('billing-print.html','utf8');
 assert.ok(html.includes("customerZoneOnly=d.documentType==='billing'&&d.customerZoneOnly===true"));
 assert.ok(html.includes('const matrix=!isQuote&&!customerZoneOnly&&houses.length?'));
 assert.ok(html.includes('const denseInvoiceGroup=isMergedExternalBilling&&!customerZoneOnly&&'));
 assert.ok(html.includes("!customerZoneOnly&&x.sourcePricingType==='historical-supplement'"));
});
