#!/usr/bin/env python3
"""K24 exact-source baseline reproduction and isolated recovery-retry regression.

The unchanged K23 browser harness is reused for its established three success and
six refusal cases. New cases exercise real IndexedDB/Web Storage in fresh owned
profiles using copied synthetic evidence only. No production origin is opened.
"""
import argparse
import copy
import hashlib
import json
import os
import platform
import shutil
import tempfile
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright
import k23_browser_recovery as k

K23_HARNESS_SHA256 = '6f986c9e3ffa9c0de34c30341346d0ce3f5ff2f433e1bc57d2c027ff8522d53b'
LEGACY_FIXTURE_SHA256 = '97f0486560015e4ec8408c089ff05282a10fe8fff8916d3b165a57e987942d1f'
J, E, S, R, G, RG = k.JOURNAL, k.EMERGENCY, k.STORE_TOKEN, k.RECEIPT_TOKEN, k.STORE_GATE, k.RECEIPT_GATE
MIRRORS = (E, S, R)
FAULT_CODE = 'SYN_K24_FORWARD_WRITE_FAILURE'


def print_run(name):
    print('RUN', name, flush=True)


def origin_journal(journal):
    node = journal
    depth = 0
    while isinstance(node, dict) and node.get('recoveryEvidence'):
        depth += 1
        if depth > 8:
            raise AssertionError('Observed recovery chain exceeds supported depth')
        node = node['recoveryEvidence']
    return node, depth


def new_persistent(playwright, launch, profile, server, report, name):
    context = playwright.chromium.launch_persistent_context(str(profile), **launch)
    k.restrict(context, server, report, name)
    return context, k.open_page(context, server)


def seed(page, server, source, report, name):
    observed = page.evaluate('value => window.__k23Seed(value)', source)
    report.check(name + ': exact copied synthetic seed', observed == source)
    k.load_store(page, server)
    report.check(name + ': source load preserves storage', k.raw(page) == source)


def preview(page, report, name, original, expected=True):
    before = k.raw(page)
    result = k.call(page, 'recoveryPreview')
    report.check(name + ': preview preserves all captured storage', k.raw(page) == before)
    if expected:
        report.check(name + ': preview permits original checkpoint only', result['ok'] and result['result']['allowed'] is True and result['result']['candidate'] == 'restore-before-checkpoint' and result['result']['operationId'] == original['idb'][J]['operationId'], result)
        report.check(name + ': preview identifies actual original checkpoint revision', result['result']['beforeRevision'] == original['idb'][J]['before']['state']['meta']['businessSnapshotRevision'], result['result'])
    else:
        report.check(name + ': preview refuses ambiguous evidence', result['ok'] and result['result']['allowed'] is False and not result['result'].get('token'), result)
    return result


def inject_write_fault(page, target, rollback_primary_fault=False):
    page.evaluate('''({target,rollbackPrimaryFault}) => {
      const originalSet=Storage.prototype.setItem, originalPut=IDBObjectStore.prototype.put;
      window.__k24ForwardFaults=0; window.__k24RollbackFaults=0; window.__k24Journals=[];
      window.__k24RestoreFaults=()=>{Storage.prototype.setItem=originalSet;IDBObjectStore.prototype.put=originalPut};
      Storage.prototype.setItem=function(key,value){
        if(this===localStorage&&key===target&&window.__k24ForwardFaults===0){
          window.__k24ForwardFaults++;
          Storage.prototype.setItem=originalSet;
          throw Object.assign(new Error('SYN-K24-FORWARD-WRITE-FAILURE'),{code:'SYN_K24_FORWARD_WRITE_FAILURE'});
        }
        return originalSet.call(this,key,value);
      };
      IDBObjectStore.prototype.put=function(value,key){
        if(this.name==='erp'&&key==='store:transaction:journal:v1')window.__k24Journals.push(structuredClone(value));
        if(rollbackPrimaryFault&&this.name==='erp'&&key==='main'&&window.__k24ForwardFaults===1&&value?.meta?.businessSnapshotRevision?.sequence===3&&window.__k24RollbackFaults===0){
          window.__k24RollbackFaults++;
          throw Object.assign(new Error('SYN-K24-ROLLBACK-PRIMARY-FAILURE'),{code:'SYN_K24_ROLLBACK_PRIMARY_FAILURE'});
        }
        return originalPut.call(this,value,key);
      };
    }''', dict(target=target, rollbackPrimaryFault=rollback_primary_fault))


def failed_attempt(page, report, name, original, target, expected_depth, rollback_primary_fault=False):
    prior = k.raw(page)
    approved = preview(page, report, name + '-before-attempt', original)['result']
    inject_write_fault(page, target, rollback_primary_fault)
    try:
        result = k.call(page, 'recoverStore', k.confirmation(approved))
    finally:
        page.evaluate('() => window.__k24RestoreFaults()')
    traces = page.evaluate('() => ({forward:__k24ForwardFaults,rollback:__k24RollbackFaults,journals:__k24Journals})')
    observed = k.raw(page)
    report.save(name + '-failed-attempt.json', dict(before=prior, result=result, after=observed, traces=traces))
    expected_code = 'RECOVERY_FAILED' if rollback_primary_fault else FAULT_CODE
    report.check(name + ': injected failure remains recovery required', not result['ok'] and result['error']['code'] == expected_code and result['error']['transactionStatus'] == 'RECOVERY_REQUIRED', result)
    report.check(name + ': exactly intended faults fired', traces['forward'] == 1 and traces['rollback'] == int(rollback_primary_fault), traces)
    journal = observed['idb'][J]
    root, depth = origin_journal(journal)
    owner = original['idb'][J]['operationId']
    report.check(name + ': full previous attempt journal retained', journal.get('recoveryEvidence') == prior['idb'][J])
    report.check(name + ': original checkpoint survives entire chain', root == original['idb'][J] and depth == expected_depth, dict(depth=depth, expected=expected_depth))
    report.check(name + ': rollback journal keeps attempt input checkpoint and root owner', journal.get('before',{}).get('state') == prior['idb']['main'] and journal.get('recoveryOf') == owner and journal.get('operationId') != owner)
    report.check(name + ': every recovery journal written carries the original owner and checkpoint chain', bool(traces['journals']) and all(x.get('recoveryOf') == owner and isinstance(x.get('recoveryEvidence'),dict) for x in traces['journals']), [dict(phase=x.get('phase'),recoveryOf=x.get('recoveryOf')) for x in traces['journals']])
    report.check(name + ': durable gate still protects original operation', observed['idb'][G] is not None and observed['idb'][G]['operationId'] == owner)
    if rollback_primary_fault:
        report.check(name + ': rollback failure preserves attempted primary and known mirrors', journal['phase'] == 'RECOVERY_REQUIRED' and observed['idb']['main']['meta']['businessSnapshotRevision']['sequence'] == 4 and observed['local'][E] == prior['local'][E] and observed['local'][S] == prior['local'][S] and observed['local'][R] == prior['local'][R])
        markers=[]
        for place in ('idb','local','session'):
            for key in (G,RG):
                value=observed[place][key]
                markers.append(json.loads(value) if isinstance(value,str) else value)
        report.check(name + ': all recovery-failure markers preserve root ownership and attempt identity', all(m and m.get('operationId') == owner and m.get('recoveryOperationId') == journal['operationId'] for m in markers), markers)
    else:
        report.check(name + ': successful rollback restores exact primary and all mirrors', journal['phase'] == 'ROLLED_BACK' and observed['idb']['main'] == prior['idb']['main'] and observed['local'] == prior['local'] and observed['session'] == prior['session'])
    refused = k.call(page, 'load')
    report.check(name + ': normal load remains blocked before explicit retry', not refused['ok'] and refused['error']['code'] == 'STORE_WRITES_BLOCKED' and page.evaluate('() => KuSheERPStore.getState()') is None, refused)
    report.check(name + ': refusal does not change failed-attempt evidence', k.raw(page) == observed)
    return observed


def assert_success(page, report, name, original, preceding, expected_sequence):
    current = k.raw(page)
    data, journal = current['idb']['main'], current['idb'][J]
    checkpoint = original['idb'][J]['before']['state']
    revision = data['meta']['businessSnapshotRevision']
    previous_revision = preceding['idb']['main']['meta']['businessSnapshotRevision']
    root, depth = origin_journal(journal)
    owner = original['idb'][J]['operationId']
    report.check(name + ': retry commits fresh monotonic revision', revision['sequence'] == expected_sequence and revision['parentId'] == previous_revision['id'] and revision['id'] != previous_revision['id'] and revision['operationId'] == journal['operationId'])
    report.check(name + ': retry recovers original business content, never partial operation', {x:v for x,v in data.items() if x not in ('meta','audit')} == {x:v for x,v in checkpoint.items() if x not in ('meta','audit')} and len(data['customers']) == 2 and all('CRASH' not in x.get('name','') for x in data['customers']))
    report.check(name + ': original metadata preserved apart from new commit values', {x:v for x,v in data['meta'].items() if x not in ('updatedAt','businessSnapshotRevision','receiptCommitVersion')} == {x:v for x,v in checkpoint['meta'].items() if x not in ('updatedAt','businessSnapshotRevision','receiptCommitVersion')} and data['meta']['receiptCommitVersion'] == revision['id'] and data['meta']['updatedAt'] == revision['committedAt'])
    report.check(name + ': successful retry adds exactly one recovery audit to original checkpoint', data['audit'][1:] == checkpoint['audit'] and len(data['audit']) == len(checkpoint['audit'])+1 and data['audit'][0]['action'] == '使用者確認恢復操作前快照' and data['audit'][0]['recoveredOperationId'] == owner)
    report.check(name + ': committed journal retains previous attempt and complete original evidence', journal['phase'] == 'COMMIT_VERIFIED' and journal.get('recoveryOf') == owner and journal['recoveryEvidence'] == preceding['idb'][J] and root == original['idb'][J])
    token = json.loads(current['local'][S])
    report.check(name + ': primary emergency and both tokens bind to successful new revision', json.loads(current['local'][E]) == data and current['local'][R] == revision['id'] and token == dict(schema='kushe-store-transaction-v1',revisionId=revision['id'],sequence=expected_sequence,stateFingerprint=journal['after']['stateFingerprint'],committedAt=revision['committedAt']) and journal['after']['businessSnapshotRevision'] == revision)
    report.check(name + ': every owned marker is cleared only after verified commit', all(current[p][key] is None for p in ('idb','local','session') for key in (G,RG)))
    report.check(name + ': payroll bank receipts and balances remain original', all(data[key] == checkpoint[key] == original['idb']['main'][key] for key in ('salaryPayments','bankTransactions','banks','payments','receipts','retentionReceipts','commissions','commissionSettlements')))
    loaded = k.call(page,'load')
    diagnostic = k.call(page,'storeTransactionDiagnostic')
    report.check(name + ': normal load and diagnostics accept only recovered state', loaded['ok'] and loaded['result'] == data and diagnostic['ok'] and diagnostic['result']['blocked'] is False and k.raw(page) == current)
    report.save(name + '-after-retry.json',current)
    return current


def fault_retry_case(playwright, launch, server, report, name, source, profile, targets, reopen_after=False, rollback_primary_fault=False):
    print_run(name)
    context, page = new_persistent(playwright,launch,profile,server,report,name)
    try:
        seed(page,server,source,report,name)
        for i,target in enumerate(targets):
            failed = failed_attempt(page,report,name+f'-attempt-{i+1}',source,target,i+1,rollback_primary_fault)
        if reopen_after:
            context.close()
            context, page = new_persistent(playwright,launch,profile,server,report,name+'-reopen-after-failure')
            observed = k.raw(page)
            report.save(name+'-after-failure-reopen-before-store.json',observed)
            report.check(name + ': failed-attempt evidence survives normal browser reopen', observed == failed)
            k.load_store(page,server)
        approved = preview(page,report,name+'-fresh-retry',source)['result']
        report.check(name + ': no business state published before explicit retry', page.evaluate('() => KuSheERPStore.getState()') is None)
        before_retry = k.raw(page)
        result = k.call(page,'recoverStore',k.confirmation(approved))
        report.check(name + ': explicit fresh retry commits successfully',result['ok'] and result['result']['status']=='COMMITTED',result)
        recovered = assert_success(page,report,name,source,before_retry,5 if rollback_primary_fault else 4)
        replay = k.call(page,'recoverStore',k.confirmation(approved))
        report.check(name + ': successful retry token cannot be replayed',not replay['ok'] and replay['error']['code']=='RECOVERY_CONFIRMATION_REQUIRED' and k.raw(page)==recovered,replay)
    finally:
        context.close()
    context,page = new_persistent(playwright,launch,profile,server,report,name+'-reopen-after-success')
    try:
        report.check(name + ': committed retry survives normal close and reopen',k.raw(page)==recovered)
        k.load_store(page,server)
        loaded=k.call(page,'load')
        report.check(name + ': reopened retry loads same committed content',loaded['ok'] and loaded['result']==recovered['idb']['main'] and k.raw(page)==recovered,loaded if not loaded['ok'] else None)
    finally:
        context.close()
    report.result['cases'].append(dict(name=name,kind='recovery-fault-retry',passed=True,failedAttempts=len(targets),faultTargets=list(targets),reopenedAfterFailure=reopen_after,rollbackPrimaryFault=rollback_primary_fault,recoveryRevision=recovered['idb']['main']['meta']['businessSnapshotRevision']))
    report.flush()


def refused_after_failure(browser,server,report,source,kind):
    name='after-failure-'+kind
    print_run(name)
    context=browser.new_context(service_workers='block');k.restrict(context,server,report,name)
    try:
        page=k.open_page(context,server);seed(page,server,source,report,name)
        failed_attempt(page,report,name,source,E,1)
        approved=preview(page,report,name+'-fresh',source)['result']
        if kind=='stale-observation':
            page.evaluate("() => localStorage.setItem('KuSheERP25_RECEIPT_COMMIT_VERSION','SYN-K24-UNRELATED')")
            before=k.raw(page);result=k.call(page,'recoverStore',k.confirmation(approved))
            report.check(name + ': stale token is rejected before any write',not result['ok'] and result['error']['code']=='RECOVERY_PREVIEW_STALE' and k.raw(page)==before,result)
        else:
            page.evaluate("() => localStorage.setItem('KuSheERP25_STORE_RECOVERY_REQUIRED',JSON.stringify({operationId:'SYN-K24-FOREIGN-OWNER'}))")
            before=k.raw(page);result=preview(page,report,name+'-foreign',source,expected=False)
            report.check(name + ': foreign marker remains intact',k.raw(page)==before)
        report.save(name+'-refusal.json',dict(result=result,observation=k.raw(page)))
        report.result['cases'].append(dict(name=name,kind='post-failure-refusal',passed=True))
    finally:context.close()


def legacy_compact_refusal(browser,server,report,source,legacy):
    name='legacy-k23-lost-checkpoint-stays-blocked'
    print_run(name)
    context=browser.new_context(service_workers='block');k.restrict(context,server,report,name)
    try:
        page=k.open_page(context,server);seed(page,server,source,report,name)
        page.evaluate('''async observed => {
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readwrite'),table=tx.objectStore('erp');for(const [key,value] of Object.entries(observed.idb)){if(value===null)table.delete(key);else table.put(value,key)}tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
          for(const [place,values] of [[localStorage,observed.local],[sessionStorage,observed.session]])for(const [key,value] of Object.entries(values)){if(value===null)place.removeItem(key);else place.setItem(key,value)}
        }''',legacy)
        report.check(name + ': prior actual failure observation copied exactly',k.raw(page)==legacy)
        result=preview(page,report,name,source,expected=False)
        report.check(name + ': missing checkpoint is not invented',result['result']['checkpointAvailable'] is False)
        loaded=k.call(page,'load')
        report.check(name + ': unresolved prior state remains fail closed and unchanged',not loaded['ok'] and loaded['error']['code']=='STORE_WRITES_BLOCKED' and k.raw(page)==legacy,loaded)
        report.result['cases'].append(dict(name=name,kind='legacy-evidence-refusal',passed=True))
    finally:context.close()


def ordinary_rollback(browser,server,report,source):
    name='ordinary-customer-writer-rollback-unchanged'
    print_run(name)
    context=browser.new_context(service_workers='block');k.restrict(context,server,report,name)
    try:
        page=k.open_page(context,server);seed(page,server,source,report,name)
        approved=preview(page,report,name+'-setup',source)['result']
        recovered=k.call(page,'recoverStore',k.confirmation(approved))
        report.check(name + ': setup recovery succeeds',recovered['ok'],recovered)
        before=k.raw(page)
        inject_write_fault(page,E)
        try:failed=k.call(page,'saveCustomer',{'name':'SYN-K24-ORDINARY-ROLLED-BACK'})
        finally:page.evaluate('() => window.__k24RestoreFaults()')
        after=k.raw(page);journal=after['idb'][J]
        report.check(name + ': ordinary writer retains ROLLED_BACK error semantics',not failed['ok'] and failed['error']['code']==FAULT_CODE and failed['error']['transactionStatus']=='ROLLED_BACK',failed)
        report.check(name + ': ordinary rollback compact shape unchanged',journal['phase']=='ROLLED_BACK' and journal['operationType']=='saveCustomer' and not any(x in journal for x in ('before','after','recoveryOf','recoveryEvidence')))
        report.check(name + ': original primary mirrors and gate state preserved',after['idb']['main']==before['idb']['main'] and after['local']==before['local'] and after['session']==before['session'] and all(after['idb'][key] is None for key in (G,RG)))
        loaded=k.call(page,'load');report.check(name + ': normal load remains available after ordinary rollback',loaded['ok'] and loaded['result']==before['idb']['main'],loaded if not loaded['ok'] else None)
        success=k.call(page,'saveCustomer',{'name':'SYN-K24-ORDINARY-RETRY'})
        current=k.raw(page)
        report.check(name + ': ordinary writer can commit next operation without recovery bypass',success['ok'] and current['idb']['main']['meta']['businessSnapshotRevision']['sequence']==5 and any(x['name']=='SYN-K24-ORDINARY-RETRY' for x in current['idb']['main']['customers']),success)
        report.check(name + ': normal writer test leaves all other business collections unchanged',all(current['idb']['main'][key]==before['idb']['main'][key] for key in before['idb']['main'] if key not in ('meta','customers','audit')))
        report.save(name+'.json',dict(before=before,failed=failed,afterRollback=after,afterNextCommit=current))
        report.result['cases'].append(dict(name=name,kind='ordinary-writer-regression',passed=True))
    finally:context.close()


def post_commit_gate_failure(playwright,launch,server,report,source,profile):
    name='committed-recovery-gate-clear-failure-resume'
    print_run(name)
    context,page=new_persistent(playwright,launch,profile,server,report,name)
    owner=source['idb'][J]['operationId']
    try:
        seed(page,server,source,report,name)
        page.evaluate("owner => localStorage.setItem('KuSheERP25_STORE_RECOVERY_REQUIRED',JSON.stringify({operationId:owner,status:'RECOVERY_REQUIRED'}))",owner)
        approved=preview(page,report,name+'-before',source)['result']
        page.evaluate('''() => {
          const original=Storage.prototype.removeItem;window.__k24RemoveFaults=0;
          window.__k24RestoreRemove=()=>{Storage.prototype.removeItem=original};
          Storage.prototype.removeItem=function(key){
            if(this===localStorage&&key==='KuSheERP25_STORE_RECOVERY_REQUIRED'){
              Storage.prototype.removeItem=original;window.__k24RemoveFaults++;
              throw Object.assign(new Error('SYN-K24-GATE-CLEAR-FAILURE'),{code:'SYN_K24_GATE_CLEAR_FAILURE'});
            }
            return original.call(this,key);
          };
        }''')
        try:failed=k.call(page,'recoverStore',k.confirmation(approved))
        finally:page.evaluate('() => window.__k24RestoreRemove()')
        observed=k.raw(page);journal=observed['idb'][J]
        report.check(name+': final gate-clear fault reproduced after commit',page.evaluate('() => __k24RemoveFaults')==1 and not failed['ok'] and failed['error']['code']=='SYN_K24_GATE_CLEAR_FAILURE' and failed['error']['transactionStatus']=='RECOVERY_REQUIRED',failed)
        report.check(name+': completed revision4 and original recovery evidence remain',journal['phase']=='COMMIT_VERIFIED' and observed['idb']['main']['meta']['businessSnapshotRevision']['sequence']==4 and journal['recoveryOf']==owner and journal['recoveryEvidence']==source['idb'][J])
        report.check(name+': original durable and local gates survive failed clearing',observed['idb'][G]['operationId']==owner and json.loads(observed['local'][G])['operationId']==owner)
        report.check(name+': unverified gate state is never published',page.evaluate('() => KuSheERPStore.getState()') is None)
        refused=k.call(page,'load')
        report.check(name+': public normal load remains blocked despite committed primary',not refused['ok'] and refused['error']['code']=='STORE_WRITES_BLOCKED' and page.evaluate('() => KuSheERPStore.getState()') is None and k.raw(page)==observed,refused)
        report.save(name+'-after-fault.json',dict(failed=failed,observation=observed,loadRefusal=refused))
    finally:context.close()
    context,page=new_persistent(playwright,launch,profile,server,report,name+'-reopen')
    try:
        report.check(name+': committed but gated evidence survives reopen',k.raw(page)==observed)
        k.load_store(page,server)
        before=k.raw(page);fresh=k.call(page,'recoveryPreview')
        report.check(name+': fresh readonly preview offers resume of verified recovery',fresh['ok'] and fresh['result']['allowed'] is True and fresh['result']['candidate']=='resume-verified-recovery' and fresh['result']['operationId']==owner and k.raw(page)==before,fresh)
        report.check(name+': preview keeps business state unpublished',page.evaluate('() => KuSheERPStore.getState()') is None)
        success=k.call(page,'recoverStore',k.confirmation(fresh['result']))
        after=k.raw(page)
        report.check(name+': explicit resume completes successfully',success['ok'] and success['result']['status']=='COMMITTED',success)
        report.check(name+': resume makes no additional revision audit or journal commit',after['idb']['main']==observed['idb']['main'] and after['idb'][J]==observed['idb'][J] and all(after['local'][key]==observed['local'][key] for key in MIRRORS))
        report.check(name+': resume clears only owned recovery gates',all(after[place][key] is None for place in ('idb','local','session') for key in (G,RG)))
        loaded=k.call(page,'load');report.check(name+': successful resume publishes exactly verified content',loaded['ok'] and loaded['result']==observed['idb']['main'] and page.evaluate('() => KuSheERPStore.getState()')==observed['idb']['main'] and k.raw(page)==after)
        report.save(name+'-after-resume.json',after)
        report.result['cases'].append(dict(name=name,kind='post-commit-gate-resume',passed=True,recoveryRevision=after['idb']['main']['meta']['businessSnapshotRevision']))
    finally:context.close()


def replace_captured_observation(page,observation):
    page.evaluate('''async observed => {
      if(location.hostname!=='127.0.0.1'||observed.idb?.main?.meta?.k21Synthetic!==true)throw Error('SYNTHETIC_ONLY');
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readwrite'),table=tx.objectStore('erp');for(const [key,value] of Object.entries(observed.idb)){if(value===null)table.delete(key);else table.put(value,key)}tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
      for(const [place,values] of [[localStorage,observed.local],[sessionStorage,observed.session]])for(const [key,value] of Object.entries(values)){if(value===null)place.removeItem(key);else place.setItem(key,value)}
    }''',observation)


def nested_chain_guards(browser,server,report,source):
    # This current-run observation was produced by a real one-shot failure above.
    failed=json.loads((report.output/'fault-retry-case-1-mirror-1-attempt-1-failed-attempt.json').read_text())['after']
    for kind in ('root-owner','prior-checkpoint-revision','depth-preflight'):
        name='nested-chain-'+kind
        print_run(name)
        context=browser.new_context(service_workers='block');k.restrict(context,server,report,name)
        try:
            page=k.open_page(context,server);seed(page,server,source,report,name)
            value=copy.deepcopy(failed)
            if kind=='root-owner':
                value['idb'][J]['recoveryEvidence']['operationId']='SYN-K24-FOREIGN-ROOT'
            elif kind=='prior-checkpoint-revision':
                value['idb'][J]['recoveryEvidence']['before']['businessSnapshotRevision']['id']='SYN-K24-MISMATCHED-CHECKPOINT-REVISION'
            else:
                # A structural depth fixture repeats the verified attempt wrapper.
                # It is a parser/preflight boundary test, not seven actual failures.
                node=copy.deepcopy(source['idb'][J])
                for _ in range(7):
                    wrapper=copy.deepcopy(failed['idb'][J]);wrapper['recoveryEvidence']=node;node=wrapper
                value['idb'][J]=node
                replace_captured_observation(page,value)
                control=preview(page,report,name+'-depth7-control',source)
                report.check(name+': depth7 remains a readonly original-checkpoint candidate',control['result']['allowed'] is True and origin_journal(value['idb'][J])[1]==7)
                wrapper=copy.deepcopy(failed['idb'][J]);wrapper['recoveryEvidence']=value['idb'][J]
                value['idb'][J]=wrapper
            replace_captured_observation(page,value)
            report.check(name+': exact structural fault observation installed',k.raw(page)==value)
            refused=preview(page,report,name,source,expected=False)
            if kind=='depth-preflight':
                report.check(name+': depth8 refuses before any ninth journal link',origin_journal(k.raw(page)['idb'][J])[1]==8 and '上限' in refused['result']['reason'] and k.raw(page)==value,refused)
            elif kind=='root-owner':
                report.check(name+': unknown root rejected for ownership', '操作歸屬' in refused['result']['reason'],refused)
            else:
                report.check(name+': nested revision mismatch rejected', '版本與內容' in refused['result']['reason'],refused)
            report.save(name+'.json',dict(result=refused,observation=k.raw(page),syntheticStructuralFixture=True))
            report.result['cases'].append(dict(name=name,kind='nested-chain-guard',passed=True,structuralFixture=True))
        finally:context.close()


def negative_regressions(browser,server,report,source):
    k.negative_case(browser,server,report,'stale-preview-token',source,mutate_after_preview="() => localStorage.setItem('KuSheERP25_RECEIPT_COMMIT_VERSION','SYN-K24-UNRELATED-REVISION')",expected_error='RECOVERY_PREVIEW_STALE')
    k.negative_case(browser,server,report,'principal-changed-after-preview',source,mutate_after_preview="() => {window.__k23Principal='SYN-K24-OTHER-OWNER'}",expected_error='RECOVERY_PRINCIPAL_CHANGED')
    k.negative_case(browser,server,report,'foreign-recovery-marker',source,mutate_seed="() => localStorage.setItem('KuSheERP25_STORE_RECOVERY_REQUIRED',JSON.stringify({operationId:'SYN-K24-FOREIGN-OPERATION'}))")
    k.negative_case(browser,server,report,'unknown-emergency-version',source,mutate_seed="() => {const value=JSON.parse(localStorage.getItem('KuSheERP25_EMERGENCY'));value.customers.push({id:'SYN-K24-UNKNOWN',name:'SYN-K24-UNKNOWN'});localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(value))}")
    k.negative_case(browser,server,report,'unknown-commit-token',source,mutate_seed="() => {const value=JSON.parse(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN'));value.revisionId='SYN-K24-UNKNOWN';localStorage.setItem('KuSheERP25_LOCAL_COMMIT_TOKEN',JSON.stringify(value))}")
    k.negative_case(browser,server,report,'unresolved-receipt-active-marker',source,mutate_seed="() => localStorage.setItem('KuSheERP25_RECEIPT_TRANSACTION_ACTIVE',JSON.stringify({operationId:'SYN-K24-UNRESOLVED-RECEIPT'}))")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline-store',type=Path,required=True)
    parser.add_argument('--candidate-store',type=Path,required=True)
    parser.add_argument('--candidate-sha256',required=True)
    parser.add_argument('--evidence',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--executable',default=None)
    args=parser.parse_args()
    report=k.Report(args.output.resolve())
    report.result.update(schema='k24-isolated-recovery-retry-browser-v1',scope='Pinned baseline defect reproduction; candidate controlled recovery fault rollback and explicit retry on synthetic fixtures',platform=platform.platform(),baselineStatus='NOT_RUN',candidateSha256=args.candidate_sha256)
    source_files={}
    try:
        harness=Path(k.__file__).read_bytes();report.check('unchanged K23 baseline harness source',k.sha256(harness)==K23_HARNESS_SHA256)
        baseline=args.baseline_store.read_bytes();candidate=args.candidate_store.read_bytes()
        source_files[args.baseline_store]=k.sha256(baseline);source_files[args.candidate_store]=k.sha256(candidate)
        report.check('pinned original Store source verified',k.sha256(baseline)==k.EXPECTED_STORE_SHA256 and k.git_blob(baseline)==k.EXPECTED_STORE_BLOB)
        report.check('reviewed candidate source bytes verified',k.sha256(candidate)==args.candidate_sha256 and candidate!=baseline)
        snapshots={}
        for name in k.CASES:
            path=args.evidence/name/'evidence'/k.RAW_FILE
            content=path.read_bytes();source_files[path]=k.sha256(content)
            report.check(name+': original fixture bytes verified',k.sha256(content)==k.SOURCE_HASHES[name])
            snapshots[name]=json.loads(content.decode('utf-8-sig'))
        legacy_path=Path(__file__).with_name('legacy_fault_observation.json')
        legacy_bytes=legacy_path.read_bytes();source_files[legacy_path]=k.sha256(legacy_bytes)
        report.check('K23 actual legacy failed observation fixture verified',k.sha256(legacy_bytes)==LEGACY_FIXTURE_SHA256)
        legacy=json.loads(legacy_bytes)['afterFaultObservation']
        executable=args.executable or shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium') or shutil.which('chrome')
        if not executable and os.name=='nt':
            for root in (os.environ.get('ProgramFiles',''),os.environ.get('ProgramFiles(x86)','')):
                p=Path(root)/'Google/Chrome/Application/chrome.exe'
                if p.is_file():executable=str(p);break
        launch=dict(headless=True,service_workers='block')
        if executable:launch['executable_path']=executable
        browser_launch={x:v for x,v in launch.items() if x!='service_workers'}
        with tempfile.TemporaryDirectory(prefix='K24_SYNTHETIC_RETRY_') as temp,sync_playwright() as playwright:
            temp=Path(temp)
            # Preserve the failing baseline result before testing the fix.
            with k.LocalServer(baseline) as server:
                browser=playwright.chromium.launch(**browser_launch)
                try:
                    k.recovery_write_fault_diagnostic(browser,server,report,snapshots[k.CASES[0]])
                    observed=report.result['diagnostics'][-1]
                    report.check('baseline reproduces retry blocked and missing original checkpoint',observed['status']=='RECOVERY_RETRY_BLOCKED' and observed['originalCheckpointStillInActiveJournal'] is False and observed['activeJournalPhase']=='ROLLED_BACK')
                    report.result['baselineStatus']='DEFECT_REPRODUCED_RETRY_BLOCKED'
                finally:browser.close()
            with k.LocalServer(candidate) as server:
                report.result['candidateOrigin']=server.origin
                for name,source in snapshots.items():
                    print_run('normal-'+name)
                    k.positive(playwright,launch,server,report,'normal-'+name,source,temp/('normal-'+name))
                browser=playwright.chromium.launch(**browser_launch)
                report.result['browserVersion']=browser.version
                try:
                    sample=snapshots[k.CASES[0]]
                    negative_regressions(browser,server,report,sample)
                    for i,(scenario,source) in enumerate(snapshots.items()):
                        for t,target in enumerate(MIRRORS):
                            name=f'fault-retry-case-{i+1}-mirror-{t+1}'
                            fault_retry_case(playwright,launch,server,report,name,source,temp/name,[target],reopen_after=i==t)
                    fault_retry_case(playwright,launch,server,report,'two-failures-then-retry',sample,temp/'twice',[E,S],reopen_after=True)
                    fault_retry_case(playwright,launch,server,report,'rollback-primary-failure-then-retry',sample,temp/'rollback-failed',[E],rollback_primary_fault=True)
                    for kind in ('stale-observation','foreign-marker'):refused_after_failure(browser,server,report,sample,kind)
                    legacy_compact_refusal(browser,server,report,sample,legacy)
                    ordinary_rollback(browser,server,report,sample)
                    post_commit_gate_failure(playwright,launch,server,report,sample,temp/'post-commit-gate')
                    nested_chain_guards(browser,server,report,sample)
                finally:browser.close()
        report.check('all expected candidate case groups completed',len(report.result['cases'])==28,{'cases':len(report.result['cases'])})
        report.check('all original input and source bytes remain unchanged',all(k.sha256(p.read_bytes())==digest for p,digest in source_files.items()))
        report.check('no page requests outside two own loopback resources',report.result['externalRequests']==[],report.result['externalRequests'])
        report.check('no unhandled page errors',report.result['pageErrors']==[],report.result['pageErrors'])
        report.result['status']='K24_CANDIDATE_RECOVERY_RETRY_VERIFIED__PUBLISH_BLOCKED'
    except Exception as error:
        report.result['status']='BLOCKED'
        report.result['failures'].append(dict(type=type(error).__name__,message=str(error),traceback=traceback.format_exc()))
        raise
    finally:
        report.result['sourceFilesUnchanged']=all(k.sha256(p.read_bytes())==digest for p,digest in source_files.items())
        report.result['sourceFileSha256']={str(p):digest for p,digest in source_files.items()}
        report.flush()
        print(report.result['status'],'PASS',report.result['passCount'],'FAIL',report.result['failCount'],flush=True)


if __name__=='__main__':main()
