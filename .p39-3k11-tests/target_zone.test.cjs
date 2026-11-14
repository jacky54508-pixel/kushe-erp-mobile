// P39-3K-11: source-level customer PDF projection test, no DB/network.
// Extracts the exact production adapter function from the candidate source.
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/external-billing-print.js','utf8');
const head='  function originalTemplateView(payload,d){';
const tail='  document.getElementById(\'close\').onclick=';
assert.equal(src.split(head).length,2,'print adapter changed');
const fnSource=src.slice(src.indexOf(head),src.indexOf(tail));
assert.ok(fnSource.includes('return {schema:'),'missing view projection');
const fakeWindow={KusheExternalBillingInvoice:{project(sources){
 return {rows:sources.map(s=>({projectName:s.projectName}))};
}}};
const project=new Function('window',fnSource+'; return originalTemplateView;')(fakeWindow);
const totals={untaxed:300000,tax:15000,grossTotal:315000,retention:0,receivable:315000};
const input={schema:'kushe-external-billing-group-v2',displayProjectName:'虛構 A 區',
targetBillingId:'syn-a',documentDate:'2026-11-14',customerName:'虛構建商',
sourceSnapshots:[{billingId:'syn-a',projectName:'虛構 A 區',invoiceStatus:'invoice_pending'},
{billingId:'syn-b',projectName:'虛構 B 區',invoiceStatus:'invoiced'}],
unified:{taxMode:'未稅',lines:[{house:'A1',item:'虛構施工 A',unit:'式',qty:1,price:100000,amount:100000},
{house:'B2',item:'虛構施工 B',unit:'式',qty:1,price:200000,amount:200000}]},
note:'虛構對外備註',totals};
const before=JSON.stringify(input);
const result=project({},input);
assert.equal(JSON.stringify(input),before,'adapter mutated source');
assert.equal(result.project,'虛構 A 區');
assert.deepEqual(result.mergedBillingProjects,['虛構 A 區']);
assert.equal(result.salesAmount,300000);
assert.equal(result.taxAmount,15000);
assert.equal(result.totalAmount,315000);
assert.equal(result.receivableAmount,315000);
assert.equal(result.lines.length,2);
assert.equal(result.lines.reduce((n,l)=>n+l.amount,0),300000);
assert.equal(result.publicNote,'虛構對外備註');
assert.ok(!JSON.stringify(result).includes('虛構 B 區'),'source zone leaked');
assert.ok(!JSON.stringify(result).includes('syn-b'),'source billing ID leaked');
assert.equal(result.isMergedExternalBilling,true);
console.log('PASS P39-3K-11: source adapter target-only, 2 input zones, 2 lines, totals and original unchanged');
