'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const erp=fs.readFileSync('assets/js/erp-store.js','utf8');
function functionText(source,name,endToken){const start=source.indexOf(name),end=source.indexOf(endToken,start);assert.ok(start>=0&&end>start,'Missing function '+name);return source.slice(start,end)};
const numeric=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
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

test('Store approval guard is present in both writer and status transition',()=>{
  const store=fs.readFileSync('assets/js/erp-store.js','utf8');
  const quotationPart=store.slice(store.indexOf('  function assertQuotationRevisionApproval('),store.indexOf('  function quotationUsage('));
  assert.ok(quotationPart.includes('QUOTATION_REVISION_NOTE_ONLY'));
  assert.ok(quotationPart.includes('if([\'已送出\',\'已確認\'].includes(nextStatus))assertQuotationRevisionApproval('));
  assert.ok(quotationPart.includes('if([\'已送出\',\'已確認\'].includes(status))assertQuotationRevisionApproval('));
  const ui=fs.readFileSync('assets/js/quotations.js','utf8');
  assert.ok(ui.includes("!$$('.quotation-line',body).some("));
});
