(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  let preview=null,busy=false;
  function diagnosticPreview(){if(!preview)return null;const {token,...diagnostic}=preview;return diagnostic}
  function message(text){$('recoveryMessage').textContent=text}
  function setBusy(value){busy=Boolean(value);document.querySelectorAll('#recoveryModal button,#recoveryModal input').forEach(node=>{node.disabled=busy});updateConfirm()}
  function updateConfirm(){const button=$('recoveryExecute');if(button)button.disabled=busy||!preview?.allowed||$('recoveryConfirmation').value!==preview.operationId}
  function showResult(result){
    if(!result||!window.KusheAuthGate?.user?.())return;
    const status=result.transactionStatus||result.status;
    if(!['RECOVERY_REQUIRED','COMMITTED_WITH_NOTIFICATION_WARNING'].includes(status))return;
    const banner=$('storeSafetyBanner');banner.hidden=false;
    $('storeSafetyMessage').textContent=status==='COMMITTED_WITH_NOTIFICATION_WARNING'
      ?`資料已儲存，但畫面更新／通知失敗，請勿重複送出。操作：${result.operationId||'—'}`
      :`資料狀態待核對，請勿再次送出或還原。操作：${result.operationId||'—'}`;
    if(status==='RECOVERY_REQUIRED')window.KusheCloudSync?.stopAutoBackup?.();
  }
  async function refresh(){
    setBusy(true);preview=null;$('recoveryConfirmation').value='';message('正在唯讀核對 checkpoint、各層版本與指紋…');
    try{
      preview=await window.KuSheERPStore.recoveryPreview();
      $('recoveryEvidence').textContent=JSON.stringify(diagnosticPreview(),null,2);
      $('recoveryCandidate').textContent=preview.allowed?`${preview.candidate==='resume-verified-recovery'?'核對已保存的恢復結果並恢復使用':'恢復 journal 已驗證的操作前快照'}；操作 ${preview.operationId}`:'沒有可證明可信的候選，保持停止。';
      message(preview.allowed?'請核對候選與影響，再輸入完整操作 ID。這不會重送原收款或刪除。':preview.reason||'無法安全恢復');
    }catch(error){message(String(error.message||error))}finally{setBusy(false)}
  }
  async function open(){
    if(!await window.KusheAuthGate?.requireAuth?.())return;
    $('recoveryModal').hidden=false;await refresh();$('recoveryClose').focus();
  }
  async function execute(){
    if(busy||!preview?.allowed||$('recoveryConfirmation').value!==preview.operationId)return;
    if(!window.confirm(`確認恢復候選「${preview.candidate}」？\n操作：${preview.operationId}\n來源快照的業務資料將被恢復；不會自動重送原操作。`))return;
    setBusy(true);
    try{
      const result=await window.KuSheERPStore.recoverStore({token:preview.token,operationId:preview.operationId,confirmed:true});
      message('恢復已提交並完成獨立讀庫驗證。請按「重新載入並恢復使用」，不要重送原操作。');
      preview=null;$('recoveryReload').hidden=false;showResult(result);
    }catch(error){preview=null;message(`${error.message||error}；仍須核對，不會自動重試。`);showResult(error)}finally{setBusy(false)}
  }
  function exportDiagnostic(){
    // Preview has no business snapshot, credentials, session or local token values.
    const data={schema:'kushe-recovery-diagnostic-v1',exportedAt:new Date().toISOString(),preview:diagnosticPreview()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='kushe-recovery-diagnostic.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function init(){
    $('recoveryOpen').addEventListener('click',()=>void open());
    $('recoveryRefresh').addEventListener('click',()=>void refresh());
    $('recoveryExecute').addEventListener('click',()=>void execute());
    $('recoveryConfirmation').addEventListener('input',updateConfirm);
    $('recoveryClose').addEventListener('click',()=>{if(!busy)$('recoveryModal').hidden=true});
    $('recoveryExport').addEventListener('click',exportDiagnostic);
    $('recoveryReload').addEventListener('click',()=>window.location.reload());
    window.addEventListener('kushe:transaction-result',event=>showResult(event.detail));
  }
  window.KusheRecovery=Object.freeze({open,showResult});
  document.addEventListener('DOMContentLoaded',init);
}());
