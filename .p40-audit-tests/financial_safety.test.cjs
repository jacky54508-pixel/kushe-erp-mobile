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
 assert.deepEqual(view.lines.map(l=>l.house),['L1','M5']);
 console.log('KNOWN PRIVACY GAP: source-area house marker M5 is still present in customer PDF print model');
});
