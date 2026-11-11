(function () {
  'use strict';
  // P39-3 standalone synthetic demonstration. Never import KuSheERPStore or CloudSync.
  const core=window.KusheP393CandidateCore;
  const $=id=>document.getElementById(id);
  let synthetic=null;
  let events=[];
  const fmt=n=>'NT$ '+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
  function fixture(status) {
    const invoiced=status==='invoiced',noInvoice=status==='no_invoice',tax=noInvoice?0:5000;
    const gross=100000+tax,retention=5000,invoiceNo=invoiced?'SYN-INV-0001':'';
    return {
      __p39Synthetic:core.FIXTURE,meta:{p39SyntheticSchema:core.FIXTURE,revision:1},
      billings:[{id:'SYN-B1',number:'SYN-B20261111-001',receivableId:'SYN-AR1',
        invoiceStatus:status,invoiceNo,note:'原虛構備註',
        preTaxAmount:100000,taxAmount:tax,grossTotal:gross,retentionAmount:retention,
        total:gross-retention,retentionBase:'preTax',retentionRate:5}],
      receivables:[{id:'SYN-AR1',billingId:'SYN-B1',sourceNo:'SYN-B20261111-001',
        invoiceNo,amount:gross-retention,retentionAmount:retention,grossTotal:gross,
        untaxedAmount:100000,taxAmount:tax,received:0,retentionReceived:0,
        legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]}],
      invoices:noInvoice?[]:[{id:'SYN-I1',billingId:'SYN-B1',sourceType:'billing',
        sourceId:'SYN-B1',status:invoiced?'issued':'pending',
        number:invoiceNo,netAmount:100000,taxAmount:tax,grossAmount:gross}],
      receipts:[],retentionReceipts:[],bankTransactions:[],commissions:[{id:'SYN-C1',amount:25000}],
      payroll:[{id:'SYN-P1',amount:25000}],salaryPayments:[],customerDeductions:[],
      externalBillingDocuments:[],billingNoteRevisions:[],billingAllowances:[]
    };
  }
  function showTotals(id,values,note) {
    const entries=[
      ['未稅',values.untaxed],['營業稅',values.tax],['含稅總額',values.gross],
      ['保留款',values.retention],['本期應收',values.receivable]
    ];
    const panel=$(id);panel.replaceChildren();
    entries.forEach(pair=>{
      const dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=pair[0];dd.textContent=fmt(pair[1]);panel.append(dt,dd);
    });
    if(note!==undefined){
      const dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent='對外備註';dd.textContent=note;panel.append(dt,dd);
    }
  }
  function redraw(message,error) {
    const current=core.effective(synthetic,'SYN-B1');
    showTotals('original',current.original,synthetic.billings[0].note);
    showTotals('effective',current.effective,undefined);
    $('message').textContent=message||'這裡只顯示虛構試算，不代表正式入帳';
    $('message').classList.toggle('error',!!error);
    $('audit').textContent='虛構版本 '+synthetic.meta.revision+'・備註修訂 '+
      synthetic.billingNoteRevisions.length+' 筆・議價折讓 '+synthetic.billingAllowances.length+
      ' 筆・正式銀行寫入 0 筆・雲端寫入 0 筆';
  }
  function reset() {
    synthetic=fixture($('invoiceStatus').value);events=[];
    $('voucherRow').hidden=$('invoiceStatus').value!=='invoiced';
    $('allowanceForm').elements.gross.value=$('invoiceStatus').value==='no_invoice'?'90000':'94500';
    redraw('已重新建立虛構資料（只在記憶體，不寫入任何 ERP）。');
  }
  function handle(fn) {
    try {fn();} catch (error) {
      redraw((error.code||'ERROR')+'｜'+(error.message||String(error)),true);
    }
  }
  function allowanceInput() {
    const form=$('allowanceForm'),status=$('invoiceStatus').value;
    return {billingId:'SYN-B1',role:'owner',
      approvedGross:Number(form.elements.gross.value),reason:form.elements.reason.value,
      ...(status==='invoiced'?{voucher:{
        type:'electronic',number:form.elements.voucher.value,date:'2026-11-11',
        synthetic:true,issued:true,testVerified:true}}:{})};
  }
  $('invoiceStatus').addEventListener('change',reset);
  $('reset').addEventListener('click',reset);
  $('noteForm').addEventListener('submit',e=>{e.preventDefault();handle(()=>{
    const form=$('noteForm');
    const plan=core.notePlan(synthetic,{billingId:'SYN-B1',role:'owner',
      note:form.elements.note.value.trim(),reason:form.elements.reason.value.trim()});
    synthetic=core.apply(synthetic,plan).state;
    redraw('已建立虛構備註修訂；原始金額、薪資、銀行、發票不變。');
  })});
  $('preview').addEventListener('click',()=>handle(()=>{
    const plan=core.allowancePlan(synthetic,allowanceInput());
    redraw('隔離預覽｜擬折讓 '+fmt(plan.discount.gross)+'，本期有效應收 '+
      fmt(plan.effective.receivable)+'，保留款 '+fmt(plan.effective.retention)+
      '；未進行任何入帳。');
  }));
  $('allowanceForm').addEventListener('submit',e=>{e.preventDefault();handle(()=>{
    const plan=core.allowancePlan(synthetic,allowanceInput());
    synthetic=core.apply(synthetic,plan).state;
    redraw('已建立虛構折讓交易｜含稅折讓 '+fmt(plan.discount.gross)+
      '，借貸各 '+fmt(plan.credit)+'。正式 ERP 沒有新增資料。');
  })});
  reset();
  // Regression-only introspection for a dedicated synthetic Playwright page.
  window.__p393SyntheticTest=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify(synthetic))});
})();