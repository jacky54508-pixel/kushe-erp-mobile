#!/usr/bin/env python3
"""K23: copied SYN-K21 crash evidence through the exact official Store APIs.

No production origin, account, profile, database, or source edits are used.
The three prior crash snapshots are inputs; this is not another crash test.
"""
import argparse
import copy
import hashlib
import json
import shutil
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

EXPECTED_STORE_SHA256 = '316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e'
EXPECTED_STORE_BLOB = '95773d5264d54fe1e1d1cfe54b37a2a2656a9fab'
SOURCE_COMMIT = 'edf1c1886aac09958caa9e4b304502cca44f6937'
CASES = (
    'PRIMARY_WRITTEN_before_emergency',
    'EMERGENCY_WRITTEN_before_store_token',
    'EMERGENCY_WRITTEN_before_receipt_token',
)
RAW_FILE = '08_raw_after_crash_before_any_store_script.json'
SOURCE_HASHES = {
    CASES[0]: '9a7d5dec2307668fb230f57d63b2103b09646c2258483aa618711882684a423f',
    CASES[1]: 'd10571f3c2b4ee045eebe3e5b8aa705a83da75ff2b4d99cb13a6bc27a030f5e3',
    CASES[2]: 'b67dbd5bcc60554302f55844c85868163741a6aff8a11d47f751b4f3e252b39e',
}
JOURNAL = 'store:transaction:journal:v1'
EMERGENCY = 'KuSheERP25_EMERGENCY'
STORE_TOKEN = 'KuSheERP25_LOCAL_COMMIT_TOKEN'
RECEIPT_TOKEN = 'KuSheERP25_RECEIPT_COMMIT_VERSION'
STORE_GATE = 'KuSheERP25_STORE_RECOVERY_REQUIRED'
RECEIPT_GATE = 'KuSheERP25_RECEIPT_RECOVERY_REQUIRED'
RECEIPT_ACTIVE = 'KuSheERP25_RECEIPT_TRANSACTION_ACTIVE'
PRINCIPAL = 'SYN-K23-OWNER'

HTML = '''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>K23 isolated synthetic recovery</title><link rel="icon" href="data:,"></head>
<body><p>唯有合成快照的隔離恢復驗收；不連線正式 ERP。</p><script>
'use strict';
window.KUSHE_PHASE1_CONFIG = {};
window.__k23Principal = 'SYN-K23-OWNER';
window.KusheAuthGate = {
  session:()=>({access_token:'SYN-K23-LOCAL-ONLY-TOKEN'}),
  user:()=>({id:window.__k23Principal,email:'synthetic-k23@example.invalid'}),
  companyContext:()=>({userId:window.__k23Principal,legacySourceUserId:window.__k23Principal,companyId:'SYN-K23-COMPANY',role:'owner',status:'active'}),
  canWrite:()=>true, requireAuth:async()=>true, requireMfa:async()=>true
};
window.KuSheLegacyData = {refresh(){}};
window.KusheRecovery = {showResult(){}};
window.__k23ReadRaw = async function () {
  const names=await indexedDB.databases();
  const exists=names.some(x=>x.name==='KuSheERP25_Core34_DB');
  const out={dbExists:exists,storeExists:false,idb:{},local:{},session:{}};
  const keys=['main','store:transaction:journal:v1','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED'];
  if(exists){
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>r.transaction.abort()});
    try{
      out.storeExists=db.objectStoreNames.contains('erp');
      if(out.storeExists)await new Promise((resolve,reject)=>{
        const tx=db.transaction('erp','readonly'),table=tx.objectStore('erp');
        for(const key of keys){const r=table.get(key);r.onsuccess=()=>{out.idb[key]=r.result??null}}
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    }finally{db.close()}
  }
  for(const key of ['KuSheERP25_EMERGENCY','KuSheERP25_LOCAL_COMMIT_TOKEN','KuSheERP25_RECEIPT_COMMIT_VERSION','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_TRANSACTION_ACTIVE'])out.local[key]=localStorage.getItem(key);
  for(const key of ['KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED'])out.session[key]=sessionStorage.getItem(key);
  return out;
};
window.__k23Seed = async function (raw) {
  if(location.hostname!=='127.0.0.1'||window.__k23Seeded)throw Error('SEED_NOT_ALLOWED');
  if(localStorage.length||sessionStorage.length||(await indexedDB.databases()).length)throw Error('FRESH_EMPTY_PROFILE_REQUIRED');
  if(raw.idb?.main?.meta?.k21Synthetic!==true||raw.idb?.['store:transaction:journal:v1']?.before?.state?.meta?.k21Synthetic!==true)throw Error('SYNTHETIC_EVIDENCE_REQUIRED');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB',1);r.onupgradeneeded=()=>r.result.createObjectStore('erp');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readwrite'),table=tx.objectStore('erp');for(const [key,value] of Object.entries(raw.idb))if(value!==null)table.put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}
  for(const [key,value] of Object.entries(raw.local))if(value!==null)localStorage.setItem(key,value);
  for(const [key,value] of Object.entries(raw.session))if(value!==null)sessionStorage.setItem(key,value);
  window.__k23Seeded=true;
  return window.__k23ReadRaw();
};
window.__k23Call = async function ({name,args=[]}) {
  try{return {ok:true,result:await window.KuSheERPStore[name](...args)}}
  catch(error){return {ok:false,error:{name:error.name,message:error.message,code:error.code||'',transactionStatus:error.transactionStatus||'',operationId:error.operationId||''}}}
};
</script></body></html>'''


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


class Report:
    def __init__(self, output):
        self.output = output
        output.mkdir(parents=True, exist_ok=True)
        self.result = dict(
            schema='k23-exact-official-store-synthetic-recovery-browser-v1',
            status='RUNNING', sourceCommit=SOURCE_COMMIT,
            expectedStoreSha256=EXPECTED_STORE_SHA256, expectedStoreBlob=EXPECTED_STORE_BLOB,
            productionDataTouched=False, recoveryPublished=False, publishGate='BLOCKED',
            realAuthenticationTested=False, hardwarePowerLossTested=False,
            scope='Copied prior SYN-K21 snapshots; actual official Store recovery APIs in isolated Chromium; graceful close/reopen',
            checks=[], cases=[], diagnostics=[], failures=[], externalRequests=[], pageErrors=[], sources=[],
        )

    def check(self, name, condition, details=None):
        row = dict(name=name, passed=bool(condition))
        if details is not None:
            row['details'] = details
        self.result['checks'].append(row)
        if not condition:
            self.flush()
            raise AssertionError(name + (': ' + str(details) if details is not None else ''))

    def save(self, name, value):
        (self.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def flush(self):
        self.result['passCount'] = sum(x['passed'] for x in self.result['checks'])
        self.result['failCount'] = sum(not x['passed'] for x in self.result['checks'])
        self.save('RESULT.json', self.result)


class LocalServer:
    def __init__(self, store):
        self.store = store
        store_bytes = store

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = urlsplit(self.path).path
                if path == '/fixture.html':
                    data, mime = HTML.encode(), 'text/html; charset=utf-8'
                elif path == '/assets/js/erp-store.js':
                    data, mime = store_bytes, 'text/javascript; charset=utf-8'
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def restrict(context, server, report, case):
    allowed = {server.origin + '/fixture.html', server.origin + '/assets/js/erp-store.js'}

    def route_request(route):
        request = route.request
        if request.method == 'GET' and request.url in allowed:
            route.continue_()
        else:
            report.result['externalRequests'].append(dict(case=case, url=request.url, method=request.method))
            route.abort()

    context.route('**/*', route_request)
    context.on('page', lambda page: page.on('pageerror', lambda error: report.result['pageErrors'].append(dict(case=case, message=str(error)))))


def open_page(context, server):
    page = context.new_page()
    page.set_default_timeout(20000)
    page.goto(server.origin + '/fixture.html', wait_until='load')
    return page


def load_store(page, server):
    page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')


def raw(page):
    return page.evaluate('() => window.__k23ReadRaw()')


def call(page, name, *args):
    return page.evaluate('value => window.__k23Call(value)', dict(name=name, args=list(args)))


def confirmation(preview):
    return dict(token=preview['token'], operationId=preview['operationId'], confirmed=True)


def positive(playwright, launch, server, report, name, source, profile):
    prefix = name + ': '
    checkpoint = copy.deepcopy(source['idb'][JOURNAL]['before']['state'])
    crash_revision = source['idb']['main']['meta']['businessSnapshotRevision']
    original_operation = source['idb'][JOURNAL]['operationId']
    context = playwright.chromium.launch_persistent_context(str(profile), **launch)
    restrict(context, server, report, name)
    try:
        page = open_page(context, server)
        seeded = page.evaluate('value => window.__k23Seed(value)', source)
        report.check(prefix + 'seed copied exact synthetic observation into empty profile', seeded == source)
        load_store(page, server)
        report.check(prefix + 'loading Store script does not mutate observation', raw(page) == source)
        blocked = call(page, 'load')
        report.check(prefix + 'original incomplete transaction refuses normal load', not blocked['ok'] and blocked['error']['code'] == 'STORE_WRITES_BLOCKED', blocked)
        report.check(prefix + 'normal load refusal preserves all captured values', raw(page) == source)
        preview = call(page, 'recoveryPreview')
        report.check(prefix + 'official preview returns verified checkpoint candidate', preview['ok'] and preview['result']['allowed'] is True and preview['result']['candidate'] == 'restore-before-checkpoint', preview)
        preview = preview['result']
        report.check(prefix + 'preview identifies original transaction and both versions', preview['operationId'] == original_operation and preview['beforeRevision'] == checkpoint['meta']['businessSnapshotRevision'] and preview['afterRevision'] == crash_revision)
        report.check(prefix + 'preview makes no captured storage changes and publishes no state', raw(page) == source and page.evaluate('() => KuSheERPStore.getState()') is None)
        recovery = call(page, 'recoverStore', confirmation(preview))
        report.save(name + '-recovery-call.json', recovery)
        report.check(prefix + 'official controlled recovery commits successfully', recovery['ok'] and recovery['result']['status'] == 'COMMITTED', recovery)
        recovered = raw(page)
        report.save(name + '-after-recovery.json', recovered)
        current = recovered['idb']['main']
        journal = recovered['idb'][JOURNAL]
        revision = current['meta']['businessSnapshotRevision']
        report.check(prefix + 'recovery creates sequence 4 with parent of interrupted revision 3', revision['sequence'] == 4 and revision['parentId'] == crash_revision['id'] and revision['id'] not in (checkpoint['meta']['businessSnapshotRevision']['id'], crash_revision['id']) and revision['operationId'] == journal['operationId'])
        report.check(prefix + 'every business collection and setting equals original checkpoint', {k:v for k,v in current.items() if k not in ('meta', 'audit')} == {k:v for k,v in checkpoint.items() if k not in ('meta', 'audit')})
        report.check(prefix + 'only permitted commit metadata changed', {k:v for k,v in current['meta'].items() if k not in ('updatedAt','businessSnapshotRevision','receiptCommitVersion')} == {k:v for k,v in checkpoint['meta'].items() if k not in ('updatedAt','businessSnapshotRevision','receiptCommitVersion')} and current['meta']['updatedAt'] == revision['committedAt'] and current['meta']['receiptCommitVersion'] == revision['id'])
        report.check(prefix + 'one explicit recovery audit row precedes the original checkpoint audit', len(current['audit']) == len(checkpoint['audit']) + 1 and current['audit'][1:] == checkpoint['audit'] and current['audit'][0]['action'] == '使用者確認恢復操作前快照' and current['audit'][0]['recoveredOperationId'] == original_operation)
        report.check(prefix + 'interrupted transaction retained in complete recovery evidence', journal['phase'] == 'COMMIT_VERIFIED' and journal['recoveryOf'] == original_operation and journal['recoveryEvidence'] == source['idb'][JOURNAL] and journal['steps']['verified'] is True)
        emergency = json.loads(recovered['local'][EMERGENCY])
        token = json.loads(recovered['local'][STORE_TOKEN])
        report.check(prefix + 'primary emergency and both commit tokens agree on new commit', emergency == current and token == dict(schema='kushe-store-transaction-v1', revisionId=revision['id'], sequence=4, stateFingerprint=journal['after']['stateFingerprint'], committedAt=revision['committedAt']) and recovered['local'][RECEIPT_TOKEN] == revision['id'] and journal['after']['businessSnapshotRevision'] == revision)
        report.check(prefix + 'salary bank postings and bank balances remain unchanged', all(current[key] == checkpoint[key] == source['idb']['main'][key] for key in ('salaryPayments','bankTransactions','banks','payments','receipts','retentionReceipts','commissions','commissionSettlements')))
        report.check(prefix + 'owned recovery gates cleared only after successful verification', all(recovered[place].get(key) is None for place in ('idb','local','session') for key in (STORE_GATE, RECEIPT_GATE)) and recovered['local'][RECEIPT_ACTIVE] is None)
        loaded = call(page, 'load')
        report.check(prefix + 'normal load exposes exactly committed recovered state', loaded['ok'] and loaded['result'] == current and page.evaluate('() => KuSheERPStore.getState()') == current)
        diagnostic = call(page, 'storeTransactionDiagnostic')
        report.check(prefix + 'post-recovery diagnostic is available and unblocked', diagnostic['ok'] and diagnostic['result']['available'] is True and diagnostic['result']['blocked'] is False, diagnostic)
        report.check(prefix + 'load and diagnostics preserve recovered storage', raw(page) == recovered)
        repeated = call(page, 'recoverStore', confirmation(preview))
        report.check(prefix + 'consumed preview cannot be replayed', not repeated['ok'] and repeated['error']['code'] == 'RECOVERY_CONFIRMATION_REQUIRED' and raw(page) == recovered, repeated)
    finally:
        context.close()

    context = playwright.chromium.launch_persistent_context(str(profile), **launch)
    restrict(context, server, report, name + '-reopen')
    try:
        page = open_page(context, server)
        before_load = raw(page)
        report.save(name + '-after-graceful-reopen-before-store.json', before_load)
        report.check(prefix + 'graceful browser reopen retains every captured committed value', before_load == recovered)
        load_store(page, server)
        loaded = call(page, 'load')
        report.check(prefix + 'normal load after reopened profile succeeds with exact recovered state', loaded['ok'] and loaded['result'] == current, loaded if not loaded['ok'] else None)
        report.check(prefix + 'reopen load neither rewrites storage nor restores interrupted customer', raw(page) == recovered and all('SYN-K21-CRASH-' not in row.get('name','') for row in loaded['result']['customers']))
        report.result['cases'].append(dict(name=name, kind='controlled-recovery-and-graceful-reopen', passed=True, beforeRevision=checkpoint['meta']['businessSnapshotRevision'], interruptedRevision=crash_revision, recoveryRevision=revision, recoveredCustomerCount=len(current['customers'])))
    finally:
        context.close()


def negative_case(browser, server, report, name, source, mutate_seed=None, mutate_after_preview=None, expected_error=None):
    context = browser.new_context(service_workers='block')
    restrict(context, server, report, name)
    try:
        page = open_page(context, server)
        # Seed only the original synthetic snapshot; deliberate fault injections follow.
        page.evaluate('value => window.__k23Seed(value)', source)
        if mutate_seed:
            page.evaluate(mutate_seed)
        load_store(page, server)
        before = raw(page)
        result = call(page, 'recoveryPreview')
        report.check(name + ': official preview does not mutate injected observation', raw(page) == before)
        if mutate_after_preview:
            report.check(name + ': valid candidate exists before fault injection', result['ok'] and result['result']['allowed'], result)
            page.evaluate(mutate_after_preview)
            before_recover = raw(page)
            refused = call(page, 'recoverStore', confirmation(result['result']))
            report.check(name + ': recovery refuses exact expected conflict', not refused['ok'] and refused['error']['code'] == expected_error, refused)
            report.check(name + ': refused recovery preserves all post-injection storage', raw(page) == before_recover)
            final = refused
        else:
            report.check(name + ': invalid evidence never yields recovery permission or token', result['ok'] and result['result']['allowed'] is False and not result['result'].get('token'), result)
            report.check(name + ': invalid preview publishes no business state', page.evaluate('() => KuSheERPStore.getState()') is None)
            final = result
        report.save(name + '.json', dict(result=final, finalObservation=raw(page)))
        report.result['cases'].append(dict(name=name, kind='negative-refusal', passed=True, result=final))
    finally:
        context.close()


def recovery_write_fault_diagnostic(browser, server, report, source):
    """One owned synthetic write fault; observe retryability without masking it."""
    name = 'recovery-emergency-write-fault-diagnostic'
    context = browser.new_context(service_workers='block')
    restrict(context, server, report, name)
    try:
        page = open_page(context, server)
        page.evaluate('value => window.__k23Seed(value)', source)
        load_store(page, server)
        preview = call(page, 'recoveryPreview')
        report.check(name + ': exact snapshot starts with valid readonly recovery candidate', preview['ok'] and preview['result']['allowed'] is True and raw(page) == source, preview)
        page.evaluate('''() => {
          window.__k23InjectedFaultCount=0;
          const original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value){
            if(this===localStorage&&key==='KuSheERP25_EMERGENCY'){
              Storage.prototype.setItem=original;
              window.__k23InjectedFaultCount++;
              throw Object.assign(new Error('SYN-K23-INJECTED-EMERGENCY-WRITE-FAILURE'),{code:'SYN_K23_INJECTED_WRITE_FAILURE'});
            }
            return original.call(this,key,value);
          };
        }''')
        failed_recovery = call(page, 'recoverStore', confirmation(preview['result']))
        after_fault = raw(page)
        report.check(name + ': single injected emergency write failure is reported as recovery required', page.evaluate('() => window.__k23InjectedFaultCount') == 1 and not failed_recovery['ok'] and failed_recovery['error']['code'] == 'SYN_K23_INJECTED_WRITE_FAILURE' and failed_recovery['error']['transactionStatus'] == 'RECOVERY_REQUIRED', failed_recovery)
        report.check(name + ': primary and all mirrors roll back to exact interrupted input', after_fault['idb']['main'] == source['idb']['main'] and after_fault['local'] == source['local'] and after_fault['session'] == source['session'])
        report.check(name + ': original-operation durable recovery gate remains present', after_fault['idb'][STORE_GATE] is not None and after_fault['idb'][STORE_GATE]['operationId'] == source['idb'][JOURNAL]['operationId'], after_fault['idb'][STORE_GATE])
        retry_preview = call(page, 'recoveryPreview')
        load_refusal = call(page, 'load')
        report.check(name + ': normal load stays blocked after the failed recovery', not load_refusal['ok'] and load_refusal['error']['code'] == 'STORE_WRITES_BLOCKED' and page.evaluate('() => KuSheERPStore.getState()') is None, load_refusal)
        report.check(name + ': retry preview and load refusal preserve post-fault captured storage', raw(page) == after_fault)
        journal = after_fault['idb'][JOURNAL]
        retry_allowed = retry_preview.get('ok') is True and retry_preview.get('result',{}).get('allowed') is True
        diagnostic = dict(
            name=name,
            status='RECOVERY_RETRY_CANDIDATE_AVAILABLE' if retry_allowed else 'RECOVERY_RETRY_BLOCKED',
            scope='One injected write failure during synthetic controlled recovery, not general fault-tolerance validation',
            failedRecovery=failed_recovery, retryPreview=retry_preview, loadRefusal=load_refusal,
            activeJournalPhase=journal.get('phase'), activeJournalOperationId=journal.get('operationId'),
            originalOperationId=source['idb'][JOURNAL]['operationId'],
            originalCheckpointStillInActiveJournal=bool(journal.get('recoveryEvidence')) or journal.get('before',{}).get('state') == source['idb'][JOURNAL]['before']['state'],
            rawSourceEvidenceRetained=True, failClosedVerified=True, publishGate='BLOCKED',
        )
        report.save(name + '.json', dict(**diagnostic, beforeObservation=source, afterFaultObservation=after_fault))
        report.result['diagnostics'].append(diagnostic)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--executable', default=None)
    args = parser.parse_args()
    report = Report(args.output.resolve())
    source_files = {}
    try:
        store = args.store.read_bytes()
        report.check('exact pinned official Store SHA256 and Git blob', sha256(store) == EXPECTED_STORE_SHA256 and git_blob(store) == EXPECTED_STORE_BLOB, dict(sha256=sha256(store), gitBlob=git_blob(store)))
        snapshots = {}
        for name in CASES:
            path = args.evidence / name / 'evidence' / RAW_FILE
            if not path.is_file():
                path = args.evidence / name / RAW_FILE
            contents = path.read_bytes()
            source_files[path] = sha256(contents)
            report.check(name + ': exact retained V4 source bytes', sha256(contents) == SOURCE_HASHES[name], dict(sha256=sha256(contents), expected=SOURCE_HASHES[name]))
            value = json.loads(contents.decode('utf-8-sig'))
            report.check(name + ': both states explicitly synthetic and no financial postings', value['idb']['main']['meta'].get('k21Synthetic') is True and value['idb'][JOURNAL]['before']['state']['meta'].get('k21Synthetic') is True and all(value['idb']['main'][key] == [] for key in ('salaryPayments','bankTransactions','payments','receipts','commissions')))
            snapshots[name] = value
            report.result['sources'].append(dict(case=name, file=path.name, sha256=source_files[path], bytes=len(contents)))
        executable = args.executable or shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium')
        launch = dict(headless=True, service_workers='block')
        if executable:
            launch['executable_path'] = executable
        with tempfile.TemporaryDirectory(prefix='K23_SYNTHETIC_RECOVERY_') as temporary:
            with LocalServer(store) as server, sync_playwright() as playwright:
                report.result['origin'] = server.origin
                for name, source in snapshots.items():
                    print('RUN', name, flush=True)
                    positive(playwright, launch, server, report, name, source, Path(temporary) / name)
                    report.flush()
                # Nonpersistent contexts are fresh and sufficient for refusal tests.
                browser_launch = {key:value for key,value in launch.items() if key != 'service_workers'}
                browser = playwright.chromium.launch(**browser_launch)
                report.result['browserVersion'] = browser.version
                try:
                    sample = snapshots[CASES[0]]
                    negative_case(browser, server, report, 'stale-preview-token', sample,
                                  mutate_after_preview="() => localStorage.setItem('KuSheERP25_RECEIPT_COMMIT_VERSION','SYN-K23-UNRELATED-REVISION')",
                                  expected_error='RECOVERY_PREVIEW_STALE')
                    negative_case(browser, server, report, 'principal-changed-after-preview', sample,
                                  mutate_after_preview="() => {window.__k23Principal='SYN-K23-OTHER-OWNER'}",
                                  expected_error='RECOVERY_PRINCIPAL_CHANGED')
                    negative_case(browser, server, report, 'foreign-recovery-marker', sample,
                                  mutate_seed="() => localStorage.setItem('KuSheERP25_STORE_RECOVERY_REQUIRED',JSON.stringify({operationId:'SYN-K23-FOREIGN-OPERATION'}))")
                    negative_case(browser, server, report, 'unknown-emergency-version', sample,
                                  mutate_seed="() => {const value=JSON.parse(localStorage.getItem('KuSheERP25_EMERGENCY'));value.customers.push({id:'SYN-K23-UNKNOWN',name:'SYN-K23-UNKNOWN'});localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(value))}")
                    negative_case(browser, server, report, 'unknown-commit-token', sample,
                                  mutate_seed="() => {const value=JSON.parse(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN'));value.revisionId='SYN-K23-UNKNOWN';localStorage.setItem('KuSheERP25_LOCAL_COMMIT_TOKEN',JSON.stringify(value))}")
                    negative_case(browser, server, report, 'unresolved-receipt-active-marker', sample,
                                  mutate_seed="() => localStorage.setItem('KuSheERP25_RECEIPT_TRANSACTION_ACTIVE',JSON.stringify({operationId:'SYN-K23-UNRESOLVED-RECEIPT'}))")
                    recovery_write_fault_diagnostic(browser, server, report, sample)
                finally:
                    browser.close()
        report.check('no request escaped the two permitted localhost resources', report.result['externalRequests'] == [], report.result['externalRequests'])
        report.check('no unhandled page errors', report.result['pageErrors'] == [], report.result['pageErrors'])
        report.check('three recovery-reopen cases and six distinct refusal cases completed', len(report.result['cases']) == 9)
        report.result['status'] = 'K23_SYNTHETIC_CONTROLLED_RECOVERY_AND_REOPEN_VERIFIED__PUBLISH_BLOCKED'
    except Exception as error:
        report.result['status'] = 'BLOCKED'
        report.result['failures'].append(dict(type=type(error).__name__, message=str(error), traceback=traceback.format_exc()))
        raise
    finally:
        unchanged = all(sha256(path.read_bytes()) == digest for path,digest in source_files.items())
        report.result['sourceFilesUnchanged'] = unchanged
        if not unchanged:
            report.result['status'] = 'BLOCKED'
            report.result['failures'].append(dict(type='SourceMutation', message='Input evidence changed during validation'))
        report.flush()
        print(report.result['status'], 'PASS', report.result['passCount'], 'FAIL', report.result['failCount'], flush=True)


if __name__ == '__main__':
    main()
