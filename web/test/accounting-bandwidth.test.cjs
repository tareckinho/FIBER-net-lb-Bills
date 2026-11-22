'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {project}=require('../app/accounting-bandwidth.cjs'),Model=require('../app/accounting-workbook.cjs');
function fixture(){
 const cells={},tables=[],styleRuns=[],rowHeights={};
 for(let m=0;m<12;m++){
  const header=2+24*m,first=header+1,last=header+20,total=last+1;
  ['Date','Name','Quantity','Description','Unit Price','Payment'].forEach((v,c)=>{cells[Model.columnName(c+2)+header]={value:v,styleId:1};});
  cells['G'+first]={value:5,styleId:2};cells['G'+total]={value:5,formula:'=SUM(G'+first+':G'+last+')',styleId:3};
  styleRuns.push([header-1,1,8,1],[header,1,8,1],[first,1,8,2],[total,1,8,3]);rowHeights[header]=29;rowHeights[first]=22;
  tables.push({name:'OriginalMonth'+m,ref:'B'+header+':G'+last,columns:['Date','Name','Quantity','Description','Unit Price','Payment'],headerRowCount:1,totalsRowCount:0,
   styleInfo:{name:'TableStyleMedium23',showRowStripes:true,resolved:{header:{fill:'#DCE6F1'}}}});
 }
 return {year:2026,sha256:'a'.repeat(64),styles:[
  {numberFormat:'General',font:{name:'Calibri',size:10},fill:{pattern:'none'}},
  {numberFormat:'General',font:{name:'Calibri',size:10,bold:true},fill:{pattern:'solid',color:'#DCE6F1'}},
  {numberFormat:'0.00',font:{name:'Calibri',size:10},alignment:{horizontal:'right'}},
  {numberFormat:'$0.00',font:{name:'Calibri',size:10,bold:true}}],
  sheets:[{name:'Bandwidth',maxRow:288,maxCol:8,dimension:'A1:H288',cells,tables,styleRuns,columnWidths:{1:9,2:205,3:174,4:92,5:619,6:93,7:161,8:68},
   rowHeights,defaultRowHeight:20,hiddenRows:[],filteredRows:[],merges:[]},
  {name:'Summary',maxRow:1,maxCol:1,cells:{A1:{value:5,formula:'=Bandwidth!G23'}}}]};
}
function receipt(id=1,changes={}){
 const requestId='fictional-purchase-'+String(id).padStart(5,'0');
 return {id,requestId,receiptNo:'BWP-'+requestId,supplierId:1,typeId:1,purchaseDate:'2026-01-12',supplierName:'Saved fictional supplier',typeName:'Fictional transit',
  unit:'Mbps',quantityMicros:1000000,unitPriceCents:200,totalCents:200,note:'Original description\nSecond line',...changes};
}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
test('appended receipt tables leave every original coordinate, formula, cross-sheet total and source object intact',()=>{
 const source=freeze(fixture()),before=JSON.stringify(source),p=freeze(receipt()),result=project(source,[p]),sheet=result.snapshot.sheets[0],m=result.metadata.months[0];
 assert.equal(JSON.stringify(source),before);assert.notStrictEqual(result.snapshot,source);
 assert.equal(result.metadata.basis,'purchase_cost');assert.equal(result.metadata.generatedStartRow,289);assert.equal(result.metadata.months.length,12);
 for(const [ref,cell]of Object.entries(source.sheets[0].cells))assert.deepEqual(sheet.cells[ref],cell);
 assert.deepEqual(sheet.columnWidths,source.sheets[0].columnWidths);assert.deepEqual(sheet.styleRuns,source.sheets[0].styleRuns);
 assert.deepEqual(sheet.merges.slice(0,source.sheets[0].merges.length),source.sheets[0].merges);
 assert.ok(sheet.merges.includes('B'+Number(m.ref.slice(1))+':G'+Number(m.ref.slice(1))));
 assert.ok(sheet.merges.includes('B'+m.totalRow+':F'+m.totalRow));
 assert.equal(sheet.cells['C'+m.firstRow].value,p.supplierName);assert.equal(sheet.cells['E'+m.firstRow].value,p.note+'\n'+p.typeName+' · Mbps');
 assert.equal(sheet.cells['B'+m.firstRow].value,46034);assert.equal(result.snapshot.styles[sheet.cells['D'+m.firstRow].styleId].numberFormat,'0.######');
 assert.equal(sheet.cells['B'+m.headerRow].styleId,1);assert.equal(sheet.rowHeights[m.headerRow],29);
 assert.deepEqual(result.snapshot.styles[sheet.cells['G'+m.totalRow].styleId],{...source.styles[3],numberFormat:'$#,##0.00'});assert.equal(sheet.tables[12].styleInfo.name,'TableStyleMedium23');
 assert.deepEqual(result.snapshot.styles.slice(0,source.styles.length),source.styles);
 assert.equal(Model.calculate(result.snapshot).values.Summary.A1,5);
 for(let row=289;row<=sheet.maxRow;row++)for(let col=1;col<=sheet.maxCol;col++)assert.equal(sheet.cells[Model.columnName(col)+row].editable,false);
 assert.throws(()=>project(result.snapshot,[p]),/original snapshot/);
 const again=project(source,[p]);assert.equal(again.signature,result.signature);assert.deepEqual(again.snapshot,result.snapshot);
});
test('exact per-purchase rounding is summed once, dates select months, paid fields never change costs and equal-value receipts remain separate',()=>{
 const source=fixture(),a=receipt(1,{quantityMicros:500000,unitPriceCents:1,totalCents:1,note:''}),b=receipt(2,{quantityMicros:500000,unitPriceCents:1,totalCents:1,note:''});
 const c=receipt(3,{purchaseDate:'2026-02-28',unit:'Gbps',quantityMicros:1234567,unitPriceCents:100,totalCents:123});
 const result=project(source,[c,b,a]),jan=result.metadata.months[0],feb=result.metadata.months[1],sheet=result.snapshot.sheets[0];
 assert.equal(jan.count,2);assert.equal(jan.totalCents,2);assert.equal(sheet.cells['G'+jan.totalRow].value,.02);
 assert.equal(sheet.cells['G'+jan.firstRow].value,.01);assert.equal(sheet.cells['G'+(jan.firstRow+1)].value,.01);
 assert.equal(sheet.cells['D'+feb.firstRow].value,1.234567);assert.match(sheet.cells['E'+feb.firstRow].value,/Gbps/);
 assert.equal(feb.totalCents,123);assert.equal(result.metadata.totalCents,125);
 const reordered=project(source,[a,b,c]);assert.equal(reordered.signature,result.signature);
 const paid=project(source,[{...a,paidCents:999,paidAmount:9.99},b,c]);assert.equal(paid.signature,result.signature);
 assert.notEqual(project(source,[{...a,note:'Changed description'},b,c]).signature,result.signature);
 assert.notEqual(project(source,[{...a,supplierName:'Another saved name'},b,c]).signature,result.signature);
 const added=project(source,[a,b,c,receipt(4)]);
 assert.notEqual(added.signature,result.signature);
 assert.deepEqual(added.snapshot.sheets[0].tables.slice(12).map(t=>t.name),sheet.tables.slice(12).map(t=>t.name));
});
test('more than twenty receipts expand without truncation and all twelve month references remain below the original grid',()=>{
 const rows=Array.from({length:25},(_,i)=>receipt(i+1)),source=fixture(),result=project(source,rows),jan=result.metadata.months[0],feb=result.metadata.months[1];
 assert.equal(jan.lastRow-jan.firstRow+1,25);assert.equal(jan.count,25);assert.equal(jan.totalCents,5000);
 assert.equal(result.snapshot.sheets[0].cells['G'+jan.totalRow].value,50);assert.equal(result.metadata.count,25);
 assert.equal(result.snapshot.sheets[0].maxRow,581);assert.equal(feb.lastRow-feb.firstRow+1,20);
 assert.equal(jan.rows.length,25);assert.equal(jan.rows[24].id,25);
 for(const month of result.metadata.months){assert.ok(Number(month.ref.slice(1))>=289);assert.ok(month.firstRow<month.totalRow);}
});
test('empty and unrelated workbooks preserve exact source identity without creating tables or totals',()=>{
 const source=fixture(),empty=project(source,[]);assert.strictEqual(empty.snapshot,source);assert.equal(empty.metadata.count,0);
 assert.equal(empty.metadata.generatedStartRow,null);assert.deepEqual(empty.metadata.months,[]);
 const unrelated={year:2026,sheets:[{name:'Other',cells:{A1:{value:1}}}]},result=project(unrelated,[receipt()]);
 assert.strictEqual(result.snapshot,unrelated);assert.equal(result.metadata,null);
});
test('duplicates, source identity conflicts, invalid calendar/year/units/scales and inconsistent rounded costs fail closed',()=>{
 const source=fixture(),p=receipt();
 assert.throws(()=>project(source,[p,p]),/duplicate purchase request/);
 assert.throws(()=>project(source,[p,{...receipt(2),id:1}]),/conflicting purchase source/);
 for(const changes of [{purchaseDate:'2026-02-30'},{purchaseDate:'2025-01-01'},{quantityMicros:1.2},{unitPriceCents:1.5},{totalCents:201},
  {supplierId:0},{typeId:0},{id:0},{requestId:'bad'},{receiptNo:'wrong'},{unit:'TB'},{supplierName:'bad\nname'}]){
  assert.throws(()=>project(source,[receipt(1,changes)]),/Accounting bandwidth projection/);
 }
 const overflow={...fixture(),sheets:fixture().sheets.map((s,i)=>i===0?{...s,maxRow:1048500}:s)};
 assert.throws(()=>project(overflow,[p]),/capacity/);
});

test('generated unit prices, costs and monthly totals use USD while original mixed-currency styles and six-decimal quantities remain intact',()=>{
 const source=fixture(),original=source.sheets[0];
 const priceStyle={numberFormat:'"LBP" #,##0.00',font:{name:'Calibri',size:10,color:'#123456'},fill:{pattern:'solid',color:'#CCDDEE'},border:{bottom:{style:'thin',color:'#445566'}}};
 const costStyle={numberFormat:'0.00" LBP"',font:{name:'Calibri',size:11,italic:true},alignment:{horizontal:'right'},border:{left:{style:'double',color:'#778899'}}};
 const totalStyle={numberFormat:'"LBP" #,##0',font:{name:'Calibri',size:12,bold:true},fill:{pattern:'solid',color:'#DDEEFF'},border:{top:{style:'double',color:'#112233'}}};
 source.styles.push(priceStyle,costStyle,totalStyle);
 for(let month=0;month<12;month++){
  const first=3+24*month,total=23+24*month;
  for(let row=first;row<total;row++){
   original.cells['F'+row]={...(original.cells['F'+row]||{value:null}),styleId:4};
   original.cells['G'+row]={...(original.cells['G'+row]||{value:null}),styleId:5};
  }
  original.cells['G'+total]={...original.cells['G'+total],styleId:6};
 }
 const before=JSON.stringify(source);freeze(source);
 const p=receipt(1,{purchaseDate:'2026-11-12',quantityMicros:1234567,unitPriceCents:123,totalCents:152});
 const result=project(source,[p]),sheet=result.snapshot.sheets[0];
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(result.snapshot.styles.slice(0,source.styles.length),source.styles);
 for(const [ref,cell]of Object.entries(original.cells))assert.deepEqual(sheet.cells[ref],cell);
 for(const month of result.metadata.months){
  for(let row=month.firstRow;row<=month.lastRow;row++){
   assert.deepEqual(result.snapshot.styles[sheet.cells['F'+row].styleId],{...priceStyle,numberFormat:'$#,##0.00'});
   assert.deepEqual(result.snapshot.styles[sheet.cells['G'+row].styleId],{...costStyle,numberFormat:'$#,##0.00'});
   assert.equal(result.snapshot.styles[sheet.cells['D'+row].styleId].numberFormat,'0.######');
  }
  assert.deepEqual(result.snapshot.styles[sheet.cells['G'+month.totalRow].styleId],{...totalStyle,numberFormat:'$#,##0.00'});
 }
 const november=result.metadata.months[10];
 assert.equal(sheet.cells['F'+november.firstRow].value,1.23);
 assert.equal(sheet.cells['G'+november.firstRow].value,1.52);
 assert.equal(sheet.cells['G'+november.totalRow].value,1.52);
 assert.equal(sheet.cells['D'+november.firstRow].value,1.234567);
 assert.equal(original.cells.F243.styleId,4);assert.equal(original.cells.G243.styleId,5);assert.equal(original.cells.G263.styleId,6);
 assert.match(source.styles[4].numberFormat,/LBP/);assert.match(source.styles[5].numberFormat,/LBP/);assert.match(source.styles[6].numberFormat,/LBP/);
});
