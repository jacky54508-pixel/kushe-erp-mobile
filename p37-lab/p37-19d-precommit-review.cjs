(function p3719dReview(root) {
'use strict';
// P37-19D: pure review of synthetic device/remote evidence only.
// Neither this file nor callers ever initiate real remote/ERP writers.
const SCHEMA='kushe-p37-19d-precommit-review-v1';
const DEVICE='kushe-p37-19d-synthetic-device-v1';
const REMOTE='kushe-p37-19d-synthetic-remote-v1';
const INTENT='kushe-p37-19d-synthetic-intent-v1';
const SCOPE='P37_19D_SYNTHETIC_CAS_ONLY';
const SYN=/^P37-19-SYN-[A-Z0-9-]{1,90}$/;
const clean=x=>String(x??'').trim();
const fail=x=>{throw new Error('P37-19D '+x)};
const whole=(v,label)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)fail(label+'必須為非負安全整數');return v};
function synthetic(v,label){const s=clean(v);if(!SYN.test(s))fail(label+'不能使用真實 ERP 識別');return s}
function version(v,label){
 if(typeof v!=='string'||!/^[1-9]\d{0,18}$/.test(v))fail(label+'版本格式錯誤');
 const n=BigInt(v);
 if(n>9223372036854775807n)fail(label+'版本超出範圍');
 return n;
}
function reportGuard(r){
 if(!r||r.schema!=='kushe-p37-19c-formal-shaped-readonly-v1'||
 r.mode!=='P37_19C_REVIEW_ONLY'||r.status!=='ALLOWANCE_RECORD_REVIEW_ONLY'||
 r.readOnly!==true||r.appliedToERP!==false||r.postingEnabled!==false||
 r.cloudWrites!==0||r.bankTransactionsAdded!==0||r.actualKpiModified!==false||
 r.formalReceiptWriterConnected!==false||r.formalRetentionWriterConnected!==false||
 r.formalChequeWriterConnected!==false||
 r.officialVoucherIndependentlyVerifiedBySystem!==false||
 r.requiresFullWriterIntegration!==true)fail('只能核對 P37-19C 未完成正式整合的折讓唯讀結果');
 const s=r.source||{},o=r.original||{},p=r.proposed||{},k=r.kpiDelta||{};
 for(const n of ['receivableId','billingId','billingNo','invoiceNo','revision'])synthetic(s[n],'來源 '+n);
 for(const n of ['gross','receivable','retention']){whole(o[n],'原'+n);whole(p[n],'核定'+n)}
 for(const n of ['principalReceived','retentionReceived','principalOutstanding','retentionOutstanding','pendingChequeReserved','receiptInputMaximum','retentionInputMaximum'])whole(p[n],n);
 if(o.receivable+o.retention!==o.gross||p.receivable+p.retention!==p.gross||
 p.principalReceived+p.principalOutstanding!==p.receivable||
 p.retentionReceived+p.retentionOutstanding!==p.retention||
 p.receiptInputMaximum+p.pendingChequeReserved!==p.principalOutstanding||
 p.retentionInputMaximum!==p.retentionOutstanding)fail('核定應收、支票預留及保留款無法勾稽');
 const discountGross=o.gross-p.gross,discountAR=o.receivable-p.receivable,discountRetention=o.retention-p.retention;
 if(discountGross<=0||discountAR<0||discountRetention<0||
 discountGross!==discountAR+discountRetention||
 k.grossReceivableTotal!==-discountGross||k.currentReceivableTotal!==-discountAR||
 k.retentionTotal!==-discountRetention||k.actualBankIncome!==0||
 k.actualReceiptCount!==0||k.commissions!==0||k.payroll!==0)fail('KPI 或折讓帳金額不一致');
 return {s,o,p,k};
}
function evidenceGuard(report,device,remote){
 const {s}=reportGuard(report);
 if(!device||device.schema!==DEVICE||device.scope!==SCOPE||
 device.trusted!==true||device.authLevel!=='SYNTHETIC_AAL2_ONLY'||
 device.permissions!=='SYNTHETIC_OWNER_ONLY'||device.pendingLocalWrites!==0||
 device.editorDirty!==false||device.syncBusy!==false||device.recoveryPending!==false||
 device.storeTransactionActive!==false)fail('裝置信任、交易或編輯狀態未通過模擬門禁');
 for(const n of ['id','userId','companyId','storeRevisionId','sourceFingerprint','lastRemoteFingerprint'])
   synthetic(device[n],'裝置 '+n);
 if(device.storeRevisionId!==s.revision)fail('本機 ERP 版本與帳務快照不一致');
 if(!remote||remote.schema!==REMOTE||remote.scope!==SCOPE||remote.simulated!==true||
 remote.productionSource!==false||remote.cloudWrites!==0)fail('雲端證據必須為無寫入的隔離模擬');
 for(const n of ['userId','companyId','snapshotRevisionId','fingerprint','sourceFingerprint'])
   synthetic(remote[n],'模擬遠端 '+n);
 if(device.userId!==remote.userId||device.companyId!==remote.companyId||
 device.sourceFingerprint!==remote.sourceFingerprint||
 device.sourceFingerprint!==remote.fingerprint && device.sourceFingerprint!==remote.sourceFingerprint)
   fail('不同登入、公司或來源，不得同步');
 if(remote.snapshotRevisionId!==s.revision)fail('遠端業務快照較新或來源不同，禁止沿用舊核定額');
 const syncVersion=version(remote.syncVersion,'遠端');
 if(version(device.lastRemoteSyncVersion,'裝置')!==syncVersion||
 device.lastRemoteFingerprint!==remote.fingerprint)
   fail('裝置同步基準已過期，請重新讀取遠端版本');
 return {source:s,syncVersion,remoteFingerprint:remote.fingerprint};
}
function preview(report,device,remote,intent){
 const before=JSON.stringify([report,device,remote,intent]),{s,p}=reportGuard(report),
   proof=evidenceGuard(report,device,remote);
 if(!intent||intent.schema!==INTENT||intent.scope!==SCOPE||
 intent.postingEnabled!==false||intent.requestedByDevice!==device.id||
 intent.expectedStoreRevision!==s.revision||
 intent.expectedRemoteSyncVersion!==remote.syncVersion||
 intent.expectedRemoteFingerprint!==remote.fingerprint||
 intent.receivableId!==s.receivableId||intent.billingId!==s.billingId||
 intent.invoiceNo!==s.invoiceNo)fail('本次操作來源或版本與核定帳款不一致');
 synthetic(intent.idempotencyKey,'操作識別');
 const amount=whole(intent.amount,'本次交易金額');
 if(!amount)fail('本次交易金額不可為零');
 const limits={receipt:p.receiptInputMaximum,retention:p.retentionInputMaximum,
 cheque_register:p.receiptInputMaximum,cheque_clear:p.pendingChequeReserved};
 if(!Object.hasOwn(limits,intent.kind))fail('員工代收繳回或其他寫入尚未整合，不允許操作');
 const max=limits[intent.kind];
 if(amount>max)fail('交易超過核定可用餘額或支票預留額度');
 if(intent.kind==='cheque_clear'){
  const ch=intent.syntheticCheque||{};
  synthetic(ch.id,'模擬支票');
  if(ch.scope!==SCOPE||ch.status!=='pending'||ch.receivableId!==s.receivableId||
     ch.reservedAmount!==amount||ch.existingReceiptCount!==0||ch.existingBankCount!==0)
     fail('模擬支票狀態、額度或銀行連結不符合待兌現條件');
 }else if(intent.syntheticCheque!==undefined)fail('非支票兌現操作不可附帶支票證據');
 if(JSON.stringify([report,device,remote,intent])!==before)fail('預檢更動原始資料');
 return {schema:SCHEMA,mode:'SIMULATED_PRECOMMIT_ONLY',ok:true,syntheticEligible:true,
  action:intent.kind,amount,maximum:max,sourceRevision:s.revision,
  expectedRemoteSyncVersion:remote.syncVersion,
  requestedByDevice:device.id,remoteFingerprint:proof.remoteFingerprint,
  blockers:['OFFICIAL_VOUCHER_INDEPENDENT_VERIFICATION_PENDING',
    'FORMAL_STORE_AND_SETTLEMENT_WRITERS_NOT_INTEGRATED',
    'REAL_TWO_DEVICE_REMOTE_CAS_NOT_TESTED',
    'REAL_BROWSER_BACKUP_AND_ROLLBACK_NOT_ACCEPTED'],
  canPost:false,postingEnabled:false,actualBankIncome:0,formalReceiptCount:0,
  formalRetentionReceiptCount:0,formalChequeCount:0,cloudWrites:0};
}
function simulateRace(report,remote,aDevice,aIntent,bDevice,bIntent){
 const before=JSON.stringify([report,remote,aDevice,aIntent,bDevice,bIntent]);
 if(aDevice.id===bDevice.id)fail('必須使用兩個不同的模擬裝置');
 const first=preview(report,aDevice,remote,aIntent);
 const next={...remote,syncVersion:(version(remote.syncVersion,'遠端')+1n).toString(),
   fingerprint:'P37-19-SYN-REMOTE-NEXT',snapshotRevisionId:'P37-19-SYN-REV-NEXT'};
 let secondBlocked=false,secondReason='';
 try{preview(report,bDevice,next,bIntent)}catch(error){secondBlocked=true;secondReason=String(error.message)}
 if(!secondBlocked)fail('第二台裝置使用舊版本未被拒絕');
 if(JSON.stringify([report,remote,aDevice,aIntent,bDevice,bIntent])!==before)fail('競爭模擬修改輸入快照');
 return {schema:SCHEMA,scope:SCOPE,mode:'FAKE_IN_MEMORY_RACE_ONLY',
  firstDevice:'SYNTHETIC_PREVIEW_ONLY',secondDevice:'BLOCKED_STALE_REMOTE',
  reason:secondReason,proposedRemoteSyncVersion:next.syncVersion,
  firstAttempt:first,sourceUnchanged:true,bankTransactionsAdded:0,
  realCloudRequests:0,cloudWrites:0,canPost:false};
}
const api=Object.freeze({preview,simulateRace,reportGuard,evidenceGuard,SCHEMA,DEVICE,REMOTE,INTENT,SCOPE});
if(typeof module==='object'&&module&&module.exports)module.exports=api;
else root.KusheP3719DPrecommitReview=api;
})(typeof window!=="undefined"?window:globalThis);
