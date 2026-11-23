'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const router=require('../assets/js/p41-38-entry-candidate.js');
function fixture(){
  const state={billings:[{id:'FAKE-B1'},{id:'FAKE-B2'},{id:'FAKE-B3'}],meta:{externalBillingDocuments:[]}},calls=[];
  const apis={store:{getState:()=>state},groups:{activeFor:()=>null},
    singlePreview:{open:id=>{calls.push('single:'+id);return {readOnly:true,canPost:false}}},
    groupPreview:{open:id=>{calls.push('group:'+id);return {readOnly:true,canPost:false}}}};
  function group(ids=['FAKE-B1','FAKE-B2']){
    const saved={id:'FAKE-G1',status:'active',sourceIds:[...ids]};
    state.meta.externalBillingDocuments=[saved];
    const g={document:{id:saved.id,sourceIds:[...ids]},canGroup:true,issues:[],termsChanged:false};
    apis.groups.activeFor=x=>ids.includes(x)?g:null;
    return g;
  }
  return {state,calls,apis,group};
}
test('01 router is immutable and single preview cannot post',()=>{
  const c=fixture();assert.ok(Object.isFrozen(router));
  const result=router.open('FAKE-B1',c.apis);
  assert.equal(result.canPost,false);assert.equal(result.readOnly,true);
  assert.deepEqual(c.calls,['single:FAKE-B1']);
});
test('02 group member routes to whole document once',()=>{
  const c=fixture();c.group();assert.equal(router.open('FAKE-B2',c.apis).documentId,'FAKE-G1');
  assert.deepEqual(c.calls,['group:FAKE-G1']);
});
test('03 group button verifies full membership',()=>{
  const c=fixture();const g=c.group();router.openGroup(g,c.apis);
  assert.deepEqual(c.calls,['group:FAKE-G1']);
});
test('04 caller with missing member is blocked',()=>{
  const c=fixture();c.group();
  assert.throws(()=>router.openGroup({document:{id:'FAKE-G1',sourceIds:['FAKE-B1']}},c.apis));
  assert.deepEqual(c.calls,[]);
});
test('05 forged group source is blocked',()=>{
  const c=fixture();c.group();
  assert.throws(()=>router.openGroup({document:{id:'FAKE-G1',sourceIds:['FAKE-B1','FAKE-B3']}},c.apis));
  assert.deepEqual(c.calls,[]);
});
test('06 forged group ID is blocked',()=>{
  const c=fixture();c.group();
  assert.throws(()=>router.openGroup({document:{id:'FAKE-G2',sourceIds:['FAKE-B1','FAKE-B2']}},c.apis));
  assert.deepEqual(c.calls,[]);
});
test('07 missing billing source is blocked',()=>{
  const c=fixture();assert.throws(()=>router.open('FAKE-UNKNOWN',c.apis));
  assert.deepEqual(c.calls,[]);
});
test('08 duplicate billing source is blocked',()=>{
  const c=fixture();c.state.billings.push({id:'FAKE-B1'});
  assert.throws(()=>router.open('FAKE-B1',c.apis));
  assert.deepEqual(c.calls,[]);
});
test('09 malformed active group blocks membership',()=>{
  const c=fixture();c.state.meta.externalBillingDocuments=[{id:'BAD',status:'active'}];
  assert.throws(()=>router.open('FAKE-B1',c.apis));
  assert.deepEqual(c.calls,[]);
});
test('10 group index not validated blocks preview',()=>{
  const c=fixture();const g=c.group();g.canGroup=false;
  assert.throws(()=>router.open('FAKE-B1',c.apis));
  assert.deepEqual(c.calls,[]);
});
test('11 unrelated identifiable group does not block single',()=>{
  const c=fixture();c.state.meta.externalBillingDocuments=[{id:'FAKE-OTHER',status:'active',sourceIds:['NOT-HERE','OTHER'],revision:'stale'}];
  assert.equal(router.open('FAKE-B1',c.apis).kind,'single');
});
test('12 preview returning permission to post is rejected',()=>{
  const c=fixture();c.apis.singlePreview.open=()=>({readOnly:true,canPost:true});
  assert.throws(()=>router.open('FAKE-B1',c.apis),/未確認唯讀/);
});
