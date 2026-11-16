/* P40-15 isolated, synthetic-only; NEVER load or write actual ERP data. */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../assets/js/billing-group-discount-preview.js');
const src = name => fs.readFileSync(path.join(__dirname,'..',name), 'utf8');
function source(id, gross, tax, retention, received, status, invoiceNo='') {
  const untaxed = gross - tax, receivable = gross - retention;
  const settlement = {
    billingId: id, received, outstanding: receivable - received,
    retentionReceived: 0, retentionOutstanding: retention,
    pendingCheque: 0, availableToCollect: receivable - received
  };
  return {document:{
    billingId:id,receivableId:'ar-'+id, number:'SYNTH-'+id,
    anchors:{untaxed,tax,grossTotal:gross,retention,receivable},
    invoiceStatus:status, invoiceNo
  },settlement};
}
function fixture() {
  const sources = [
    source('fake-a',350000,16667,17500,10000,'invoiced','FAKE-INVOICE'),
    source('fake-b',282100,13433,14105,0,'invoice_pending')
  ];
  const totals={};
  for(const k of ['untaxed','tax','grossTotal','retention','receivable'])
    totals[k]=sources.reduce((v,s)=>v+s.document.anchors[k],0);
  for(const k of ['received','outstanding','retentionReceived','retentionOutstanding','pendingCheque','availableToCollect'])
    totals[k]=sources.reduce((v,s)=>v+s.settlement[k],0);
  return {document:{id:'fake-merge',status:'active',revision:1,sourceIds:['fake-a','fake-b']},
    sources,totals,issues:[],canGroup:true,termsChanged:false,settlementChanged:false};
}
test('merged 632100 -> 600000 applies exactly one gross reduction, never posts',()=>{
  const g=fixture(),before=JSON.stringify(g);
  const p=api.preview(g,600000);
  assert.equal(p.original.grossTotal,632100);
  assert.equal(p.approvedGross,600000);
  assert.equal(p.reduction,32100);
  assert.equal(p.sourceCount,2);
  assert.equal(p.canPost,false);assert.equal(p.readOnly,true);
  assert.equal(p.taxAllocation,'待核對');
  assert.equal(p.receivableAdjustment,'待核對');
  assert.ok(p.locks.some(s=>s.includes('已開發票')));
  assert.ok(p.locks.some(s=>s.includes('已有收款')));
  assert.equal(JSON.stringify(g),before);
});
test('fail closed: invalid amount, stale group, mismatched source sum, duplicate, invalid receipt',()=>{
  const cases=[
    [g=>{},0],
    [g=>{},632101],
    [g=>{g.canGroup=false},600000],
    [g=>{g.termsChanged=true},600000],
    [g=>{g.totals.receivable++},600000],
    [g=>{g.document.sourceIds[1]='fake-a'},600000],
    [g=>{g.sources[0].settlement.outstanding++},600000],
    [g=>{g.sources[0].document.invoiceStatus='unknown'},600000],
  ];
  for(const [change,amount] of cases){
    const g=fixture();change(g);
    assert.throws(()=>api.preview(g,amount));
  }
});
test('whole-group preview never reallocates tax, retention, AR or changes source lines',()=>{
  const g=fixture();g.sources[0].document.originalLines=Array.from({length:9},(_,i)=>({item:'fixture-'+i}));
  g.sources[1].document.originalLines=Array.from({length:9},(_,i)=>({item:'fixture-'+(i+9)}));
  const before=JSON.stringify(g);
  const p=api.preview(g,'620000');
  assert.equal(p.reduction,12100);
  assert.equal(g.sources[0].document.originalLines.length+g.sources[1].document.originalLines.length,18);
  assert.equal(JSON.stringify(g),before);
});
test('all bill lists, details and merged rows visibly provide concession actions',()=>{
  const billing=src('assets/js/billing.js'),groups=src('assets/js/billing-groups.js'),index=src('index.html');
  assert.ok(billing.includes('data-billing-discount-readonly="${esc(row.id)}"'));
  assert.ok(billing.includes('function openBillingDiscountReadOnly(id)'));
  assert.ok(billing.includes('window.KusheBillingGroups?.activeFor(id)'));
  assert.ok(groups.includes('data-bg-discount'));
  assert.ok(groups.includes('KusheBillingGroupDiscountPreview.open(g.document.id)'));
  assert.ok(index.includes('billing-group-discount-preview.js?v=p40-15-readonly-1'));
  assert.ok(index.indexOf('billing-groups.js')<index.indexOf('billing-group-discount-preview.js'));
  assert.ok(index.indexOf('src="assets/js/billing-group-discount-preview.js')<index.indexOf('src="assets/js/billing.js?v='));
});
test('new module has no ERP or browser persistence writers',()=>{
  const source=src('assets/js/billing-group-discount-preview.js');
  for(const term of ['.persist(','.saveExternalBillingDocument(','.updateBilling(','.saveBilling(',
                      '.updateReceivable(','.saveInvoice(','.updateInvoice(','.saveReceipt(',
                      '.post(','.sync(', 'localStorage','indexedDB','fetch(','XMLHttpRequest',
                      'supabase','document.cookie']){
    assert.equal(source.includes(term),false,'forbidden writer marker '+term);
  }
  assert.ok(source.includes('externalBillingDocumentIndex()'));
  assert.ok(source.includes('readOnly: true'));
  assert.ok(source.includes('canPost: false'));
});
