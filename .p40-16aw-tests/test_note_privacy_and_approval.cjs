/* P40-16AW: isolated source regression and privacy tests, entirely FAKE.
 * No official ERP Store reads, network, real invoice, Supabase, PDF release.
 * P40-16AW approval registry is a MOCK contract, not deployed auth.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {fixture}=require('./fixture.cjs');
const ROOT=path.resolve(__dirname,'..');
const file='assets/js/external-billing-print.js';
const candidate=fs.readFileSync(path.join(ROOT,file),'utf8');
const baseline=execFileSync('git',['show','origin/main:'+file],{cwd:ROOT,encoding:'utf8'});
const invoices=require(path.join(ROOT,'assets/js/external-billing-invoice.js'));
const clone=structuredClone;

function slice(text,start,end){
  const a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Source drift, STOP: '+start+' / '+end);
  return text.slice(a,b);
}
function compiled(text){
  const validator=slice(text,'  function validate(payload){','  // P31-4:');
  const projector=slice(text,'  function originalTemplateView(payload,d){',
    "  document.getElementById('close')");
  const obj=Function('window','"use strict";\n'+validator+'\n'+projector+
    '\nreturn Object.freeze({validate,originalTemplateView});')({
      KusheExternalBillingInvoice:invoices
    });
  return obj;
}
const current=compiled(candidate),main=compiled(baseline);
function currentView(payload){
  return current.originalTemplateView(payload,current.validate(payload));
}
function mainView(payload){
  return main.originalTemplateView(payload,main.validate(payload));
}
const noteRisk=(payload,reason)=>{
  assert.throws(()=>currentView(payload),err=>{
    assert.match(err.message,/對外備註/);
    assert.ok(!err.message.includes('PRIVATE-'),'Do not reveal source token in error');
    assert.ok(!err.message.includes('FAKE-L-ZONE'),'Do not echo other project name');
    if(reason)assert.ok(err.message.includes('原發票')||err.message.includes('資訊'));
    return true;
  });
};

test('only isolated originalTemplateView note guard added, formal validate identical',()=>{
  assert.ok(!baseline.includes('assertCurrentCustomerNotePrivacy'));
  assert.ok(candidate.includes('assertCurrentCustomerNotePrivacy(payload,d,publicNote)'));
  assert.equal(
    slice(candidate,'  function validate(payload){','  // P40-16AW DRAFT ONLY:'),
    slice(baseline,'  function validate(payload){','  // P31-4:')
  );
  assert.equal(slice(candidate,"  document.getElementById('close')","    // Explicit historical-version viewing"),
    slice(baseline,"  document.getElementById('close')","    // Explicit historical-version viewing"));
  assert.ok(!candidate.includes('fetch('));
});

const cleanCases=[
  ['untaxed with retention',{}],
  ['tax-included source',{taxMode:'含稅'}],
  ['tax exempt',{exempt:true}],
  ['fractional quantity',{fractional:true}],
  ['both original invoices Aug Oct',{twoInvoiced:true}],
  ['18 construction rows',{counts:[9,9]}],
  ['regular neutral public construction note',{note:'施工位置按現場完成結果計算，請確認驗收。'}]
];
for(const [name,opts] of cleanCases){
  test('no customer document content changes: '+name,()=>{
    const {note,...arg}=opts;
    const p=fixture(arg);
    if(note)p.document.note=note;
    const before=JSON.stringify(p);
    const a=mainView(p),b=currentView(p);
    assert.deepEqual(b,a);
    assert.equal(JSON.stringify(p),before);
    assert.equal(b.project,'FAKE-M-ZONE');
    assert.deepEqual(b.mergedBillingProjects,['FAKE-M-ZONE']);
    assert.equal(b.lines.length,p.document.unified.lines.length);
    assert.equal(b.salesAmount+p.document.totals.tax,b.totalAmount);
    assert.equal(b.totalAmount-b.retentionAmount,b.receivableAmount);
    assert.ok(!JSON.stringify(b).includes('PRIVATE-INVOICE'));
  });
}
test('effective fallback publicNote is unchanged if it is clean',()=>{
  const p=fixture();
  p.document.note='';
  p.template.publicNote='乾淨的對外施工說明。';
  assert.equal(currentView(p).publicNote,mainView(p).publicNote);
  assert.equal(currentView(p).publicNote,p.template.publicNote);
});
test('empty note is allowed, no hidden mutating redaction',()=>{
  const p=fixture();
  p.document.note='';
  p.template.publicNote='';
  const before=JSON.stringify(p);
  assert.equal(currentView(p).publicNote,'');
  assert.equal(JSON.stringify(p),before);
});

const sensitive=[
  ['original August invoice',p=>p.document.note=p.document.sourceSnapshots[0].invoiceNo],
  ['original October invoice',p=>{
     p.document.sourceSnapshots[1].invoiceStatus='invoiced';
     p.document.sourceSnapshots[1].invoiceNo='PRIVATE-INVOICE-OCT';
     p.document.sourceSnapshots[1].invoiceDate='2026-10-20';
     p.document.note='注意：PRIVATE-INVOICE-OCT';
  }],
  ['foreign source project',p=>p.document.note='參照 '+p.document.sourceSnapshots[0].projectName],
  ['foreign project casefold',p=>p.document.note='faKe-l-zone'],
  ['foreign project with spacing/separators',p=>p.document.note='FAKE L ZONE'],
  ['original billing ID',p=>p.document.note=p.document.sourceSnapshots[0].billingId],
  ['original billing display number',p=>p.document.note=p.document.sourceSnapshots[0].number],
  ['original receivable ID',p=>p.document.note=p.document.sourceSnapshots[0].receivableId],
  ['source invoice date',p=>p.document.note=p.document.sourceSnapshots[0].invoiceDate],
  ['invoice ID only in source',p=>{
    p.document.sourceSnapshots[0].invoiceId='FAKE-INVOICE-RECORD-01';
    p.document.note=p.document.sourceSnapshots[0].invoiceId;
  }],
  ['line level private invoice',p=>p.document.note=p.document.sourceSnapshots[0].originalLines[0].invoiceNo]
];
for(const [name,change] of sensitive){
  test('customer only note BLOCK: '+name,()=>{
    const p=fixture();
    change(p);
    const before=JSON.stringify(p);
    assert.doesNotThrow(()=>mainView(p),'Official pre-candidate contains a public note privacy gap');
    noteRisk(p,true);
    assert.equal(JSON.stringify(p),before,'Candidate must never redact or alter original data');
  });
}
test('private token in fallback template note also blocks',()=>{
  const p=fixture();
  p.document.note='';
  p.template.publicNote='FAKE-L-ZONE';
  noteRisk(p,true);
});
test('too-long note blocks with no hidden truncation',()=>{
  const p=fixture();
  p.document.note='正常施工備註'.repeat(400);
  noteRisk(p);
  assert.equal(p.document.note.length,6*400);
});

test('notes with innocent invoice-status words and other wording remain unchanged',()=>{
  const p=fixture();
  p.document.note='工程驗收後再確認開立發票流程；本單工期以實際施工為準。';
  assert.deepEqual(currentView(p),mainView(p));
});
test('history archive path remains exact same source code and is not reclassified',()=>{
  const p=fixture();
  p.historical=true;
  p.document.status='archived';
  p.document.note='FAKE-L-ZONE';
  assert.doesNotThrow(()=>current.validate(p));
  const archiveOutput=slice(candidate,'    // Explicit historical-version viewing',
    "  }catch(error)");
  const baselineArchive=slice(baseline,'    // Explicit historical-version viewing',
    "  }catch(error)");
  assert.equal(archiveOutput,baselineArchive);
  // Historical's separate archive renderer retains its existing invoice
  // reference policy, and this new customer-only note gate is not installed there.
  assert.equal(current.originalTemplateView(p,current.validate(p)).publicNote,'FAKE-L-ZONE');
});

test('normal project/projection privacy still excludes original sources and invoice fields',()=>{
  const p=fixture({twoInvoiced:true});
  const v=currentView(p),str=JSON.stringify(v);
  assert.equal(v.project,'FAKE-M-ZONE');
  assert.ok(!str.includes('FAKE-L-ZONE'));
  assert.ok(!str.includes('PRIVATE-INVOICE'));
  assert.ok(!str.includes('sourceSnapshots'));
  assert.ok(!str.includes('sourceInvoiceReferences'));
  assert.ok(v.lines.every(x=>!('invoiceNo' in x)));
});

// A separate APPROVAL model. It is intentionally not installed in ERP;
// client-submitted reason or fake approval fields are never treated as trusted.
const shape=x=>({
  house:x.house||'',item:x.item,unit:x.unit,qty:x.qty,price:x.price
});
const stamp=content=>crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
function changedArrangement(d){
  const originals=d.sourceSnapshots.flatMap(s=>s.originalLines.map(shape));
  const published=d.unified.lines.map(shape);
  const sameTax=d.sourceSnapshots.every(s=>s.taxMode===d.unified.taxMode);
  return !sameTax||JSON.stringify(originals)!==JSON.stringify(published);
}
function fingerprint(d){
  return stamp({
    sourceIds:d.sourceIds,
    targets:[d.targetBillingId,d.displayProjectName],
    customer:d.customerName,
    original:d.sourceSnapshots.map(s=>({
      billingId:s.billingId,anchors:s.anchors,originalLines:s.originalLines.map(l=>({...shape(l),amount:l.amount})),
      taxMode:s.taxMode,projectName:s.projectName
    })),
    published:d.unified.lines.map(l=>({...shape(l),amount:l.amount})),
    unifiedTaxMode:d.unified.taxMode,
    financial:d.totals,
    revision:d.revision
  });
}
class FakeApprovalAuthority{
  // Private registry represents a hypothetical trusted approval service.
  // The real ERP DOES NOT HAVE THIS AUTHORITY OR AN APPROVED SIGNATURE.
  #entries=new Map();
  acceptFromFakeTrustedReviewer(d,actor,company){
    if(actor!=='FAKE-APPROVED-REVIEWER')throw Error('TEST_ONLY_REVIEWER_REQUIRED');
    if(!Number.isSafeInteger(d.revision)||d.revision<1)throw Error('TEST_ONLY_REVISION');
    this.#entries.set(d.targetBillingId,{company,revision:d.revision,
      fingerprint:fingerprint(d),reviewer:actor});
  }
  check(d,company){
    if(!changedArrangement(d))return true;
    const entry=this.#entries.get(d.targetBillingId);
    if(!entry||entry.company!==company||entry.revision!==d.revision||
       entry.fingerprint!==fingerprint(d))
      throw Error('FAKE_INDEPENDENT_APPROVAL_MISSING_OR_STALE');
    return true;
  }
}

function reorganized(){
  const p=fixture();
  p.document.revision=7;
  p.document.unified.lines[0].item='FAKE-REORGANIZED-CONSTRUCTION';
  p.document.unified.reason='依核對資料重新編排，僅供測試';
  return p;
}
test('ACTUAL formal code accepts changed item text with reason, proving a missing trusted approval boundary',()=>{
  const p=reorganized();
  assert.doesNotThrow(()=>current.validate(p));
  assert.equal(currentView(p).lines[0].item,'FAKE-REORGANIZED-CONSTRUCTION');
  assert.ok(changedArrangement(p.document));
  const authority=new FakeApprovalAuthority();
  assert.throws(()=>authority.check(p.document,'FAKE-CO-01'),/APPROVAL_MISSING/);
});
test('reason or client approval object alone cannot satisfy the mock independent approval contract',()=>{
  const p=reorganized();
  p.document.approval={reviewer:'FAKE-APPROVED-REVIEWER',verified:true};
  assert.doesNotThrow(()=>current.validate(p));
  const authority=new FakeApprovalAuthority();
  assert.throws(()=>authority.check(p.document,'FAKE-CO-01'),/APPROVAL_MISSING/);
});
test('mock explicitly reviewed revision and original+public fingerprint enables only that exact record',()=>{
  const p=reorganized();
  const authority=new FakeApprovalAuthority();
  authority.acceptFromFakeTrustedReviewer(p.document,'FAKE-APPROVED-REVIEWER','FAKE-CO-01');
  assert.equal(authority.check(p.document,'FAKE-CO-01'),true);
  assert.throws(()=>authority.check(p.document,'FAKE-OTHER-CO'),/APPROVAL_MISSING/);
  const edit=clone(p.document);
  edit.unified.lines[0].item='FAKE-ALTERED-AFTER-REVIEW';
  assert.throws(()=>authority.check(edit,'FAKE-CO-01'),/APPROVAL_MISSING/);
});
test('mock revision/source/total/customer drift revokes prior independent approval',()=>{
  const p=reorganized();
  const authority=new FakeApprovalAuthority();
  authority.acceptFromFakeTrustedReviewer(p.document,'FAKE-APPROVED-REVIEWER','FAKE-CO-01');
  for(const mutate of [
    d=>d.revision++,
    d=>d.sourceSnapshots[0].originalLines[0].item='FAKE-SOURCE-TAMPER',
    d=>d.sourceSnapshots[0].anchors.grossTotal++,
    d=>d.targetBillingId='FAKE-OTHER-TARGET',
    d=>d.displayProjectName='FAKE-OTHER-ZONE',
    d=>d.customerName='FAKE-DIFFERENT-CUSTOMER',
    d=>d.unified.lines[1].amount++,
    d=>d.unified.taxMode='含稅'
  ]){
    const edited=clone(p.document);
    mutate(edited);
    assert.throws(()=>authority.check(edited,'FAKE-CO-01'));
  }
});
test('mock fake reviewer role failure, no client-trusted approval',()=>{
  const p=reorganized(),a=new FakeApprovalAuthority();
  assert.throws(()=>a.acceptFromFakeTrustedReviewer(p.document,'FAKE-CLIENT','FAKE-CO-01'));
  assert.throws(()=>a.check(p.document,'FAKE-CO-01'));
});
test('unchanged original rows need no revised-item approval in hypothetical model',()=>{
  const p=fixture(),a=new FakeApprovalAuthority();
  assert.equal(changedArrangement(p.document),false);
  assert.equal(a.check(p.document,'FAKE-CO-01'),true);
});
