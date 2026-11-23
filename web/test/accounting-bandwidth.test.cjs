'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {project,purchaseFingerprint}=require('../app/accounting-bandwidth.cjs'),Model=require('../app/accounting-workbook.cjs');
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fixture(){
 const styles=[{numberFormat:'"LBP" #,##0.00',font:{name:'Calibri',size:10},fill:{pattern:'solid',color:'#DCE6F1'},border:{bottom:{style:'thin',color:'#112233'}}},{numberFormat:'dd/mm/yyyy',font:{name:'Calibri',size:10}}];
 const base=(name,maxRow,maxCol,cells,extra={})=>({name,maxRow,maxCol,cells,defaultRowHeight:20,columnWidths:{2:205,3:174,4:92,5:619,6:93,7:161},rowHeights:{},styleRuns:[],tables:[],merges:[],hiddenRows:[],filteredRows:[],...extra});
 const cells={},tables=[];
 for(let m=0;m<12;m++){
  const first=3+24*m,last=22+24*m,total=23+24*m,start=1+24*m,column=Model.columnName(m+2);
  ['Date','Name','Quantity','Description','Unit Price','Payment'].forEach((v,i)=>cells[Model.columnName(i+2)+(first-1)]={value:v,styleId:0});
  for(let row=first;row<=last;row++)cells['G'+row]={value:0,formula:'=D'+row+'*F'+row,styleId:0};
  cells['E'+start]={value:100,formula:'=SUM(Accounting!'+column+'12:'+column+'39)',styleId:0};
  cells['D'+start]={value:.5,styleId:0};cells['G'+start]={value:50,formula:'=E'+start+'*D'+start,styleId:0};
  cells['C'+total]={value:10,styleId:0};cells['G'+total]={value:0,formula:'=SUM(G'+first+':G'+last+')',styleId:0};
  cells['E'+total]={value:60,formula:'=(G'+start+'+C'+total+')-G'+total,styleId:0};
  tables.push({name:'OriginalMonth'+m,ref:'B'+(first-1)+':G'+last,columns:['Date','Name','Quantity','Description','Unit Price','Payment'],headerRowCount:1,totalsRowCount:0});
 }
 cells.C3={value:'Legacy ISP',styleId:0};cells.D3={value:2,styleId:0};cells.F3={value:3,styleId:0};cells.G3.value=6;
 const bandwidth=base('Bandwidth',288,8,cells,{dimension:'A1:H288',tables});
 const monthly=MONTHS.map((name,m)=>{
  const first=3+24*m,last=22+24*m,cells={A1:{value:'No.'}};
  for(let row=2;row<=11;row++){
   cells['A'+row]={value:row-1};cells['B'+row]={value:'ISP'};cells['C'+row]={value:row===2?'Legacy ISP':0};
   cells['D'+row]={value:0,formula:'=IF(C'+row+'<>"",SUMIF(Bandwidth!C'+first+':C'+last+',C'+row+',Bandwidth!G'+first+':G'+last+'),"")*-1'};
   cells['E'+row]={value:0};cells['F'+row]={value:0};cells['M'+row]={value:0,formula:'=SUM(E'+row+':L'+row+')'};
   cells['N'+row]={value:0,formula:'=D'+row+'-M'+row};
  }return base(name,201,14,cells);
 });
 const annual={A2:{value:'**Legacy ISP'},A3:{value:'**Future ISP'},A12:{value:'Reseller Example'}};
 for(let row=2;row<=11;row++){
  for(let m=0;m<12;m++){const col=Model.columnName(m+2);annual[col+row]={value:0,formula:'=IF(A'+row+'<>"",SUMIF('+MONTHS[m]+'!C2:C200,A'+row+','+MONTHS[m]+'!D2:D200),"")'};}
  annual['N'+row]={value:0,formula:'=SUM(B'+row+':M'+row+')'};annual['O'+row]={value:0};annual['P'+row]={value:0,formula:'=N'+row+'-O'+row};
 }
 for(let m=0;m<12;m++)annual[Model.columnName(m+2)+'12']={value:100};
 return {year:2026,sha256:'a'.repeat(64),styles,sheets:[bandwidth,...monthly,base('Accounting',40,16,annual)]};
}
function receipt(id=1,changes={}){
 const requestId='fictional-purchase-'+String(id).padStart(5,'0');
 return {id,requestId,receiptNo:'BWP-'+requestId,supplierId:1,typeId:1,purchaseDate:'2026-01-12',supplierName:'Future ISP',typeName:'Fictional transit',unit:'Mbps',quantityMicros:1000000,unitPriceCents:200,totalCents:200,note:'Original description\nSecond line',recordedAt:'2026-06-15T10:00:00Z',...changes};
}
function baseline(rows=[]){return {format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-BASELINE-1',year:2026,sourceSha256:'a'.repeat(64),cutoverAt:'2026-06-15T08:00:00.000Z',purchases:rows.map(p=>({requestId:p.requestId,fingerprint:purchaseFingerprint(p)}))};}
const freeze=v=>{if(v&&typeof v==='object'){Object.freeze(v);Object.values(v).forEach(freeze);}return v;};
const by=(book,name)=>book.sheets.find(s=>s.name===name);
test('all captured fictional receipts are excluded even from blank months; no baseline never backfills imports',()=>{
 const source=freeze(fixture()),before=JSON.stringify(source),old=Array.from({length:4},(_,i)=>receipt(i+1,{purchaseDate:'2026-11-12'}));
 const result=project(source,old,{baseline:baseline(old)});
 assert.strictEqual(result.snapshot,source);assert.equal(result.metadata.count,0);assert.equal(result.metadata.baselineCount,4);assert.deepEqual(result.managedCells,{});
 assert.equal(result.metadata.months[10].count,0);assert.equal(JSON.stringify(source),before);
 const disabled=project(source,old);assert.strictEqual(disabled.snapshot,source);assert.equal(disabled.metadata,null);
 assert.equal(project({...source,year:2027},[],{baseline:baseline(old)}).metadata,null);
});
test('future receipts fill the original grid and recalculate purchase total, monthly charge, annual account and bandwidth surplus together',()=>{
 const source=freeze(fixture()),before=JSON.stringify(source),old=receipt(1),fresh=receipt(22),result=project(source,[fresh,old],{baseline:baseline([old])});
 const bw=by(result.snapshot,'Bandwidth'),values=Model.calculate(result.snapshot).values;
 assert.equal(result.metadata.mode,'in_place');assert.equal(result.metadata.count,1);assert.equal(result.metadata.purchases[0].id,22);
 assert.equal(bw.maxRow,288);assert.deepEqual(bw.tables,source.sheets[0].tables);assert.deepEqual(bw.columnWidths,source.sheets[0].columnWidths);
 assert.equal(bw.cells.C3.value,'Legacy ISP');assert.equal(bw.cells.G3.formula,'=D3*F3');assert.equal(bw.cells.G4.value,2);
 assert.equal(values.Bandwidth.G23,8);assert.equal(values.Jan.D3,-2);assert.equal(values.Accounting.B3,-2);assert.equal(values.Bandwidth.E23,52);
 assert.equal(result.metadata.months[0].linkedTotalCents,200);assert.equal(result.metadata.months[0].monthlyTotalCents,800);
 assert.equal(by(result.snapshot,'Jan').cells.C3.value,'Future ISP');assert.ok(result.managedCells.Jan.includes('C3'));
 for(const ref of result.managedCells.Bandwidth)assert.equal(bw.cells[ref].editable,false);
 assert.equal(by(result.snapshot,'Jan').cells.C3.editable,false);assert.equal(JSON.stringify(source),before);
 for(const ref of ['F4','G4'])assert.equal(result.snapshot.styles[bw.cells[ref].styleId].numberFormat,'$#,##0.00');
 assert.equal(result.snapshot.styles[bw.cells.D4.styleId].numberFormat,'0.######');
 assert.deepEqual(result.snapshot.styles.slice(0,source.styles.length),source.styles);assert.equal(Model.calculate(result.snapshot).errors.length,0);
});
test('source inputs, literal cost-only rows, zero literals and any active override row are protected',()=>{
 const source=fixture(),bw=by(source,'Bandwidth');bw.cells.G4={value:7};bw.cells.G5={value:0};bw.cells.D6={value:0};
 by(source,'Jan').cells.C3={value:'Future ISP'};
 const overrides={Bandwidth:{B7:null,F3:4}},result=project(freeze(source),[receipt(22)],{baseline:baseline(),overrides});
 assert.equal(result.metadata.purchases[0].row,8);assert.equal(by(result.snapshot,'Bandwidth').cells.G4.value,7);assert.equal(by(result.snapshot,'Bandwidth').cells.G5.value,0);
 assert.ok(!result.managedCells.Bandwidth.includes('B7'));assert.equal(Model.calculate(result.snapshot,overrides).values.Bandwidth.G23,17);
 assert.notEqual(result.signature,project(source,[receipt(22)],{baseline:baseline(),overrides:{Bandwidth:{B7:null,F3:5}}}).signature);
});
test('overflow groups only the same saved supplier, preserves every receipt and never invents mixed quantity or rate totals',()=>{
 const source=fixture(),bw=by(source,'Bandwidth');
 for(let row=3;row<=21;row++){bw.cells['C'+row]={value:'Legacy ISP'};bw.cells['D'+row]={value:1};bw.cells['F'+row]={value:1};bw.cells['G'+row].value=1;}
 const purchases=[receipt(22,{unitPriceCents:100,totalCents:100}),receipt(23,{quantityMicros:2000000,unitPriceCents:200,totalCents:400}),receipt(24,{unit:'Gbps',unitPriceCents:100,totalCents:100})];
 const result=project(freeze(source),purchases,{baseline:baseline()}),sheet=by(result.snapshot,'Bandwidth'),m=result.metadata.months[0];
 assert.equal(m.count,3);assert.deepEqual(m.rows.map(p=>p.row),[22,22,22]);assert.equal(m.purchases.length,3);
 assert.equal(sheet.cells.D22.value,null);assert.equal(sheet.cells.F22.value,null);assert.equal(sheet.cells.G22.value,6);assert.match(sheet.cells.E22.value,/Multiple purchases \(3\)/);
 assert.equal(Model.calculate(result.snapshot).values.Accounting.B3,-6);assert.equal(m.monthlyTotalCents,2500);
 assert.throws(()=>project(source,[...purchases,receipt(25,{supplierName:'Other ISP'})],{baseline:baseline()}),/not enough safe original monthly rows/);
});
test('exact per-receipt rounded cents remain separate and equal-valued new receipts are not deduplicated',()=>{
 const source=fixture(),a=receipt(22,{quantityMicros:500000,unitPriceCents:1,totalCents:1}),b=receipt(23,{quantityMicros:500000,unitPriceCents:1,totalCents:1});
 const result=project(source,[b,a],{baseline:baseline()}),sheet=by(result.snapshot,'Bandwidth');
 assert.equal(result.metadata.count,2);assert.equal(sheet.cells.G4.value,.01);assert.equal(sheet.cells.G5.value,.01);
 assert.equal(Model.calculate(result.snapshot).values.Accounting.B3,-.02);assert.equal(result.metadata.months[0].monthlyTotalCents,602);
 assert.equal(result.signature,project(source,[a,b],{baseline:baseline()}).signature);
});
test('unknown suppliers use only safe provider slots and leave payments and manually edited placeholders intact',()=>{
 const source=fixture(),jan=by(source,'Jan'),annual=by(source,'Accounting');
 jan.cells.E3={value:9};annual.cells.O4={value:8};
 const result=project(freeze(source),[receipt(22,{supplierName:'New ISP'})],{baseline:baseline(),overrides:{Accounting:{A5:null}}});
 assert.equal(by(result.snapshot,'Jan').cells.C4.value,'New ISP');assert.equal(by(result.snapshot,'Accounting').cells.A6.value,'**New ISP');
 assert.equal(by(result.snapshot,'Jan').cells.E3.value,9);assert.equal(by(result.snapshot,'Accounting').cells.O4.value,8);
 assert.equal(Model.calculate(result.snapshot,{Accounting:{A5:null}}).values.Accounting.B6,-2);
 assert.equal(by(result.snapshot,'Accounting').cells.A6.editable,false);
 const full=fixture();for(let row=2;row<=11;row++)by(full,'Accounting').cells['A'+row]={value:'**Existing '+row};
 assert.throws(()=>project(full,[receipt(22,{supplierName:'Unknown ISP'})],{baseline:baseline()}),/no safe Accounting provider placeholder/);
});
test('recalculated active wildcard accounts cannot be overwritten or silently double-count future purchases',()=>{
 const source=fixture(),annual=by(source,'Accounting');annual.cells.A4={value:'*'};
 assert.throws(()=>project(freeze(source),[receipt(22,{supplierName:'New ISP'})],{baseline:baseline()}),/broad Accounting provider criteria/);
 const payment=fixture(),jan=by(payment,'Jan');jan.cells.M3={value:0,formula:'=Accounting!O2'};
 const result=project(payment,[receipt(22)],{baseline:baseline(),overrides:{Accounting:{O2:5}}});
 assert.equal(by(result.snapshot,'Jan').cells.C4.value,'Future ISP');assert.equal(by(result.snapshot,'Jan').cells.C3.value,0);
});
test('baseline missing or changed proofs, duplicate identities, unsupported aliases and malformed dates fail closed',()=>{
 const source=fixture(),old=receipt(1),proof=baseline([old]);
 assert.throws(()=>project(source,[],{baseline:proof}),/baseline receipt is missing/);
 assert.throws(()=>project(source,[{...old,note:'Changed'}],{baseline:proof}),/missing or changed/);
 assert.throws(()=>project(source,[old],{baseline:{...proof,sourceSha256:'b'.repeat(64)}}),/does not match/);
 assert.throws(()=>project(source,[old],{baseline:{...proof,purchases:[...proof.purchases,...proof.purchases]}}),/duplicate baseline/);
 assert.throws(()=>project(source,[old,old],{baseline:baseline()}),/duplicate purchase request/);
 for(const name of ['Vendor*','Vendor?','Vendor~','>Vendor','=Vendor'])assert.throws(()=>project(source,[receipt(22,{supplierName:name})],{baseline:baseline()}),/reviewed literal alias/);
 assert.throws(()=>purchaseFingerprint(receipt(1,{purchaseDate:'2026-02-30'})),/calendar date/);
 assert.throws(()=>project(source,[receipt(22,{totalCents:201})],{baseline:baseline()}),/exact rounded/);
 assert.equal(purchaseFingerprint({...old,paidCents:99}),purchaseFingerprint(old));
});

test('actual Due Date template placeholders remain unchanged while genuine dates and payments reserve their provider rows',()=>{
 const source=fixture(),jan=by(source,'Jan');jan.cells.A1={value:'Due Date'};
 for(let row=2;row<=11;row++)jan.cells['A'+row]={value:36526,styleId:1};
 jan.cells.A3={value:46050,styleId:1};
 const before=JSON.stringify(source),result=project(freeze(source),[receipt(22)],{baseline:baseline()});
 assert.equal(by(result.snapshot,'Jan').cells.C4.value,'Future ISP');
 assert.deepEqual(by(result.snapshot,'Jan').cells.A4,{value:36526,styleId:1});
 assert.equal(by(result.snapshot,'Jan').cells.A3.value,46050);assert.equal(JSON.stringify(source),before);
});

test('provider identity stays in place after post-link cash and date edits while earlier or deleted claims reserve slots forever',()=>{
 const source=fixture(),jan=by(source,'Jan');jan.cells.A1={value:'Due Date'};
 for(let row=2;row<=11;row++)jan.cells['A'+row]={value:36526,styleId:1};
 const old={Jan:{E3:{createdAt:'2026-06-15T09:00:00Z',deleted:true}}};
 const first=project(source,[receipt(22)],{baseline:baseline(),origins:old});
 assert.equal(by(first.snapshot,'Jan').cells.C4.value,'Future ISP');
 const origins={Jan:{...old.Jan,E4:{createdAt:'2026-06-15T11:00:00Z',deleted:false},A4:{createdAt:'2026-06-15T12:00:00Z',deleted:false}}};
 const overrides={Jan:{E4:1,A4:46050}};
 const next=project(freeze(source),[receipt(22),receipt(23,{recordedAt:'2026-06-15T10:30:00Z'})],{baseline:baseline(),overrides,origins});
 assert.equal(by(next.snapshot,'Jan').cells.C4.value,'Future ISP');assert.equal(by(next.snapshot,'Jan').cells.C3.value,0);
 const values=Model.calculate(next.snapshot,overrides).values;
 assert.equal(values.Jan.D4,-4);assert.equal(values.Jan.M4,1);assert.equal(values.Jan.N4,-5);assert.equal(values.Jan.A4,46050);assert.equal(values.Accounting.B3,-4);
 const claim=project(source,[receipt(22)],{baseline:baseline(),origins:{Jan:{C3:{createdAt:'2026-06-15T11:00:00Z',deleted:true}}}});
 assert.equal(by(claim.snapshot,'Jan').cells.C4.value,'Future ISP');
 const missing=project(source,[receipt(22)],{baseline:baseline(),origins:{Jan:{E3:{createdAt:null,deleted:true}}}});
 assert.equal(by(missing.snapshot,'Jan').cells.C4.value,'Future ISP');
 assert.notEqual(next.signature,first.signature);
});

test('annual post-link payments keep their provider alias and deleted Bandwidth input records remain reusable without erasing prior results',()=>{
 const source=fixture(),p=receipt(22,{supplierName:'New ISP'});
 const options={baseline:baseline(),overrides:{Accounting:{O4:1}},origins:{Accounting:{O4:{createdAt:'2026-06-15T11:00:00Z',deleted:false}},Bandwidth:{C4:{createdAt:'2026-06-15T09:00:00Z',deleted:true}}}};
 const result=project(freeze(source),[p],options);
 assert.equal(by(result.snapshot,'Accounting').cells.A4.value,'**New ISP');assert.equal(result.metadata.purchases[0].row,4);
 const values=Model.calculate(result.snapshot,options.overrides).values;assert.equal(values.Accounting.B4,-2);assert.equal(values.Accounting.O4,1);
 assert.equal(by(result.snapshot,'Accounting').cells.A4.editable,false);
 const claimed=project(source,[p],{baseline:baseline(),origins:{Accounting:{A4:{createdAt:'2026-06-15T11:00:00Z',deleted:true}}}});
 assert.equal(by(claimed.snapshot,'Accounting').cells.A5.value,'**New ISP');
});


test('editable Bandwidth margin notes do not relocate the linked B:G receipt footprint',()=>{
 const source=freeze(fixture()),p=receipt(22),initial=project(source,[p],{baseline:baseline()});
 const row=initial.metadata.purchases[0].row,overrides={Bandwidth:{['H'+row]:'Preserved margin note',['A'+row]:'Separate margin'}};
 const result=project(source,[p],{baseline:baseline(),overrides,origins:{Bandwidth:{['H'+row]:{createdAt:'2026-06-15T09:00:00Z',deleted:false}}}});
 assert.equal(result.metadata.purchases[0].row,row);assert.equal(Model.calculate(result.snapshot,overrides).values.Bandwidth['H'+row],'Preserved margin note');
 assert.equal(Model.calculate(result.snapshot,overrides).values.Bandwidth['A'+row],'Separate margin');
 assert.ok(!result.managedCells.Bandwidth.includes('H'+row));assert.ok(!result.managedCells.Bandwidth.includes('A'+row));
});


test('existing comparison or broad wildcard provider criteria cannot silently duplicate a future supplier charge',()=>{
 for(const value of ['>=A','*','Future*',123]){
  const source=fixture();by(source,'Jan').cells.C4={value};
  assert.throws(()=>project(freeze(source),[receipt(22)],{baseline:baseline()}),/provider|criteria|alias/);
 }
 const source=fixture();by(source,'Accounting').cells.A4={value:'>=A'};
 assert.throws(()=>project(freeze(source),[receipt(22)],{baseline:baseline()}),/provider criterion/);
});

function authority(changes={}){return {format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-06-15T08:00:00.000Z',...changes};}
test('program authority replaces represented imported months, includes captured receipts once and preserves unrelated history and payments',()=>{
 const source=fixture(),bw=by(source,'Bandwidth'),annual=by(source,'Accounting');
 bw.cells.C219={value:'Legacy ISP',styleId:0};bw.cells.D219={value:5};bw.cells.F219={value:10};bw.cells.G219.value=50;
 bw.cells.C220={value:'Removed old supplier'};bw.cells.G220={value:9};annual.cells.K3={value:77};annual.cells.O3={value:12};
 const p=receipt(1,{purchaseDate:'2026-10-12'}),overrides={Bandwidth:{C219:'Saved legacy edit',G220:999,H219:'Margin note',F3:4},Accounting:{K3:321,O3:15,B12:200}};
 const origins={Bandwidth:{G220:{createdAt:'2026-06-01T10:00:00',deleted:false}}},options=freeze({authority:authority(),baseline:baseline([p]),overrides,origins});
 const before=JSON.stringify(source),saved=JSON.stringify(options),result=project(freeze(source),[p],options),sheet=by(result.snapshot,'Bandwidth'),values=Model.calculate(result.snapshot,result.calculationOverrides).values;
 assert.equal(result.metadata.policy,'program_months');assert.equal(result.metadata.count,1);assert.equal(result.metadata.programmeTotalCents,200);
 assert.equal(values.Bandwidth.G239,2);assert.equal(values.Accounting.K3,-2);assert.equal(values.Accounting.O3,15);assert.equal(values.Accounting.B12,200);
 assert.equal(values.Bandwidth.G23,8);assert.equal(values.Bandwidth.H219,'Margin note');assert.deepEqual(sheet.cells.C3,source.sheets[0].cells.C3);
 assert.equal(sheet.cells.C219.value,'Future ISP');assert.equal(sheet.cells.C220.value,null);assert.equal(sheet.cells.G220.value,null);assert.ok(!Object.hasOwn(sheet.cells.G220,'formula'));
 for(let row=219;row<=238;row++)for(const col of ['B','C','D','E','F','G']){assert.ok(result.managedCells.Bandwidth.includes(col+row));assert.equal(sheet.cells[col+row].editable,false);}
 assert.equal(result.metadata.months[9].source,'program');assert.equal(result.metadata.months[0].source,'imported');assert.equal(result.metadata.months[9].actualMonthlyTotalCents,200);
 assert.ok(!Object.hasOwn(result.calculationOverrides.Bandwidth,'C219'));assert.ok(!Object.hasOwn(result.calculationOverrides.Accounting,'K3'));
 assert.equal(sheet.maxRow,bw.maxRow);assert.deepEqual(sheet.tables,bw.tables);assert.deepEqual(sheet.cells.G239,bw.cells.G239);assert.deepEqual(by(result.snapshot,'Accounting').cells.O3,annual.cells.O3);
 assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(options),saved);assert.equal(Model.calculate(result.snapshot,result.calculationOverrides).errors.length,0);
});
test('program authority repairs missing and wrong monthly annual supplier formulas in all twelve original month columns',()=>{
 const source=fixture(),annual=by(source,'Accounting');annual.cells.B3={value:0};delete annual.cells.G3;annual.cells.C3={value:0,formula:'=SUMIF(Jan!C2:C200,A3,Jan!D2:D200)'};
 const purchases=MONTHS.map((name,m)=>receipt(m+1,{purchaseDate:'2026-'+String(m+1).padStart(2,'0')+'-12',unitPriceCents:101+m,totalCents:101+m}));
 const overrides={Accounting:{B3:999,G3:555,O3:7,B12:123}},result=project(freeze(source),purchases,{authority:authority(),baseline:baseline(purchases),overrides}),values=Model.calculate(result.snapshot,result.calculationOverrides).values;
 for(let m=0;m<12;m++){
  const col=Model.columnName(m+2),ref=col+'3',cost=(101+m)/100;
  assert.ok(Math.abs(values.Accounting[ref]+cost)<1e-10,ref);assert.ok(Math.abs(values.Bandwidth['G'+(23+24*m)]-cost)<1e-10);
  assert.equal(by(result.snapshot,'Accounting').cells[ref].formula,'=IF(A3<>"",SUMIF('+MONTHS[m]+'!C2:C200,A3,'+MONTHS[m]+'!D2:D200),"")');
  assert.equal(by(result.snapshot,'Accounting').cells[ref].editable,false);assert.ok(result.managedCells.Accounting.includes(ref));
 }
 assert.equal(values.Accounting.O3,7);assert.equal(values.Accounting.B12,123);assert.deepEqual(by(result.snapshot,'Accounting').cells.O3,annual.cells.O3);assert.equal(result.metadata.count,12);
 assert.equal(Model.calculate(result.snapshot,result.calculationOverrides).errors.length,0);
});
test('authority activation is the minimum local Beirut alias ownership time, preserving earlier cash and later provider association',()=>{
 const source=fixture(),p=receipt(1,{recordedAt:'2026-06-01T10:00:00'}),old={E3:{createdAt:'2026-06-15T10:59:59',deleted:true}};
 const first=project(source,[p],{authority:authority(),origins:{Jan:old}});assert.equal(by(first.snapshot,'Jan').cells.C4.value,'Future ISP');
 const origins={Jan:{...old,E4:{createdAt:'2026-06-15T11:00:01',deleted:false}}},overrides={Jan:{E4:1}};
 const next=project(source,[p],{authority:authority(),overrides,origins}),values=Model.calculate(next.snapshot,next.calculationOverrides).values;
 assert.equal(by(next.snapshot,'Jan').cells.C4.value,'Future ISP');assert.equal(values.Jan.M4,1);assert.equal(values.Accounting.B3,-2);
 const ambiguous=project(source,[p],{authority:authority(),overrides,origins:{Jan:{...old,E4:{createdAt:'2026-06-15T11:00:00',deleted:false}}}});
 assert.equal(by(ambiguous.snapshot,'Jan').cells.C5.value,'Future ISP');assert.equal(Model.calculate(ambiguous.snapshot,ambiguous.calculationOverrides).values.Jan.E4,1);
});
test('authority overflow uses twenty original slots and supplier groups without truncating equal-valued receipts',()=>{
 const purchases=Array.from({length:24},(_,i)=>receipt(i+1,{supplierName:i%2?'Future ISP':'Legacy ISP',quantityMicros:500000,unitPriceCents:1,totalCents:1}));
 const source=freeze(fixture()),result=project(source,purchases,{authority:authority(),baseline:baseline(purchases)}),values=Model.calculate(result.snapshot,result.calculationOverrides).values;
 assert.equal(result.metadata.count,24);assert.equal(result.metadata.months[0].rows.length,24);assert.equal(new Set(result.metadata.months[0].rows.map(p=>p.row)).size,2);
 assert.equal(values.Bandwidth.G23,.24);assert.equal(values.Accounting.B2,-.12);assert.equal(values.Accounting.B3,-.12);assert.equal(result.managedCells.Bandwidth.length,120);
 const tooMany=Array.from({length:21},(_,i)=>receipt(i+1,{supplierName:'Unique ISP '+i}));assert.throws(()=>project(source,tooMany,{authority:authority()}),/not enough safe original monthly rows/);
});
test('authority is source-bound and strict, while an empty program year leaves every imported month intact',()=>{
 const source=freeze(fixture()),result=project(source,[],{authority:authority(),overrides:{Bandwidth:{F3:4}}});
 assert.strictEqual(result.snapshot,source);assert.equal(result.metadata.count,0);assert.ok(result.metadata.months.every(m=>m.source==='imported'));assert.equal(result.calculationOverrides.Bandwidth.F3,4);
 assert.throws(()=>project(source,[],{authority:authority({sourceSha256:'b'.repeat(64)})}),/does not match/);
 for(const extra of [{mode:'future'},{activatedAt:'2026-06-15T08:00:00Z'},{activatedAt:'2026-02-30T08:00:00.000Z'},{extra:true}])assert.throws(()=>project(source,[],{authority:authority(extra)}),/authority/);
 assert.equal(project(source,[],{authority:authority({year:2027})}).metadata,null);
});

module.exports={fixture,receipt,baseline,authority};
