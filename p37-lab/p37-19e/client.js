(() => {
'use strict';
// P37-19E: standalone synthetic fixture, never an ERP application module.
const SCOPE = 'P37-19E-SYNTHETIC-LOCAL-ONLY';
const USERS = Object.freeze({
  A: 'P37-19-SYN-OWNER-A',
  B: 'P37-19-SYN-OWNER-B',
  outsider: 'P37-19-SYN-OUTSIDER'
});
let token = '', baseline = null, working = false;
const $ = id => document.getElementById(id);
const src = { billingId:'P37-19-SYN-BILL', receivableId:'P37-19-SYN-ARID',
  invoiceNo:'P37-19-SYN-INVNO', snapshotRevision:'P37-19-SYN-REV' };
const discount = { untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600 };
function render(message) {
  $('status').textContent = message;
  $('version').textContent = baseline ? '合成遠端版本 ' + baseline.version : '尚無可用版本';
  $('balance').textContent = baseline?.allowances?.length === 1 ?
    '核定應收 ' + baseline.allowances[0].approved.receivable : '尚未套用合成折讓';
}
async function request(url, method, body) {
  const headers = {Authorization: token ? 'Bearer '+token : ''};
  if (body) headers['Content-Type']='application/json';
  const response = await fetch(url, {method,headers,cache:'no-store',body:body?JSON.stringify(body):undefined});
  return {http:response.status,...await response.json()};
}
async function load(user) {
  token=USERS[user]||'';
  baseline=null;
  const r=await request('/api/state','GET');
  if(r.http===200 && r.scope===SCOPE && r.simulated===true && r.formalPostingEnabled===false) {
    baseline=JSON.parse(JSON.stringify(r));
    render('已讀取合成快照（不可視為正式驗證）');
  } else {render('拒絕讀取：'+r.status)}
  return {http:r.http,status:r.status||'READY',version:r.version??null};
}
async function submit(key, failAt=null, override={}) {
  if(working)throw Error('BUSY');
  if(!baseline||baseline.scope!==SCOPE)throw Error('SYNTHETIC_BASELINE_REQUIRED');
  if(typeof key!=='string'||!/^P37-19-SYN-ACTION-[A-Z0-9-]{1,50}$/.test(key))throw Error('INVALID_SYNTHETIC_ACTION');
  working=true;
  try{
    const body={scope:SCOPE,expectedVersion:baseline.version,expectedFingerprint:baseline.fingerprint,
      source:src,discount,idempotencyKey:key,failAt,...override};
    const result=await request('/api/allowance','POST',body);
    render('僅本機合成交易：'+result.status);
    return result;
  } finally {working=false}
}
function visible(){return {
  hasToken:!!token,version:baseline?.version??null,
  persisted:false,erpWriterConnected:false,formalPostingEnabled:false
}}
window.KusheP3719ELab = Object.freeze({load,submit,visible});
})();