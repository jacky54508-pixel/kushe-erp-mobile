(function p3713EffectiveConsumers(){
 'use strict';
 // P37-13: ONE pure source for synthetic receivable-list, receipt, retention and KPI projections.
 // This module has no ERP writer, local DB, browser storage, tax issuance or cloud access.
 const SCHEMA='kushe-p37-13-effective-consumers-v1';
 const BRIDGE='kushe-p37-12-synthetic-bridge-v1';
 const LEDGER='kushe-p37-12-mock-entry-v1';
 const text=x=>String(x??'').trim();
 function fail(reason){throw new Error(reason)}
 function amount(value,label){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail(label+'必須為有效非負整數');
  return value;
 }
 function project(bridgeReport,bridge=window.KusheP3712LedgerBridge){
  if(!bridge?.effectiveLimit||bridgeReport?.ok!==true||bridgeReport.schema!==BRIDGE||
     bridgeReport.postingEnabled!==false||bridgeReport.formalReceiptReaderConnected!==false||
     bridgeReport.cloudWrites!==0||bridgeReport.originalStateUnchanged!==true)
   fail('P37-12 未完成隔離核對，禁止計算收款與報表');
  const state=bridgeReport.nextState,entry=bridgeReport.ledgerEntry;
  if(!state||!entry||entry.schema!==LEDGER||entry.status!=='SYNTHETIC_NOT_POSTED'||
     entry.postable!==false||entry.voucherStatus!=='NOT_VERIFIED'||!entry.source||
     !text(entry.source.billingId)||!text(entry.source.receivableId)||!text(entry.source.invoiceNo)||
     !text(entry.source.snapshot)||entry.billingId!==entry.source.billingId||
     entry.receivableId!==entry.source.receivableId||
     entry.invoiceNo!==entry.source.invoiceNo||
     entry.idempotencyKey!=='billing-allowance::'+entry.billingId+'::'+entry.invoiceNo)
   fail('隔離折讓紀錄格式、識別或鎖定狀態不正確');
  if(!Array.isArray(state.billingAllowances)||!Array.isArray(state.receivables)||
     !Array.isArray(state.billings)||!Array.isArray(state.invoices))
   fail('缺少應收與折讓資料集');
  const ledgerMatches=state.billingAllowances.filter(x=>
   text(x?.billingId)===entry.billingId||text(x?.receivableId)===entry.receivableId||
   text(x?.invoiceNo)===entry.invoiceNo||text(x?.idempotencyKey)===entry.idempotencyKey);
  if(ledgerMatches.length!==1||JSON.stringify(ledgerMatches[0])!==JSON.stringify(entry))
   fail('隔離折讓不是唯一紀錄，禁止計算');
  const arMatches=state.receivables.filter(x=>text(x?.id)===entry.receivableId);
  const billingMatches=state.billings.filter(x=>text(x?.id)===entry.billingId);
  const invoiceMatches=state.invoices.filter(x=>text(x?.id)===entry.invoiceId);
  if(arMatches.length!==1||billingMatches.length!==1||invoiceMatches.length!==1)
   fail('原請款、應收、發票不唯一');
  const ar=arMatches[0],billing=billingMatches[0],invoice=invoiceMatches[0];
  if(text(ar.billingId)!==entry.billingId||text(billing.receivableId)!==entry.receivableId||
     text(billing.invoiceNo)!==entry.invoiceNo||
     text(invoice.invoiceNumber||invoice.number)!==entry.invoiceNo)
   fail('請款、應收與發票關聯不一致');
  const values=bridge.effectiveLimit(state,entry.receivableId);
  if(values?.status!=='SYNTHETIC_RECEIPT_LIMIT_ONLY'||values.formalReceiptReaderConnected!==false)
   fail('收款核定餘額並非隔離模式');
  const d=entry.reduction||{},original=entry.original||{},effective=entry.effective||{};
  for(const k of ['untaxed','tax','gross','receivable','retention']){
   amount(d[k],'折讓'+k);amount(original[k],'原始'+k);amount(effective[k],'核定'+k);
   if(original[k]-d[k]!==effective[k])fail('折讓無法勾稽：'+k);
  }
  if(d.untaxed+d.tax!==d.gross||d.receivable+d.retention!==d.gross||
     effective.receivable+effective.retention!==effective.gross||
     values.originalReceivable!==original.receivable||
     values.originalRetention!==original.retention||
     values.effectiveReceivable!==effective.receivable||
     values.effectiveRetention!==effective.retention||
     values.receivableOutstanding!==effective.receivable-amount(ar.received??0,'已收本期')||
     values.retentionOutstanding!==effective.retention-amount(ar.retentionReceived??0,'已收保留款'))
   fail('請款、應收、保留款、KPI 計算基準不一致');
  const principalPaid=amount(ar.received??0,'本期已收'),retentionPaid=amount(ar.retentionReceived??0,'保留款已收');
  const view={
   receivableId:entry.receivableId,billingId:entry.billingId,billingNo:text(billing.number),
   originalInvoiceNo:entry.invoiceNo,
   originalGross:original.gross,effectiveGross:effective.gross,allowanceGross:d.gross,
   originalReceivable:original.receivable,effectiveReceivable:effective.receivable,
   received:principalPaid,receivableOutstanding:values.receivableOutstanding,
   originalRetention:original.retention,effectiveRetention:effective.retention,
   retentionReceived:retentionPaid,retentionOutstanding:values.retentionOutstanding,
   receiptStatus:values.receivableOutstanding===0?'本期已收清':principalPaid>0?'部分收款':'未收',
   retentionStatus:values.retentionOutstanding===0?'已收回':retentionPaid>0?'部分收回':'保留中'
  };
  const kpiDelta={
   grossReceivableTotal:-d.gross,
   currentReceivableTotal:-d.receivable,
   currentOutstanding:-d.receivable,
   retentionTotal:-d.retention,
   retentionOutstanding:-d.retention,
   actualBankIncome:0,actualReceiptCount:0,commissions:0,payroll:0
  };
  if(-kpiDelta.currentReceivableTotal-kpiDelta.retentionTotal!==d.gross||
     -kpiDelta.grossReceivableTotal!==d.gross)
   fail('KPI 差額與折讓含稅不一致');
  return {schema:SCHEMA,ok:true,mode:'BETA_SYNTHETIC_READ_ONLY',
   source:{billingId:entry.billingId,receivableId:entry.receivableId,invoiceNo:entry.invoiceNo,
     documentSnapshot:entry.source.snapshot},
   view,kpiDelta,receiptInputMax:view.receivableOutstanding,
   retentionInputMax:view.retentionOutstanding,
   formalReceiptWriterConnected:false,formalRetentionWriterConnected:false,
   formalReportReaderConnected:false,postingEnabled:false,cloudWrites:0
  };
 }
 function checkPayment(model,kind,input,options={}){
  if(model?.schema!==SCHEMA||model.mode!=='BETA_SYNTHETIC_READ_ONLY'||
     model.postingEnabled!==false||model.formalReceiptWriterConnected!==false||
     model.formalRetentionWriterConnected!==false||model.cloudWrites!==0)
   fail('此處只允許隔離測試，不得建立收款或銀行流水');
  if(!['receipt','retention'].includes(kind))fail('收款類型不正確');
  const v=model.view||{},ret=kind==='retention';
  const effective=amount(ret?v.effectiveRetention:v.effectiveReceivable,'核定有效金額');
  const already=amount(ret?v.retentionReceived:v.received,'已收款');
  const request=amount(input,'本次收款');
  if(request<=0)fail('本次收款必須大於 0');
  const mode=options.mode||'new';
  if(!['new','edit'].includes(mode))fail('收款操作類型不正確');
  const otherReceived=mode==='edit'?amount(options.otherReceived,'其他已收紀錄'):already;
  if(otherReceived>effective)fail('其他收款紀錄高於有效應收');
  const maximum=effective-otherReceived;
  if(request>maximum)fail('超過議價折讓後的有效可收上限');
  const nextReceived=otherReceived+request;
  return {ok:true,kind,mode,maximum,input:request,
   projectedReceived:nextReceived,projectedOutstanding:effective-nextReceived,
   simulatedOnly:true,bankTransactionsAdded:0,ERPRecordsChanged:0};
 }
 function checkConsistency(bridgeReport,bridge){
  const report=project(bridgeReport,bridge),view=report.view,amounts=bridgeReport.effective||{};
  if(view.effectiveReceivable!==amounts.receivable||
     view.effectiveRetention!==amounts.retention||
     view.effectiveGross!==amounts.gross||
     report.receiptInputMax!==view.receivableOutstanding||
     report.retentionInputMax!==view.retentionOutstanding)
   fail('請款、應收或保留款讀取結果不同');
  // Test both front-end entry limits and business validation, without calling ERP writers.
  for(const [kind,limit] of [['receipt',report.receiptInputMax],['retention',report.retentionInputMax]]){
   if(limit<=0)fail('目前隔離案例缺少可驗證的未收金額');
   const exact=checkPayment(report,kind,limit);
   if(exact.projectedOutstanding!==0)fail('收款後餘額驗算錯誤');
   let blocked=false;
   try{checkPayment(report,kind,limit+1)}catch(_){blocked=true}
   if(!blocked)fail('超收上限未被拒絕');
   const partial=Math.max(1,Math.floor(limit/2)),initial=checkPayment(report,kind,partial);
   const later=checkPayment(report,kind,limit-partial,{mode:'edit',otherReceived:partial});
   if(initial.projectedOutstanding!==limit-partial||later.projectedOutstanding!==0)
    fail('分次收款或編輯收款上限不一致');
  }
  return {...report,boundariesTested:8,downstreamChecksPassed:true};
 }
 window.KusheP3713EffectiveConsumers=Object.freeze({project,checkPayment,checkConsistency});
})();