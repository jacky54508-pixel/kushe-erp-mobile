/* P40-16D: PURE, IN-MEMORY, SYNTHETIC ledger simulation.
 * Not imported by index.html; NEVER writes to browser, Supabase, ERP or GitHub.
 * Ledger revision checks model a future transaction/CAS but are NOT atomic storage.
 * CanPost / canSave are always false: no legally effective allowance is created.
 */
(function(root, factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else if(root)root.KusheP4016LedgerSimulator=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const SCHEMA='kushe-p40-16d-sim-ledger-v1';
  const FIELDS=Object.freeze(['untaxed','tax','grossTotal','retention','receivable']);
  const positive=(x,label,allowZero=true)=>{
    if(typeof x!=='number'||!Number.isSafeInteger(x)||(allowZero?x<0:x<=0))
      throw Error(label+' 必須為安全整數');
    return x;
  };
  const token=(x,label)=>{
    if(typeof x!=='string'||x.trim().length<2||x.length>200)
      throw Error(label+' 缺漏或格式異常');
    return x.trim();
  };
  const snapshot=(a,b)=>{if(token(a,'預期快照')!==token(b,'即時快照'))
    throw Error('帳務／來源快照已變更，停止模擬');return a;};
  function deltas(x,label){
    if(!x||typeof x!=='object'||Array.isArray(x))throw Error(label+' 缺少金額');
    const a=Object.fromEntries(FIELDS.map(k=>[k,positive(x[k],label+'.'+k)]));
    if(a.untaxed+a.tax!==a.grossTotal||a.grossTotal-a.retention!==a.receivable)
      throw Error(label+' 金額不平衡');
    return a;
  }
  const clone=x=>JSON.parse(JSON.stringify(x));
  function validate(ledger){
    if(!ledger||ledger.schema!==SCHEMA||!Number.isSafeInteger(ledger.revision)||
       ledger.revision<0||!Array.isArray(ledger.events)||ledger.events.length>10000)
      throw Error('台帳版本或結構不完整');
    if(ledger.revision!==ledger.events.length)throw Error('模擬台帳修訂序號與事件數不一致');
    const keys=new Set(),ids=new Set(),seen=new Map(),reversed=new Set();
    for(const e of ledger.events){
      if(!e||!['SIMULATED_ALLOWANCE','SIMULATED_REVERSAL'].includes(e.kind))
        throw Error('模擬事件類別不明');
      const id=token(e.eventId,'事件 ID'),key=token(e.operationKey,'操作鍵');
      token(e.documentId,'文件 ID');token(e.basisSnapshot,'來源快照');
      if(ids.has(id)||keys.has(key))throw Error('重複事件 ID 或操作鍵');
      ids.add(id);keys.add(key);
      if(!Number.isSafeInteger(e.revision)||e.revision!==seen.size+1)
        throw Error('模擬事件序號不連續');
      const amounts=deltas(e.deltas,'事件金額');
      if(e.kind==='SIMULATED_ALLOWANCE'){
        if(e.reversesEventId!==null||!Array.isArray(e.sourceDeltas)||
           e.sourceDeltas.length<1||!e.fingerprint)
          throw Error('折讓模擬事件來源不完整');
        const sources=new Set();const sum=Object.fromEntries(FIELDS.map(k=>[k,0]));
        for(const s of e.sourceDeltas){
          const bid=token(s?.billingId,'來源請款 ID');
          if(sources.has(bid))throw Error('來源請款重複');sources.add(bid);
          const a=deltas(s.delta,'分攤');
          for(const k of FIELDS){sum[k]+=a[k];positive(sum[k],'分攤加總');}
        }
        if(FIELDS.some(k=>sum[k]!==amounts[k]))throw Error('折讓事件合計與來源不一致');
      }else{
        if(e.sourceDeltas!==null||!e.reversesEventId||!seen.has(e.reversesEventId))
          throw Error('回沖來源事件不存在或循環引用');
        const parent=seen.get(e.reversesEventId);
        if(parent.kind!=='SIMULATED_ALLOWANCE'||parent.documentId!==e.documentId||
           reversed.has(parent.eventId)||FIELDS.some(k=>parent.deltas[k]!==amounts[k]))
          throw Error('回沖重複、跨文件或金額不一致');
        reversed.add(parent.eventId);
      }
      seen.set(id,e);
    }
    return {keys,ids,seen,reversed};
  }
  function empty(){return Object.freeze({schema:SCHEMA,revision:0,events:Object.freeze([])});}
  function append(ledger,entry){
    const events=clone(ledger.events);
    events.push(clone(entry));
    const next={schema:SCHEMA,revision:ledger.revision+1,events};
    validate(next);
    return {readOnly:true,canPost:false,canSave:false,mutationCount:0,simulated:true,
      simulatedLedger:next,wasDuplicate:false};
  }
  function simulateAllowance({ledger,expectedRevision,plan,reviewInput,operationKey,eventId,
                              expectedSnapshot,observedSnapshot}){
    const info=validate(ledger);
    const sourceVersion=snapshot(expectedSnapshot,observedSnapshot);
    if(!reviewInput||reviewInput.expectedSnapshot!==sourceVersion||
       reviewInput.observedSnapshot!==sourceVersion)
      throw Error('P40-16A 來源快照不一致');
    if(!plan||plan.schema!=='kushe-p40-16c-nonposting-plan-v1'||
       plan.reviewOnly!==true||plan.readyForFurtherReview!==true||
       plan.canPost!==false||plan.canSave!==false||plan.discountGross<=0||
       !Array.isArray(reviewInput.allocations)||
       plan.docId!==reviewInput.documentId||
       plan.approvedGross!==reviewInput.approvedGross)
      throw Error('會計文件核定尚未達到模擬前置要求');
    const key=token(operationKey,'操作唯一鍵'),id=token(eventId,'模擬事件 ID');
    const sourceDeltas=reviewInput.allocations.map(row=>({
      billingId:token(row?.billingId,'原單 ID'),delta:deltas(row?.delta,'原單分攤')
    }));
    if(new Set(sourceDeltas.map(row=>row.billingId)).size!==sourceDeltas.length ||
       sourceDeltas.length!==reviewInput.sources?.length ||
       sourceDeltas.some((row,i)=>row.billingId!==reviewInput.sources[i]?.billingId))
      throw Error('原單分攤或順序與原始請款不一致');
    const sum=Object.fromEntries(FIELDS.map(k=>[k,0]));
    for(const row of sourceDeltas)
      for(const k of FIELDS){sum[k]+=row.delta[k];positive(sum[k],'整張分攤');}
    if(FIELDS.some(k=>sum[k]!==plan.proposedDeltas?.[k])||
       sum.grossTotal!==plan.discountGross)
      throw Error('折讓分攤與已核對會計計畫不一致');
    // Deterministic, noncryptographic input fingerprint. Real DB must enforce this atomically.
    const fingerprint=JSON.stringify({docId:plan.docId,sourceVersion,
      approvedGross:plan.approvedGross,originalGross:plan.originalGross,
      sourceDeltas,sum});
    const replay=ledger.events.find(e=>e.operationKey===key);
    if(replay){
      if(replay.kind!=='SIMULATED_ALLOWANCE'||replay.fingerprint!==fingerprint||
         replay.eventId!==id)throw Error('操作鍵重用但內容不同，停止重送');
      return {readOnly:true,canPost:false,canSave:false,mutationCount:0,simulated:true,
        simulatedLedger:clone(ledger),wasDuplicate:true};
    }
    if(info.ids.has(id))throw Error('事件 ID 已存在');
    positive(expectedRevision,'預期台帳版號');
    if(expectedRevision!==ledger.revision)throw Error('台帳版本不同（CAS 衝突），重新核對');
    if(ledger.events.some(e=>e.documentId===plan.docId))
      throw Error('同一文件已有折讓或回沖事件，必須另行核定');
    const entry={revision:ledger.revision+1,kind:'SIMULATED_ALLOWANCE',eventId:id,operationKey:key,
      documentId:plan.docId,basisSnapshot:sourceVersion,deltas:sum,
      sourceDeltas,reversesEventId:null,fingerprint};
    return append(ledger,entry);
  }
  function simulateReversal({ledger,expectedRevision,operationKey,eventId,
                             reversesEventId,expectedSnapshot,observedSnapshot,reason}){
    const info=validate(ledger),version=snapshot(expectedSnapshot,observedSnapshot);
    const key=token(operationKey,'回沖操作鍵'),id=token(eventId,'回沖事件 ID'),
      ref=token(reversesEventId,'原事件 ID');
    token(reason,'回沖原因');
    const parent=info.seen.get(ref);
    if(!parent||parent.kind!=='SIMULATED_ALLOWANCE')throw Error('未找到可回沖的虛構原事件');
    if(parent.basisSnapshot!==version)
      throw Error('原事件來源快照不同，停止回沖');
    const fingerprint=JSON.stringify({docId:parent.documentId,ref,version,reason:textReason(reason),
      deltas:parent.deltas});
    const replay=ledger.events.find(e=>e.operationKey===key);
    if(replay){
      if(replay.kind!=='SIMULATED_REVERSAL'||replay.fingerprint!==fingerprint||
         replay.eventId!==id)throw Error('回沖操作鍵重送內容不同');
      return {readOnly:true,canPost:false,canSave:false,mutationCount:0,simulated:true,
        simulatedLedger:clone(ledger),wasDuplicate:true};
    }
    if(info.ids.has(id))throw Error('回沖 ID 已存在');
    positive(expectedRevision,'預期台帳版號');
    if(expectedRevision!==ledger.revision)throw Error('台帳版本不同（CAS 衝突）');
    if(info.reversed.has(ref))throw Error('原事件已經回沖，禁止二次回沖');
    const entry={revision:ledger.revision+1,kind:'SIMULATED_REVERSAL',eventId:id,operationKey:key,
      documentId:parent.documentId,basisSnapshot:version,deltas:clone(parent.deltas),
      sourceDeltas:null,reversesEventId:ref,fingerprint};
    return append(ledger,entry);
  }
  const textReason=x=>token(x,'回沖原因',500);
  function projection(ledger,documentId){
    validate(ledger);const doc=token(documentId,'文件 ID');
    const totals=Object.fromEntries(FIELDS.map(k=>[k,0]));
    let events=0,active=0;
    const refs=new Set(ledger.events.filter(e=>e.kind==='SIMULATED_REVERSAL'&&e.documentId===doc)
      .map(e=>e.reversesEventId));
    for(const e of ledger.events.filter(e=>e.documentId===doc)){
      events++;
      const factor=e.kind==='SIMULATED_ALLOWANCE'?1:-1;
      for(const k of FIELDS)totals[k]+=factor*e.deltas[k];
      if(e.kind==='SIMULATED_ALLOWANCE'&&!refs.has(e.eventId))active++;
    }
    if(FIELDS.some(k=>!Number.isSafeInteger(totals[k])||totals[k]<0))
      throw Error('模擬餘額不安全');
    return Object.freeze({readOnly:true,canPost:false,canSave:false,simulationOnly:true,
      documentId:doc,ledgerRevision:ledger.revision,eventCount:events,activeAllowances:active,
      netReductions:Object.freeze(totals)});
  }
  return Object.freeze({SCHEMA,empty,validate,simulateAllowance,simulateReversal,projection});
});
