(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>'$'+v.toLocaleString('zh-TW',{maximumFractionDigits:0}),decimal=v=>v.toLocaleString('zh-TW',{maximumFractionDigits:4}),paper=document.getElementById('paper');
  function validate(payload){
    const d=payload?.document,unified=d?.schema==='kushe-external-billing-group-v2';
    if(payload?.schema!=='kushe-external-billing-print-v1'||!['kushe-external-billing-group-v1','kushe-external-billing-group-v2'].includes(d?.schema)||!['active','archived'].includes(d.status)||!Array.isArray(d.sourceSnapshots)||!Array.isArray(d.settlementSnapshots)||d.sourceSnapshots.length<2||d.sourceSnapshots.length>30||d.settlementSnapshots.length!==d.sourceSnapshots.length||d.status==='archived'&&!payload.historical)throw new Error('文件尚未確認或資料格式不完整');
    if(unified?(d.detailMode!=='unified'||d.sections!==undefined):(!Array.isArray(d.sections)||d.sections.length!==d.sourceSnapshots.length||d.unified!==undefined))throw new Error('對外明細模式不一致');
    const keys=['untaxed','tax','grossTotal','retention','receivable','received','outstanding','retentionReceived','retentionOutstanding','pendingCheque','availableToCollect'],sums=Object.fromEntries(keys.map(k=>[k,0])),ids=new Set();let count=0;
    function lineTotal(lines){
      if(!Array.isArray(lines)||!lines.length||lines.length>300)throw new Error('對外明細未完成');
      return lines.reduce((sum,l)=>{
        count++;if(!l||typeof l.item!=='string'||!l.item.trim()||l.item.length>200||typeof l.unit!=='string'||!l.unit.trim()||l.unit.length>20||!Number.isFinite(l.qty)||l.qty<=0||l.qty>1e10||!Number.isFinite(l.price)||l.price<0||l.price>1e10||Math.abs(l.qty*10000-Math.round(l.qty*10000))>0.001||Math.abs(l.price*10000-Math.round(l.price*10000))>0.001||!Number.isSafeInteger(l.amount)||Math.round(l.qty*l.price)!==l.amount)throw new Error('對外品項金額無法核對');
        if(!Number.isSafeInteger(sum+l.amount))throw new Error('對外合計超過安全範圍');return sum+l.amount;
      },0);
    }
    d.sourceSnapshots.forEach(source=>{
      if(!source.billingId||ids.has(source.billingId))throw new Error('原單重複');ids.add(source.billingId);
      const a=source.anchors,settlements=d.settlementSnapshots.filter(p=>p.billingId===source.billingId),p=settlements[0];
      if(!a||settlements.length!==1)throw new Error('收款快照無法對應原單');
      keys.forEach(k=>{const v=a[k]??p[k];if(!Number.isSafeInteger(v)||v<0)throw new Error('原帳款金額無法核對');sums[k]+=v});
      if(a.untaxed+a.tax!==a.grossTotal||a.grossTotal-a.retention!==a.receivable||p.received+p.outstanding!==a.receivable||p.retentionReceived+p.retentionOutstanding!==a.retention||p.availableToCollect+p.pendingCheque!==p.outstanding)throw new Error('原帳款與收款合計不一致');
      if(!unified){
        const sections=d.sections.filter(s=>s.billingId===source.billingId);if(sections.length!==1)throw new Error('明細無法對應原單');
        const s=sections[0];if(!['未稅','含稅'].includes(s.taxMode))throw new Error('對外單價方式待核對');
        if(lineTotal(s.lines)!==(s.taxMode==='未稅'?a.untaxed:a.grossTotal))throw new Error('對外品項與原單金額不同');
      }
    });
    if(unified){
      const u=d.unified;if(!u||!['未稅','含稅'].includes(u.taxMode))throw new Error('整份對外單價方式待核對');
      const target=u.taxMode==='未稅'?sums.untaxed:sums.grossTotal,total=lineTotal(u.lines);
      if(total!==target||u.total!==total||u.target!==target)throw new Error('整份對外明細與 A＋B 原帳款合計不同');
      if(typeof u.reason!=='string'||u.reason.length>1000)throw new Error('合併編排說明格式錯誤');
      const shape=l=>({house:l.house||'',item:l.item,unit:l.unit,qty:l.qty,price:l.price});
      const same=d.sourceSnapshots.every(s=>s.taxMode===u.taxMode)&&JSON.stringify(d.sourceSnapshots.flatMap(s=>s.originalLines.map(shape)))===JSON.stringify(u.lines.map(shape));
      if(!same&&!u.reason.trim())throw new Error('重新編排的對外明細缺少核對說明');
    }
    if(count>300||!d.totals||keys.some(k=>!Number.isSafeInteger(sums[k])||sums[k]!==d.totals[k]))throw new Error('總額與原單加總不同');
    if(!Array.isArray(d.sourceIds)||d.sourceIds.length!==ids.size||new Set(d.sourceIds).size!==ids.size||d.sourceIds.some(id=>!ids.has(id))||!d.sourceSnapshots.some(s=>s.billingId===d.targetBillingId&&s.projectName===d.displayProjectName)||new Set(d.sourceSnapshots.map(s=>s.customerId)).size!==1)throw new Error('客戶／對外案場來源不一致');
    return d;
  }
  // P31-4: adapt validated document data to the existing single-billing renderer.
  // No independent public layout, no tax recomputation, no Store/database access.
  function originalTemplateView(payload,d){
    const template=payload.template;
    if(template&&(template.schema!=='kushe-original-billing-template-v1'||template.billingId!==d.targetBillingId))throw new Error('所選案場與原請款模板不一致，請重新開啟 PDF');
    const unified=d.schema==='kushe-external-billing-group-v2',modes=unified?[d.unified.taxMode]:[...new Set(d.sections.map(section=>section.taxMode))];
    if(modes.length!==1)throw new Error('此舊版文件使用不同單價稅別，請在對外明細修訂為統一單價方式後再匯出；不會自動換算或修改原單');
    const taxMode=modes[0],t=d.totals;
    const raw=unified?d.unified.lines:d.sections.flatMap(section=>section.lines);
    const lines=raw.map(l=>({house:String(l.house||''),item:l.item,unit:l.unit,qty:l.qty,price:l.price,amount:l.amount,pricingType:'',sourcePricingType:template?.historicalDetails?'historical-supplement':'external-document'}));
    const company={name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路 62 號',line:'eing0519'};
    if(template?.company){for(const key of ['name','englishName','taxId','address','phone','line'])if(typeof template.company[key]==='string')company[key]=template.company[key];}
    const publicNote=String(d.note||template?.publicNote||'');
    // invoiceStatus is a print-only switch for the existing template's tax rows.
    // Individual invoice numbers/statuses/amounts stay exclusively in the originals.
    const invoiceStatus=t.tax===0&&d.sourceSnapshots.every(s=>s.invoiceStatus==='no_invoice')?'no_invoice':'invoice_pending';
    const fileName=('酷舍_請款單_'+d.displayProjectName+'_'+String(d.documentDate).slice(0,7)).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.pdf';
    return {schema:'kushe-external-document-v1',documentType:'billing',title:'請款單',number:'',customer:d.customerName,project:d.displayProjectName,date:d.documentDate,taxMode,pricingMode:'',invoiceStatus,lines,salesAmount:t.untaxed,taxAmount:t.tax,totalAmount:t.grossTotal,retentionAmount:t.retention,receivableAmount:t.receivable,publicNote,company,fileName};
  }
  document.getElementById('close').onclick=()=>window.close();
  try{
    const payload=JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(location.hash.slice(1)))))),d=validate(payload),t=d.totals;
    if(!payload.historical){
      const view=originalTemplateView(payload,d),url=new URL('billing-print.html?v=p31-4-original-template-1&print=0',location.href);
      url.hash=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(view)))));
      if(url.href.length>1500000)throw new Error('對外文件內容過大，請核對明細後再匯出');
      location.replace(url.href);return;
    }
    // Explicit historical-version viewing preserves its prior, reference-only output.

    const invoices=d.sourceSnapshots.map(s=>'<tr><td>'+esc(s.invoiceNo|| (s.invoiceStatus==='no_invoice'?'免開發票':'待開發票'))+'</td><td>'+money(s.anchors.grossTotal)+'</td></tr>').join('');
    const lines=d.schema==='kushe-external-billing-group-v2'?d.unified.lines.map(l=>({...l,taxMode:d.unified.taxMode})):d.sections.flatMap(section=>section.lines.map(l=>({...l,taxMode:section.taxMode})));
    const totals=[['未稅合計',t.untaxed],['原發票稅額合計',t.tax],['請款總額（含稅）',t.grossTotal,'primary'],['原保留款合計',t.retention],['本期應收',t.receivable],['已沖銷（含客戶扣款）',t.received],['本期未沖銷',t.outstanding,'primary'],...(t.pendingCheque?[['其中：待兌現預留（含扣款）',t.pendingCheque,'secondary'],['尚待安排收款',t.availableToCollect]]:[])];
    paper.innerHTML='<header class="masthead"><div class="company"><h1>酷舍企業有限公司</h1><p>Cool Sir Limited Company</p><p>統編 82980636<br>台中市豐原區瑞興路 62 號 · LINE：eing0519</p></div><div class="doc-title"><img src="assets/img/kushe-logo.png" alt="酷舍企業"><h2>請款單</h2><p class="note">合併請款明細</p></div></header>'+(payload.historical?'<div class="historic">保存版本・僅供查閱，非本次付款通知</div>':'')+'<section class="meta"><div class="wide"><span>工程案場</span><strong>'+esc(d.displayProjectName)+'</strong></div><div><span>請款對象</span>'+esc(d.customerName)+'</div><div><span>文件日期</span>'+esc(d.documentDate)+'</div></section><table class="detail"><colgroup><col style="width:13%"><col style="width:34%"><col style="width:7%"><col style="width:10%"><col style="width:13%"><col style="width:8%"><col style="width:15%"></colgroup><thead><tr><th>戶別／位置</th><th>施工品項</th><th>單位</th><th>數量</th><th>單價</th><th>單價方式</th><th>小計</th></tr></thead><tbody>'+lines.map(l=>'<tr><td>'+esc(l.house||'—')+'</td><td>'+esc(l.item)+'</td><td class="center">'+esc(l.unit)+'</td><td class="num">'+decimal(l.qty)+'</td><td class="num">$'+decimal(l.price)+'</td><td class="center">'+esc(l.taxMode)+'</td><td class="num">'+money(l.amount)+'</td></tr>').join('')+'</tbody></table><section class="bottom"><div class="invoices"><h3>對應原發票（各自金額不變）</h3><table class="invoice-table"><thead><tr><th>發票號碼／狀態</th><th>原含稅金額</th></tr></thead><tbody>'+invoices+'</tbody></table>'+(d.note?'<p class="note"><b>備註</b><br>'+esc(d.note)+'</p>':'')+'</div><div class="summary">'+totals.map(([label,value,cls])=>'<div class="'+(cls||'')+'"><span>'+label+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div></section><p class="footer-note">本文件彙整原請款資料，不另增加一筆應收；發票仍以各原票號及金額為準。<br>金額核對時間：'+esc(d.updatedAt)+'｜保存版本：'+d.revision+'。已沖銷不等於銀行實收；待兌現預留（含待確認客戶扣款）包含在本期未沖銷中，不另加計。'+(t.retentionOutstanding>0?'<br>另有保留款待收 '+money(t.retentionOutstanding)+'，依原約定另行處理。':'')+'</p><div class="signature"><span>承辦人簽章</span><span>核對／收件簽章</span></div>';
    document.title=('酷舍_合併請款_'+d.displayProjectName+'_'+d.documentDate+'_v'+d.revision).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
    const button=document.getElementById('print');button.disabled=false;button.onclick=()=>window.print();
  }catch(error){paper.classList.add('empty');paper.innerHTML='<p class="error">無法匯出：'+esc(error.message)+'。請返回文件重新核對；不會讀寫帳務資料。</p>';}
}());
