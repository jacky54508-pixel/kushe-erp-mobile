'use strict';
// P40: synthetic characterization/regression, never imports any real customer data.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const erp=fs.readFileSync('assets/js/erp-store.js','utf8');
const ext=fs.readFileSync('assets/js/external-billing-print.js','utf8');
function functionText(source,name,endToken) {
 const start=source.indexOf(name);
 assert.ok(start>=0,'function missing: '+name);
 const end=source.indexOf(endToken,start);
 assert.ok(end>start,'function boundary missing: '+name);
 return source.slice(start,end);
}
const numeric=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
test('Real commissionBasisAmounts uses untaxed construction source per employee',()=>{
 const source=functionText(erp,'function commissionBasisAmounts(items=[]) {','  function projectCommissionBasisAmounts(');
 const calculate=new Function('num','state',source+';return commissionBasisAmounts;')(numeric,{settings:{defaultTax:5}});
 const basis=calculate([{qty:1,inputPrice:84000,subtotal:84000,untaxedSubtotal:84000,taxMode:'未稅'}]);
 assert.equal(basis.preTax,84000);
 assert.equal(basis.taxIncluded,88200);
 // Characterize the current Store's per-employee full-project 25% policy,
 // not the older half-project 25% method.
 const dailyWriter=functionText(erp,'const commissionRate=Math.round(rawRate*100)/100,','    state.dailyItemPresets = state.dailyItemPresets || [];');
 assert.ok(dailyWriter.includes("const commissionBasis='preTax'"));
 assert.ok(dailyWriter.includes('commissionBaseAmount*commissionRate/100'));
 assert.ok(dailyWriter.includes('commissionBaseAmount=commissionBasis==='));
 assert.equal(Math.round(basis.preTax*0.25),21000);
 assert.equal(Math.round(basis.preTax*0.25)*2,42000);
});
test('Negotiated line price affects actual amounts, a note alone does not',()=>{
 const source=functionText(erp,'function quotationTotals(lines, taxMode', '  // Preview is read-only.');
 const quoteTotal=new Function('num','state','pricingMode','taxValues',source+';return quotationTotals;')
   (numeric,{settings:{defaultTax:5}},v=>v||'actual',gross=>{
     const entered=Math.max(0,numeric(gross));
     const pre=Math.round(entered/1.05);
     return {untaxed:pre,tax:entered-pre,total:entered};
   });
 const quotation={lines:[{qty:52,price:24000,subtotal:1248000}],publicNote:'議價單價 23500'};
 const before=JSON.stringify(quotation);
 const original=quoteTotal(quotation.lines,'未稅','actual');
 assert.equal(original.amount,1248000);
 assert.equal(JSON.stringify(quotation),before);
 // An authorized price edit, not a note string, drives the recomputation.
 const negotiated=quoteTotal([{qty:52,price:23500,subtotal:1222000}],'未稅','actual');
 assert.equal(negotiated.amount,1222000);
 assert.equal(original.amount-negotiated.amount,26000);
 const confirmedGuard=functionText(erp,'function writeQuotation(values, id =', '  async function saveQuotation(');
 assert.ok(confirmedGuard.includes("existing?.status==='已確認'"));
});
test('Billing update recomputes AR+invoice but does not silently backfill commission',()=>{
 const src=functionText(erp,'async function updateBilling(id, values={}) {','  function deleteBilling(');
 assert.ok(src.includes('Object.assign(billing,billingChanges)'));
 assert.ok(src.includes('Object.assign(receivable,receivableChanges)'));
 assert.ok(src.includes('syncBillingInvoiceRecord(billing,now)'));
 assert.ok(!src.includes('rebuildPayrollFor('));
 assert.ok(!src.includes('state.commissions'));
 assert.ok(src.includes('if(!safety.editable)'));
 console.log('KNOWN POLICY GAP: negotiation-adjusted billing does not auto-adjust historical commission');
});
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
test('Quotation revision review rejects note-only negotiation and shows actual price delta',()=>{
 const quotes=fs.readFileSync('assets/js/quotations.js','utf8');
 const start=quotes.indexOf('function quotationNegotiationReview('),end=quotes.indexOf('  function openEditor(',start);
 assert.ok(start>=0&&end>start);
 const store={quotationTotals(lines,tax,mode,lump){const amount=mode==='lump_sum'?Number(lump||0):lines.reduce((sum,line)=>sum+Number(line.qty||0)*Number(line.price||0),0);return {amount,tax:Math.round(amount*.05),total:Math.round(amount*1.05)};}};
 const review=new Function('store',quotes.slice(start,end)+';return quotationNegotiationReview;')(store);
 const original={amount:1248000,taxMode:'未稅',pricingMode:'actual',lines:[{item:'鋁窗美容',qty:52,price:24000}]};
 const noteOnly=review(original,{...original,internalNote:'議價降為每戶23500'});
 assert.equal(noteOnly.noteOnly,true);assert.equal(noteOnly.delta,0);
 const adjusted=review(original,{...original,internalNote:'議價降為每戶23500',lines:[{item:'鋁窗美容',qty:52,price:23500}]});
 assert.equal(adjusted.noteOnly,false);assert.equal(adjusted.priceChanged,true);assert.equal(adjusted.delta,-26000);
 assert.ok(quotes.includes('if(row?.revisionOf&&[\'已送出\',\'已確認\'].includes(values.status))'));
 assert.ok(quotes.includes('if(source.revisionOf&&[\'已送出\',\'已確認\'].includes(nextStatus))'));
});
test('Cross-zone customer render excludes matrix and original-house detail when flag set',()=>{
 const html=fs.readFileSync('billing-print.html','utf8');
 assert.ok(html.includes("customerZoneOnly=d.documentType==='billing'&&d.customerZoneOnly===true"));
 assert.ok(html.includes('const matrix=!isQuote&&!customerZoneOnly&&houses.length?'));
 assert.ok(html.includes('const denseInvoiceGroup=isMergedExternalBilling&&!customerZoneOnly&&'));
 assert.ok(html.includes("!customerZoneOnly&&x.sourcePricingType==='historical-supplement'"));
});
