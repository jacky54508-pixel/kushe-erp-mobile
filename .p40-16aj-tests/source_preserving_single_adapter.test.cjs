/* P40-16AJ: run REAL published view builder with fake Store records
 * and test isolated read-only adapter. stdlib Node only, no network/data.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const ROOT=path.resolve(__dirname,'..');
const src=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const singleCode=src('assets/js/billing-print.js');
const mergedCode=src('assets/js/billing-bundle-print.js');
const adapterCode=src('.p40-16aj-tests/source_preserving_single_adapter.js');
const mainPrint=src('billing-print.html');
const moduleNotes=[];

function runtime(){
  const protectedStates=new Map();
  const win={
    KuSheERPStore:{
      getState:()=>({settings:{}}),
      billingDocumentState:id=>protectedStates.get(id)||null,
      billingDocumentLines:row=>row.lines
    },
    KusheDisplaySort:{sortWorkRows:rows=>rows}
  };
  const ctx={window:win,location:{href:'https://synthetic.invalid/index.html'}};
  vm.runInNewContext(singleCode,ctx);
  vm.runInNewContext(mergedCode,ctx);
  vm.runInNewContext(adapterCode,ctx);
  assert.ok(win.KusheBillingPrint?.buildExternalView);
  assert.ok(win.P40AJ?.normalizeSingle);
  return {win,protectedStates};
}

function record(over={}){
  return {id:'SYNTH-AJ-001',customer:'SYNTH-CUST-1',
    customerName:'虛構建商',project:'SYNTH-PROJ-1',projectName:'虛構M區',
    date:'2026-11-18',taxMode:'未稅',invoiceStatus:'invoice_pending',
    lines:[{house:'H01',item:'虛構牆面補修',unit:'式',qty:1,price:100,amount:100}],
    amount:100,tax:5,grossTotal:105,total:105,
    retentionAmount:0,publicNote:'純虛構測試',...over};
}

function approved(view, overrides={}){
  const trust={approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED',...overrides};
  return {trust,adapter:runtime().win.P40AJ};
}

function adapt(row, overrides={}, guarded=null){
  const ctx=runtime();
  if(guarded)ctx.protectedStates.set(row.id,guarded);
  const published=ctx.win.KusheBillingPrint.buildExternalView(row);
  const trust={approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED',...overrides};
  const view=ctx.win.P40AJ.normalizeSingle(published,trust);
  return {view,published,ctx};
}

test('trusted basic single-billing contract preserves exact approved amounts',()=>{
  const {view,published,ctx}=adapt(record());
  assert.equal(view.sourceSchema,published.schema);
  assert.equal(view.documentType,'billing');
  assert.equal(view.project,'虛構M區');
  assert.equal(view.amounts.totalAmount,105);
  assert.equal(view.amounts.salesAmount,100);
  assert.equal(view.amounts.taxAmount,5);
  assert.equal(view.display.originalDetailTotal,100);
  assert.equal(view.display.showTax,true);
  const summary=ctx.win.P40AJ.denseSummary(view);
  assert.equal(summary.length,1);
  assert.equal(summary[0].amount,100);
});

test('fractional qty + unit price survives without silent price recalculation',()=>{
  const row=record({
    lines:[{house:'F02',item:'虛構地坪',unit:'坪',qty:.25,price:400.25,amount:100}],
    amount:100,tax:5,grossTotal:105,total:105
  });
  const {view,ctx}=adapt(row);
  assert.equal(view.lines[0].qty,.25);
  assert.equal(view.lines[0].price,400.25);
  assert.equal(view.lines[0].amount,100);
  const spec=ctx.win.P40AJ.previewSpec(view);
  assert.equal(spec.sourceRows[0].qtyText,'0.25');
  assert.equal(spec.sourceRows[0].priceText,'400.25');
  assert.equal(spec.sourceRows[0].amountText,'100');
  assert.equal(spec.safeForProduction,false);
  moduleNotes.push('DECIMAL_VALUES_PRESERVED');
});

test('historical-supplement amount preserved with null qty and price',()=>{
  const row=record({
    lines:[{house:'F03',item:'虛構歷史補登',unit:'式',qty:null,price:null,
      sourceType:'historical-supplement',subtotal:100}]
  });
  const {view,ctx}=adapt(row);
  assert.equal(view.lines[0].qty,null);
  assert.equal(view.lines[0].price,null);
  assert.equal(view.lines[0].amount,100);
  assert.equal(view.lines[0].sourcePricingType,'historical-supplement');
  const data=ctx.win.P40AJ.previewSpec(view);
  assert.equal(data.sourceRows[0].qtyText,'—');
  assert.equal(data.sourceRows[0].priceText,'—');
  assert.equal(data.approvedAmounts.totalAmount,105);
  moduleNotes.push('HISTORICAL_AMOUNT_PRESERVED');
});

test('tax included uses gross detail total from actual main printer rule',()=>{
  const row=record({
    taxMode:'含稅',
    lines:[{house:'H04',item:'虛構含稅修補',unit:'式',qty:1,price:105,amount:105}],
    amount:100,tax:5,grossTotal:105,total:105
  });
  const {view,ctx}=adapt(row);
  assert.equal(view.amounts.salesAmount,100);
  assert.equal(view.display.originalDetailTotal,105);
  assert.equal(ctx.win.P40AJ.denseSummary(view)[0].amount,105);
  assert.equal(view.taxMode,'含稅');
  assert.ok(mainPrint.includes("d.taxMode==='含稅'?d.totalAmount:d.salesAmount"));
  moduleNotes.push('INCLUSIVE_DETAIL_USES_GROSS');
});

test('no_invoice mode keeps the published original-tax-display switch',()=>{
  const row=record({invoiceStatus:'no_invoice',taxMode:'含稅',tax:0,
    grossTotal:100,total:100});
  const {view}=adapt(row);
  assert.equal(view.display.showTax,false);
  assert.equal(view.display.originalDetailTotal,100);
  assert.equal(view.invoiceStatus,'no_invoice');
});

test('protected source amounts override row retention and stale user-facing total',()=>{
  const row=record({total:500,retentionAmount:30});
  const guarded={
    protected:true,issues:[],supplement:{taxMode:'未稅'},
    amounts:{untaxed:100,tax:5,grossTotal:105,retention:10,receivable:95}
  };
  const {view,published}=adapt(row,{},guarded);
  assert.equal(published.totalAmount,105);
  assert.equal(view.amounts.totalAmount,105);
  assert.equal(view.amounts.retentionAmount,10);
  assert.equal(view.amounts.receivableAmount,95);
  assert.equal(view.display.showRetention,true);
  moduleNotes.push('PROTECTED_RETAINED_TOTALS_NOT_RECOMPUTED');
});

test('different sourcePricingType keeps separate summary rows and original amounts',()=>{
  const row=record({
    lines:[
      {house:'H01',item:'虛構同項目',unit:'式',qty:1,price:100,amount:100,
       pricingType:'actual'},
      {house:'H02',item:'虛構同項目',unit:'式',qty:1,price:100,amount:100,
       sourceType:'historical-supplement',subtotal:100}
    ],amount:200,tax:10,grossTotal:210,total:210
  });
  const {view,ctx}=adapt(row);
  const s=ctx.win.P40AJ.denseSummary(view);
  assert.equal(s.length,2);
  assert.equal(s[0].sourcePricingType,'actual');
  assert.equal(s[1].sourcePricingType,'historical-supplement');
  assert.equal(s[0].amount+s[1].amount,200);
  assert.equal(s[0].qty+s[1].qty,2);
  assert.ok(mainPrint.includes("line.sourcePricingType||''"));
  moduleNotes.push('SOURCE_CLASSIFICATION_GROUPS_SEPARATE');
});

test('same source type genuinely identical rows group without altering totals',()=>{
  const row=record({lines:[
    {house:'H01',item:'虛構門框',unit:'式',qty:1,price:100,amount:100,
      pricingType:'actual'},
    {house:'H02',item:'虛構門框',unit:'式',qty:1,price:100,amount:100,
      pricingType:'actual'}
  ],amount:200,tax:10,grossTotal:210,total:210});
  const {view,ctx}=adapt(row);
  const s=ctx.win.P40AJ.denseSummary(view);
  assert.equal(s.length,1);
  assert.equal(s[0].qty,2);
  assert.equal(s[0].amount,200);
  assert.equal(view.lines.length,2);
});

test('ordinary nested combined billing must not be treated as single',()=>{
  const c=runtime();
  const a=record(),b=record({id:'SYNTH-AJ-002',project:'SYNTH-PROJ-2',projectName:'虛構L區'});
  const nested=c.win.KusheBillingBundlePrint.buildCombinedView([a,b]);
  assert.equal(nested.documentType,'combined-billing');
  assert.throws(()=>c.win.P40AJ.normalizeSingle(nested,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /NOT_SINGLE_BILLING/);
  moduleNotes.push('COMBINED_BILLING_STILL_BLOCKED');
});

test('cross-zone and merged payload require independently proven origin',()=>{
  const ctx=runtime(),view=ctx.win.KusheBillingPrint.buildExternalView(record());
  view.isMergedExternalBilling=true;
  view.mergedBillingProjects=['虛構M區'];
  assert.throws(()=>ctx.win.P40AJ.normalizeSingle(view,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /MERGED_OR_HISTORICAL_REQUIRES_OWN_ADAPTER/);
});

test('protected legacy source mismatch never silently outputs new amount',()=>{
  const ctx=runtime(),v=ctx.win.KusheBillingPrint.buildExternalView(record());
  v.salesAmount=111;
  assert.throws(()=>ctx.win.P40AJ.normalizeSingle(v,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /APPROVED_TOTAL_RELATION_INCONSISTENT/);
});

test('source lines sum mismatch must stop instead of changing source amounts',()=>{
  const ctx=runtime(),v=ctx.win.KusheBillingPrint.buildExternalView(record());
  v.lines[0].amount=99;
  assert.throws(()=>ctx.win.P40AJ.normalizeSingle(v,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /ORIGINAL_LINES_DO_NOT_MATCH_PUBLISHED_DETAIL_TOTAL/);
});

test('invalid source decimal precision must be rejected',()=>{
  const ctx=runtime(),v=ctx.win.KusheBillingPrint.buildExternalView(record());
  v.lines[0].qty=0.123456;
  assert.throws(()=>ctx.win.P40AJ.normalizeSingle(v,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /INVALID_QUANTITY/);
});

test('unverified status, expired sync or spoofed context blocks',()=>{
  const ctx=runtime(),v=ctx.win.KusheBillingPrint.buildExternalView(record());
  for(const trust of [
    {},{approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'REMOTE_NEWER'},
    {approvedByTrustedCaller:true,lifecycleStatus:'archived',syncState:'SYNCED'},
    {approvedByTrustedCaller:false,lifecycleStatus:'active',syncState:'SYNCED'}
  ])assert.throws(()=>ctx.win.P40AJ.normalizeSingle(v,trust),/UNVERIFIED_CONTEXT/);
});

test('internal invoice number/bank/salary/credentials never appear in customer projection',()=>{
  const c=runtime();
  const row=record();
  row.internalInvoiceNo='PRIVATE-INVOICE-08';
  row.internalSalary='PRIVATE-PAYROLL';
  row.auth={token:'PRIVATE-TOKEN'};
  row.lines[0].bank='PRIVATE-BANK';
  const built=c.win.KusheBillingPrint.buildExternalView(row);
  const output=c.win.P40AJ.normalizeSingle(built,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'});
  const s=JSON.stringify(output);
  for(const t of ['PRIVATE-INVOICE-08','PRIVATE-BANK','PRIVATE-PAYROLL',
      'PRIVATE-TOKEN','internalInvoiceNo','auth','bank'])
    assert.ok(!s.includes(t),'private field escaped: '+t);
  const malicious={...built,publicNote:'PRIVATE-INVOICE-08'};
  assert.throws(()=>c.win.P40AJ.normalizeSingle(malicious,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'}),
    /PRIVATE_DATA_IN_PUBLIC_PROJECTION/);
});

test('source and records never mutated by adapter',()=>{
  const c=runtime(),row=record(),v=c.win.KusheBillingPrint.buildExternalView(row);
  const earlier=JSON.stringify(v),original=JSON.stringify(row);
  const result=c.win.P40AJ.normalizeSingle(v,
    {approvedByTrustedCaller:true,lifecycleStatus:'active',syncState:'SYNCED'});
  assert.equal(JSON.stringify(v),earlier);
  assert.equal(JSON.stringify(row),original);
  assert.equal(result.lines.length,1);
  assert.ok(!adapterCode.includes('KuSheERPStore.setState'));
  assert.ok(!adapterCode.includes('supabase.co'));
  assert.ok(!adapterCode.includes('window.print()'));
});

test('preview plan is not a release certificate or PDF bytes',()=>{
  const {view,ctx}=adapt(record());
  const plan=ctx.win.P40AJ.previewSpec(view);
  assert.equal(plan.safeForProduction,false);
  assert.equal('base64' in plan,false);
  assert.equal('pdfBytes' in plan,false);
  assert.equal(typeof plan.sourceRows[0].amountText,'string');
  assert.equal(plan.approvedAmounts.totalAmount,105);
});

test('source capabilities unchanged, only isolated adapter is new',()=>{
  assert.ok(singleCode.includes('billingDocumentState?.(record.id)'));
  assert.ok(mergedCode.includes("schema:'kushe-combined-billing-v1'"));
  assert.ok(mainPrint.includes('const summaryGroups=new Map();'));
  assert.ok(adapterCode.includes('root.P40AJ={normalizeSingle,denseSummary,previewSpec}'));
});

test.after(()=>console.log('P40AJ_SUMMARY '+JSON.stringify({
  tests:'synthetic published single-builder to isolated adapter only',
  supported_model:'single billing preview contract only',
  resolved_in_isolated_adapter:moduleNotes,
  still_blocked:['FORMAL_PDF_RENDER','REAL_ACCOUNTING_AUTHORITY',
    'NORMAL_COMBINED_BILLING','CROSS_ZONE_MERGED_BILLING',
    'ARCHIVED_DOCUMENT','DEVICE_INTEGRATION','SYNCED_AUTH_PROOF'],
  production_ready:false
})));
