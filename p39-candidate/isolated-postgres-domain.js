/* P39-3E disposable GitHub Actions PostgreSQL lab contract.
   stdin/stdout JSON only; imports the actual P39 synthetic domain modules.
   Absolutely no HTTP, production database URL, credentials or Supabase writes. */
'use strict';
const fs=require('node:fs');
const core=require('./core.js'),scenarios=require('./scenario-gate.js');
const voucherReview=require('./voucher-review.js');
const effective=require('./effective-accounting.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const fixtureMarker=core.FIXTURE;
function deny(code,message){const error=new Error(message);error.code=code;throw error}
function seed(variant='invoice_pending'){
  const status=['invoice_pending','no_invoice','invoiced','collected','commission','cheque'].includes(variant)?
    (['collected','commission','cheque'].includes(variant)?'invoice_pending':variant):'invoice_pending';
  const invoiced=status==='invoiced',noInvoice=status==='no_invoice';
  const tax=noInvoice?0:5000,gross=100000+tax,invoiceNo=invoiced?'SYN-INV-0001':'';
  const state={
    __p39Synthetic:fixtureMarker,
    meta:{revision:1,p39SyntheticSchema:fixtureMarker,updatedAt:'SYNTHETIC-ONLY'},
    customers:[{id:'SYN-CUST-001'}],projects:[{id:'SYN-PROJECT-001'}],
    banks:[{id:'SYN-BANK-001'}],employees:[],
    billings:[{id:'SYN-B',receivableId:'SYN-AR',number:'SYN-BILL-001',
      customer:'SYN-CUST-001',project:'SYN-PROJECT-001',
      invoiceStatus:status,invoiceNo,retentionRate:5,retentionBase:'preTax',
      preTaxAmount:100000,taxAmount:tax,grossTotal:gross,
      retentionAmount:5000,total:gross-5000,note:'SYNTHETIC'}],
    receivables:[{id:'SYN-AR',billingId:'SYN-B',sourceNo:'SYN-BILL-001',
      invoiceNo,amount:gross-5000,retentionAmount:5000,
      grossTotal:gross,untaxedAmount:100000,taxAmount:tax,received:0,
      retentionReceived:0,receivableCheques:[]}],
    invoices:noInvoice?[]:[{id:'SYN-INVOICE-001',billingId:'SYN-B',sourceType:'billing',
      sourceId:'SYN-B',number:invoiceNo,status:invoiced?'issued':'pending',
      netAmount:100000,taxAmount:tax,grossAmount:gross}],
    receipts:[],retentionReceipts:[],bankTransactions:[],commissionSettlements:[],
    customerDeductions:[],externalBillingDocuments:[],commissions:[],payroll:[],
    salaryPayments:[],billingAllowances:[],billingNoteRevisions:[]
  };
  if(variant==='collected')state.receivables[0].received=100;
  if(variant==='commission')state.commissions=[{id:'SYN-COM-001',project:'SYN-PROJECT-001'}];
  if(variant==='cheque')state.receivables[0].receivableCheques=[{id:'SYN-CHQ-001'}];
  return state;
}
function apply(payload){
  const state=payload?.state,command=payload?.command;
  if(state?.__p39Synthetic!==fixtureMarker||
     state?.meta?.p39SyntheticSchema!==fixtureMarker||
     !command||String(command.billingId)!=='SYN-B')
    deny('P39_PG_SYNTHETIC_ONLY','僅允許虛構單 SYN-B');
  for(const key of ['billings','receivables','invoices','customers','projects','banks']){
    if(!Array.isArray(state[key])||state[key].some(x=>!/^SYN-/.test(String(x?.id||''))))
      deny('P39_PG_SYNTHETIC_ONLY','快照含非虛構主檔');
  }
  const scenario=scenarios.inspect(state,command.billingId);
  if(!scenario.candidateEligible)
    deny('P39_PG_SCENARIO_BLOCKED',scenario.blockers.map(x=>x.code).join(','));
  const intent=command.intent||{};
  const plan=core.allowancePlan(state,{
    billingId:command.billingId,role:intent.role,
    approvedGross:intent.approvedGross,reason:intent.reason,
    voucher:intent.voucher||undefined
  });
  if(String(command.idempotencyKey)!==plan.idempotencyKey)
    deny('P39_PG_IDEMPOTENCY_MISMATCH','操作識別碼不符');
  const reviewed=voucherReview.inspect(plan,command.evidence);
  const mutation=core.apply(state,plan);
  if(mutation.status!=='SYNTHETIC_ONLY'||mutation.productionWrites!==0)
    deny('P39_PG_NO_REAL_POSTING','不允許正式過帳');
  const next=mutation.state,entry=next.billingAllowances.at(-1);
  entry.evidenceReview=clone(reviewed);
  entry.officialVoucherVerified=false;
  entry.productionAuthorized=false;
  const projection=effective.inspect(next,command.billingId);
  if(!projection.hasAllowance||projection.receivable!==plan.effective.receivable||
     projection.retention!==plan.effective.retention||entry.cloudWrites!==0)
    deny('P39_PG_PROJECTION_MISMATCH','有效應收／保留款勾稽失敗');
  for(const key of ['billings','receivables','invoices','receipts','retentionReceipts',
    'bankTransactions','banks','commissions','payroll','salaryPayments']){
    if(JSON.stringify(state[key])!==JSON.stringify(next[key]))
      deny('P39_PG_PROTECTED_COLLECTION_CHANGED','非折讓資料遭修改：'+key);
  }
  return {next,ledgerId:entry.id,discountGross:entry.discount.gross,
    effectiveReceivable:projection.receivable,effectiveRetention:projection.retention,
    simulatedOnly:true,productionWrites:0};
}
function main(){
  const mode=process.argv[2],raw=fs.readFileSync(0,'utf8');
  const input=raw.trim()?JSON.parse(raw):{};
  const result=mode==='seed'?seed(input.variant):
    mode==='apply'?apply(input):deny('P39_PG_COMMAND_UNKNOWN','未知測試指令');
  process.stdout.write(JSON.stringify({ok:true,result}));
}
try{main()}catch(e){
  process.stdout.write(JSON.stringify({ok:false,code:e.code||'P39_PG_UNKNOWN',
    message:String(e.message||e).slice(0,400)}));
}
