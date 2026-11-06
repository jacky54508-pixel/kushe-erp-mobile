(function(root,factory){
'use strict';
const exported=factory();
if(typeof module==='object'&&module&&module.exports)module.exports=exported;
else root.KusheP3719TReadOnlyCandidate=exported;
})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
// P37-19T: independent, framework-neutral, read-only formal integration
// CANDIDATE. Not loaded by index.html. NOT a posting or official tax module.
const MODE='P37_19T_FORMAL_SHAPED_READ_ONLY_REVIEW';
const SCHEMA='kushe-p37-19t-integration-candidate-v1';
const fail=code=>{throw Error('P37-19T '+code)};
const str=x=>String(x??'').trim();
function id(x,label){
 const v=str(x);
 if(!v||v.length>160||/[\u0000-\u001f\u007f]/.test(v))fail(label+'_INVALID_ID');
 return v;
}
function whole(x,label){
 if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0)fail(label+'_NOT_SAFE_MONEY');
 return x;
}
function sum(array,label){
 let s=0;
 for(const x of array){
  s+=whole(x,label);
  if(!Number.isSafeInteger(s))fail(label+'_MONEY_OVERFLOW');
 }
 return s;
}
function monthOf(x){
 const v=str(x).slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))fail('INVALID_BILLING_MONTH');
 return v;
}
function prevMonth(ym){
 const [year,m]=ym.split('-').map(Number);
 return String(m===1?year-1:year)+'-'+String(m===1?12:m-1).padStart(2,'0');
}
function ratio(n,prev){
 if(prev===0)return {text:'—',className:'neutral'};
 const r=(n-prev)/Math.abs(prev)*100;
 return {text:(r>=0?'↑':'↓')+' '+Math.abs(r).toFixed(1)+'%',
  className:r>=0?'positive':'negative'};
}
const copies=x=>JSON.parse(JSON.stringify(x));
function authorize(auth){
 if(!auth||typeof auth.user!=='function'||typeof auth.companyContext!=='function'||
    typeof auth.canWrite!=='function')fail('REAL_AUTH_CONTEXT_REQUIRED');
 const user=auth.user(),company=auth.companyContext();
 const uid=id(user?.id,'AUTH_USER'),cid=id(company?.companyId,'AUTH_COMPANY');
 if(id(company?.userId,'COMPANY_USER')!==uid||
    id(company?.legacySourceUserId,'COMPANY_LEGACY_USER')!==uid||
    auth.canWrite('billings')!==true)
    fail('OWNER_COMPANY_SCOPE_OR_BILLING_PERMISSION_REJECTED');
 return {userId:uid,companyId:cid};
}
const sourceFields=['billings','receivables','invoices','receipts','retentionReceipts',
 'bankTransactions','billingAllowances','projects','commissions'];
function signature(state){
 return JSON.stringify({meta:state.meta,billings:state.billings,
  receivables:state.receivables,invoices:state.invoices,receipts:state.receipts,
  retentionReceipts:state.retentionReceipts,
  bankTransactions:state.bankTransactions,billingAllowances:state.billingAllowances,
  projects:state.projects,commissions:state.commissions});
}
function details(rows,kind,month){
 if(!['revenue','ar','retention'].includes(kind))fail('INVALID_DETAIL_KIND');
 const subset=kind==='revenue'?rows.filter(r=>r.month===month):rows;
 const labels=kind==='revenue'?
  ['日期','請款單','原未稅','折讓未稅','核定未稅']:
  kind==='ar'?['日期','請款單','核定應收','已沖銷','未收應收']:
  ['日期','請款單','核定保留款','已收保留款','待收保留款'];
 const fmt=x=>'$'+whole(x,'DETAIL').toLocaleString('zh-TW');
 const data=subset.map(r=>{
  const n=kind==='revenue'?[r.originalUntaxed,r.discountUntaxed,r.effectiveUntaxed]:
   kind==='ar'?[r.effectiveAR,r.received,r.openAR]:
   [r.effectiveRetention,r.retentionReceived,r.openRetention];
  return {id:r.billId,cells:[r.date,r.billNo,...n.map(fmt)]};
 });
 const total=sum(subset.map(r=>kind==='revenue'?r.effectiveUntaxed:
  kind==='ar'?r.openAR:r.openRetention),'DETAIL_TOTAL');
 return {title:'P37-19T 核定金額唯讀試算 '+kind,
  scope:'尚未獨立驗證正式折讓憑證。此內容僅供審查，不代表可入帳或申報。',
  columns:labels,rows:data,total,
  drawer:{summaryIndex:4,summaryLabel:labels[4]},
  verifiedForFormalPosting:false,readOnly:true};
}
function trends(rows,month,range){
 if(![12,4,3].includes(range))fail('INVALID_CHART_RANGE');
 const [y,m]=month.split('-').map(Number);
 const monthKey=(offset)=>{
  const d=new Date(Date.UTC(y,m-1+offset,1));
  return String(d.getUTCFullYear())+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
 };
 let intervals;
 if(range===12)intervals=Array.from({length:12},(_,i)=>({
  key:monthKey(i-11),kind:'month',label:String(Number(monthKey(i-11).slice(5)))+'月'
 }));
 else if(range===4){
  const q=Math.floor((m-1)/3);
  intervals=Array.from({length:4},(_,i)=>{
   const n=q+i-3,year=y+Math.floor(n/4),quarter=((n%4)+4)%4;
   return {key:String(year)+' Q'+String(quarter+1),
    kind:'quarter',year,quarter,label:'Q'+String(quarter+1)};
  });
 }else intervals=[2,1,0].map(back=>({key:String(y-back),year:y-back,kind:'year',label:String(y-back)}));
 return intervals.map(v=>{
  const filtered=rows.filter(r=>{
   if(v.kind==='month')return r.month===v.key;
   const year=Number(r.month.slice(0,4)),mm=Number(r.month.slice(5));
   return v.kind==='year'?year===v.year:
    year===v.year&&Math.floor((mm-1)/3)===v.quarter;
  });
  return {key:v.key,label:v.label,value:sum(filtered.map(r=>r.effectiveUntaxed),'CHART_UNTAXED')};
 });
}
function project(options){
 if(!options||options.mode!==MODE||
    options.officialVoucherIndependentlyVerified!==false||
    options.allowFinancialWrites!==false||
    options.expectedRevisionId===undefined)
    fail('EXPLICIT_READ_ONLY_REVIEW_MODE_REQUIRED');
 const authResult=authorize(options.auth);
 const state=options.state,base=options.originalDashboard;
 if(!state||typeof state!=='object'||Array.isArray(state)||
   !base||typeof base!=='object')fail('SOURCE_SNAPSHOT_MISSING');
 for(const field of sourceFields)if(!Array.isArray(state[field]))fail('MISSING_FINANCIAL_ARRAY_'+field);
 const rev=id(state.meta?.businessSnapshotRevision?.id,'SOURCE_REVISION');
 if(rev!==id(options.expectedRevisionId,'EXPECTED_REVISION'))fail('STALE_ERP_STORE_REVISION');
 const month=monthOf(options.month);
 if(base.month!==month||!base.data||signature(base.data)!==signature(state)||
   !Array.isArray(base.reportProjects)||!Array.isArray(base.attentions)||
   !Array.isArray(base.projects))
  fail('DASHBOARD_AND_ERP_STORE_SNAPSHOT_DIVERGED');
 if(typeof options.effectiveLedger?.inspect!=='function'||
    typeof options.formalReadOnlyLedger?.project!=='function')fail('P37_18_AND_19C_VERIFIED_READERS_REQUIRED');
 const before=signature(state),rowIDs=new Set(),arIDs=new Set(),billNos=new Set();
 const rows=[],projectAllowance=new Map();
 for(const bill of state.billings){
  const billId=id(bill?.id,'BILL_ID'),billNo=id(bill?.number,'BILL_NO');
  if(rowIDs.has(billId)||billNos.has(billNo))fail('DUPLICATE_BILL_ID_OR_NUMBER');
  rowIDs.add(billId);billNos.add(billNo);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(str(bill.date)))fail('MISSING_BILL_DATE');
  const related=state.receivables.filter(ar=>str(ar.billingId)===billId);
  if(related.length!==1)fail('BILLING_AR_RELATION_NOT_UNIQUE_OR_MISSING');
  const ar=related[0],arId=id(ar.id,'AR_ID'),arSource=id(ar.sourceNo,'AR_SOURCE_NO');
  if(arIDs.has(arId)||arSource!==billNo||str(bill.receivableId)!==arId)
    fail('DUPLICATE_OR_UNMATCHED_AR_SOURCE');
  arIDs.add(arId);
  const checked=options.formalReadOnlyLedger.project(state,arId,options.effectiveLedger,{
   mode:'P37_19C_REVIEW_ONLY',expectedRevisionId:rev
  });
  if(!checked||checked.readOnly!==true||checked.appliedToERP!==false||
     checked.postingEnabled!==false||checked.cloudWrites!==0||
     checked.bankTransactionsAdded!==0||
     checked.formalReceiptWriterConnected!==false||
     checked.officialVoucherIndependentlyVerifiedBySystem!==false)
   fail('P37_19C_REVIEW_NO_POST_STATUS_CHANGED');
  if(checked.source?.billingId!==billId||checked.source?.receivableId!==arId)
   fail('P37_19C_RECEIVABLE_SOURCE_MISMATCH');
  const p=checked.proposed,original=checked.original;
  const originalAR=whole(original.receivable,'ORIGINAL_AR'),
   originalRetention=whole(original.retention,'ORIGINAL_RET'),
   effAR=whole(p.receivable,'EFFECTIVE_AR'),
   effRetention=whole(p.retention,'EFFECTIVE_RET'),
   received=whole(p.principalReceived,'COLLECTED_PRINCIPAL'),
   retReceived=whole(p.retentionReceived,'COLLECTED_RETENTION'),
   openAR=whole(p.principalOutstanding,'OPEN_AR'),
   openRetention=whole(p.retentionOutstanding,'OPEN_RETENTION');
  if(effAR>originalAR||effRetention>originalRetention||
    openAR+received!==effAR||openRetention+retReceived!==effRetention)
   fail('APPROVED_BALANCE_EXCEEDS_OR_BREAKS_SOURCE');
  const discounted=checked.status==='ALLOWANCE_RECORD_REVIEW_ONLY';
  if(!discounted&&checked.status!=='ORIGINAL_UNADJUSTED_READ_ONLY')
   fail('UNKNOWN_FORMAL_READ_ONLY_STATE');
  const untaxed=whole(bill.amount,'BILL_UNTAXED'),
   billedTax=whole(bill.tax,'BILL_TAX');
  let untaxedDiscount=0,taxDiscount=0;
  if(discounted){
   const allowances=state.billingAllowances.filter(v=>
    str(v.billingId)===billId||str(v.receivableId)===arId);
   if(allowances.length!==1)fail('DUPLICATE_OR_MISSING_DISCOUNT_SOURCE');
   const adj=allowances[0];
   untaxedDiscount=whole(adj.allowance?.untaxed,'DISCOUNT_UNTAXED');
   taxDiscount=whole(adj.allowance?.tax,'DISCOUNT_TAX');
   if(adj.original?.untaxed!==untaxed||adj.original?.tax!==billedTax||
      adj.effective?.untaxed!==untaxed-untaxedDiscount||
      adj.effective?.tax!==billedTax-taxDiscount||
      untaxedDiscount+taxDiscount!==originalAR-effAR+originalRetention-effRetention)
    fail('DISCOUNT_INVOICE_UNTAXED_TAX_NOT_RECONCILED');
  }
  if(untaxedDiscount>untaxed||taxDiscount>billedTax)fail('DISCOUNT_EXCEEDS_ORIGINAL_INVOICE');
  const project=id(bill.project,'PROJECT_ID');
  const historic=projectAllowance.get(project)||{untaxed:0,ar:0};
  historic.untaxed+=untaxedDiscount;historic.ar+=originalAR-effAR;
  projectAllowance.set(project,historic);
  rows.push(Object.freeze({
   billId,billNo,arId,projectId:project,date:str(bill.date),
   month:monthOf(bill.date),
   originalUntaxed:untaxed,discountUntaxed:untaxedDiscount,
   effectiveUntaxed:untaxed-untaxedDiscount,
   originalAR,effectiveAR:effAR,received,openAR,
   originalRetention,effectiveRetention:effRetention,
   retentionReceived:retReceived,openRetention,
   pendingCheques:whole(p.pendingChequeReserved,'PENDING_CHEQUES'),
   sourceIsVoucherReviewOnly:discounted
  }));
 }
 if(state.receivables.length!==arIDs.size)fail('UNMATCHED_RECEIVABLES');
 // Only linked and independently reviewed allowance records may enter a preview.
 const handled=rows.filter(r=>r.sourceIsVoucherReviewOnly).length;
 if(handled!==state.billingAllowances.length)
  fail('ALLOWANCE_WITHOUT_UNIQUE_REVIEWED_SOURCE');
 const originalRevenue=sum(rows.filter(r=>r.month===month).map(r=>r.originalUntaxed),'BASE_REVENUE');
 const originalOpenAR=sum(rows.map(r=>r.originalAR-r.received),'BASE_AR_OPEN');
 const originalRetentionOpen=sum(rows.map(r=>r.originalRetention-r.retentionReceived),'BASE_RETENTION_OPEN');
 const alert=base.attentions.find(x=>x.type==='保留款待收');
 if(base.revenue!==originalRevenue||base.outstandingAR!==originalOpenAR||
    (alert?.amount||0)!==originalRetentionOpen)
  fail('ORIGINAL_DASHBOARD_MONEY_CONFLICT');
 const revenue=sum(rows.filter(r=>r.month===month).map(r=>r.effectiveUntaxed),'APPROVED_REVENUE');
 const outstandingAR=sum(rows.map(r=>r.openAR),'APPROVED_OPEN_AR');
 const retentionOpen=sum(rows.map(r=>r.openRetention),'APPROVED_OPEN_RETENTION');
 const discountedUntaxed=originalRevenue-revenue,
  reducedAR=originalOpenAR-outstandingAR,
  reducedRetention=originalRetentionOpen-retentionOpen;
 const projectRows=base.reportProjects.map(r=>{
  const adjustment=projectAllowance.get(r.id)||{untaxed:0,ar:0};
  const billed=whole(r.billed-adjustment.untaxed,'PROJECT_BILLED'),
   open=whole(r.outstanding-adjustment.ar,'PROJECT_OPEN');
  const profit=billed-r.totalCost;
  return {...r,billed,outstanding:open,profit,
   margin:billed?profit/billed*100:0};
 });
 const projects=base.projects.map(r=>{
  const found=projectRows.find(p=>p.id===r.id);
  if(!found)fail('TOP_PROJECT_NOT_IN_REPORT');
  return {...found};
 });
 const adjustmentsPrevious=sum(rows.filter(r=>r.month===prevMonth(month)).map(r=>r.effectiveUntaxed),
  'PREV_MONTH_EFFECTIVE_REVENUE');
 const previousAR=sum(rows.filter(r=>r.month===prevMonth(month)).map(r=>r.openAR),
  'PREV_MONTH_OPEN_AR');
 const monthARReduction=sum(rows.filter(r=>r.month===month).map(r=>r.originalAR-r.effectiveAR),
  'CURRENT_MONTH_AR_REDUCTION');
 const structureTotal=whole(base.structureTotal-monthARReduction,'MONTH_STRUCTURE_TOTAL');
 const structureOpen=whole(base.structureOpen-monthARReduction,'MONTH_STRUCTURE_OPEN');
 const allApproved=sum(rows.map(r=>r.effectiveAR),'ALL_APPROVED_AR'),
  allReceived=sum(rows.map(r=>r.received),'ALL_COLLECTED');
 const attentions=base.attentions.map(x=>{
  if(x.type==='待收款')return {...x,count:rows.filter(r=>r.openAR>0).length,amount:outstandingAR};
  if(x.type==='保留款待收')return {...x,count:rows.filter(r=>r.openRetention>0).length,amount:retentionOpen};
  return {...x};
 }).filter(x=>x.count||x.amount);
 const view={
  ...base,revenue,outstandingAR,structureTotal,structureOpen,
  collectionRate:structureTotal?base.structurePaid/structureTotal*100:0,
  recoveryRate:allApproved?Math.min(100,allReceived/allApproved*100):0,
  projects,reportProjects:projectRows,attentions,
  deltas:{...base.deltas,revenue:ratio(revenue,adjustmentsPrevious),
   ar:ratio(outstandingAR,previousAR)}
 };
 const commissions=state.commissions.filter(c=>c.billingId).map(c=>{
  const idValue=id(c.id,'COMMISSION_ID');
  const row=rows.find(r=>r.billId===str(c.billingId));
  if(!row)fail('COMMISSION_BILLING_OUTSIDE_REVIEWED_SCOPE');
  return {id:idValue,billingId:row.billId,
   hypotheticalFullySettled:row.openAR===0&&row.pendingCheques===0,
   effectiveAR:row.effectiveAR,received:row.received,
   formalPayrollReleased:false,financialWriterConnected:false};
 });
 if(signature(state)!==before)fail('SOURCE_MUTATED_DURING_READ');
 const output={
  schema:SCHEMA,mode:MODE,sourceRevision:rev,month,
  original:{revenue:originalRevenue,outstandingAR:originalOpenAR,
   retentionOpen:originalRetentionOpen},
  adjusted:{revenue,outstandingAR,retentionOpen},
  reductions:{untaxed:discountedUntaxed,receivable:reducedAR,
   retention:reducedRetention},
  dashboard:view,rows:rows.map(x=>({...x})),
  details:(kind,target=month)=>details(rows,kind,monthOf(target)),
  chart:(range,target=month)=>trends(rows,monthOf(target),range),
  commissionReview:commissions,
  authorization:{principalMatched:true,companyScopeMatched:true,
   permissionChecked:true, // not a verified signed Auth HTTP client proof
   serverSignatureVerified:false},
  status:'UNVERIFIED_VOUCHER_READ_ONLY_CANDIDATE',
  readOnly:true,postedToERP:false,officialVoucherVerified:false,
  formalReceiptWriterConnected:false,formalBankWriterConnected:false,
  formalCommissionPaid:false,realCloudSyncVerified:false,
  originalBankAndPayrollUnchanged:true,
  mayMountProduction:false,releaseGate:'NO_GO',
  canPost:false,cloudWrites:0,bankEntriesAdded:0
 };
 return Object.freeze(output);
}
return Object.freeze({project,MODE,SCHEMA});
});
