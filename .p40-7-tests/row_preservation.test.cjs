'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('assets/js/external-billing-print.js','utf8');
const start=source.indexOf('  function originalTemplateView(payload,d){');
const end=source.indexOf("  document.getElementById('close').onclick=",start);
assert.ok(start>=0&&end>start,'P40-7 projection function missing');
const project=()=>({rows:[],totals:{}});
const build=new Function('window',source.slice(start,end)+';return originalTemplateView;')({KusheExternalBillingInvoice:{project}});
const lines=Array.from({length:18},(_,i)=>{
  const qty=i%3===0?2:1,price=i%3===0?1600:i%3===1?34000:600;
  return {house:(i%2===0?'L':'M')+(i+1),item:i%3===0?'模擬地坪處理':i%3===1?'模擬室內鋁窗美容':'模擬木門扇',unit:i%3===0?'塊':i%3===1?'戶':'面',qty,price,amount:qty*price};
});
const sum=lines.reduce((v,x)=>v+x.amount,0);
const make=()=>({
 schema:'kushe-external-billing-group-v2',
 targetBillingId:'SYN-L',displayProjectName:'虛構耀時代L區',customerName:'測試建商',
 sourceSnapshots:[
  {billingId:'SYN-L',projectName:'虛構耀時代L區',invoiceStatus:'invoice_pending',originalLines:[]},
  {billingId:'SYN-O',projectName:'虛構耀時代O3-1',invoiceStatus:'invoice_pending',originalLines:[]}
 ],documentDate:'2026-11-15',note:'',
 unified:{taxMode:'未稅',lines,reason:'模擬 M 區金額依公司帳務要求彙整（內部備註，不列印）'},
 totals:{untaxed:sum,tax:Math.round(sum*.05),grossTotal:sum+Math.round(sum*.05),retention:0,receivable:sum+Math.round(sum*.05)}
});
test('18 original lines remain 18 customer PDF lines in identical order and with identical money',()=>{
 const d=make(),before=JSON.stringify(d),view=build({},d);
 assert.equal(JSON.stringify(d),before,'projection must not mutate original data');
 assert.equal(view.customerZoneOnly,true);
 assert.equal(view.project,'虛構耀時代L區');
 assert.equal(view.lines.length,18,'never replace 18 rows with 3 groups');
 assert.ok(view.lines.every(x=>x.house===''),'do not leak any real-zone houses in customer payload');
 assert.deepEqual(view.lines.map(x=>[x.item,x.unit,x.qty,x.price,x.amount]),
  d.unified.lines.map(x=>[x.item,x.unit,x.qty,x.price,x.amount]));
 assert.equal(view.lines.reduce((v,x)=>v+x.amount,0),sum);
 assert.equal(view.salesAmount,sum);
 assert.equal(view.totalAmount,sum+Math.round(sum*.05));
 assert.deepEqual(view.mergedBillingProjects,['虛構耀時代L區']);
 assert.ok(!JSON.stringify(view).includes('虛構耀時代O3-1'));
 assert.ok(!JSON.stringify(view).includes('"M2"'));
 assert.ok(!JSON.stringify(view).includes('模擬 M 區'));
});
test('Same-zone merged billing remains unmasked and keeps every house',()=>{
 const d=make();d.sourceSnapshots[1].projectName=d.displayProjectName;
 const view=build({},d);
 assert.equal(view.customerZoneOnly,false);
 assert.deepEqual(view.lines.map(x=>x.house),lines.map(x=>x.house));
 assert.equal(view.lines.length,18);
});
test('Cross-zone unsafe public labels block export rather than silently changing accounting text',()=>{
 const d=make(),old=JSON.stringify(d);
 for(const note of ['虛構耀時代O3-1','M區','M2']){
   assert.throws(()=>build({},{...d,note}),/來源區域/,'note '+note);
 }
 assert.throws(()=>build({},{...d,unified:{...d.unified,lines:d.unified.lines.map((x,i)=>i===0?{...x,item:'M區施工'}:x)}}),/來源區域/);
 assert.equal(JSON.stringify(d),old);
});
test('Print renderer keeps per-row detail and neutral sequence while preserving normal print',()=>{
 const html=fs.readFileSync('billing-print.html','utf8');
 assert.ok(html.includes("customerZoneOnly=d.documentType==='billing'&&d.isMergedExternalBilling===true&&d.customerZoneOnly===true"));
 assert.ok(html.includes("(customerZoneOnly||houses.length>9||items.length>5||lines.length>12)"),'force dense rows on cross-zone');
 assert.ok(html.includes("customerZoneOnly?'序號':'戶別'"));
 assert.ok(html.includes("lines.map((line,index)=>'<tr>"));
 assert.ok(html.includes("customerZoneOnly?String(index+1):esc(line.house||'—')"));
 assert.ok(html.includes("const groupedSummary=denseInvoiceGroup?"));
 assert.ok(html.includes("const denseDetails=denseInvoiceGroup?"));
 assert.ok(!html.includes("denseInvoiceGroup=isMergedExternalBilling&&!customerZoneOnly"),'old P40 bug must be absent');
});