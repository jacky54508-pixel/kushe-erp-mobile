/* P40-16AI — source-grounded readonly compatibility diagnostic.
 * No production writes, no real company records, no network, no PDF output.
 * Green CI = discrepancy detection succeeded; release remains BLOCKED.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const single=read('assets/js/billing-print.js');
const bundle=read('assets/js/billing-bundle-print.js');
const merged=read('assets/js/external-billing-print.js');
const printHtml=read('billing-print.html');
const local=read('.p40-16ah-tests/local_pdf.js');
const blockers=new Set();
function block(id,why){blockers.add(id);console.log('P40AI_BLOCK '+JSON.stringify({id,why}));}
function runtime(){
  const guarded=new Map();
  const window={
    KuSheERPStore:{billingDocumentLines:r=>r.lines,
      billingDocumentState:id=>guarded.get(id)||null,getState:()=>({settings:{}})},
    KusheDisplaySort:{sortWorkRows:rows=>rows}
  };
  const ctx={window,location:{href:'https://synthetic.invalid/index.html'}};
  vm.runInNewContext(single,ctx);
  vm.runInNewContext(bundle,ctx);
  vm.runInNewContext(local,ctx);
  return {single:window.KusheBillingPrint,bundle:window.KusheBillingBundlePrint,
          local:window.P40AH,guarded};
}
function make(overrides={}){
  return {id:'SYNTH-001',number:'SYNTH-001',customer:'FAKE-C-1',
    customerName:'虛構客戶',project:'FAKE-P-1',projectName:'虛構M區',
    date:'2026-11-18',taxMode:'未稅',invoiceStatus:'invoice_pending',
    lines:[{house:'H01',item:'虛構修補',unit:'式',qty:1,price:100,amount:100}],
    amount:100,tax:5,grossTotal:105,total:105,retentionAmount:0,
    publicNote:'虛構，禁止對外寄送',...overrides};
}
const testActive=view=>({...view,status:'active'});

test('published single view is built from its own actual module',()=>{
  const c=runtime(),v=c.single.buildExternalView(make());
  assert.equal(v.schema,'kushe-external-document-v1');
  assert.equal(v.documentType,'billing');
  assert.equal(v.lines.length,1);
  assert.equal(v.lines[0].house,'H01');
  assert.equal(v.salesAmount,100);
  assert.equal(v.totalAmount,105);
  assert.equal(v.project,'虛構M區');
});

test('published view lacks AH-specific lifecycle status',()=>{
  const c=runtime(),v=c.single.buildExternalView(make());
  assert.equal(Object.hasOwn(v,'status'),false);
  assert.throws(()=>c.local.publicOnly(v,v.project),/WRONG_TARGET_OR_STATUS/);
  const mock=c.local.publicOnly(testActive(v),v.project);
  assert.equal(mock.totalAmount,105);
  block('SINGLE_STATUS_SHAPE','AH test-only status field does not exist on published external billing view');
});

test('fractional line from actual builder is incompatible with AH integer-only checks',()=>{
  const c=runtime(),v=c.single.buildExternalView(make({
    lines:[{house:'H01',item:'虛構小面積補修',unit:'坪',qty:.5,price:100,amount:50}],
    amount:50,tax:3,grossTotal:53,total:53
  }));
  assert.equal(v.lines[0].qty,.5);
  assert.equal(v.lines[0].amount,50);
  assert.throws(()=>c.local.publicOnly(testActive(v),v.project),/BAD_LINE/);
  block('DECIMAL_QTY','published allows noninteger work quantity, AH refuses it');
});

test('historical supplement can include amount without quantity and unit price',()=>{
  const c=runtime(),v=c.single.buildExternalView(make({
    lines:[{house:'H02',item:'虛構歷史補登',unit:'式',qty:null,price:null,
      sourceType:'historical-supplement',subtotal:100}]
  }));
  assert.equal(v.lines[0].amount,100);
  assert.equal(v.lines[0].qty,null);
  assert.equal(v.lines[0].sourcePricingType,'historical-supplement');
  assert.throws(()=>c.local.publicOnly(testActive(v),v.project),/BAD_LINE/);
  block('HISTORICAL_SOURCE','published historical supplement may not have standard qty/price');
});

test('tax-inclusive line amount can equal gross, not untaxed',()=>{
  const c=runtime(),v=c.single.buildExternalView(make({
    taxMode:'含稅',
    lines:[{house:'H01',item:'虛構含稅',unit:'式',qty:1,price:105,amount:105}],
    amount:100,tax:5,grossTotal:105,total:105
  }));
  assert.equal(v.lines[0].amount,v.totalAmount);
  assert.notEqual(v.lines[0].amount,v.salesAmount);
  assert.ok(printHtml.includes("d.taxMode==='含稅'?d.totalAmount:d.salesAmount"));
  assert.throws(()=>c.local.publicOnly(testActive(v),v.project),/UNTRUSTED_TOTAL/);
  block('TAX_INCLUDED','published tax-inclusive display total differs from local untaxed-sum assumption');
});

test('protected original amounts must override untrusted visible record fields',()=>{
  const c=runtime();
  c.guarded.set('SYNTH-001',{protected:true,issues:[],supplement:{taxMode:'未稅'},
    amounts:{untaxed:100,tax:5,grossTotal:105,retention:10,receivable:95}});
  const v=c.single.buildExternalView(make({total:999,retentionAmount:40}));
  assert.equal(v.totalAmount,105);
  assert.equal(v.retentionAmount,10);
  assert.equal(v.receivableAmount,95);
  assert.equal(c.local.publicOnly(testActive(v),v.project).receivableAmount,95);
  block('PROTECTED_TOTAL_ORIGIN','the local PDF renderer must consume exact ERP approved amounts, not recalculate discounts or retention');
});

test('ordinary combined document is its own nested schema and cannot use AH directly',()=>{
  const c=runtime();
  const other=make({id:'SYNTH-002',project:'FAKE-P-2',projectName:'虛構L區',
    lines:[{house:'H02',item:'虛構油漆',unit:'式',qty:1,price:200,amount:200}],
    amount:200,tax:10,grossTotal:210,total:210});
  const v=c.bundle.buildCombinedView([make(),other]);
  assert.equal(v.schema,'kushe-combined-billing-v1');
  assert.equal(v.documentType,'combined-billing');
  assert.equal(v.billings.length,2);
  assert.equal(v.projects.length,2);
  assert.equal(v.totals.grossTotal,315);
  assert.throws(()=>c.local.publicOnly(testActive(v),'虛構M區'),/WRONG_TARGET_OR_STATUS/);
  block('NESTED_COMBINED_FORMAT','combined view has nested billings/projects/totals, and no verified local adapter exists');
});

function officialCrossZone(){
  const i=merged.indexOf('  function originalTemplateView(payload,d){');
  const j=merged.indexOf("\n  document.getElementById('close')",i);
  assert.ok(i>=0&&j>i,'official cross-zone function changed: STOP');
  const functionSource=merged.slice(i,j);
  return vm.runInNewContext('(function(){'+functionSource+';return originalTemplateView;})()',
    {window:{KusheExternalBillingInvoice:{project:()=>({rows:[]})}}});
}
test('published cross-zone customer payload keeps only selected project and no original invoice details',()=>{
  const fn=officialCrossZone();
  const d={
    schema:'kushe-external-billing-group-v2',
    targetBillingId:'SYNTH-002',displayProjectName:'虛構M區',
    documentDate:'2026-11-18',customerName:'虛構客戶',note:'虛構說明',
    sourceSnapshots:[
      {invoiceStatus:'invoiced',invoiceNo:'PRIVATE-INVOICE-08'},
      {invoiceStatus:'invoice_pending',invoiceNo:'PRIVATE-INVOICE-10'}
    ],
    unified:{taxMode:'未稅',lines:[
      {house:'H01',item:'虛構跨區修補',unit:'式',qty:1,price:100,amount:100}
    ]},
    totals:{untaxed:100,tax:5,grossTotal:105,retention:10,receivable:95}
  };
  const v=fn({template:{schema:'kushe-original-billing-template-v1',
    billingId:'SYNTH-002',company:{name:'虛構公司',taxId:'00000000'}}},d);
  assert.equal(v.project,'虛構M區');
  assert.equal(v.mergedBillingProjects.length,1);
  assert.equal(v.mergedBillingProjects[0],'虛構M區');
  assert.equal(v.retentionAmount,10);
  assert.equal(v.receivableAmount,95);
  assert.equal(v.lines[0].sourcePricingType,'external-document');
  const rendered=JSON.stringify(v);
  assert.equal(rendered.includes('PRIVATE-INVOICE-'),false);
  assert.equal(rendered.includes('sourceSnapshots'),false);
  block('CROSS_ZONE_SOURCE_FLAGS','must preserve target project only and original external-document classification');
});

test('original dense summary respects sourcePricingType; AH silently merges unlike lines',()=>{
  const a=printHtml.indexOf('const summaryGroups=new Map();');
  const b=printHtml.indexOf('const groupedSummary=',a);
  assert.ok(a>=0&&b>a,'published summary algorithm changed: STOP');
  const data=[
    {house:'H01',item:'虛構修補',unit:'式',qty:1,price:100,amount:100,
      sourcePricingType:'historical-supplement'},
    {house:'H02',item:'虛構修補',unit:'式',qty:1,price:100,amount:100,
      sourcePricingType:'external-document'}
  ];
  const official=vm.runInNewContext('(()=>{'+printHtml.slice(a,b)+'return summaryItems;})()',
    {denseInvoiceGroup:true,lines:data,billingDetailTotal:200,
      n:x=>Number(x)||0,
      sum:(rows,key)=>rows.reduce((t,r)=>t+(Number(r[key])||0),0)});
  const ah=runtime().local.summaryOf(data);
  assert.equal(official.length,2);
  assert.equal(ah.length,1);
  assert.equal(official.reduce((sum,l)=>sum+l.amount,0),200);
  assert.equal(ah.reduce((sum,l)=>sum+l.amount,0),200);
  block('SOURCE_PRICING_GROUP','AH grouping key ignores sourcePricingType, so matching amounts alone cannot establish parity');
});

test('published print display switches dropped from candidate publicOnly view',()=>{
  const c=runtime(),v=c.single.buildExternalView(make());
  assert.equal('invoiceStatus' in v,true);
  assert.equal('pricingMode' in v,true);
  const projected=c.local.publicOnly(testActive(v),v.project);
  assert.equal('invoiceStatus' in projected,false);
  assert.equal('pricingMode' in projected,false);
  assert.ok(printHtml.includes("hasTax=isQuote||d.invoiceStatus!=='no_invoice'"));
  block('PRINT_DISPLAY_SWITCHES','must reproduce invoice/tax/pricing presentation without disclosing internal invoice numbers');
});

test('ERP production sources and lab generator are read-only boundaries',()=>{
  assert.ok(single.includes('billingDocumentState?.(record.id)'));
  assert.ok(bundle.includes("schema:'kushe-combined-billing-v1'"));
  assert.ok(merged.includes('const mergedBillingProjects=[String(d.displayProjectName'));
  assert.ok(local.includes('window.P40AH={generate,publicOnly,summaryOf}'));
  assert.ok(!local.includes('KuSheERPStore.setState'));
  assert.ok(!local.includes('supabase.co'));
});

test.after(()=>{
  console.log('P40AI_SUMMARY '+JSON.stringify({
    diagnostic_only:true,release_gate:'BLOCKED',
    discrepancies:[...blockers].sort(),
    detail:'No production compatibility or PDF visual parity has been achieved.'
  }));
});
