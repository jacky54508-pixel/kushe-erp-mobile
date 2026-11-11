'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('./core.js'),lab=require('./virtual-cloud-lab.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 return {
  __p39Synthetic:core.FIXTURE,meta:{revision:1,p39SyntheticSchema:core.FIXTURE},
  billings:[{id:'SYN-B',number:'SYN-BILL-001',receivableId:'SYN-AR',
    invoiceStatus:'invoice_pending',invoiceNo:'',customer:'SYN-CUST',
    project:'SYN-PROJECT',preTaxAmount:100000,taxAmount:5000,grossTotal:105000,
    total:100000,retentionAmount:5000,retentionRate:5,retentionBase:'preTax'}],
  receivables:[{id:'SYN-AR',billingId:'SYN-B',sourceNo:'SYN-BILL-001',
    amount:100000,retentionAmount:5000,received:0,retentionReceived:0,
    untaxedAmount:100000,taxAmount:5000,grossTotal:105000,invoiceNo:''}],
  invoices:[{id:'SYN-I',billingId:'SYN-B',sourceId:'SYN-B',sourceType:'billing',
    status:'pending',netAmount:100000,taxAmount:5000,grossAmount:105000,number:''}],
  receipts:[],retentionReceipts:[],bankTransactions:[],billingAllowances:[],
  billingNoteRevisions:[],commissions:[],commissionSettlements:[],payroll:[],
  salaryPayments:[],customerDeductions:[],externalBillingDocuments:[]
 };
}
const evidence={synthetic:true,agreementRef:'SYN-AGREEMENT-001',
  reviewerRef:'SYN-OWNER-001',reviewedAt:'2026-11-11'};
const command=(gross=94500)=>({billingId:'SYN-B',expectedRevision:1,
  idempotencyKey:'p39::SYN-B::unissued',
  intent:{role:'owner',approvedGross:gross,reason:'合成案場議價'},evidence:clone(evidence)});
const rejects=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('模擬兩台裝置：其中一台過帳後，另一台舊版本直接封鎖',async()=>{
 const seed=fixture(),before=clone(seed),server=lab.create(seed);
 const a=server.connect('SYN-DEVICE-A'),b=server.connect('SYN-DEVICE-B');
 const startA=await a.read(),startB=await b.read();
 assert.equal(startA.revision,startB.revision);
 assert.deepEqual(startA.state,startB.state);
 const first=await a.commit(command());
 assert.equal(first.status,'COMMITTED_IN_MEMORY_ONLY');
 const stale={...command(95550),idempotencyKey:'p39::SYN-B::alternate'};
 await rejects(()=>b.commit(stale),'P39_MOCK_STALE_REMOTE');
 assert.equal(server.status().ledgerRows,1);
 assert.equal(server.status().transactions,1);
 assert.deepEqual(seed,before);
 assert.equal((await b.read()).state.receivables[0].amount,100000);
});
test('兩台裝置同筆同識別碼同時送出：只成立一筆分錄',async()=>{
 const server=lab.create(fixture()),a=server.connect('SYN-DEVICE-A'),
   b=server.connect('SYN-DEVICE-B');
 const [first,second]=await Promise.all([a.commit(command()),b.commit(command())]);
 assert.deepEqual([first.status,second.status].sort(),
   ['COMMITTED_IN_MEMORY_ONLY','REPLAYED_IDEMPOTENT']);
 assert.equal(first.ledgerId,second.ledgerId);
 assert.equal(server.status().ledgerRows,1);
 assert.equal(server.status().transactions,1);
});
test('模擬提交後斷線：重試只取回同一筆結果，不重複請款',async()=>{
 const server=lab.create(fixture()),a=server.connect('SYN-DEVICE-A');
 await rejects(()=>a.commit({...command(),failAfterCommit:true}),'P39_MOCK_ACK_LOST');
 assert.equal(server.status().transactions,1);
 const again=await a.commit(command());
 assert.equal(again.status,'REPLAYED_IDEMPOTENT');
 assert.equal(again.revision,2);
 assert.equal(server.status().ledgerRows,1);
});
test('提交前斷線：交易失敗不會修改任何資料',async()=>{
 const server=lab.create(fixture()),a=server.connect('SYN-DEVICE-A');
 const before=await a.read();
 await rejects(()=>a.commit({...command(),failBeforeCommit:true}),'P39_MOCK_INJECT_BEFORE');
 assert.deepEqual(await a.read(),before);
 assert.equal(server.status().transactions,0);
});
test('同識別碼不同金額絕不可冒用重送',async()=>{
 const server=lab.create(fixture()),a=server.connect('SYN-DEVICE-A');
 await a.commit(command());
 await rejects(()=>a.commit(command(95550)),'P39_MOCK_IDEMPOTENCY_CONFLICT');
 assert.equal(server.status().transactions,1);
});
test('已開票、已收款、薪資抽成均無法通過虛構同步網關',async()=>{
 const variants=[
  s=>{s.billings[0].invoiceStatus='invoiced';s.billings[0].invoiceNo='SYN-INV-001';
    s.invoices[0].status='issued';s.invoices[0].number='SYN-INV-001';s.receivables[0].invoiceNo='SYN-INV-001'},
  s=>{s.receivables[0].received=100},
  s=>{s.commissions.push({id:'SYN-C',project:'SYN-PROJECT'})}
 ];
 for(const mutate of variants){
  const state=fixture();mutate(state);
  const server=lab.create(state),a=server.connect('SYN-DEVICE-A');
  await rejects(()=>a.commit(command()),'P39_MOCK_SCENARIO_BLOCKED');
  assert.equal(server.status().transactions,0);
 }
});
test('虛構證據不完整：不能產生交易',async()=>{
 const server=lab.create(fixture()),a=server.connect('SYN-DEVICE-A');
 const input=command();delete input.evidence.agreementRef;
 await rejects(()=>a.commit(input),'P39_EVIDENCE_REF_INVALID');
 assert.equal(server.status().transactions,0);
});
test('真實快照沒有合成標記：模擬器也不接受',()=>{
 const state=fixture();delete state.__p39Synthetic;
 assert.throws(()=>lab.create(state),e=>e.code==='P39_MOCK_SYNTHETIC_ONLY');
});
test('模擬結果原請款、發票、應收、銀行、薪資完全不變',async()=>{
 const original=fixture(),before=clone(original),server=lab.create(original);
 const a=server.connect('SYN-DEVICE-A');
 await a.commit(command());
 const now=(await a.read()).state;
 for(const key of ['billings','receivables','invoices','receipts','retentionReceipts',
   'bankTransactions','commissions','payroll','salaryPayments'])
   assert.deepEqual(now[key],before[key],key+' changed');
 assert.equal(server.status().productionWrites,0);
 assert.equal(server.status().remoteProvider,'MEMORY_ONLY');
});
