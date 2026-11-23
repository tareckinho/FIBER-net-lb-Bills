'use strict';

// Pure, read-only view of already verified operational purchase receipts.
// The caller must run bandwidth-spending.purchaseSummary before supplying rows.
// Source snapshots are immutable; source-bound future receipts use safe original slots.
const crypto=require('node:crypto'),Model=require('./accounting-workbook.cjs');
const FORMAT='FIBERNETLB-ACCOUNTING-BANDWIDTH-PROJECTION-2',SHEET='Bandwidth';
const MAX_CELLS=300000,MAX_ROW=1048576,MAX_STYLES=5000;
const copy=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function demand(value,message){if(!value)throw Error('Accounting bandwidth projection: '+message);}
function integer(value,label){demand(Number.isSafeInteger(value)&&value>0,'invalid '+label+'.');return value;}
function text(value,label,max,multiline=false){
 demand(typeof value==='string'&&value.length<=max&&(multiline||value.trim())&&
  !(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value),'invalid '+label+'.');
 return value;
}
function purchase(value,year){
 demand(value&&typeof value==='object'&&!Array.isArray(value),'invalid purchase.');
 const id=integer(value.id,'purchase ID'),supplierId=integer(value.supplierId,'supplier ID'),typeId=integer(value.typeId,'type ID');
 const requestId=text(value.requestId,'request ID',100);
 demand(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(requestId)&&value.receiptNo==='BWP-'+requestId,'invalid saved receipt identity.');
 const date=value.purchaseDate;
 demand(typeof date==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(date)&&Number(date.slice(0,4))===year,'purchase is outside the selected year.');
 const parsed=new Date(date+'T12:00:00Z');
 demand(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date,'invalid purchase calendar date.');
 const quantityMicros=integer(value.quantityMicros,'quantity millionths'),unitPriceCents=integer(value.unitPriceCents,'unit price cents'),totalCents=integer(value.totalCents,'purchase cost cents');
 demand((BigInt(quantityMicros)*BigInt(unitPriceCents)+500000n)/1000000n===BigInt(totalCents),'purchase cost differs from its exact rounded source.');
 demand(['Mbps','Gbps'].includes(value.unit),'invalid bandwidth unit.');
 return {id,requestId,receiptNo:value.receiptNo,supplierId,typeId,purchaseDate:date,
  supplierName:text(value.supplierName,'saved supplier name',160),typeName:text(value.typeName,'saved type name',120),unit:value.unit,
  quantityMicros,unitPriceCents,totalCents,note:text(value.note??'','purchase description',1000,true)};
}
function excelDate(value){return (Date.parse(value+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;}

const BASELINE='FIBERNETLB-ACCOUNTING-BANDWIDTH-BASELINE-1';
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function purchaseFingerprint(value){
 const year=typeof value?.purchaseDate==='string'?Number(value.purchaseDate.slice(0,4)):NaN;
 return hash(purchase(value,year));
}
function baseline(value){
 demand(plain(value),'invalid future-purchase baseline.');
 const keys=['format','year','sourceSha256','cutoverAt','purchases'];
 demand(Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(value,k))&&value.format===BASELINE&&Number.isInteger(value.year)&&value.year>=2000&&value.year<=2099,'invalid baseline fields.');
 demand(typeof value.sourceSha256==='string'&&/^[a-f0-9]{64}$/i.test(value.sourceSha256),'invalid baseline source identity.');
 demand(typeof value.cutoverAt==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.cutoverAt)&&Number.isFinite(Date.parse(value.cutoverAt))&&new Date(value.cutoverAt).toISOString().slice(0,10)===value.cutoverAt.slice(0,10),'invalid baseline cutover time.');
 demand(Array.isArray(value.purchases)&&value.purchases.length<=20000,'invalid baseline receipt list.');
 const rows=value.purchases.map(p=>{
  demand(plain(p)&&Reflect.ownKeys(p).length===2&&Object.hasOwn(p,'requestId')&&Object.hasOwn(p,'fingerprint')&&
   typeof p.requestId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(p.requestId)&&typeof p.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(p.fingerprint),'invalid baseline receipt proof.');
  return {requestId:p.requestId,fingerprint:p.fingerprint};
 });
 demand(new Set(rows.map(p=>p.requestId)).size===rows.length,'duplicate baseline receipt ID.');
 return {format:BASELINE,year:value.year,sourceSha256:value.sourceSha256.toLowerCase(),cutoverAt:value.cutoverAt,purchases:rows.sort((a,b)=>a.requestId<b.requestId?-1:a.requestId>b.requestId?1:0)};
}
function overrideMap(value){
 if(value===undefined)return {};demand(plain(value),'invalid saved Accounting overrides.');const result={};
 for(const name of Object.keys(value).sort()){
  demand(plain(value[name]),'invalid saved Accounting overrides.');const cells={};
  for(const ref of Object.keys(value[name]).sort()){
   const v=value[name][ref];
   demand(/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)&&(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=32767||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER),'invalid saved Accounting override value.');cells[ref]=v;
  }result[name]=cells;
 }return result;
}

function originMap(value){
 if(value===undefined)return {};demand(plain(value),'invalid Accounting record origins.');const result={};
 for(const name of Object.keys(value).sort()){
  demand(plain(value[name]),'invalid Accounting record origins.');const cells={};
  for(const ref of Object.keys(value[name]).sort()){
   const v=value[name][ref];demand(/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)&&plain(v),'invalid Accounting record origin.');
   cells[ref]={createdAt:typeof v.createdAt==='string'?v.createdAt:null,deleted:typeof v.deleted==='boolean'?v.deleted:v.deleted===0?false:v.deleted===1?true:null};
  }result[name]=cells;
 }return result;
}
function stamp(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))return null;
 const time=Date.parse(value),date=new Date(value.slice(0,10)+'T12:00:00Z');
 if(!Number.isFinite(time)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.slice(0,10))return null;
 return {time,zone:/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?'offset':'local'};
}
const empty=v=>v===null||v===undefined||v==='';
const zero=v=>empty(v)||v===0;
const stars=v=>typeof v==='string'&&/^\*+$/.test(v);
const nameKey=v=>v.toLowerCase();
const escaped=v=>v.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
function criteria(value,pattern){
 if(typeof pattern!=='string')return value===pattern;let regex='^';
 for(let i=0;i<pattern.length;i++){
  const c=pattern[i];
  if(c==='~'&&i+1<pattern.length)regex+=escaped(pattern[++i]);
  else if(c==='*')regex+='.*';else if(c==='?')regex+='.';else regex+=escaped(c);
 }return new RegExp(regex+'$','iu').test(String(value));
}
const escapeCriteria=v=>v.replace(/~/g,'~~').replace(/\*/g,'~*').replace(/\?/g,'~?');
function literalAnnualAlias(pattern,name){
 const input=pattern.replace(/^\*{2,}/,'');let value='';
 for(let i=0;i<input.length;i++){if(input[i]==='~'&&i+1<input.length)value+=input[++i];else if(input[i]==='*'||input[i]==='?')return false;else value+=input[i];}
 return value.toLowerCase()===name.toLowerCase();
}
function centsSum(rows){const n=rows.reduce((sum,p)=>sum+BigInt(p.totalCents),0n);demand(n<=BigInt(Number.MAX_SAFE_INTEGER),'purchase total exceeds exact supported cents.');return Number(n);}
function project(snapshot,purchases,options={}){
 Model.validateSnapshot(snapshot);demand(plain(options),'invalid projection options.');
 const disabled=()=>({snapshot,signature:hash([FORMAT,'disabled',snapshot.year]),metadata:null,managedCells:{}});
 if(options.baseline==null)return disabled();
 const cutover=baseline(options.baseline);
 if(cutover.year!==snapshot.year||!snapshot.sheets.some(s=>s.name===SHEET))return disabled();
 demand(typeof snapshot.sha256==='string'&&snapshot.sha256.toLowerCase()===cutover.sourceSha256,'baseline does not match the installed workbook source.');
 demand(Array.isArray(purchases)&&purchases.length<=20000,'purchases must be a bounded explicit array.');
 const all=purchases.map(p=>purchase(p,snapshot.year)).sort((a,b)=>a.id-b.id);
 demand(new Set(all.map(p=>p.requestId)).size===all.length,'duplicate purchase request ID.');
 demand(new Set(all.map(p=>p.id)).size===all.length,'conflicting purchase source ID.');
 const byRequest=new Map(all.map(p=>[p.requestId,p])),excluded=new Set(cutover.purchases.map(p=>p.requestId));
 for(const p of cutover.purchases){const current=byRequest.get(p.requestId);demand(current&&hash(current)===p.fingerprint,'a captured baseline receipt is missing or changed; no historical purchase was relinked.');}
 const eligible=all.filter(p=>!excluded.has(p.requestId)),overrides=overrideMap(options.overrides),origins=originMap(options.origins);
 const recordedAt=new Map(purchases.map(p=>[p.requestId,typeof p.recordedAt==='string'?p.recordedAt:null]));
 const signature=hash([FORMAT,snapshot.year,snapshot.sha256,cutover,all,all.map(p=>[p.requestId,recordedAt.get(p.requestId)]),overrides,origins]);
 const beforeValues=Model.calculate(snapshot,overrides).values;
 for(const p of eligible)demand(!/[*?~]/.test(p.supplierName)&&!/^\s*[<>=]/.test(p.supplierName),'the future supplier name requires a reviewed literal alias.');
 const originalByName=new Map(snapshot.sheets.map(s=>[s.name,s])),copies=new Map(),managed=new Map(),styles=[...(snapshot.styles||[])],styleCache=new Map(),runMaps=new Map(),original=originalByName.get(SHEET);
 demand(Number.isSafeInteger(original.maxRow)&&original.maxRow>=287&&Number.isSafeInteger(original.maxCol)&&original.maxCol>=7,'original monthly table bounds are unavailable.');
 demand(styles.length>0&&styles.length<=5000,'original cell styles are unavailable.');
 const effective=(s,ref)=>Object.hasOwn(overrides[s.name]||{},ref)?overrides[s.name][ref]:(copies.get(s.name)||s).cells[ref]?.value;
 const edited=(s,row,columns)=>Object.keys(overrides[s.name]||{}).some(ref=>Number(ref.match(/\d+$/)[0])===row&&(!columns||columns.includes(ref.match(/^[A-Z]+/)[0])));
 const writableSheet=s=>{if(!copies.has(s.name))copies.set(s.name,{...s,cells:{...s.cells},rowHeights:{...(s.rowHeights||{})}});return copies.get(s.name);};
 function styleAt(s,row,col){
  if(!runMaps.has(s.name)){const map=new Map();for(const run of s.styleRuns||[]){if(!map.has(run[0]))map.set(run[0],[]);map.get(run[0]).push(run);}runMaps.set(s.name,map);}
  const pick=v=>typeof v==='object'&&v!==null?v.styleId:v;
  const id=s.cells[Model.columnName(col)+row]?.styleId??runMaps.get(s.name).get(row)?.find(r=>col>=r[1]&&col<=r[2])?.[3]??pick(s.rowStyles?.[row])??pick(s.columnStyles?.[col])??s.defaultStyleId??0;
  demand(Number.isInteger(id)&&id>=0&&id<snapshot.styles.length,'invalid original style reference.');return id;
 }
 function adjusted(id,kind){
  const key=id+':'+kind;if(styleCache.has(key))return styleCache.get(key);const style=copy(styles[id]);
  if(kind==='quantity')style.numberFormat='0.######';else if(kind==='usd')style.numberFormat='$#,##0.00';else style.alignment={...style.alignment,wrapText:true};
  demand(styles.length<5000,'generated styles exceed supported capacity.');const next=styles.push(style)-1;styleCache.set(key,next);return next;
 }
 function put(s,col,row,value,kind){
  const ref=col+row,cell={...(s.cells[ref]||{}),value,editable:false};delete cell.formula;delete cell.error;delete cell.display;
  const id=styleAt(s,row,Model.columnNumber(col));cell.styleId=kind?adjusted(id,kind):id;
  writableSheet(s).cells[ref]=cell;if(!managed.has(s.name))managed.set(s.name,new Set());managed.get(s.name).add(ref);
 }
 const uniqueNames=[...new Map(all.map(p=>[nameKey(p.supplierName),p.supplierName])).values()];
 const unambiguous=(pattern,name)=>uniqueNames.filter(n=>criteria(n,pattern)).every(n=>nameKey(n)===nameKey(name));

 function firstReceipt(name,monthIndex){
  const rows=eligible.filter(p=>nameKey(p.supplierName)===nameKey(name)&&(monthIndex===undefined||Number(p.purchaseDate.slice(5,7))===monthIndex+1)),times=rows.map(p=>stamp(recordedAt.get(p.requestId)));
  if(!times.length||times.some(t=>!t)||new Set(times.map(t=>t.zone)).size!==1)return null;
  return times.reduce((a,b)=>a.time<=b.time?a:b);
 }
 const counterfactuals=new Map();
 function ownership(s,row,claim,first){
  const records=origins[s.name]||{},refs=Object.keys(records).filter(ref=>Number(ref.match(/\d+$/)[0])===row),active=Object.keys(overrides[s.name]||{}).filter(ref=>Number(ref.match(/\d+$/)[0])===row);
  if(Object.hasOwn(records,claim+row)||active.some(ref=>!Object.hasOwn(records,ref)))return {safe:false,post:false};
  if(!refs.length)return {safe:!active.length,post:false};
  if(!first)return {safe:false,post:false};
  for(const ref of refs){const origin=records[ref],when=stamp(origin.createdAt);if(origin.deleted===null||!when||when.zone!==first.zone||when.time<=first.time)return {safe:false,post:false};}
  return {safe:true,post:true};
 }
 function beforeWithoutOwnedRow(s,row,state){
  if(!state.post)return beforeValues[s.name]||{};
  const key=s.name+'\0'+row;
  if(!counterfactuals.has(key)){
   const local={...overrides,[s.name]:Object.fromEntries(Object.entries(overrides[s.name]||{}).filter(([ref])=>Number(ref.match(/\d+$/)[0])!==row))};
   counterfactuals.set(key,Model.calculate(snapshot,local).values[s.name]||{});
  }return counterfactuals.get(key);
 }
 function providerRowIsSafe(s,row,name,monthIndex){
  const state=ownership(s,row,'C',firstReceipt(name,monthIndex));if(!state.safe)return false;
  const without=beforeWithoutOwnedRow(s,row,state);
  for(let col=1;col<=Math.min(s.maxCol||14,14);col++){
   if([3,4].includes(col))continue;
   const ref=Model.columnName(col)+row,cell=s.cells[ref],raw=cell?.value,value=effective(s,ref),header=String(s.cells.A1?.value??'').trim();
   if(col===1){
    const ordinal=/^(?:no\.?|number|#)$/i.test(header)&&Number.isSafeInteger(raw)&&raw===row-1;
    const templateDate=header==='Due Date'&&raw===36526&&s.cells['B'+row]?.value==='ISP'&&zero(s.cells['C'+row]?.value);
    if(ordinal||templateDate){if(!state.post&&!zero(value)&&value!==raw)return false;continue;}
   }
   if(col===2){if(!zero(raw)&&raw!=='ISP')return false;if(!state.post&&!zero(value)&&value!=='ISP')return false;continue;}
   if([13,14].includes(col)&&cell?.formula){if(!zero(without[ref]))return false;continue;}
   if(cell?.formula||!zero(raw))return false;
   if(!state.post&&!zero(value))return false;
  }return true;
 }
 function connect(monthIndex,name,first,last){
  const monthSheet=originalByName.get(MONTHS[monthIndex]),account=originalByName.get('Accounting');
  demand(monthSheet&&account,'the connected monthly and Accounting worksheets are required.');
  const providerRows=[];
  for(let row=2;row<=Math.min(monthSheet.maxRow||200,200);row++){
   const f=monthSheet.cells['D'+row]?.formula;if(typeof f!=='string')continue;
   const normalized=f.replace(/\$/g,'').replace(/'Bandwidth'!/gi,'Bandwidth!').replace(/\s+/g,'').toLowerCase();
   if(normalized.includes('sumif(bandwidth!c'+first+':c'+last+',c'+row+',bandwidth!g'+first+':g'+last+')'))providerRows.push(row);
  }
  for(const row of providerRows){const v=effective(monthSheet,'C'+row);demand(zero(v)||typeof v==='string'&&!/^\s*[<>=]/.test(v),'an existing monthly provider criterion requires a reviewed literal alias.');}
  const found=providerRows.filter(row=>{const v=effective(monthSheet,'C'+row);return typeof v==='string'&&!stars(v)&&criteria(name,v);});
  demand(found.length<=1,'multiple monthly provider formulas match the same future supplier.');
  if(found.length)demand(literalAnnualAlias(effective(monthSheet,'C'+found[0]),name)&&unambiguous(effective(monthSheet,'C'+found[0]),name),'a monthly provider wildcard requires a reviewed supplier alias.');
  else{
   const row=providerRows.find(r=>zero(effective(monthSheet,'C'+r))&&!monthSheet.cells['C'+r]?.formula&&providerRowIsSafe(monthSheet,r,name,monthIndex));
   demand(row!==undefined,'no safe monthly provider-name slot is available; imported and paid rows were preserved.');
   demand(criteria(name,name)&&unambiguous(name,name),'the supplier name requires a reviewed literal monthly alias.');put(monthSheet,'C',row,name);
  }
  demand(providerRows.filter(row=>{const v=effective(monthSheet,'C'+row);return typeof v==='string'&&criteria(name,v);}).length===1,'existing broad monthly provider criteria require review before linking future purchases.');
  for(let row=2;row<=Math.min(11,account.maxRow||11);row++){const v=effective(account,'A'+row);demand(zero(v)||typeof v==='string'&&!/^\s*[<>=]/.test(v),'an existing Accounting provider criterion requires a reviewed literal alias.');}
  const annual=[];
  for(let row=2;row<=Math.min(11,account.maxRow||11);row++){
   const v=effective(account,'A'+row);if(typeof v==='string'&&!stars(v)&&criteria(name,v))annual.push(row);
  }
  demand(annual.length<=1,'multiple Accounting provider criteria match the same future supplier.');
  if(annual.length)demand(literalAnnualAlias(effective(account,'A'+annual[0]),name)&&unambiguous(effective(account,'A'+annual[0]),name),'an Accounting provider wildcard requires a reviewed supplier alias.');
  else{
   const row=Array.from({length:Math.max(0,Math.min(11,account.maxRow||11)-1)},(_,i)=>i+2).find(r=>{
    const v=effective(account,'A'+r),state=ownership(account,r,'A',firstReceipt(name));
    if(!(zero(v)||stars(v))||account.cells['A'+r]?.formula||!state.safe)return false;
    const without=beforeWithoutOwnedRow(account,r,state);
    for(let col=2;col<=16;col++){const ref=Model.columnName(col)+r,raw=account.cells[ref]?.value;if(!zero(raw)||!zero(without[ref])||!state.post&&!zero(effective(account,ref)))return false;}return true;
   });
   demand(row!==undefined,'no safe Accounting provider placeholder is available; existing accounts and payments were preserved.');put(account,'A',row,'**'+escapeCriteria(name));
  }
 }
 const metadata={sheet:SHEET,mode:'in_place',basis:'purchase_cost',signature,cutoverAt:cutover.cutoverAt,baselineCount:cutover.purchases.length,count:eligible.length,totalCents:centsSum(eligible),generatedStartRow:null,months:[],purchases:[]};
 for(let month=0;month<12;month++){
  const first=3+24*month,last=22+24*month,total=23+24*month,key=snapshot.year+'-'+String(month+1).padStart(2,'0'),rows=eligible.filter(p=>p.purchaseDate.slice(0,7)===key),free=[];
  for(let row=first;row<=last;row++){
   if(edited(original,row,['B','C','D','E','F','G']))continue;let occupied=false;
   for(const col of ['B','C','D','E','F']){const cell=original.cells[col+row];if(cell?.formula||!empty(cell?.value)){occupied=true;break;}}
   const g=original.cells['G'+row];if(g?.formula?!zero(g.value):!empty(g?.value))occupied=true;
   if(!occupied)free.push(row);
  }
  let allocations=rows.map(p=>[p]);
  if(rows.length>free.length){const groups=new Map();for(const p of rows){const key=nameKey(p.supplierName);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}allocations=[...groups.values()];}
  demand(allocations.length<=free.length,'not enough safe original monthly rows for future supplier purchases; no imported row was overwritten or receipt truncated.');
  const rowProof=[],detail=[];
  allocations.forEach((group,index)=>{
   const row=free[index],p=group[0],grouped=group.length>1;connect(month,p.supplierName,first,last);
   const uniform=group.every(x=>x.quantityMicros===p.quantityMicros&&x.unitPriceCents===p.unitPriceCents&&x.unit===p.unit&&x.typeName===p.typeName);
   const quantity=group.reduce((n,x)=>n+BigInt(x.quantityMicros),0n),qty=uniform&&quantity<=BigInt(Number.MAX_SAFE_INTEGER)?Number(quantity)/1000000:null;
   const types=[...new Set(group.map(x=>x.typeName+' · '+x.unit))];
   const description=grouped?'Multiple purchases ('+group.length+'); see receipt details.\n'+types.slice(0,5).join(', ')+(types.length>5?'\nAdditional types are retained in receipt details.':''):(p.note?p.note+'\n':'')+p.typeName+' · '+p.unit;
   put(original,'B',row,group.every(x=>x.purchaseDate===p.purchaseDate)?excelDate(p.purchaseDate):null);
   put(original,'C',row,p.supplierName);put(original,'D',row,qty,'quantity');put(original,'E',row,description,'description');
   put(original,'F',row,uniform?p.unitPriceCents/100:null,'usd');put(original,'G',row,centsSum(group)/100,'usd');
   const lines=description.split(/\r\n|\r|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/80)),0);
   writableSheet(original).rowHeights[row]=Math.max(original.rowHeights?.[row]??original.defaultRowHeight??20,Math.min(10000,lines*18));
   for(const purchase of group){rowProof.push({row,id:purchase.id,requestId:purchase.requestId,receiptNo:purchase.receiptNo,grouped});const d={...purchase,row};detail.push(d);metadata.purchases.push(d);}
  });
  const cost=centsSum(rows);metadata.months.push({month:key,ref:'B'+(1+24*month),headerRow:2+24*month,firstRow:first,lastRow:last,totalRow:total,count:rows.length,totalCents:cost,linkedTotalCents:cost,monthlyTotalCents:null,rows:rowProof,purchases:detail});
 }
 const account=originalByName.get('Accounting');
 for(const name of [...new Set(eligible.map(p=>p.supplierName))]){
  let matches=0;for(let row=2;row<=Math.min(11,account?.maxRow||11);row++){const value=effective(account,'A'+row);if(typeof value==='string'&&!empty(value)&&criteria(name,value))matches++;}
  demand(matches===1,'existing broad Accounting provider criteria require review before linking future purchases.');
 }
 const derived=copies.size?{...snapshot,styles,sheets:snapshot.sheets.map(s=>copies.get(s.name)||s)}:snapshot;
 Model.validateSnapshot(derived);const calculation=copies.size?Model.calculate(derived,overrides):{values:beforeValues};
 for(const month of metadata.months){const value=calculation.values[SHEET]['G'+month.totalRow],cents=typeof value==='number'&&Number.isFinite(value)?Math.round(value*100):null;month.monthlyTotalCents=Number.isSafeInteger(cents)?cents:null;}
 const managedCells={};for(const [name,refs]of managed)managedCells[name]=[...refs].sort((a,b)=>Number(a.match(/\d+$/)[0])-Number(b.match(/\d+$/)[0])||Model.columnNumber(a.match(/^[A-Z]+/)[0])-Model.columnNumber(b.match(/^[A-Z]+/)[0]));
 return {snapshot:derived,signature,metadata,managedCells};
}
module.exports={project,purchaseFingerprint};
