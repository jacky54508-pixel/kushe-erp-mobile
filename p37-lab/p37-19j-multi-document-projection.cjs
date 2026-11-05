'use strict';
// P37-19J synthetic multi-document finance projection.
// This file NEVER connects to the live ERP, reads storage, or posts money.
const reader=require('../assets/js/p37-billing-formal-readonly-projection.js');
const SCHEMA='kushe-p37-19j-multi-doc-readonly-v1';
const FIXTURE='kushe-p37-19j-synthetic-bundle-v1';
const SCOPE='P37_LAB_SYNTHETIC_ONLY';
const ID=/^P37-19-SYN-[A-Z0-9-]{1,80}$/;
const keys=['untaxed','tax','gross','receivable','retention'];
const clean=v=>String(v??'').trim();
function error(message){throw new Error('P37-19J '+message)}
function money(v,label){
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)error(label+' 非有效整數');
 return v;
}
function add(nums,label){
 let n=0;for(const v of nums){n+=money(v,label);if(!Number.isSafeInteger(n))error(label+' 金額溢位')}
 return n;
}
function fixedId(v,label){if(!ID.test(clean(v)))error(label+' 不可使用正式ERP識別碼');return clean(v)}
function rowAmount(row,fields,label){
 const vals=fields.filter(k=>row?.[k]!==null&&row?.[k]!==undefined&&row?.[k]!=='').map(k=>money(row[k],label));
 if(!vals.length)error(label+' 無來源金額');
 if(vals.some(v=>v!==vals[0]))error(label+' 欄位不一致');
 return vals[0];
}
function inspect(state,options={}){
 if(state?.schema!==FIXTURE||state.scope!==SCOPE||
    state.productionData!==false||state.postingEnabled!==false||state.cloudWrites!==0)
   error('只能使用完全隔離的合成帳務資料');
 if(!options||options.mode!=='SYNTHETIC_READ_ONLY_BUNDLE'||
    options.expectedRevisionId!==state.meta?.businessSnapshotRevision?.id||
    typeof options.inspector?.inspect!=='function')error('來源快照或唯讀檢查工具未驗證');
 for(const key of ['billings','receivables','invoices','receipts',
     'retentionReceipts','bankTransactions','billingAllowances']){
   if(!Array.isArray(state[key]))error('缺少帳務資料集 '+key);
 }
 if(!state.billings.length||state.billings.length>20||
    state.billings.length!==state.receivables.length)error('請款與應收數量不符合單一來源');
 const starting=JSON.stringify(state),byBill=new Set(),byAR=new Set(),byNo=new Set(),byInvoice=new Set();
 const expected=state.meta.businessSnapshotRevision.id;
 fixedId(expected,'快照版本');
 for(const invoice of state.invoices){
   fixedId(invoice.id,'發票');
   fixedId(invoice.billingId,'發票對應請款');
   if(byInvoice.has(invoice.id))error('發票編號重複');
   byInvoice.add(invoice.id);
 }
 const rows=[];
 for(const bill of state.billings){
   const billId=fixedId(bill.id,'請款'),billNo=fixedId(bill.number,'請款單號');
   if(byBill.has(billId)||byNo.has(billNo))error('請款來源重複');
   byBill.add(billId);byNo.add(billNo);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(bill.date)))error('請款日期缺失或錯誤');
   const ars=state.receivables.filter(ar=>clean(ar.billingId)===billId);
   if(ars.length!==1)error('請款與應收非唯一對應');
   const ar=ars[0],arId=fixedId(ar.id,'應收');
   if(byAR.has(arId)||clean(bill.receivableId)!==arId)error('應收來源重複或不一致');
   byAR.add(arId);
   const untaxed=rowAmount(bill,['amount','preTaxAmount'],'原請款未稅');
   const tax=rowAmount(bill,['tax','taxAmount'],'原請款稅額');
   const gross=rowAmount(bill,['grossTotal','taxIncludedAmount'],'原請款含稅');
   const receivable=rowAmount(bill,['total'],'原請款應收');
   const retention=rowAmount(bill,['retention','retentionAmount'],'原請款保留款');
   if(untaxed+tax!==gross||receivable+retention!==gross||
      rowAmount(ar,['amount'],'原應收')!==receivable)error('原始請款與應收金額不平衡');
   const projection=reader.project(state,arId,options.inspector,{
     mode:reader.MODE,expectedRevisionId:expected});
   const ledger=options.inspector.inspect(state,arId);
   if(projection.readOnly!==true||projection.appliedToERP!==false||
      projection.postingEnabled!==false||projection.cloudWrites!==0||
      projection.formalReceiptWriterConnected!==false||
      projection.bankTransactionsAdded!==0)error('既有唯讀財務模組意外允許寫入');
   if(projection.source.billingId!==billId||projection.source.receivableId!==arId||
      projection.original.receivable!==receivable||
      projection.original.retention!==retention||
      projection.original.gross!==gross)error('原始來源與提案核對不一致');
   const adjusted=projection.status==='ALLOWANCE_RECORD_REVIEW_ONLY';
   if(!adjusted&&projection.status!=='ORIGINAL_UNADJUSTED_READ_ONLY')
     error('不允許未識別的折讓狀態');
   if(adjusted&&ledger.status!=='POSTED_RECORD_CONTRACT_REVIEW_ONLY'||!adjusted&&ledger.status!=='ORIGINAL_UNADJUSTED')
     error('正式形狀帳本與合成核對狀態不同');
   const proposed=projection.proposed,paid=proposed.principalReceived,paidRetention=proposed.retentionReceived;
   const newUntaxed=adjusted?money(ledger.proposed.untaxed,'核定未稅'):untaxed;
   const newTax=adjusted?money(ledger.proposed.tax,'核定稅額'):tax;
   if(newUntaxed+newTax!==proposed.gross||
      proposed.receivable+proposed.retention!==proposed.gross||
      proposed.receivable!==proposed.principalOutstanding+paid||
      proposed.retention!==proposed.retentionOutstanding+paidRetention||
      proposed.receiptInputMaximum+proposed.pendingChequeReserved!==proposed.principalOutstanding)
     error('核定請款、已收、保留款及支票餘額無法勾稽');
   if(adjusted&&(ledger.proposed.receivable!==proposed.receivable||
      ledger.proposed.retention!==proposed.retention||
      ledger.proposed.gross!==proposed.gross))error('獨立帳本計算不一致');
   const reduction={untaxed:untaxed-newUntaxed,tax:tax-newTax,
     gross:gross-proposed.gross,receivable:receivable-proposed.receivable,retention:retention-proposed.retention};
   for(const k of keys)if(reduction[k]<0)error('核定金額不得高於原始');
   if(reduction.untaxed+reduction.tax!==reduction.gross||
      reduction.receivable+reduction.retention!==reduction.gross)error('折讓拆分不平衡');
   rows.push({billingId:billId,billingNo:billNo,receivableId:arId,
     projectId:bill.project||null,month:bill.date.slice(0,7),allowanceReviewOnly:adjusted,
     original:{untaxed,tax,gross,receivable,retention},
     approved:{untaxed:newUntaxed,tax:newTax,gross:proposed.gross,
       receivable:proposed.receivable,retention:proposed.retention},
     reduction,received:paid,retentionReceived:paidRetention,
     outstanding:proposed.principalOutstanding,retentionOutstanding:proposed.retentionOutstanding,
     pendingChequeReserved:proposed.pendingChequeReserved,receiptInputMax:proposed.receiptInputMaximum,
     retentionInputMax:proposed.retentionInputMaximum});
 }
 for(const ar of state.receivables)if(!byAR.has(fixedId(ar.id,'應收')))error('存在非所選請款的應收');
 const totals=(field,key)=>add(rows.map(row=>row[field][key]),field+'.'+key);
 const summary={
  original:Object.fromEntries(keys.map(k=>[k,totals('original',k)])),
  approved:Object.fromEntries(keys.map(k=>[k,totals('approved',k)])),
  reduction:Object.fromEntries(keys.map(k=>[k,totals('reduction',k)])),
  principalReceived:add(rows.map(r=>r.received),'已收本期'),
  retentionReceived:add(rows.map(r=>r.retentionReceived),'已收保留款'),
  principalOutstanding:add(rows.map(r=>r.outstanding),'未收應收'),
  retentionOutstanding:add(rows.map(r=>r.retentionOutstanding),'待收保留款'),
  pendingChequeReserved:add(rows.map(r=>r.pendingChequeReserved),'支票預留'),
  receiptInputMaximum:add(rows.map(r=>r.receiptInputMax),'本期可收'),
  retentionInputMaximum:add(rows.map(r=>r.retentionInputMax),'保留款可收')
 };
 if(summary.original.gross!==summary.original.receivable+summary.original.retention||
    summary.approved.gross!==summary.approved.receivable+summary.approved.retention||
    summary.reduction.gross!==summary.reduction.receivable+summary.reduction.retention||
    summary.approved.receivable!==summary.principalReceived+summary.principalOutstanding||
    summary.approved.retention!==summary.retentionReceived+summary.retentionOutstanding||
    summary.receiptInputMaximum+summary.pendingChequeReserved!==summary.principalOutstanding)
     error('跨請款核對總額不一致');
 const months=[...new Set(rows.map(r=>r.month))].sort();
 const revenueByMonth=months.map(month=>({month,
    originalUntaxed:add(rows.filter(r=>r.month===month).map(r=>r.original.untaxed),'月份原營業額'),
    projectedUntaxed:add(rows.filter(r=>r.month===month).map(r=>r.approved.untaxed),'月份核定營業額'),
    adjustment:add(rows.filter(r=>r.month===month).map(r=>r.reduction.untaxed),'月份折讓')}));
 if(JSON.stringify(state)!==starting)error('ERP 資料在唯讀計算時被修改');
 return {schema:SCHEMA,mode:'ISOLATED_SYNTHETIC_PREVIEW_ONLY',readOnly:true,
   originalStateUnchanged:true,cloudWrites:0,bankTransactionsAdded:0,
   formalReceiptWriterConnected:false,formalRetentionWriterConnected:false,
   formalChequeWriterConnected:false,formalReportReaderConnected:false,
   formalPayrollUnlockChanged:false,officialTaxVoucherVerified:false,
   crossDeviceCloudCasVerified:false,canPost:false,releaseBlocked:true,
   expectedRevisionId:expected,count:rows.length,rows,summary,revenueByMonth,
   delta:{grossBilled:-summary.reduction.gross,receivable:-summary.reduction.receivable,
     retention:-summary.reduction.retention,monthlyUntaxedRevenue:-summary.reduction.untaxed,
     tax:-summary.reduction.tax,bankIncome:0,receiptCount:0,payroll:0,commissions:0}};
}
module.exports=Object.freeze({inspect,SCHEMA,FIXTURE,SCOPE});
