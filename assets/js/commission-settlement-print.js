(function(){
  'use strict';
  const number=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0};
  const text=(value)=>String(value??'').trim();
  const safeFile=(value)=>text(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
  const taipeiDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
  function buildView(settlement,state){
    if(!settlement)return null;
    const employeeId=text(settlement.employeeId||settlement.employee),projectId=text(settlement.projectId||settlement.project),bankId=text(settlement.bankAccountId||settlement.bankId);
    const employee=(state?.employees||[]).find((row)=>text(row.id)===employeeId)||{},project=(state?.projects||[]).find((row)=>text(row.id)===projectId)||{},bank=(state?.banks||[]).find((row)=>text(row.id)===bankId)||{};
    const mappedAllocations=(Array.isArray(settlement.allocations)?settlement.allocations:[]).map((row)=>({
      date:text(row.date),
      house:text(row.house)||'未指定戶別',
      untaxedAmount:Math.max(0,number(row.untaxedAmount)),
      amount:Math.max(0,number(row.amount))
    })),allocations=window.KusheDisplaySort?.sortByHouse?window.KusheDisplaySort.sortByHouse(mappedAllocations,(row)=>row.house):mappedAllocations;
    const total=Math.max(0,number(settlement.amount)||allocations.reduce((sum,row)=>sum+row.amount,0));
    return {
      title:'案場抽成結算單',
      companyName:'酷舍企業有限公司',
      employeeName:text(settlement.employeeName||employee.name)||'—',
      projectName:text(settlement.projectName||project.name)||'—',
      settlementDate:text(settlement.date)||'—',
      generatedDate:taipeiDate(),
      allocations,
      total,
      bankName:text(bank.name||bank.bank||bank.account)||'—',
      paymentMethod:text(settlement.paymentMethod)||'銀行轉帳',
      note:text(settlement.note),
      fileName:`${safeFile(`酷舍_案場抽成結算單_${text(settlement.employeeName||employee.name)||'員工'}_${text(settlement.projectName||project.name)||'案場'}_${text(settlement.date)||taipeiDate()}`)}.pdf`
    };
  }
  function openView(settlement,state,autoPrint){
    const view=buildView(settlement,state);if(!view)return;
    const payload=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(view)))));
    const url=new URL(`commission-settlement-print.html?v=20261001-p20-5c1&print=${autoPrint?'1':'0'}`,location.href);
    url.hash=payload;location.assign(url.href);
  }
  window.KusheCommissionSettlementPrint={open(settlement,state){openView(settlement,state,false)},export(settlement,state){openView(settlement,state,true)},buildView};
}());