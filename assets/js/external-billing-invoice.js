/* P39-INV-1: READ-ONLY source-invoice reference projection.
 * Does not post an invoice, allocate an invoice, alter AR or write to Store.
 * A merged external document is not itself a VAT invoice.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KusheExternalBillingInvoice=api;
})(typeof window==='object'?window:{},function(){
  'use strict';
  const SCHEMA='kushe-p39-inv1-source-reference-v1';
  const STATUS=Object.freeze({invoiced:'已開票',invoice_pending:'待開票',
    no_invoice:'免開發票'});
  const string=(v,max=200)=>String(v??'').trim().slice(0,max);
  const currency=(v,key)=>{
    if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)
      throw new Error('原請款金額待核對：'+key);
    return v;
  };
  const date=value=>{
    const s=string(value,40);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
    const t=Date.parse(s+'T00:00:00Z');
    return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:'';
  };
  function project(sources,expectedTotals=null) {
    if(!Array.isArray(sources)||sources.length<2||sources.length>30)
      throw new Error('發票對照須有 2～30 張原始請款');
    const seen=new Set(),seenReceivable=new Set();
    const totals={untaxed:0,tax:0,grossTotal:0,retention:0,receivable:0};
    const rows=sources.map(item=>{
      const s=item?.document||item,a=s?.anchors;
      if(!s||!a||!s.billingId||seen.has(String(s.billingId))||
         !s.receivableId||seenReceivable.has(String(s.receivableId)))
        throw new Error('發票對照來源請款／應收重複或缺漏');
      seen.add(String(s.billingId));seenReceivable.add(String(s.receivableId));
      const raw=Object.fromEntries(Object.keys(totals).map(key=>
        [key,currency(a[key],key)]));
      if(raw.untaxed+raw.tax!==raw.grossTotal||
        raw.grossTotal-raw.retention!==raw.receivable)
        throw new Error('原請款金額與應收、保留款不一致');
      for(const key of Object.keys(totals)){
        totals[key]+=raw[key];
        if(!Number.isSafeInteger(totals[key]))
          throw new Error('發票對照金額超出安全範圍');
      }
      const status=string(s.invoiceStatus,40),number=string(s.invoiceNo,100),
        dateRaw=string(s.invoiceDate,40),issuedAt=date(dateRaw);
      let label=STATUS[status]||'發票狀態待核對';
      const warnings=[];
      if(!STATUS[status])warnings.push('原單的發票狀態未能確認');
      if(status==='invoiced'&&!number)warnings.push('顯示已開票，但沒有原發票號碼');
      if(status==='invoiced'&&!issuedAt)warnings.push('已開票，發票日期未記錄或格式不正確');
      if(status==='no_invoice'&&number)warnings.push('免開發票原單仍有發票號碼，請先核對');
      if(dateRaw&&!issuedAt)warnings.push('發票日期不符合 YYYY-MM-DD 格式');
      const isRecorded=status==='invoiced'&&Boolean(number&&issuedAt);
      if(status==='invoiced'&&!isRecorded)label='已開票・資料待核對';
      return Object.freeze({
        billingId:string(s.billingId,150),receivableId:string(s.receivableId,150),
        billingNo:string(s.number,100),projectName:string(s.projectName,150),
        sourceBillingDate:date(s.date),
        invoiceStatus:status,invoiceLabel:label,invoiceNo:number,
        invoiceDate:issuedAt,invoiceMonth:issuedAt?issuedAt.slice(0,7):'',
        invoiceId:string(s.invoiceId,150),hasRecordedInvoice:isRecorded,
        originalUntaxed:raw.untaxed,originalTax:raw.tax,
        originalGross:raw.grossTotal,originalRetention:raw.retention,
        originalReceivable:raw.receivable,
        warnings:Object.freeze(warnings)
      });
    });
    if(expectedTotals){
      for(const key of Object.keys(totals))
        if(totals[key]!==expectedTotals[key])
          throw new Error('合併請款與各原單發票對照金額不一致：'+key);
    }
    return Object.freeze({
      schema:SCHEMA,sourceCount:rows.length,rows:Object.freeze(rows),
      totals:Object.freeze(totals),
      issued:rows.filter(row=>row.invoiceStatus==='invoiced').length,
      pending:rows.filter(row=>row.invoiceStatus==='invoice_pending').length,
      exempt:rows.filter(row=>row.invoiceStatus==='no_invoice').length,
      warnings:Object.freeze(rows.flatMap(row=>row.warnings.map(w=>row.billingNo+'：'+w))),
      readOnly:true,createdInvoiceRecords:0,createdReceivables:0
    });
  }
  function validateProjection(model){
    if(!model||model.schema!==SCHEMA||model.readOnly!==true||
       !Array.isArray(model.rows)||model.rows.length<2||model.rows.length>30||
       model.sourceCount!==model.rows.length)
      throw new Error('PDF 發票對照資料不完整');
    const ids=new Set(),total={untaxed:0,tax:0,grossTotal:0,retention:0,receivable:0};
    for(const row of model.rows){
      if(!row.billingId||ids.has(row.billingId))throw new Error('PDF 發票來源重複');
      ids.add(row.billingId);
      // Existing historical records may lack a date or even a status; show a
      // clearly flagged incomplete reference instead of fabricating or hiding it.
      if(row.invoiceStatus==='invoiced'&&(!row.invoiceNo||!date(row.invoiceDate))&&
         row.hasRecordedInvoice===true)
        throw new Error('PDF 已開票日期／號碼標記與原資料不一致');
      for(const [dest,src] of Object.entries({
        untaxed:'originalUntaxed',tax:'originalTax',grossTotal:'originalGross',
        retention:'originalRetention',receivable:'originalReceivable'
      })){
        total[dest]+=currency(row[src],src);
        if(!Number.isSafeInteger(total[dest]))throw new Error('PDF 發票加總不安全');
      }
      if(row.originalUntaxed+row.originalTax!==row.originalGross||
         row.originalGross-row.originalRetention!==row.originalReceivable)
        throw new Error('PDF 原請款金額不平衡');
    }
    if(Object.keys(total).some(key=>total[key]!==model.totals?.[key]))
      throw new Error('PDF 發票對照合計與原單不一致');
    return model;
  }
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const money=v=>String.fromCharCode(36)+Number(v).toLocaleString('zh-TW',{maximumFractionDigits:0});
  function printHtml(model){
    validateProjection(model);
    // Document-only presentation: never infer an invoice issuance date from a
    // source billing date or a stale pending-invoice date. No source mutation.
    const invoiceNumber=row=>row.invoiceStatus==='invoiced'?
      (row.invoiceNo||'票號待核對'):row.invoiceStatus==='no_invoice'?
      '免開發票':row.invoiceStatus==='invoice_pending'?'待開票':'狀態待核對';
    const invoiceDate=row=>row.invoiceStatus==='invoiced'?
      (date(row.invoiceDate)||'日期待核對'):row.invoiceStatus==='invoice_pending'?
      '尚未開立':row.invoiceStatus==='no_invoice'?'不適用':'狀態待核對';
    const lines=model.rows.map(row=>
      '<tr><td>'+escapeHtml(row.projectName||'原案場')+
      (row.sourceBillingDate?'<small>原請款日期：'+escapeHtml(row.sourceBillingDate)+'</small>':'')+'</td>'+
      '<td>'+escapeHtml(invoiceNumber(row))+
      (row.warnings.length?'<small>資料待核對</small>':'')+'</td>'+
      '<td>'+escapeHtml(invoiceDate(row))+'</td><td>'+escapeHtml(row.invoiceLabel)+'</td>'+
      '<td class="inv-num">'+money(row.originalUntaxed)+'</td>'+
      '<td class="inv-num">'+money(row.originalTax)+'</td>'+
      '<td class="inv-num">'+money(row.originalGross)+'</td></tr>'
    ).join('');
    return '<section class="section invoice-ref-section">'+
      '<div class="section-title">原請款／發票對照</div>'+
      '<table class="invoice-ref-table">'+
      '<colgroup><col style="width:22%"><col style="width:18%"><col style="width:12%">'+
      '<col style="width:15%"><col style="width:11%"><col style="width:11%"><col style="width:11%"></colgroup>'+
      '<thead><tr><th>原請款案場</th><th>發票號碼</th><th>發票日期</th><th>狀態</th>'+
      '<th>原單未稅</th><th>原單稅額</th><th>原單含稅</th></tr></thead>'+
      '<tbody>'+lines+'</tbody></table>'+
      '<div class="invoice-ref-footer">發票依原單實際開立資料列示；未開票者不列開立日期。</div></section>';
  }
  return Object.freeze({SCHEMA,STATUS,project,validateProjection,printHtml});
});
