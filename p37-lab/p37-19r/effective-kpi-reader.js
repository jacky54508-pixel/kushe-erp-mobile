(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module&&module.exports)module.exports=api;
else root.KusheP3719RLabReader=api;
})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
// P37-19R: SYNTHETIC-ONLY KPI/REPORT READ PREVIEW. Never writes ERP data.
const MODE='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY';
const SYN=/^P37-19-SYN-[A-Z0-9-]{1,90}$/;
const ARR=['billings','receivables','invoices','receipts','retentionReceipts',
 'bankTransactions','billingAllowances','projects','commissions'];
const fail=what=>{throw Error('P37-19R '+what)};
const amount=(n,name)=>{if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)fail(name+'_MONEY_INVALID');return n};
const add=(values,name)=>{let out=0;for(const v of values){out+=amount(v,name);if(!Number.isSafeInteger(out))fail(name+'_OVERFLOW')}return out};
const val=x=>String(x??'').trim();
const id=(x,name)=>{if(!SYN.test(val(x)))fail(name+'_FOREIGN_OR_MISSING_ID');return val(x)};
const month=x=>val(x).slice(0,7);
const previousMonth=at=>{const [y,m]=at.split('-').map(Number);return String(m===1?y-1:y)+'-'+String(m===1?12:m-1).padStart(2,'0')};
const delta=(now,old)=>!old?{text:'—',className:'neutral'}:
 {text:(now>=old?'↑':'↓')+' '+Math.abs((now-old)/Math.abs(old)*100).toFixed(1)+'%',
  className:now>=old?'positive':'negative'};
function project(state,base,ledger,reader,options={}){
 if(options.mode!==MODE||options.labOnly!==true||options.legalTaxVoucherVerified!==false)
  fail('LAB_ONLY_MODE_REQUIRED');
 if(typeof window!=='undefined'&&(
    window.location?.protocol!=='http:'||
    window.location?.hostname!=='127.0.0.1'||
    window.location?.pathname!=='/'||
    window.P37R?.scope!==MODE||window.P37R?.isolatedFixture!==true))
  fail('NON_LOCAL_BROWSER_OR_NOT_APPROVED_FIXTURE');
 if(!state||typeof state!=='object'||Array.isArray(state)||!base||
    base.data!==state||!Array.isArray(base.attentions)||!Array.isArray(base.reportProjects)||
    !Array.isArray(base.projects)||typeof reader?.project!=='function'||
    typeof ledger?.inspect!=='function')fail('ORIGINAL_SNAPSHOT_OR_READERS_MISSING');
 for(const k of ARR)if(!Array.isArray(state[k]))fail('INCOMPLETE_SOURCE_'+k);
 if(state.billings.length<2||state.billings.length>12||
    state.receivables.length!==state.billings.length)fail('SYNTHETIC_CASE_COUNT_INVALID');
 const revision=val(state.meta?.businessSnapshotRevision?.id);
 if(!revision||revision!==options.expectedRevisionId)
  fail('STALE_BUSINESS_SNAPSHOT');
 const selected=val(options.selectedMonth);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)||selected!==base.month)
  fail('SELECTED_MONTH_MISMATCH');
 if(state.settings?.company!=='P37-19R SYNTHETIC ONLY')fail('NON_SYNTHETIC_COMPANY_MARKER');
 for(const key of ['billings','receivables','invoices','billingAllowances','projects','commissions'])
  for(const row of state[key])id(row?.id,key);
 const originalFingerprint=JSON.stringify({billings:state.billings,receivables:state.receivables,
  invoices:state.invoices,billingAllowances:state.billingAllowances,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,
  bankTransactions:state.bankTransactions,commissions:state.commissions,meta:state.meta});
 const bills=new Set(),ars=new Set(),numbers=new Set(),rows=[];
 for(const bill of state.billings){
  const bid=id(bill.id,'BILLING'),number=id(bill.number,'BILL_NUMBER');
  if(bills.has(bid)||numbers.has(number))fail('DUPLICATE_BILLING_SOURCE');
  bills.add(bid);numbers.add(number);
  const matches=state.receivables.filter(ar=>ar.billingId===bid);
  if(matches.length!==1)fail('BILLING_AND_AR_NOT_ONE_TO_ONE');
  const ar=matches[0];
  const aid=id(ar.id,'AR');
  if(ars.has(aid)||bill.receivableId!==aid||
    ar.sourceNo!==number||month(ar.date)!==month(bill.date))fail('AR_SOURCE_OR_DATE_MISMATCH');
  ars.add(aid);
  const ledgerRow=reader.project(state,aid,ledger,{
   mode:'P37_19C_REVIEW_ONLY',expectedRevisionId:revision
  });
  if(ledgerRow.readOnly!==true||ledgerRow.appliedToERP!==false||
    ledgerRow.postingEnabled!==false||ledgerRow.cloudWrites!==0||
    ledgerRow.formalReceiptWriterConnected!==false||
    ledgerRow.bankTransactionsAdded!==0||ledgerRow.actualKpiModified!==false)
    fail('LEDGER_CONTRACT_CHANGED_OR_WRITER_PRESENT');
  const originalAR=amount(ledgerRow.original.receivable,'ORIGINAL_AR');
  const originalRetention=amount(ledgerRow.original.retention,'ORIGINAL_RETENTION');
  const revised=ledgerRow.proposed;
  const approvedAR=amount(revised.receivable,'APPROVED_AR'),
    approvedRetention=amount(revised.retention,'APPROVED_RETENTION'),
    outstanding=amount(revised.principalOutstanding,'APPROVED_OUTSTANDING'),
    retentionRemaining=amount(revised.retentionOutstanding,'APPROVED_RET_OUTSTANDING'),
    principalReceived=amount(revised.principalReceived,'ACTUAL_SETTLEMENT'),
    retentionReceived=amount(revised.retentionReceived,'ACTUAL_RET_SETTLEMENT');
  if(outstanding+principalReceived!==approvedAR||
     retentionRemaining+retentionReceived!==approvedRetention)
    fail('APPROVED_RECEIPTS_AND_RETENTION_NOT_BALANCED');
  const discounted=ledgerRow.status==='ALLOWANCE_RECORD_REVIEW_ONLY';
  if(!discounted&&ledgerRow.status!=='ORIGINAL_UNADJUSTED_READ_ONLY')
    fail('UNKNOWN_CREDIT_STATUS');
  const arDelta=originalAR-approvedAR,retentionDelta=originalRetention-approvedRetention;
  if(arDelta<0||retentionDelta<0)fail('DISCOUNT_INCREASED_BALANCES');
  let untaxedDeduction=0,taxDeduction=0;
  if(discounted){
   const related=state.billingAllowances.filter(r=>
     r.billingId===bid&&r.receivableId===aid);
   if(related.length!==1)fail('VOUCHER_NOT_UNIQUE');
   const row=related[0],originalUntaxed=amount(bill.amount,'BILLED_UNTAXED');
   untaxedDeduction=amount(row.allowance?.untaxed,'ALLOWANCE_UNTAXED');
   taxDeduction=amount(row.allowance?.tax,'ALLOWANCE_TAX');
   if(untaxedDeduction>originalUntaxed||
      row.original?.untaxed!==originalUntaxed||
      row.effective?.untaxed!==originalUntaxed-untaxedDeduction||
      row.original?.tax!==bill.tax||
      row.effective?.tax!==bill.tax-taxDeduction||
      row.allowance?.gross!==arDelta+retentionDelta||
      untaxedDeduction+taxDeduction!==arDelta+retentionDelta)
     fail('UNTAXED_DISCOUNT_OR_VOUCHER_NOT_BALANCED');
  }
  rows.push(Object.freeze({
   billingId:bid,receivableId:aid,projectId:id(bill.project,'PROJECT'),
   month:month(bill.date),originalUntaxed:amount(bill.amount,'ORIG_UNTAXED'),
   reducedUntaxed:untaxedDeduction,approvedUntaxed:bill.amount-untaxedDeduction,
   originalAR,approvedAR,originalRetention,approvedRetention,
   principalReceived,retentionReceived,outstanding,retentionRemaining,
   pendingChequeReserved:amount(revised.pendingChequeReserved,'PENDING_CHEQUE'),
   adjustment:discounted,arDelta,retentionDelta
  }));
 }
 if(ars.size!==state.receivables.length)fail('UNLINKED_RECEIVABLE_RECORD');
 const billOriginal=add(rows.filter(r=>r.month===selected).map(r=>r.originalUntaxed),'ORIGINAL_MONTH');
 if(base.revenue!==billOriginal)fail('ORIGINAL_DASHBOARD_REVENUE_NOT_VERIFIED');
 const baseAR=add(rows.map(r=>r.originalAR-r.principalReceived),'ORIGINAL_AR_TOTAL');
 const baseRetention=add(rows.map(r=>r.originalRetention-r.retentionReceived),'ORIGINAL_RET_TOTAL');
 if(base.outstandingAR!==baseAR)fail('ORIGINAL_DASHBOARD_AR_NOT_VERIFIED');
 const retentionAlert=base.attentions.find(r=>r.type==='保留款待收');
 if(baseRetention>0&&retentionAlert?.amount!==baseRetention)
  fail('ORIGINAL_DASHBOARD_RETENTION_NOT_VERIFIED');
 const arOutstanding=add(rows.map(r=>r.outstanding),'APPROVED_AR_OPEN'),
  retentionOpen=add(rows.map(r=>r.retentionRemaining),'APPROVED_RET_OPEN');
 const discountUntaxed=add(rows.filter(r=>r.month===selected).map(r=>r.reducedUntaxed),'MONTH_DISCOUNT'),
  monthARDiscount=add(rows.filter(r=>r.month===selected).map(r=>r.arDelta),'MONTH_AR_DISCOUNT');
 const revenue=billOriginal-discountUntaxed;
 const prev=previousMonth(selected),previousUntaxed=add(rows.filter(r=>r.month===prev).map(r=>r.approvedUntaxed),'PREV_MONTH_REVENUE');
 const prevOpenAR=add(rows.filter(r=>r.month===prev).map(r=>r.outstanding),'PREV_MONTH_AR_OPEN');
 const projectTotals=new Map();
 for(const r of rows){
  const p=projectTotals.get(r.projectId)||{untaxed:0,ar:0};
  p.untaxed+=r.reducedUntaxed;p.ar+=r.arDelta;
  projectTotals.set(r.projectId,p);
 }
 const projectRows=base.reportProjects.map(row=>{
  const reductions=projectTotals.get(row.id)||{untaxed:0,ar:0};
  const billed=row.billed-reductions.untaxed,outstanding=row.outstanding-reductions.ar;
  if(billed<0||outstanding<0)fail('PROJECT_ADJUSTED_BELOW_ZERO');
  const profit=billed-row.totalCost;
  return {...row,billed,outstanding,profit,
    margin:billed?profit/billed*100:0};
 });
 const projectMap=new Map(projectRows.map(p=>[p.id,p]));
 const projects=base.projects.map(p=>{
  if(!projectMap.has(p.id))fail('TOP_PROJECT_NOT_IN_REPORT');
  return projectMap.get(p.id);
 });
 const countAR=rows.filter(r=>r.outstanding>0).length,
   countRetention=rows.filter(r=>r.retentionRemaining>0).length,
   paidStructure=base.structurePaid,
   structureTotal=base.structureTotal-monthARDiscount,
   structureOpen=base.structureOpen-monthARDiscount;
 if(structureTotal<0||structureOpen<0)fail('MONTHLY_STRUCTURE_ADJUSTMENT_INVALID');
 const allApproved=add(rows.map(r=>r.approvedAR),'APPROVED_TOTAL_AR');
 const allReceived=add(rows.map(r=>r.principalReceived),'TOTAL_RECEIVED');
 const attentions=base.attentions.map(x=>{
  if(x.type==='待收款')return {...x,count:countAR,amount:arOutstanding};
  if(x.type==='保留款待收')return {...x,count:countRetention,amount:retentionOpen};
  return {...x};
 }).filter(x=>x.count||x.amount);
 const vm={
   ...base,revenue,outstandingAR:arOutstanding,
   structureTotal,structureOpen,
   collectionRate:structureTotal?paidStructure/structureTotal*100:0,
   recoveryRate:allApproved?Math.min(100,allReceived/allApproved*100):0,
   projects,reportProjects:projectRows,attentions,
   deltas:{...base.deltas,revenue:delta(revenue,previousUntaxed),
    ar:delta(arOutstanding,prevOpenAR)}
 };
 const commissionPreview=state.commissions.filter(x=>x.billingId).map(c=>{
  const row=rows.find(r=>r.billingId===c.billingId);
  if(!row)fail('COMMISSION_SOURCE_NOT_FOUND');
  return {
   commissionId:id(c.id,'COMMISSION'),billingId:row.billingId,
   approvedBasis:row.approvedAR,principalReceived:row.principalReceived,
   remaining:row.outstanding,pendingChequeReserved:row.pendingChequeReserved,
   hypotheticalFullySettled:row.outstanding===0&&row.pendingChequeReserved===0,
   realStorePayrollUnlocked:false,paymentCreated:false,
   formalCommissionSettlementApproved:false
  };
 });
 const sourceFingerprint=JSON.stringify({billings:state.billings,receivables:state.receivables,
  invoices:state.invoices,billingAllowances:state.billingAllowances,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,
  bankTransactions:state.bankTransactions,commissions:state.commissions,meta:state.meta});
 if(sourceFingerprint!==originalFingerprint)fail('FINANCIAL_DATA_MUTATED');
 return Object.freeze({
  schema:'kushe-p37-19r-synthetic-view-v1',mode:MODE,
  sourceRevision:revision,month:selected,readOnly:true,isolated:true,
  status:'P37_19R_LAB_PREVIEW_ONLY',realERPDataWritten:false,
  bankWrites:0,cloudWrites:0,commissionPayments:0,
  officialTaxVoucherVerified:false,productionReady:false,
  allFormalUIReadersIntegrated:false,kpiDrilldownsIntegrated:false,
  dashboardTrendChartIntegrated:false,canPost:false,
  original:{revenue:base.revenue,outstandingAR:base.outstandingAR,
    retentionOpen:baseRetention},
  adjusted:{revenue,outstandingAR:arOutstanding,retentionOpen},
  deductions:{untaxed:discountUntaxed,
    currentReceivable:baseAR-arOutstanding,retention:baseRetention-retentionOpen},
  dashboard:vm,commissionPreview,
  rows
 });
}
return Object.freeze({project,MODE});
});
