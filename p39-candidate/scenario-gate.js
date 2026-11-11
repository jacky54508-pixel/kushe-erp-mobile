/* P39-3D: synthetic-only financial dependency & scenario matrix.
 * Read-only policy; never grants real ERP posting permissions or tax validity.
 * Unknown historical links fail closed rather than guessing allocation.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.KusheP393ScenarioGate=api;
})(typeof window==='object'?window:{},function(){
 'use strict';
 const FIXTURE='kushe-p39-3-synthetic-fixture-v1';
 function error(code,message){const e=new Error(message);e.code=code;throw e}
 const str=v=>String(v??'').trim();
 const num=(v,label)=>{
   if(v===undefined||v===null||v==='')return 0;
   if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)
     error('P39_SCENARIO_INVALID_AMOUNT',label+'不是有效整數金額');
   return v;
 };
 const collection=(state,key)=>{
   if(state[key]===undefined)return [];
   if(!Array.isArray(state[key]))
     error('P39_SCENARIO_INVALID_COLLECTION','資料集格式無效：'+key);
   return state[key];
 };
 const one=(rows,filter,label)=>{
   const hits=rows.filter(filter);
   if(hits.length!==1)error('P39_SCENARIO_SOURCE_NOT_UNIQUE',label+'來源識別不唯一');
   return hits[0];
 };
 const linked=(row,bill,ar)=>{
   if(!row||typeof row!=='object')return false;
   const targets=new Set([str(bill.id),str(ar.id),str(bill.number)].filter(Boolean));
   return ['billingId','receivableId','sourceBillingId','sourceReceivableId',
     'sourceId','sourceNo','sourceNumber','linkedBillingId','originalBillingId',
     'sourceInvoiceId'].some(key=>row[key]!==undefined&&targets.has(str(row[key])))||
     ['billingIds','receivableIds','sourceIds','sourceBillingIds','billingSourceIds',
       'sourceInvoiceIds'].some(key=>Array.isArray(row[key])&&row[key].some(id=>targets.has(str(id))));
 };
 const projectRelated=(row,bill)=>{
   const id=str(bill.project||bill.projectId);
   return id&&row&&['project','projectId'].some(k=>str(row[k])===id) ||
     (id&&Array.isArray(row?.projectIds)&&row.projectIds.some(x=>str(x)===id));
 };
 function inspect(state,billingId){
   if(!state||state.__p39Synthetic!==FIXTURE||state.meta?.p39SyntheticSchema!==FIXTURE)
     error('P39_SCENARIO_SYNTHETIC_ONLY','只能分析獨立虛構測試資料，禁止讀取真實公司資料');
   const bill=one(collection(state,'billings'),r=>str(r?.id)===str(billingId),'請款');
   const ar=one(collection(state,'receivables'),r=>
     str(r?.billingId)===str(bill.id) ||
     (str(bill.receivableId)&&str(r?.id)===str(bill.receivableId)),'應收');
   if(str(bill.receivableId)!==str(ar.id)||str(ar.billingId)!==str(bill.id))
     error('P39_SCENARIO_LINK_INVALID','請款與應收相互關聯不一致');
   const blockers=[],warn=[];
   const block=(code,message)=>{if(!blockers.some(x=>x.code===code))blockers.push({code,message})};
   const invoiceState=str(bill.invoiceStatus);
   if(!['invoice_pending','no_invoice','invoiced'].includes(invoiceState))
     block('UNKNOWN_INVOICE_STATUS','無法判定應開、免開或已開發票');
   const invoices=collection(state,'invoices').filter(r=>linked(r,bill,ar)||
     str(r?.billingId)===str(bill.id));
   if(invoices.length>1)block('MULTIPLE_INVOICE_REFERENCES','存在多張來源銷項發票');
   if(invoiceState==='invoiced')
     block('ISSUED_INVOICE_NEEDS_OFFICIAL_PLATFORM','已開電子發票，須另由合法來源開立傳輸存證折讓證明單');
   if(invoices.some(r=>['issued','void','cancelled','作廢'].includes(str(r.status)))&&
      invoiceState!=='invoiced')
     block('INVOICE_LIFECYCLE_MISMATCH','原發票歷程與請款稅務狀態不相符');
   if(invoiceState==='no_invoice'&&invoices.length)
     block('NO_INVOICE_HAS_INVOICE_ROW','免開發票請款已有銷項發票來源');
   if(invoiceState==='invoice_pending'&&str(bill.invoiceNo))
     block('PENDING_HAS_INVOICE_NUMBER','待開票請款已有發票號碼');
   if(invoiceState==='invoiced'&&(!str(bill.invoiceNo)||invoices.length!==1))
     block('ISSUED_INVOICE_MISMATCH','已開票須有唯一發票號碼及來源');
   const paid=['received','retentionReceived','legacyReceived','legacyRetentionReceived']
     .reduce((sum,key)=>sum+num(ar[key],key),0);
   if(paid>0)block('COLLECTED_OR_RETENTION_PAID','已有應收收款或保留款入帳');
   const receipts=collection(state,'receipts').filter(r=>linked(r,bill,ar));
   const retention=collection(state,'retentionReceipts').filter(r=>linked(r,bill,ar));
   if(receipts.length||retention.length)
     block('SETTLEMENT_HISTORY_PRESENT','原請款已有收款／保留款歷程');
   const bank=collection(state,'bankTransactions').filter(r=>linked(r,bill,ar)||
     [...receipts,...retention].some(rec=>rec?.id&&
       (str(r?.sourceId)===str(rec.id)||str(r?.receiptId)===str(rec.id))));
   if(bank.length)block('BANK_TRANSACTION_LINKED','已有銀行流水，禁止直接折讓');
   const cheques=[...(Array.isArray(ar.receivableCheques)?ar.receivableCheques:[]),
     ...collection(state,'receivableCheques').filter(r=>linked(r,bill,ar)),
     ...collection(state,'cheques').filter(r=>linked(r,bill,ar))];
   if(ar.receivableCheques!==undefined&&!Array.isArray(ar.receivableCheques))
     block('CHEQUE_SCHEMA_UNSAFE','票據歷程格式不完整');
   if(cheques.length||num(ar.pendingChequeAmount,'pendingChequeAmount')>0)
     block('CHEQUE_HISTORY_PRESENT','存在支票登記或預留款');
   const groupDocs=[...collection(state,'externalBillingDocuments'),
     ...(state.meta?.externalBillingDocuments===undefined?[]:
       collection(state.meta,'externalBillingDocuments'))];
   if(groupDocs.some(r=>str(r?.targetBillingId)===str(bill.id)||
     Array.isArray(r?.sourceIds)&&r.sourceIds.some(x=>str(x)===str(bill.id))))
     block('EXTERNAL_BILLING_GROUP','已納入對外合併請款');
   if(collection(state,'customerDeductions').some(r=>linked(r,bill,ar)))
     block('CUSTOMER_DEDUCTION','已有建商扣款或清潔費等扣款');
   const commission=collection(state,'commissions').filter(r=>linked(r,bill,ar)||
     projectRelated(r,bill));
   const settled=collection(state,'commissionSettlements').filter(r=>linked(r,bill,ar)||
     projectRelated(r,bill));
   const payroll=collection(state,'payroll').filter(r=>linked(r,bill,ar)||
     projectRelated(r,bill));
   const salaryPaid=collection(state,'salaryPayments').filter(r=>linked(r,bill,ar)||
     projectRelated(r,bill));
   if(commission.length||settled.length||payroll.length||salaryPaid.length)
     block('COMMISSION_PAYROLL_REVIEW_REQUIRED','相關案場已有抽成／薪資／付款紀錄，不得自動重算');
   if(collection(state,'billingAllowances').some(r=>linked(r,bill,ar)))
     block('ALLOWANCE_ALREADY_RECORDED','已有折讓，禁止重複申請');
   const supported=invoiceState==='invoice_pending'||invoiceState==='no_invoice';
   if(!supported)warn.push('已開發票及特殊歷史狀態不在本階段可核准範圍');
   const result={
     schema:'kushe-p39-3d-scenario-gate-v1',
     billingId:str(bill.id),receivableId:str(ar.id),invoiceState,
     inspectedCollections:13,
     status:blockers.length?'SYNTHETIC_BLOCKED':'SYNTHETIC_PREVIEW_ELIGIBLE',
     candidateEligible:blockers.length===0&&supported,
     productionPostingAllowed:false,
     realTaxVoucherVerified:false,
     cloudWriteAvailable:false,
     blockers,warnings:warn,
     nextAction:blockers.length?'逐項檢核，不可直接改原請款或折讓入帳':
       '僅能在 localhost 使用虛構資料測試新版過帳流程'
   };
   return Object.freeze(result);
 }
 return Object.freeze({FIXTURE,inspect});
});