/* P40-16AV — FICTIONAL DATA ONLY. No official ERP state or customer data. */
'use strict';
const assert=require('node:assert/strict');
const AMOUNT_KEYS=['untaxed','tax','grossTotal','retention','receivable',
  'received','outstanding','retentionReceived','retentionOutstanding',
  'pendingCheque','availableToCollect'];

function fixture(options={}){
  const counts=options.counts||[3,4],taxMode=options.taxMode||'未稅';
  assert.ok(['未稅','含稅'].includes(taxMode));
  const exempt=Boolean(options.exempt);
  const sources=[],settlements=[],allLines=[];
  const totals=Object.fromEntries(AMOUNT_KEYS.map(k=>[k,0]));
  counts.forEach((n,index)=>{
    const billingId='FAKE-BILL-'+String(index+1).padStart(2,'0');
    const projectName=index===counts.length-1?'FAKE-M-ZONE':'FAKE-L-ZONE';
    const invoiceStatus=exempt?'no_invoice':(index===0||options.twoInvoiced?'invoiced':'invoice_pending');
    const invoiceNo=invoiceStatus==='invoiced'?'PRIVATE-INVOICE-'+(index===0?'AUG':'OCT'):'';
    const invoiceDate=invoiceStatus==='invoiced'?(index===0?'2026-08-16':'2026-10-20'):'';
    const unitPrice=taxMode==='含稅'?(exempt?100:105):100;
    const lines=Array.from({length:n},(_,j)=>{
      const qty=options.fractional && j===0 && index===0?0.5:1;
      const price=options.fractional && j===0 && index===0?unitPrice*2:unitPrice;
      return {house:'FAKE-H'+(index+1)+'-'+(j+1),
        item:'FAKE-CONSTRUCTION-'+(index+1)+'-'+(j+1),
        unit:'式',qty,price,amount:Math.round(qty*price),
        invoiceNo:'PRIVATE-INVOICE-LINE-'+(index+1)};
    });
    const untaxed=n*100,tax=exempt?0:n*5,grossTotal=untaxed+tax;
    const retention=index===0?10:0,receivable=grossTotal-retention;
    const anchors={untaxed,tax,grossTotal,retention,receivable};
    const rest={received:0,outstanding:receivable,
      retentionReceived:0,retentionOutstanding:retention,
      pendingCheque:0,availableToCollect:receivable};
    const source={billingId,receivableId:'FAKE-AR-'+index,
      customerId:'FAKE-CUSTOMER-ONE',number:'FAKE-ORIGINAL-'+index,
      projectName,date:index===0?'2026-08-12':'2026-10-12',
      taxMode,invoiceStatus,invoiceNo,invoiceDate,
      anchors,originalLines:lines};
    sources.push(source);
    settlements.push({billingId,...rest});
    allLines.push(...lines);
    for(const [key,value] of Object.entries({...anchors,...rest}))totals[key]+=value;
  });
  const unitTotal=taxMode==='含稅'?totals.grossTotal:totals.untaxed;
  const document={
    schema:'kushe-external-billing-group-v2',status:'active',detailMode:'unified',
    targetBillingId:sources.at(-1).billingId,displayProjectName:'FAKE-M-ZONE',
    customerName:'FAKE-CUSTOMER',documentDate:'2026-11-18',
    note:'FAKE-PUBLIC-CONSTRUCTION-NOTE',
    sourceSnapshots:sources,settlementSnapshots:settlements,
    sourceIds:sources.map(s=>s.billingId),
    unified:{taxMode,lines:allLines,total:unitTotal,target:unitTotal,reason:''},totals
  };
  return {
    schema:'kushe-external-billing-print-v1',historical:false,
    document,template:{
      schema:'kushe-original-billing-template-v1',
      billingId:document.targetBillingId,historicalDetails:false,
      company:{name:'FAKE-COMPANY',englishName:'SYNTHETIC ONLY',
        taxId:'00000000',address:'FAKE-ADDRESS'}
    }
  };
}

function groupForDiscount(payload){
  const d=payload.document;
  return {
    canGroup:true,issues:[],termsChanged:false,settlementChanged:false,
    document:{id:'FAKE-GROUP-01',status:'active',sourceIds:[...d.sourceIds]},
    sources:d.sourceSnapshots.map((source,i)=>({
      document:source,settlement:d.settlementSnapshots[i]
    })),
    totals:{...d.totals}
  };
}
module.exports={fixture,groupForDiscount,AMOUNT_KEYS};
