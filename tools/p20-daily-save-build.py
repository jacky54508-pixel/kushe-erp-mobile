from pathlib import Path
import shutil,re,hashlib,json
D=Path.cwd()
p=D/'assets/js/commissions.js';s=p.read_text()
assert s.count('$$$(')==4
s=s.replace('$$$(','$$(')
old="    const showRowError=(error,rows)=>{const row=rows[error.dailyRowIndex]||rows[0];if(row){const field=error.dailyField==='house'?$('.daily-house-name',row.closest('.daily-house-group')):error.dailyField==='project'?projectInput(row):error.dailyField==='qty'?$('.daily-line-qty',row):error.dailyField==='quotation'?$('.daily-line-choice',row):$('.daily-line-item',row);field.setAttribute('aria-invalid','true');$('.daily-quote-hint',row).textContent=error.message;field.focus();field.scrollIntoView({block:'nearest',inline:'nearest'})}window.KushePhase1?.toast(error.message)};"
new="""    const showRowError=(error,rows)=>{
      const row=Number.isInteger(error?.dailyRowIndex)?rows[error.dailyRowIndex]:null;
      const field=error?.dailyField==='employee'?$('input[name="dailyEmployees"]',form):row?(error.dailyField==='house'?$('.daily-house-name',row.closest('.daily-house-group')):error.dailyField==='project'?projectInput(row):error.dailyField==='qty'?$('.daily-line-qty',row):error.dailyField==='quotation'?$('.daily-line-choice',row):$('.daily-line-item',row)):null;
      if(field){field.setAttribute('aria-invalid','true');field.focus();field.scrollIntoView({block:'nearest',inline:'nearest'})}
      const hint=row?$('.daily-quote-hint',row):null;if(hint)hint.textContent=error.message;
    };"""
assert old in s;s=s.replace(old,new,1)
old="if(!$('input[name=\"dailyEmployees\"]:checked',form))throw new Error('請至少選擇一位員工');"
new="if(!$('input[name=\"dailyEmployees\"]:checked',form)){const error=new Error('請至少選擇一位員工');error.dailyField='employee';throw error}"
assert old in s;s=s.replace(old,new,1)
marker='  async function submitDaily(event) {'
helper='''  // P20 Daily Save-1: feedback stays inside the drawer, even when the body is scrolled.
  function dailySaveFeedback(form,message,tone='error') {
    if(!form?.isConnected)return;
    const footer=$(':scope > footer',form);if(!footer)return;
    let feedback=$('.daily-save-feedback',footer);
    if(!feedback){feedback=document.createElement('p');feedback.className='daily-save-feedback';footer.prepend(feedback)}
    feedback.dataset.tone=tone;feedback.setAttribute('role',tone==='error'?'alert':'status');
    feedback.setAttribute('aria-live',tone==='error'?'assertive':'polite');
    feedback.textContent=String(message||'');feedback.hidden=!message;
  }
  function dailySaveError(form,context,error,rows,message) {
    dailySaveFeedback(form,message||`未儲存：${error?.message||'表單處理失敗，請保留內容後再試。'}`);
    // Error presentation must not throw a second error or discard the original draft.
    try{context?.showRowError?.(error,rows)}catch(_){}
  }
'''
assert marker in s;s=s.replace(marker,helper+marker,1)
old="    try{context?.validateRows(rows)}catch(error){context?.showRowError(error,rows);return}\n    const lines="
new="    let values;\n    try{\n      context?.validateRows(rows);\n      const lines="
assert old in s;s=s.replace(old,new,1)
# Payload building must be guarded as well, not just storage.
s=s.replace('    const values={date:form.elements.date.value,employeeIds:', '      values={date:form.elements.date.value,employeeIds:',1)
old="    dailySubmitInFlight=true;button.disabled=true;button.textContent='儲存中…';"
new="    }catch(error){dailySaveError(form,context,error,rows);return}\n    dailySubmitInFlight=true;button.disabled=true;button.textContent='儲存中…';\n    dailySaveFeedback(form,'儲存中，請勿重複送出或關閉視窗。','pending');"
assert old in s;s=s.replace(old,new,1)
old="      if(context)context.showRowError(error,rows);else window.KushePhase1?.toast(`儲存失敗：${error.message}`);"
new="      dailySaveError(form,context,error,rows,error.transactionStatus==='RECOVERY_REQUIRED'?'儲存狀態待核對，請保留此畫面，勿重送。':undefined);"
assert old in s;s=s.replace(old,new,1)
s=s.replace("    const result=store.getLastStoreTransactionResult?.();\n    try{\n      enabledControls", "    let result;\n    try{\n      result=store.getLastStoreTransactionResult?.();\n      enabledControls",1)
old="      if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING')window.KusheRecovery?.showResult(result);\n      else window.KushePhase1?.toast('每日施工、抽成、點工與待請款已同步儲存');"
new="""      if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING'){
        dailySaveFeedback(form,'資料已儲存，但畫面更新異常；請核對紀錄，勿重送。','warning');
        window.KusheRecovery?.showResult(result);
      }else{
        dailySaveFeedback(form,'本筆已儲存；已保留案場與品項，請填下一戶及數量。','success');
        window.KushePhase1?.toast('每日施工、抽成、點工與待請款已同步儲存');
      }"""
assert old in s;s=s.replace(old,new,1)
old="      window.KusheRecovery?.showResult(warning);button.textContent='已儲存，請關閉後重新開啟';"
new="      dailySaveFeedback(form,'資料已儲存，但畫面更新異常；請核對紀錄，勿重送。','warning');\n      button.textContent='已儲存，請關閉後重新開啟';\n      try{window.KusheRecovery?.showResult(warning)}catch(_){}"
assert old in s;s=s.replace(old,new,1)
p.write_text(s)
css=D/'assets/css/commissions-scoped.css'
with css.open('a') as f:f.write('''\n/* P20 Daily Save-1: drawer-local durable save/validation feedback. */
#commissionDrawerLayer #dailyWorkForm > footer { flex-wrap: wrap; }
#commissionDrawerLayer #dailyWorkForm > footer > .daily-save-feedback {
  flex: 0 0 100%; grid-column: 1 / -1; box-sizing: border-box;
  margin: 0; padding: 8px 12px; border: 1px solid #f0c6c6; border-radius: 8px;
  background: #fff4f4; color: #a52222; font-size: 13px; line-height: 1.5;
  white-space: normal; overflow-wrap: anywhere; max-height: 100px; overflow-y: auto;
}
#commissionDrawerLayer #dailyWorkForm > footer > .daily-save-feedback[hidden] { display: none !important; }
#commissionDrawerLayer #dailyWorkForm > footer > .daily-save-feedback[data-tone="pending"] {
  background: #f3f7ff; border-color: #cbdcf7; color: #234d7c;
}
#commissionDrawerLayer #dailyWorkForm > footer > .daily-save-feedback[data-tone="success"] {
  background: #f0faf4; border-color: #bfddcb; color: #236342;
}
#commissionDrawerLayer #dailyWorkForm > footer > .daily-save-feedback[data-tone="warning"] {
  background: #fff8eb; border-color: #ecd7a7; color: #80591c;
}
''')
p=D/'index.html';s=p.read_text()
for path in ['assets/js/commissions.js','assets/css/commissions-scoped.css']:
 s,n=re.subn(re.escape(path)+r'\?[^"\s]+',path+'?v=p20-daily-save-1-20261004',s)
 assert n==1,(path,n)
p.write_text(s)
