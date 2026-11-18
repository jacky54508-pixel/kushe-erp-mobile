/* P40-16AV: ACTUAL PINNED-MAIN financial validators on FAKE sources only.
 * No ERP app writes, no Supabase, no real accounts, no PDF release or backend.
 * This is a CI contract, not trusted production document ingestion.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture,groupForDiscount,AMOUNT_KEYS}=require('./fixture.cjs');

const ROOT=path.join(__dirname,'..');
const official=fs.readFileSync(path.join(ROOT,'assets/js/external-billing-print.js'),'utf8');
const invoice=require(path.join(ROOT,'assets/js/external-billing-invoice.js'));
const discount=require(path.join(ROOT,'assets/js/billing-group-discount-preview.js'));

function exactSlice(text,start,end){
  const a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a, 'STOP: original formal code signature changed');
  return text.slice(a,b);
}
const validator=exactSlice(official,'  function validate(payload){','  // P31-4:');
const projector=exactSlice(official,'  function originalTemplateView(payload,d){',
                           "  document.getElementById('close')");
const originalCode=Function('window',
  '"use strict";\n'+validator+'\n'+projector+
  '\nreturn Object.freeze({validate,originalTemplateView});')({
    KusheExternalBillingInvoice:invoice
  });

const allowedOuter=new Set([
  'schema','documentType','title','number','customer','project','date',
  'taxMode','pricingMode','invoiceStatus','lines','salesAmount','taxAmount',
  'totalAmount','retentionAmount','receivableAmount','publicNote','company',
  'fileName','mergedBillingProjects','isMergedExternalBilling'
]);
const allowedLine=new Set([
  'house','item','unit','qty','price','amount','pricingType','sourcePricingType'
]);
const allowedCompany=new Set([
  'name','englishName','taxId','address','phone','line'
]);
const finance={
  untaxed:'salesAmount',tax:'taxAmount',grossTotal:'totalAmount',
  retention:'retentionAmount',receivable:'receivableAmount'
};
const clone=x=>structuredClone(x);
const noUnexpected=(o,allowed,reason)=>{
  assert.equal(typeof o,'object',reason);
  for(const key of Object.keys(o))assert.ok(allowed.has(key),reason+': '+key);
};

function outputPrivacyGate(payload,out){
  // Additional PROPOSED gate only in isolated lab. It is NOT in formal main.
  noUnexpected(out,allowedOuter,'public outer key');
  for(const line of out.lines)noUnexpected(line,allowedLine,'public item key');
  noUnexpected(out.company,allowedCompany,'public company key');
  const d=payload.document;
  assert.equal(out.schema,'kushe-external-document-v1');
  assert.equal(out.documentType,'billing');
  assert.equal(out.isMergedExternalBilling,true);
  assert.equal(out.number,'');
  assert.equal(out.project,d.displayProjectName);
  assert.deepEqual(out.mergedBillingProjects,[d.displayProjectName]);
  assert.equal(out.lines.length,d.unified.lines.length);
  for(let i=0;i<out.lines.length;i++){
    const original=d.unified.lines[i],line=out.lines[i];
    for(const key of ['house','item','unit','qty','price','amount']){
      assert.equal(line[key],original[key],'line fidelity '+i+' '+key);
    }
  }
  for(const [source,publicKey] of Object.entries(finance)){
    assert.equal(out[publicKey],d.totals[source],'approved original amount '+source);
  }
  assert.equal(out.salesAmount+out.taxAmount,out.totalAmount);
  assert.equal(out.totalAmount-out.retentionAmount,out.receivableAmount);
  const serialized=JSON.stringify(out);
  for(const secret of ['sourceSnapshots','settlementSnapshots','invoiceNo','invoiceDate',
      'sourceInvoiceReferences','bankTransactions','payroll','salary',
      'PRIVATE-INVOICE-', 'PRIVATE-BANK', 'PRIVATE-SALARY', 'PRIVATE-TOKEN']){
    assert.equal(serialized.includes(secret),false,'PROPOSED PRIVACY GATE: '+secret);
  }
  for(const source of d.sourceSnapshots){
    if(source.projectName!==d.displayProjectName)
      assert.equal(serialized.includes(source.projectName),false,'other project leaked');
    if(source.invoiceNo)
      assert.equal(serialized.includes(source.invoiceNo),false,'original invoice number leaked');
  }
  return out;
}
function outward(payload){
  const d=originalCode.validate(payload);
  const view=originalCode.originalTemplateView(payload,d);
  return outputPrivacyGate(payload,view);
}
function rejectOriginal(mutator,expect=/./){
  const p=fixture();
  mutator(p);
  assert.throws(()=>originalCode.validate(p),expect);
}
function rejectProjection(mutator,expect=/./){
  const p=fixture();
  mutator(p);
  const d=originalCode.validate(p);
  assert.throws(()=>originalCode.originalTemplateView(p,d),expect);
}

test('official validate and projection are verbatim main source, not a replacement calculator',()=>{
  assert.match(validator,/function validate\(payload\)/);
  assert.match(projector,/function originalTemplateView\(payload,d\)/);
  assert.match(projector,/salesAmount:t\.untaxed,taxAmount:t\.tax,totalAmount:t\.grossTotal/);
  assert.match(projector,/No independent public layout, no tax recomputation|const taxMode=/);
});
for(const [name,opts] of [
  ['normal untaxed with retention',{}],
  ['gross-tax-included source price',{taxMode:'含稅'}],
  ['no-invoice tax-exempt',{exempt:true}],
  ['fractional qty retains one-dollar rounded line',{fractional:true}],
  ['August and October recorded invoice references',{twoInvoiced:true}],
  ['18 original lines with explicit 6 categories',{counts:[9,9]}]
]){
  test('approved original totals and complete customer-only construction: '+name,()=>{
    const p=fixture(opts),before=JSON.stringify(p);
    const view=outward(p);
    assert.equal(JSON.stringify(p),before,'projection changed original snapshot');
    assert.equal(view.lines.length,opts.counts?.reduce((a,b)=>a+b,0)||7);
    assert.equal(view.project,'FAKE-M-ZONE');
    assert.ok(!JSON.stringify(view).includes('FAKE-L-ZONE'));
    assert.equal(view.totalAmount,p.document.totals.grossTotal);
    assert.equal(view.retentionAmount,p.document.totals.retention);
    assert.equal(view.receivableAmount,p.document.totals.receivable);
    if(opts.exempt){assert.equal(view.taxAmount,0);assert.equal(view.invoiceStatus,'no_invoice');}
    if(opts.taxMode==='含稅')assert.equal(view.lines.reduce((a,b)=>a+b.amount,0),view.totalAmount);
    else assert.equal(view.lines.reduce((a,b)=>a+b.amount,0),view.salesAmount);
    if(opts.fractional)assert.equal(view.lines[0].qty,0.5);
  });
}

test('actual invoice source reconciliation preserves separately recorded Aug/Oct invoice identifiers internally only',()=>{
  const p=fixture({twoInvoiced:true});
  const invoiceProjection=invoice.project(p.document.sourceSnapshots,p.document.totals);
  assert.equal(invoiceProjection.rows.length,2);
  assert.deepEqual(invoiceProjection.rows.map(x=>x.invoiceMonth),['2026-08','2026-10']);
  assert.deepEqual(invoiceProjection.rows.map(x=>x.invoiceNo),['PRIVATE-INVOICE-AUG','PRIVATE-INVOICE-OCT']);
  assert.equal(invoiceProjection.readOnly,true);
  const publicView=outward(p);
  assert.equal(publicView.invoiceStatus,'invoice_pending');
  assert.ok(!JSON.stringify(publicView).includes('PRIVATE-INVOICE'));
  assert.deepEqual(publicView.mergedBillingProjects,['FAKE-M-ZONE']);
});

test('internal invoice record has source amounts equal to both originals, without creating a new invoice',()=>{
  const p=fixture();
  const model=invoice.project(p.document.sourceSnapshots,p.document.totals);
  assert.equal(model.sourceCount,2);
  assert.equal(model.createdInvoiceRecords,0);
  assert.equal(model.createdReceivables,0);
  for(const k of Object.keys(finance))assert.equal(model.totals[k],p.document.totals[k]);
});

test('source invoice reference rejects duplicate receivable and incorrect original anchor',()=>{
  let p=fixture();
  p.document.sourceSnapshots[1].receivableId=p.document.sourceSnapshots[0].receivableId;
  assert.throws(()=>invoice.project(p.document.sourceSnapshots,p.document.totals));
  p=fixture();
  p.document.sourceSnapshots[0].anchors.tax++;
  assert.throws(()=>invoice.project(p.document.sourceSnapshots,p.document.totals));
});

const rejects=[
  ['duplicate original billing ID',p=>{
    p.document.sourceSnapshots[1].billingId=p.document.sourceSnapshots[0].billingId;}],
  ['source anchor gross differs from original tax',p=>p.document.sourceSnapshots[0].anchors.grossTotal++],
  ['retention ledger differs from original receivable',p=>p.document.sourceSnapshots[0].anchors.retention++],
  ['source tax changed independently of gross',p=>p.document.sourceSnapshots[0].anchors.tax++],
  ['source receivable changed',p=>p.document.sourceSnapshots[0].anchors.receivable++],
  ['settlement source is not a one-to-one mapping',p=>p.document.settlementSnapshots[1].billingId='FAKE-WRONG'],
  ['already received but outstanding not adjusted',p=>p.document.settlementSnapshots[0].received++],
  ['retention received and outstanding disagree',p=>p.document.settlementSnapshots[0].retentionReceived++],
  ['pending cheque and available sum disagree',p=>p.document.settlementSnapshots[0].pendingCheque++],
  ['merged gross changed without source changes',p=>p.document.totals.grossTotal++],
  ['merged tax changed without source changes',p=>p.document.totals.tax++],
  ['merged receivable changed without source changes',p=>p.document.totals.receivable++],
  ['unified quantity changed without line amount',p=>p.document.unified.lines[0].qty=2],
  ['unified price changed without amount',p=>p.document.unified.lines[0].price=200],
  ['unified amount changed without qty and price',p=>p.document.unified.lines[0].amount++],
  ['unified total differs from original',p=>p.document.unified.total++],
  ['unified target differs from original',p=>p.document.unified.target++],
  ['unified row missing',p=>p.document.unified.lines.pop()],
  ['wrong document original target',p=>p.document.targetBillingId='FAKE-NOT-AN-ORIGINAL'],
  ['target project differs from verified target original',p=>p.document.displayProjectName='FAKE-OTHER-ZONE'],
  ['source customer not unique',p=>p.document.sourceSnapshots[1].customerId='FAKE-DIFFERENT'],
  ['one missing source ID',p=>p.document.sourceIds.pop()],
  ['duplicate source ID',p=>p.document.sourceIds[1]=p.document.sourceIds[0]],
  ['document marked archived under current customer print',p=>p.document.status='archived'],
  ['document uses mismatched old sections',p=>p.document.sections=[]],
  ['source line price is non-finite',p=>p.document.unified.lines[0].price=Infinity],
  ['amount not safe integer',p=>p.document.unified.lines[0].amount=1.5],
  ['negative quantity',p=>p.document.unified.lines[0].qty=-1],
  ['unsafe large amount',p=>p.document.unified.lines[0].amount=Number.MAX_SAFE_INTEGER+1]
];
for(const [label,mutator] of rejects)
  test('official original-source fail closed: '+label,()=>rejectOriginal(mutator));

test('same original lines with tampered name require an explicit reorganization reason',()=>{
  const p=fixture();
  p.document.unified.lines[0].item='FAKE-REORGANIZED-NAME';
  assert.throws(()=>originalCode.validate(p),/核對說明/);
  p.document.unified.reason='FAKE-APPROVED-REORG-REASON';
  assert.doesNotThrow(()=>originalCode.validate(p));
  // Note: an explanation is not a cryptographically trusted approval!
});
test('incorrect original template reference is rejected',()=>{
  rejectProjection(p=>p.template.billingId='FAKE-WRONG',/模板/);
});
test('source invoice numbers missing prevents outward projection',()=>{
  rejectProjection(p=>p.document.sourceSnapshots[0].receivableId='');
});
test('customer note containing an original invoice ID is recognized as a PRIVACY GAP in current projector',()=>{
  const p=fixture();
  p.document.note='FAKE-NOTE PRIVATE-INVOICE-AUG';
  const publicView=originalCode.originalTemplateView(p,originalCode.validate(p));
  // Current official function copies note; it does not sanitize arbitrary note text.
  assert.ok(publicView.publicNote.includes('PRIVATE-INVOICE-AUG'));
  // This ADDITIONAL LAB-ONLY allowlist/privacy gate must block; not deployed.
  assert.throws(()=>outputPrivacyGate(p,publicView),/PROPOSED PRIVACY GATE/);
});
test('customer note containing source zone is recognized as privacy gap',()=>{
  const p=fixture();
  p.document.note='FAKE-L-ZONE';
  assert.throws(()=>outward(p),/other project leaked/);
});
test('exact displayed money is not sourced from draft discount',()=>{
  const p=fixture();
  const g=groupForDiscount(p);
  const before=JSON.stringify(g);
  const discountPreview=discount.preview(g,g.totals.grossTotal-50);
  assert.equal(discountPreview.readOnly,true);
  assert.equal(discountPreview.canPost,false);
  assert.equal(discountPreview.reduction,50);
  assert.equal(discountPreview.approvedGross,p.document.totals.grossTotal-50);
  assert.equal(discountPreview.taxAllocation,'待核對');
  assert.equal(discountPreview.retentionAllocation,'待核對');
  assert.equal(discountPreview.receivableAdjustment,'待核對');
  assert.ok(discountPreview.locks.some(x=>x.includes('已開發票')));
  assert.equal(JSON.stringify(g),before);
  const view=outward(p);
  assert.equal(view.totalAmount,p.document.totals.grossTotal,
               'readonly discount must NOT recalculate official customer PDF');
  assert.notEqual(view.totalAmount,discountPreview.approvedGross);
});
test('zero discount still read-only, with no allocated tax or retention',()=>{
  const p=fixture(),g=groupForDiscount(p);
  const preview=discount.preview(g,g.totals.grossTotal);
  assert.equal(preview.readOnly,true);
  assert.equal(preview.reduction,0);
  assert.ok(preview.locks.some(x=>x.includes('未產生折讓')));
});
test('concession preview fails on zero/over-cap approval and incomplete source',()=>{
  let p=fixture(),g=groupForDiscount(p);
  assert.throws(()=>discount.preview(g,0));
  assert.throws(()=>discount.preview(g,g.totals.grossTotal+1));
  g.termsChanged=true;assert.throws(()=>discount.preview(g,g.totals.grossTotal-1));
});
test('concession preview refuses modified source anchoring, settlement and source order',()=>{
  for(const mutate of [
    g=>g.sources[0].document.anchors.tax++,
    g=>g.sources[0].settlement.received++,
    g=>g.sources[0].document.billingId='FAKE-SWAPPED',
    g=>g.sources[1].document.receivableId='',
    g=>g.totals.grossTotal++,
    g=>g.sources[1].document.invoiceStatus='invalid'
  ]){
    const g=groupForDiscount(fixture());
    mutate(g);
    assert.throws(()=>discount.preview(g,g.totals.grossTotal-1));
  }
});
test('concession preview flags already issued invoices, bank receipts and pending cheques for independent review',()=>{
  const p=fixture(),g=groupForDiscount(p);
  const x=g.sources[0].settlement;
  x.received=50;x.outstanding-=50;x.availableToCollect-=70;x.pendingCheque=20;
  g.totals.received+=50;g.totals.outstanding-=50;
  g.totals.availableToCollect-=70;g.totals.pendingCheque+=20;
  const v=discount.preview(g,g.totals.grossTotal-60);
  assert.ok(v.locks.some(x=>x.includes('已開發票')));
  assert.ok(v.locks.some(x=>x.includes('已有收款')));
  assert.ok(v.locks.some(x=>x.includes('支票預留')));
  assert.equal(v.canPost,false);
  assert.equal(v.original.grossTotal,p.document.totals.grossTotal);
});
test('multi-month invoices never copied into current outward project details',()=>{
  const p=fixture({twoInvoiced:true});
  const notesBefore=p.document.sourceSnapshots.map(x=>[x.invoiceNo,x.invoiceDate]);
  const v=outward(p);
  assert.deepEqual(p.document.sourceSnapshots.map(x=>[x.invoiceNo,x.invoiceDate]),notesBefore);
  assert.ok(!('sourceInvoiceReferences' in v));
  assert.ok(!('invoiceNo' in v));
  assert.ok(!('sourceSnapshots' in v));
  assert.ok(v.lines.every(x=>!('invoiceNo' in x)));
});
test('only exact approved original data accepted; no direct write or network use in runner',()=>{
  const files=['assets/js/external-billing-print.js',
    'assets/js/external-billing-invoice.js','assets/js/billing-group-discount-preview.js'];
  for(const file of files)assert.ok(fs.existsSync(path.join(ROOT,file)));
  assert.ok(!fs.existsSync(path.join(ROOT,'supabase/migrations/p40-16av.sql')));
});
