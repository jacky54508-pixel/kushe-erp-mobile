/* P40-16AK — isolated browser-side *actual* PDF bytes for SOURCE-PRESERVING
 * SINGLE billing approved external views. Only fictitious test data.
 * Does NOT change P40-16AH, AJ, live app, db, auth, or print paths.
 * Exposes no download UI and never invokes window.print().
 * A PDF here is NOT proof of production authorization or financial parity.
 */
(function(root){
'use strict';
const A4=[595.28,841.89],X=32,W=531,MIN=8.1;
const die=(reason)=>{const e=new Error(reason);e.code=reason;throw e;};
function charsWrap(str,font,size,maxWidth){
  const lines=[];let active='';
  for(const glyph of Array.from(String(str))){
    if(glyph==='\n'){lines.push(active);active='';continue;}
    if(active&&font.widthOfTextAtSize(active+glyph,size)>maxWidth){
      lines.push(active);active=glyph;
    } else active+=glyph;
  }
  lines.push(active);
  return lines;
}
function put(page,font,s,x,y,size=8.1){
  if(y<32 || y>841.89)die('TEXT_OUTSIDE_SAFE_PAGE');
  const text=String(s??'');
  if(font.widthOfTextAtSize(text,size)>595.28-x-19)die('TEXT_EXCEEDS_RIGHT_EDGE');
  page.drawText(text,{font,x,y,size});
}
function rect(page,x,y,width,height,color){
  if(y<30)die('BOX_BELOW_PAGE');
  page.drawRectangle({x,y,width,height,borderWidth:.35,
    borderColor:color||PDFLib.rgb(.70,.76,.82)});
}
function tableRow(page,font,cells,widths,top,height){
  const color=PDFLib.rgb(.76,.81,.86);
  const total=widths.reduce((sum,n)=>sum+n,0);
  rect(page,X===null?0:cells.x??X,top-height,total,height,color);
  let x=cells.x??X;
  for(let i=0;i<widths.length;i++){
    if(i)page.drawLine({start:{x,y:top},end:{x,y:top-height},
         thickness:.3,color});
    const val=Array.isArray(cells[i])?cells[i]:[String(cells[i]??'')];
    for(let j=0;j<val.length;j++){
      if(font.widthOfTextAtSize(val[j],MIN)>widths[i]-7)die('CELL_TEXT_TOO_WIDE');
      put(page,font,val[j],x+3.5,top-8.7-9*j,MIN);
    }
    x+=widths[i];
  }
}
async function generatePublishedSingle(published,trust,target){
  if(!root.PDFLib||!root.fontkit||!root.P40AJ)die('LAB_DEPENDENCY_UNAVAILABLE');
  if(typeof target!=='string'||target!==published?.project)die('WRONG_SELECTED_PROJECT');
  const adapted=root.P40AJ.normalizeSingle(published,trust);
  const view=root.P40AJ.previewSpec(adapted);
  if(view.safeForProduction!==false)die('PRODUCTION_FLAG_UNEXPECTED');
  if(view.sourceRows.length!==adapted.lines.length)die('SOURCE_LINES_DROPPED');
  if(view.summaryRows.length!==root.P40AJ.denseSummary(adapted).length)
    die('GROUPED_LINES_DROPPED');
  if(view.sourceRows.length>50||view.summaryRows.length>50)die('TOO_MANY_ROWS');
  const res=await fetch('../.p40-16ah-tests/runtime-font.ttf',{cache:'no-store'});
  if(!res.ok)die('TEMPORARY_CJK_FONT_MISSING');
  const pdf=await PDFLib.PDFDocument.create();
  pdf.registerFontkit(root.fontkit);
  const font=await pdf.embedFont(await res.arrayBuffer(),{subset:true});
  const page=pdf.addPage(A4);
  const gray=PDFLib.rgb(.68,.76,.83);
  put(page,font,'虛構公司｜隔離 A4 單筆請款驗證',X,806,12);
  rect(page,510,780,51,40,gray);
  put(page,font,'模擬LOGO',513,796,8.1);
  put(page,font,'建商：'+view.customer,X,768,8.7);
  put(page,font,'案場：'+view.project,X,752,8.7);
  put(page,font,'日期：'+adapted.date+'　統編：'+(view.company.taxId||''),X,737,8.3);
  put(page,font,'施工原始明細（不得刪除戶別）',X,715,9.0);
  let y=703;
  const widths=[53,221,31,48,70,108];
  tableRow(page,font,Object.assign(
      ['戶別','施工項目','單位','數量','單價','小計'],{x:X}),widths,y,14);
  y-=14;
  for(const line of view.sourceRows){
    const wrapped=charsWrap(line.item,font,MIN,widths[1]-7);
    const height=Math.max(10.4,wrapped.length*9.1+1.3);
    if(height>28)die('SOURCE_DESCRIPTION_TOO_LONG');
    tableRow(page,font,Object.assign([
      line.house,wrapped,line.unit,line.qtyText,line.priceText,line.amountText
    ],{x:X}),widths,y,height);
    y-=height;
    if(y<270)die('SOURCE_A4_CAPACITY_EXCEEDED');
  }
  put(page,font,'原施工明細合計：'+
      root.P40AJ.previewSpec(adapted).display.originalDetailTotal
        .toLocaleString('en-US',{maximumFractionDigits:2}),
      X+3,y-10,8.2);
  y-=26;
  put(page,font,'施工項目彙總（同計價來源分組，不改原金額）',X,y,8.8);
  y-=10;
  const split=Math.ceil(view.summaryRows.length/2);
  const two=[view.summaryRows.slice(0,split),view.summaryRows.slice(split)];
  const half=(W-10)/2;
  const widths2=[half*.56,half*.13,half*.15,half*.16];
  function summaryTable(rows,x,top){
    let cy=top;
    tableRow(page,font,Object.assign(['項目','數量','單價','小計'],{x}),
          widths2,cy,13);
    cy-=13;
    for(const l of rows){
      const wrap=charsWrap(l.item,font,MIN,widths2[0]-7);
      const height=Math.max(10.4,wrap.length*9.1+1.3);
      if(height>27)die('SUMMARY_DESCRIPTION_TOO_LONG');
      tableRow(page,font,Object.assign([
        wrap,l.qtyText,l.priceText,l.amountText
      ],{x}),widths2,cy,height);
      cy-=height;
    }
    return cy;
  }
  const endLeft=summaryTable(two[0],X,y);
  const endRight=summaryTable(two[1],X+half+10,y);
  y=Math.min(endLeft,endRight)-10;
  if(y<179)die('FOOTER_OR_STAMP_A4_OVERFLOW');
  const textSummary=view.display.originalDetailTotal.toLocaleString(
    'en-US',{maximumFractionDigits:2});
  put(page,font,'施工項目彙總合計：'+textSummary,X,y,8.2);
  // Footer/stamp dedicated fixed zone so long content cannot overlap.
  const note=charsWrap('備註：'+view.publicNote,font,8.1,305);
  if(note.length>3)die('NOTE_TOO_LONG');
  rect(page,X,111,317,60,gray);
  note.forEach((v,i)=>put(page,font,v,X+5,156-i*11,8.1));
  rect(page,X+323,111,W-323,60,gray);
  const m=view.approvedAmounts;
  function num(k){return m[k].toLocaleString('en-US',{maximumFractionDigits:2});}
  const subtotal=view.display.showTax?'未稅：'+num('salesAmount'):'請款總額：'+num('totalAmount');
  put(page,font,subtotal,X+328,158,8.1);
  if(view.display.showTax){
    put(page,font,'稅額：'+num('taxAmount'),X+328,147,8.1);
    put(page,font,'含稅：'+num('totalAmount'),X+328,136,8.1);
  }
  put(page,font,'保留款：'+num('retentionAmount'),X+328,125,8.1);
  put(page,font,'應收：'+num('receivableAmount'),X+328,114,8.1);
  put(page,font,'客戶簽章：__________________',X,87,8.1);
  rect(page,409,33,154,68,gray);
  put(page,font,'模擬大小章',414,72,8.1);
  put(page,font,'54 × 24 mm 預留',414,59,8.1);
  const bytes=await pdf.save({useObjectStreams:false});
  const expected={
    original:view.sourceRows.map(l=>({...l})),
    summary:view.summaryRows.map(l=>({...l})),
    amounts:{...view.approvedAmounts},
    display:{...view.display},
    selectedProject:view.project,
    taxMode:view.taxMode,invoiceStatus:view.invoiceStatus,
    pagesRequired:1,fontMin:MIN,productionReady:false
  };
  let ascii='';
  for(let i=0;i<bytes.length;i+=12288)
    ascii+=String.fromCharCode(...bytes.subarray(i,i+12288));
  return {base64:btoa(ascii),expected};
}
root.P40AK={generatePublishedSingle};
})(window);
