(function(){
  'use strict';

  const collator=new Intl.Collator('zh-Hant',{numeric:true,sensitivity:'base'});

  function clean(value){return String(value??'').trim()}
  function compareText(a,b){
    const left=clean(a),right=clean(b);
    if(!left&&!right)return 0;
    if(!left)return 1;
    if(!right)return -1;
    return collator.compare(left,right);
  }

  function houseKey(value){
    const text=clean(value).toUpperCase();
    if(!text||text==='—'||text==='未指定戶別')return {group:99,text};
    let match;
    if((match=/^(\d+)$/.exec(text)))return {group:1,n:Number(match[1]),text};
    if((match=/^([A-Z]+)$/.exec(text)))return {group:2,a:match[1],text};
    if((match=/^(\d+)([A-Z]+)$/.exec(text)))return {group:3,n:Number(match[1]),a:match[2],text};
    if((match=/^([A-Z]+)(\d+)$/.exec(text)))return {group:4,a:match[1],n:Number(match[2]),text};
    return {group:5,text};
  }

  function compareHouse(a,b){
    const left=houseKey(a),right=houseKey(b);
    if(left.group!==right.group)return left.group-right.group;
    if(left.group===1)return left.n-right.n;
    if(left.group===2)return collator.compare(left.a,right.a);
    if(left.group===3)return left.n-right.n||collator.compare(left.a,right.a);
    if(left.group===4)return collator.compare(left.a,right.a)||left.n-right.n;
    return compareText(left.text,right.text);
  }

  function sortByHouse(rows,getHouse=(row)=>row?.house){
    return (Array.isArray(rows)?rows:[])
      .map((row,originalIndex)=>({row,originalIndex}))
      .sort((a,b)=>compareHouse(getHouse(a.row),getHouse(b.row))||a.originalIndex-b.originalIndex)
      .map(({row})=>row);
  }

  function sortWorkRows(rows,accessors={}){
    const source=Array.isArray(rows)?rows:[];
    const read=(row,key,aliases)=>{
      const getter=accessors?.[key];
      if(typeof getter==='function')return getter(row);
      for(const alias of aliases){
        const value=row?.[alias];
        if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;
      }
      return '';
    };
    return source
      .map((row,originalIndex)=>({
        row,
        originalIndex,
        date:clean(read(row,'date',['date','workDate'])),
        employee:clean(read(row,'employee',['employees','employeeName','employee'])),
        house:clean(read(row,'house',['house']))
      }))
      .sort((a,b)=>
        compareText(a.date,b.date)||
        compareText(a.employee,b.employee)||
        compareHouse(a.house,b.house)||
        a.originalIndex-b.originalIndex
      )
      .map(({row})=>row);
  }

  window.KusheDisplaySort=Object.freeze({compareText,compareHouse,sortByHouse,sortWorkRows});
}());
