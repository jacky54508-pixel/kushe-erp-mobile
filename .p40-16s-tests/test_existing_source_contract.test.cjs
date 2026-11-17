'use strict';
/* Read-only inspection of existing original production source (no executing it).
 * These contracts are brittle deliberately: any real source change requires
 * explicit re-review, rather than silent acceptance by this isolated lab.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const groups=read('assets/js/billing-groups.js');
const invoices=read('assets/js/invoices.js');
const print=read('assets/js/external-billing-print.js');
const store=read('assets/js/erp-store.js');

test('official external document selects exactly its target project',()=>{
 assert.ok(print.includes("const mergedBillingProjects=[String(d.displayProjectName||'').trim()];"));
 assert.ok(print.includes("project:d.displayProjectName"));
});
test('existing original customer PDF retains unified line items and totals',()=>{
 assert.ok(print.includes('const raw=unified?d.unified.lines:d.sections.flatMap(section=>section.lines)'));
 assert.ok(print.includes('lines,salesAmount:t.untaxed,taxAmount:t.tax,totalAmount:t.grossTotal'));
});
test('customer invoice status is a print-only switch, not itemized invoice table',()=>{
 assert.ok(print.includes('Individual invoice numbers/statuses/amounts stay exclusively in the originals.'));
 assert.ok(print.includes("const invoiceStatus=t.tax===0"));
 assert.ok(print.includes("invoice_pending"));
});
test('billing group remains presentational and does not create a new receivable',()=>{
 assert.ok(groups.includes('原請款、發票與應收各自保留。'));
 assert.ok(groups.includes('不另計一筆應收'));
});
test('group editor targets a verified original for external display',()=>{
 assert.ok(groups.includes('name="targetBillingId"'));
 assert.ok(groups.includes('store.externalBillingContext(ids,id)'));
 assert.ok(groups.includes('原發票金額不變'));
});
test('invoice editor opens an original billing invoice, not a group invoice',()=>{
 assert.ok(invoices.includes('function openOriginalBillingInvoice(billingId,options={})'));
 assert.ok(invoices.includes("row.sourceType==='billing'"));
 assert.ok(invoices.includes("String(row.sourceId)===id"));
 assert.ok(invoices.includes('Never creates an invoice on a group ID'));
});
test('original store ties output invoice to its real billing source',()=>{
 assert.ok(store.includes('async function saveInvoice(values,id='));
 assert.ok(store.includes('if(type===\'output\')'));
 assert.ok(store.includes('const billing=state.billings.find'));
 assert.ok(store.includes('invoice=syncBillingInvoiceRecord'));
});
test('official commission release remains source-linked and locks settled sources',()=>{
 assert.ok(store.includes('function commissionReleasePool()'));
 assert.ok(store.includes('commissionAllocationReleaseState(row,allocation)'));
 assert.ok(store.includes('settledKeys.has(allocation.allocationKey)'));
});
test('previous candidate test never modifies original formal app scripts',()=>{
 assert.ok(!read('index.html').includes('p40-16s'));
 assert.ok(!store.includes('p40-16s'));
 assert.ok(!groups.includes('p40-16s'));
});
