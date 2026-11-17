/* P40-16AH browser/device-local PDF byte generator, SYNTHETIC ONLY.
   No Supabase/ERP storage, browser print, network upload or production module.
   Designed to be exercised by isolated localhost Chrome test harness.
   Requires pinned local pdf-lib/fontkit UMD and a locally served Chinese TTF.
   The font is provisioned ephemerally in CI and NEVER committed.
*/
(function() {
  "use strict";
  const A4=[595.28,841.89], LEFT=32, RIGHT=563, BOTTOM=30;
  const TEXT=8.3, ROW=10.4;
  const allowedTop=new Set(["schema","documentType","title","customer","project",
    "date","taxMode","lines","salesAmount","taxAmount","totalAmount",
    "retentionAmount","receivableAmount","publicNote","company"]);
  const allowedLine=["house","item","unit","qty","price","amount"];
  const privates=["PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-PAYROLL","PRIVATE-TOKEN"];
  const stop=(why)=>{const e=new Error(why);e.code=why;throw e};
  const money=(n)=>Number(n).toLocaleString("en-US",{maximumFractionDigits:0});
  const cloneText=(s)=>String(s==null?"":s);

  function publicOnly(source,target) {
    if(!source||source.project!==target||source.status!=="active")stop("WRONG_TARGET_OR_STATUS");
    if(!Array.isArray(source.lines)||!source.lines.length||source.lines.length>50)stop("BAD_LINES");
    const view={};
    for(const key of allowedTop) {
      if(!(key in source))stop("MISSING_"+key);
      if(key==="lines"||key==="company")continue;
      view[key]=source[key];
    }
    if(source.documentType!=="billing"||source.schema!=="kushe-external-document-v1")
      stop("UNSUPPORTED_TYPE");
    view.lines=source.lines.map(line=>{
      const o={};
      for(const key of allowedLine) {
        if(!(key in line))stop("MISSING_LINE_FIELD");
        o[key]=line[key];
      }
      if(!o.item||!o.house||!o.unit||
        ![o.qty,o.price,o.amount].every(v=>Number.isSafeInteger(v)&&v>=0))
        stop("BAD_LINE");
      if(o.qty*o.price!==o.amount)stop("INCONSISTENT_LINE_AMOUNT");
      return o;
    });
    view.company={name:cloneText(source.company.name),
       taxId:cloneText(source.company.taxId),address:cloneText(source.company.address)};
    const keys=["salesAmount","taxAmount","totalAmount","retentionAmount","receivableAmount"];
    for(const k of keys)if(!Number.isSafeInteger(view[k])||view[k]<0)stop("BAD_MONEY");
    const sum=view.lines.reduce((s,l)=>s+l.amount,0);
    if(sum!==view.salesAmount || view.salesAmount+view.taxAmount!==view.totalAmount||
       view.totalAmount-view.retentionAmount!==view.receivableAmount)
      stop("UNTRUSTED_TOTAL");
    if(privates.some(p=>JSON.stringify(view).includes(p)))stop("PRIVATE_VALUE_IN_PUBLIC_VIEW");
    return view;
  }
  function summaryOf(lines) {
    const map=new Map();
    for(const l of lines) {
      const key=l.item+"\0"+l.unit+"\0"+l.price;
      if(!map.has(key))map.set(key,{item:l.item,unit:l.unit,price:l.price,qty:0,amount:0});
      const row=map.get(key);row.qty+=l.qty;row.amount+=l.amount;
    }
    return [...map.values()];
  }
  function wrapText(text,font,size,maxWidth) {
    const out=[];let line="";
    for(const ch of Array.from(String(text))){
      if(ch==="\n"){out.push(line);line="";continue}
      const candidate=line+ch;
      if(line && font.widthOfTextAtSize(candidate,size)>maxWidth){
        out.push(line);line=ch;
      }else line=candidate;
    }
    out.push(line);
    return out;
  }
  function put(page,font,text,x,y,size=TEXT,color){
    if(y<BOTTOM)stop("OUTSIDE_A4");
    page.drawText(cloneText(text),{x,y,size,font,color});
  }
  function stroke(page,x,y,w,h,rgb,strokeColor){
    page.drawRectangle({x,y,width:w,height:h,color:rgb,borderColor:strokeColor||rgb,borderWidth:.5});
  }
  function rowColumns(page,font,rows,x,y,widths,h,size=TEXT){
    const total=widths.reduce((a,b)=>a+b,0);
    const {rgb}=PDFLib;
    page.drawRectangle({x,y:y-h,width:total,height:h,borderWidth:.3,borderColor:rgb(.76,.81,.84)});
    let pos=x;
    for(let i=0;i<widths.length;i++){
      if(i>0)page.drawLine({start:{x:pos,y},end:{x:pos,y:y-h},
         thickness:.3,color:rgb(.78,.83,.87)});
      const cells=Array.isArray(rows[i])?rows[i]:[String(rows[i])];
      cells.forEach((v,j)=>put(page,font,v,pos+3.5,y-9.2-j*9.1,size));
      pos+=widths[i];
    }
  }
  function summaryTable(page,font,items,x,top,width,colRows){
    const {rgb}=PDFLib;
    const widths=[width*.57,width*.105,width*.145,width*.18],w=widths.reduce((a,b)=>a+b,0);
    let y=top;
    stroke(page,x,y-13,w,13,rgb(.90,.93,.95),rgb(.74,.79,.82));
    rowColumns(page,font,["項目","量","單價","小計"],x,y,widths,13,8.15);
    y-=13;
    for(const item of items){
      const wrapped=wrapText(item.item,font,8.1,widths[0]-7);
      const h=Math.max(ROW,wrapped.length*9.1+1.3);
      if(h>25)stop("LONG_SUMMARY_ITEM");
      rowColumns(page,font,[wrapped,String(item.qty),money(item.price),money(item.amount)],
         x,y,widths,h,8.1);
      y-=h;
    }
    return y;
  }
  async function generate(source,target) {
    if(!window.PDFLib||!window.fontkit)stop("LOCAL_LIBRARY_MISSING");
    const view=publicOnly(source,target);
    const summary=summaryOf(view.lines);
    if(summary.length>50)stop("TOO_MANY_GROUPS");
    const fontResponse=await fetch("./runtime-font.ttf",{cache:"no-store"});
    if(!fontResponse.ok)stop("LOCAL_CJK_FONT_UNAVAILABLE");
    const fontBytes=await fontResponse.arrayBuffer();
    const doc=await PDFLib.PDFDocument.create();
    doc.registerFontkit(window.fontkit);
    const font=await doc.embedFont(fontBytes,{subset:true});
    const page=doc.addPage(A4);
    const {rgb}=PDFLib;let y=808;
    const ink=rgb(.12,.19,.29), blue=rgb(.91,.95,.98), gray=rgb(.67,.74,.8);
    page.drawText("虛構測試公司",{x:LEFT,y,size:14,font,color:ink});
    stroke(page,510,780,51,40,rgb(.97,.97,.97),gray);
    put(page,font,"模擬LOGO",513,798,8.1);
    put(page,font,"對外請款單（僅虛構測試）",LEFT,783,10);
    put(page,font,"建商："+view.customer,LEFT,764,9);
    put(page,font,"案場："+view.project,LEFT,748,9);
    put(page,font,"日期："+view.date+"　統編："+view.company.taxId,LEFT,732,8.2);
    y=728;
    stroke(page,LEFT,y-15,RIGHT-LEFT,15,blue,gray);
    put(page,font,"原施工明細（戶別、施工項目、數量、單價）",LEFT+5,y-10,9.0);
    y-=15;
    const cols=[60,222,33,38,83,95];
    rowColumns(page,font,["戶別","施工內容","單位","量","單價","小計"],LEFT,y,cols,14,8.1);
    y-=14;
    for(const l of view.lines){
      const item=wrapText(l.item,font,8.15,cols[1]-8);
      const h=Math.max(ROW,item.length*9.1+1.3);
      if(h>26)stop("ORIGINAL_DESCRIPTION_TOO_LONG");
      rowColumns(page,font,[l.house,item,l.unit,String(l.qty),money(l.price),money(l.amount)],
         LEFT,y,cols,h,8.15);
      y-=h;
      if(y<245)stop("SOURCE_TABLE_EXCEEDS_A4");
    }
    put(page,font,"原施工明細合計："+money(view.salesAmount),LEFT+3,y-10,8.3);
    y-=19;
    stroke(page,LEFT,y-15,RIGHT-LEFT,15,blue,gray);
    put(page,font,"施工項目彙總（完整保留每種項目）",LEFT+5,y-10,9.0);
    y-=18;
    const half=(RIGHT-LEFT-9)/2;
    const midpoint=Math.ceil(summary.length/2);
    const bottom1=summaryTable(page,font,summary.slice(0,midpoint),LEFT,y,half);
    const bottom2=summaryTable(page,font,summary.slice(midpoint),LEFT+half+9,y,half);
    y=Math.min(bottom1,bottom2)-5;
    put(page,font,"明細合計："+money(view.salesAmount),LEFT+3,y-9,8.2);
    y-=16;
    const note=wrapText("備註："+view.publicNote,font,8.1,290);
    if(note.length>3)stop("NOTE_EXCEEDS_SAFE_ZONE");
    const footerH=Math.max(60,note.length*10+18);
    if(y-footerH<BOTTOM)stop("A4_LAYOUT_OVERFLOW");
    const footTop=y;
    // The boxes are neutral placeholders; NO genuine logos or stamps.
    stroke(page,LEFT,footTop-footerH,300,footerH,rgb(.98,.98,.98),gray);
    note.forEach((str,i)=>put(page,font,str,LEFT+5,footTop-12-i*10,8.1));
    const amountX=LEFT+305;
    stroke(page,amountX,footTop-footerH,RIGHT-amountX,footerH,rgb(.98,.98,.98),gray);
    put(page,font,"未稅："+money(view.salesAmount),amountX+5,footTop-12,8.2);
    put(page,font,"稅額："+money(view.taxAmount),amountX+5,footTop-23,8.2);
    put(page,font,"含稅："+money(view.totalAmount),amountX+5,footTop-34,8.4);
    put(page,font,"保留款："+money(view.retentionAmount)+"  應收："+money(view.receivableAmount),
        amountX+5,footTop-45,8.1);
    const sigY=footTop-footerH-26;
    if(sigY-45<BOTTOM)stop("STAMP_AREA_OVERFLOW");
    put(page,font,"客戶簽章：__________________",LEFT,sigY+15,8.2);
    stroke(page,RIGHT-154,sigY-45,154,68,rgb(.98,.98,.98),gray);
    put(page,font,"模擬大小章（無真實印章）",RIGHT-150,sigY-7,8.2);
    put(page,font,"54 × 24 mm 預留概念",RIGHT-150,sigY-19,8.1);
    const bytes=await doc.save({useObjectStreams:false});
    const expected={original:view.lines.length,summary:summary.length,
       originalLabels:view.lines.map(l=>l.house),
       itemLabels:summary.map(s=>s.item),
       totals:{sales:view.salesAmount,tax:view.taxAmount,gross:view.totalAmount,
          retention:view.retentionAmount,receivable:view.receivableAmount},
       paper:"A4",fontMin:8.1};
    let base64="";
    for(let i=0;i<bytes.length;i+=12288)
      base64+=String.fromCharCode(...bytes.subarray(i,i+12288));
    return {base64:btoa(base64),expected};
  }
  window.P40AH={generate,publicOnly,summaryOf};
})();