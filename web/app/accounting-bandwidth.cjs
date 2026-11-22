'use strict';

// Pure, read-only view of already verified operational purchase receipts.
// The caller must run bandwidth-spending.purchaseSummary before supplying rows.
// Source snapshots and original cell coordinates are never changed.
const crypto=require('node:crypto'),Model=require('./accounting-workbook.cjs');
const FORMAT='FIBERNETLB-ACCOUNTING-BANDWIDTH-PROJECTION-1',SHEET='Bandwidth';
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
function project(snapshot,purchases){
 Model.validateSnapshot(snapshot);
 demand(Array.isArray(purchases),'purchases must be an explicit array.');
 const sheet=snapshot.sheets.find(value=>value.name===SHEET);
 if(!sheet)return {snapshot,signature:hash([FORMAT,'no-bandwidth',snapshot.year]),metadata:null};
 demand(!sheet.accountingBandwidthProjection,'use the original snapshot rather than an already derived projection.');
 demand(Number.isInteger(snapshot.year)&&snapshot.year>=2000&&snapshot.year<=2099,'invalid workbook year.');
 const canonical=purchases.map(value=>purchase(value,snapshot.year)).sort((a,b)=>a.purchaseDate<b.purchaseDate?-1:a.purchaseDate>b.purchaseDate?1:a.id-b.id);
 demand(new Set(canonical.map(p=>p.requestId)).size===canonical.length,'duplicate purchase request ID.');
 demand(new Set(canonical.map(p=>p.id)).size===canonical.length,'conflicting purchase source ID.');
 const sum=canonical.reduce((n,p)=>n+BigInt(p.totalCents),0n);
 demand(sum<=BigInt(Number.MAX_SAFE_INTEGER),'summed purchase cost exceeds exact supported cents.');
 const signature=hash([FORMAT,snapshot.year,snapshot.sha256??null,canonical]);
 const metadata={sheet:SHEET,signature,basis:'purchase_cost',count:canonical.length,totalCents:Number(sum),generatedStartRow:null,months:[],readonlyRanges:[]};
 if(!canonical.length)return {snapshot,signature,metadata};
 demand(Number.isSafeInteger(sheet.maxRow)&&sheet.maxRow>=1&&sheet.maxRow<=MAX_ROW&&Number.isSafeInteger(sheet.maxCol)&&sheet.maxCol>=7&&sheet.maxCol<=16384,'invalid original worksheet bounds.');
 demand(Array.isArray(snapshot.styles)&&snapshot.styles.length>0&&snapshot.styles.length<=MAX_STYLES,'missing original cell styles.');
 for(const address of Object.keys(sheet.cells)){
  const match=/^([A-Z]+)([1-9]\d*)$/.exec(address);
  demand(match&&Number(match[2])<=sheet.maxRow&&Model.columnNumber(match[1])<=sheet.maxCol,'original cell lies outside declared bounds.');
 }
 const groups=Array.from({length:12},(_,month)=>canonical.filter(p=>Number(p.purchaseDate.slice(5,7))===month+1));
 const generatedRows=groups.reduce((n,rows)=>n+Math.max(20,rows.length)+4,0),endRow=sheet.maxRow+generatedRows;
 const sourceCells=snapshot.sheets.reduce((n,s)=>n+Object.keys(s.cells).length,0);
 demand(endRow<=MAX_ROW&&sourceCells+generatedRows*sheet.maxCol<=MAX_CELLS,'generated rows exceed the supported workbook capacity; nothing was truncated.');
 demand((sheet.tables?.length??0)+12<=2000,'too many worksheet tables.');
 const styles=[...snapshot.styles],styleCache=new Map(),runs=new Map();
 for(const run of sheet.styleRuns||[]){if(!runs.has(run[0]))runs.set(run[0],[]);runs.get(run[0]).push(run);}
 function styleAt(row,col){
  const pick=value=>typeof value==='object'&&value!==null?value.styleId:value;
  const id=sheet.cells[Model.columnName(col)+row]?.styleId??runs.get(row)?.find(r=>col>=r[1]&&col<=r[2])?.[3]??
   pick(sheet.rowStyles?.[row])??pick(sheet.columnStyles?.[col])??sheet.defaultStyleId??0;
  demand(Number.isInteger(id)&&id>=0&&id<snapshot.styles.length,'invalid original style reference.');return id;
 }
 function adjusted(id,kind){
  const key=id+':'+kind;if(styleCache.has(key))return styleCache.get(key);
  const style=copy(styles[id]);
  if(kind==='quantity')style.numberFormat='0.######';
  else if(kind==='usd')style.numberFormat='$#,##0.00';
  else style.alignment={...style.alignment,wrapText:true};
  demand(styles.length<MAX_STYLES,'generated styles exceed supported capacity.');
  const next=styles.push(style)-1;styleCache.set(key,next);return next;
 }
 const resultSheet={...sheet,cells:{...sheet.cells},tables:[...(sheet.tables||[])],rowHeights:{...(sheet.rowHeights||{})},columnWidths:{...(sheet.columnWidths||{})},merges:[...(sheet.merges||[])],
  maxRow:endRow,dimension:'A1:'+Model.columnName(sheet.maxCol)+endRow,accountingBandwidthProjection:{format:FORMAT,signature,generatedStartRow:sheet.maxRow+1}};
 const usedNames=new Set(snapshot.sheets.flatMap(s=>(s.tables||[]).map(t=>t.name.toLowerCase())));
 metadata.generatedStartRow=sheet.maxRow+1;
 metadata.readonlyRanges=['A'+metadata.generatedStartRow+':'+Model.columnName(sheet.maxCol)+endRow];
 let title=metadata.generatedStartRow;
 for(let month=0;month<12;month++){
  const rows=groups[month],capacity=Math.max(20,rows.length),header=title+1,first=title+2,last=first+capacity-1,total=last+1;
  const originalTitle=1+24*month,originalHeader=2+24*month,originalFirst=3+24*month,originalTotal=23+24*month;
  const prototype=(sheet.tables||[]).find(t=>t.ref==='B'+originalHeader+':G'+(originalTotal-1))||(sheet.tables||[])[0];
  const fallbackHeaders=['Date','Name','Quantity','Description','Unit Price','Payments'];
  const headers=Array.from({length:6},(_,i)=>sheet.cells[Model.columnName(i+2)+originalHeader]?.value??prototype?.columns?.[i]??fallbackHeaders[i]);
  demand(headers.every(v=>typeof v==='string'&&v)&&new Set(headers.map(v=>v.toLowerCase())).size===6,'invalid original purchase table headers.');
  for(let row=title;row<=total+1;row++){
   const sourceRow=row===title?originalTitle:row===header?originalHeader:row===total?originalTotal:row===total+1?originalTotal+1:originalFirst+(row-first)%20;
   resultSheet.rowHeights[row]=sheet.rowHeights?.[sourceRow]??sheet.defaultRowHeight??20;
   for(let col=1;col<=sheet.maxCol;col++){
    let id=styleAt(sourceRow,col);
    if(row>=first&&row<=last&&col===4)id=adjusted(id,'quantity');
    if(row>=first&&row<=last&&col===5)id=adjusted(id,'description');
    if((row>=first&&row<=last&&(col===6||col===7))||(row===total&&col===7))id=adjusted(id,'usd');
    resultSheet.cells[Model.columnName(col)+row]={value:null,styleId:id,editable:false};
   }
  }
  const put=(col,row,value)=>{resultSheet.cells[col+row].value=value;};
  const monthKey=snapshot.year+'-'+String(month+1).padStart(2,'0');
  put('B',title,monthKey+' · Linked bandwidth purchases (cost)');
  headers.forEach((value,i)=>put(Model.columnName(i+2),header,value));
  rows.forEach((p,index)=>{
   const row=first+index,description=(p.note?p.note+'\n':'')+p.typeName+' · '+p.unit;
   put('B',row,excelDate(p.purchaseDate));put('C',row,p.supplierName);put('D',row,p.quantityMicros/1000000);
   put('E',row,description);put('F',row,p.unitPriceCents/100);put('G',row,p.totalCents/100);
   const lines=description.split(/\r\n|\r|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/80)),0);
   resultSheet.rowHeights[row]=Math.max(resultSheet.rowHeights[row],Math.min(10000,lines*18));
  });
  const totalCents=Number(rows.reduce((n,p)=>n+BigInt(p.totalCents),0n));
  put('B',total,'Total purchase cost');put('G',total,totalCents/100);
  const tableName='AccountingBandwidth'+snapshot.year+'M'+String(month+1).padStart(2,'0');
  demand(!usedNames.has(tableName.toLowerCase()),'generated table name conflicts with the original workbook.');
  usedNames.add(tableName.toLowerCase());
  resultSheet.merges.push('B'+title+':G'+title,'B'+total+':F'+total);
  const tableRef='B'+header+':G'+last;
  resultSheet.tables.push({name:tableName,ref:tableRef,columns:headers,headerRowCount:1,totalsRowCount:0,...prototype?.styleInfo?{styleInfo:copy(prototype.styleInfo)}:{}});
  metadata.months.push({month:monthKey,ref:'B'+title,headerRow:header,firstRow:first,lastRow:last,totalRow:total,count:rows.length,totalCents,tableRef,range:'B'+title+':G'+total,
   rows:rows.map((p,i)=>({row:first+i,id:p.id,requestId:p.requestId,receiptNo:p.receiptNo}))});
  title=total+2;
 }
 const derived={...snapshot,styles,sheets:snapshot.sheets.map(s=>s===sheet?resultSheet:s)};
 Model.validateSnapshot(derived);
 return {snapshot:derived,signature,metadata};
}
module.exports={project};