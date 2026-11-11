/* P39-3D — VIRTUAL CLOUD CONTRACT LAB ONLY.
 * In-memory two-device CAS/idempotency simulator; never opens a network connection
 * and is NOT Supabase, official cloud sync, or a production adapter.
 */
(function(root,factory) {
  'use strict';
  const moduleReady=typeof module==='object'&&module.exports;
  const api=factory(moduleReady?require('./core.js'):root.KusheP393CandidateCore,
    moduleReady?require('./scenario-gate.js'):root.KusheP393ScenarioGate,
    moduleReady?require('./voucher-review.js'):root.KusheP393VoucherReview,
    moduleReady?require('./effective-accounting.js'):root.KusheP393EffectiveAccounting);
  if(moduleReady)module.exports=api;
  else root.KusheP393VirtualCloudLab=api;
})(typeof window==='object'?window:{},function(core,scenarios,reviews,accounting){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function deny(code,message){
    const e=new Error(message);e.code=code;throw e;
  }
  const ensure=state=>{
    if(!state||state.__p39Synthetic!==core?.FIXTURE||
       state.meta?.p39SyntheticSchema!==core?.FIXTURE||
       !Array.isArray(state.billings)||!Array.isArray(state.billingAllowances))
      deny('P39_MOCK_SYNTHETIC_ONLY','隔離同步模擬器只接受合成快照');
  };
  function create(seed){
    ensure(seed);
    let committed=clone(seed),sequence=1,transactions=0,chain=Promise.resolve();
    const accepted=new Map();
    const queue=work=>{
      const r=chain.then(work);
      chain=r.then(()=>undefined,()=>undefined);
      return r;
    };
    const status=()=>({revision:sequence,transactions,
      ledgerRows:committed.billingAllowances.length,
      productionWrites:0,remoteProvider:'MEMORY_ONLY'});
    const connect=deviceId=>{
      if(typeof deviceId!=='string'||!/^(SYN-)[A-Z0-9-]{4,35}$/.test(deviceId))
        deny('P39_MOCK_DEVICE_ID','只接受虛構測試裝置 ID');
      return Object.freeze({
        read:async()=>({revision:sequence,state:clone(committed),
          productionWrites:0,remoteProvider:'MEMORY_ONLY'}),
        commit:async(message)=>queue(async()=>{
          ensure(committed);
          const payload=message||{};
          const id=String(payload.billingId||''),expected=payload.expectedRevision;
          const intent=payload.intent||{};
          const key=String(payload.idempotencyKey||'');
          const evidence=payload.evidence;
          if(!id||!key||!Number.isSafeInteger(expected)||expected<1)
            deny('P39_MOCK_COMMAND_INVALID','請款 ID、操作識別或版本不完整');
          const normalizedIntent=clone({billingId:id,approvedGross:intent.approvedGross,
            reason:intent.reason,role:intent.role||'owner',
            voucher:intent.voucher??null,evidence:evidence??null});
          const intentHash=JSON.stringify(normalizedIntent);
          if(accepted.has(key)){
            const prev=accepted.get(key);
            if(prev.intentHash!==intentHash||prev.billingId!==id)
              deny('P39_MOCK_IDEMPOTENCY_CONFLICT','相同操作識別但內容不同');
            return {status:'REPLAYED_IDEMPOTENT',revision:prev.revision,
              ledgerId:prev.ledgerId,productionWrites:0};
          }
          if(expected!==sequence)
            deny('P39_MOCK_STALE_REMOTE','雲端快照已更新，禁止舊裝置覆蓋');
          const scenario=scenarios.inspect(committed,id);
          if(!scenario.candidateEligible)
            deny('P39_MOCK_SCENARIO_BLOCKED','不符合模擬議價情境：'+
              scenario.blockers.map(b=>b.code).join(','));
          const plan=core.allowancePlan(committed,{billingId:id,
            role:normalizedIntent.role,approvedGross:intent.approvedGross,
            reason:intent.reason,voucher:intent.voucher});
          if(key!==plan.idempotencyKey)
            deny('P39_MOCK_IDEMPOTENCY_MISMATCH','操作識別不符合請款來源');
          const review=reviews.inspect(plan,evidence);
          const mutation=core.apply(committed,plan);
          const next=mutation.state,entry=next.billingAllowances.at(-1);
          entry.evidenceReview=clone(review);
          entry.officialVoucherVerified=false;
          entry.productionAuthorized=false;
          const view=accounting.inspect(next,id);
          if(!view.hasAllowance||view.effective.gross!==plan.effective.gross||
             entry.cloudWrites!==0||mutation.productionWrites!==0)
            deny('P39_MOCK_POSTCONDITION_FAILED','擬議分錄無法勾稽');
          if(payload.failBeforeCommit===true)
            deny('P39_MOCK_INJECT_BEFORE','模擬提交前斷線，狀態不變');
          // Single in-memory atomic publish. No DB writes and no cloud API.
          committed=clone(next);sequence++;transactions++;
          const recorded={intentHash,billingId:id,ledgerId:entry.id,revision:sequence};
          accepted.set(key,recorded);
          if(payload.failAfterCommit===true)
            deny('P39_MOCK_ACK_LOST','模擬已提交但回應遺失，重試必須沿用相同識別碼');
          return {status:'COMMITTED_IN_MEMORY_ONLY',revision:sequence,
            ledgerId:entry.id,productionWrites:0};
        })
      });
    };
    return Object.freeze({connect,status});
  }
  return Object.freeze({create});
});