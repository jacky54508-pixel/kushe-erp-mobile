'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const store=fs.readFileSync('assets/js/erp-store.js','utf8');
const print=fs.readFileSync('billing-print.html','utf8');
const projection=fs.readFileSync('assets/js/external-billing-print.js','utf8');
function between(a,b){const i=store.indexOf(a),j=store.indexOf(b,i);assert.ok(i>=0&&j>i,'function boundary missing '+a);return store.slice(i,j)}
test('Existing Store explicitly blocks unsafe billing edits with all issued/paid/merged evidence',()=>{
 const safety=between('function billingSafety(id) {','  function billingEditable(');
 const update=between('async function updateBilling(id, values={}) {','  function deleteBilling(');
 for(const needle of ['externalBillingMembership(billing.id).length','receivable.receivableCheques','receipts.length',
    'retentionReceipts.length','bankLinked','issuedInvoice'])
     assert.ok(safety.includes(needle),needle);
 assert.ok(update.includes('const safety=billingSafety(id)'));
 assert.ok(update.includes('if(!safety.editable)throw'));
 assert.ok(update.includes('syncBillingInvoiceRecord(billing,now)'));
 assert.ok(update.includes('Object.assign(receivable,receivableChanges)'));
 assert.ok(!update.includes('state.commissions'));
 assert.ok(!update.includes('state.salaryPayments'));
 assert.ok(!update.includes('state.bankTransactions'));
});
test('Existing billing amount calculator is consistent under ordinary and tax-inclusive concessions',()=>{
 const fn=between('function calculateBilling(values = {}) {','  function cloneBillingRef(');
 const num=v=>Number(v)||0;
 const calculate=new Function('num','state',fn+';return calculateBilling;')(num,{settings:{defaultTax:5}});
 const ordinary=calculate({lines:[{qty:10,price:9500}],taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'5',retentionBase:'taxIncluded'});
 assert.deepEqual([ordinary.untaxed,ordinary.tax,ordinary.grossTotal,ordinary.retention,ordinary.receivable],[95000,4750,99750,4988,94762]);
 const included=calculate({lines:[{qty:1,price:105000}],taxMode:'含稅',invoiceStatus:'invoice_pending',retentionMode:'10',retentionBase:'preTax'});
 assert.deepEqual([included.untaxed,included.tax,included.grossTotal,included.retention,included.receivable],[100000,5000,105000,10000,95000]);
 const exempt=calculate({lines:[{qty:1,price:100000}],taxMode:'未稅',invoiceStatus:'no_invoice',retentionMode:'none'});
 assert.deepEqual([exempt.untaxed,exempt.tax,exempt.grossTotal,exempt.retention,exempt.receivable],[100000,0,100000,0,100000]);
});
test('Printed PDF stays unmodified: original per-house detail and summary preserved',()=>{
 assert.ok(print.includes("const denseDetails=denseInvoiceGroup?"));
 assert.ok(print.includes("const groupedSummary=denseInvoiceGroup?"));
 assert.ok(print.includes("lines.map(line=>'<tr><td class=\"center\">'+esc(line.house||'—')"));
 assert.ok(!print.includes('customerZoneOnly'));
 assert.ok(projection.includes("const lines=raw.map(l=>({house:String(l.house||'')"));
 assert.ok(!projection.includes("customerZoneOnly"));
});