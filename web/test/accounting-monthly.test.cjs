'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Bandwidth=require('../app/accounting-bandwidth.cjs'),Monthly=require('../app/accounting-monthly.cjs'),Model=require('../app/accounting-workbook.cjs');
const {purchaseFingerprint}=Bandwidth;
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
function workbook(){
 const book=fixture();book.format='FIBERNETLB-ACCOUNTING-WORKBOOK-1';book.name='Fictional-monthly.xlsx';book.activeSheet='Jan';
 for(const name of MONTHS){const sheet=book.sheets.find(value=>value.name===name);sheet.maxRow=203;sheet.maxCol=14;sheet.tables=[{name:'Monthly'+name,ref:'A1:N201',headerRowCount:1,totalsRowCount:0,columns:['Due Date','Type','Name','Added','Method','Date','Notes1','Notes2','Notes3','Notes4','Notes5','Notes6','Payments','Balance']}];sheet.cells.A1={value:'Due Date'};
  for(let row=2;row<=200;row++){sheet.cells['A'+row]={value:36526};if(row>11)sheet.cells['B'+row]={value:row<=16?'BWidth':'Radius'};if(row>=12&&row<=16){sheet.cells['C'+row]={value:'Imported width '+row};sheet.cells['D'+row]={value:0};}if(row===17){sheet.cells['C'+row]={value:'fictional-reseller'};sheet.cells['D'+row]={value:name==='Jan'?50:0};}for(let column=5;column<=12;column++)sheet.cells[Model.columnName(column)+row]??={value:0};sheet.cells['M'+row]={value:0,formula:'=SUM(G'+row+':L'+row+')'};sheet.cells['N'+row]={value:0,formula:'=D'+row+'-M'+row};}
  if(name==='Jan')sheet.cells.G17={value:4};
 }
 const annual=book.sheets.find(sheet=>sheet.name==='Accounting');annual.cells.A17={value:'fictional-reseller'};
 for(let row=2;row<=39;row++){for(let month=0;month<12;month++)annual.cells[Model.columnName(month+2)+row]??={value:0,formula:'=IF(A'+row+'<>"",SUMIF('+MONTHS[month]+'!C2:C200,A'+row+','+MONTHS[month]+'!D2:D200),"")'};annual.cells['N'+row]={value:0,formula:'=IF(A'+row+'<>"",SUM(B'+row+':M'+row+'),"")'};annual.cells['O'+row]={value:0,formula:'=IF(A'+row+'<>"",'+MONTHS.map(name=>'IF(A'+row+'<>"",SUMIF('+name+'!C2:C200,A'+row+','+name+'!M2:M200),"")').join('+')+',0)'};annual.cells['P'+row]={value:0,formula:'=IF(A'+row+'<>"",SUM(B'+row+':M'+row+')-O'+row+',"")'};}
 return book;
}
const by=(book,name)=>book.sheets.find(sheet=>sheet.name===name);
const monthlyAuthority=(changes={})=>({format:'FIBERNETLB-ACCOUNTING-MONTHLY-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-06-15T08:00:00.000Z',resellerAddedBasis:'net_credit',resellerPaymentBasis:'admin_paybill',...changes});
const bwAuthority=()=>({format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-05-01T08:00:00.000Z'});
const identities=()=>({suppliers:[{id:10,name:'Legacy ISP',active:false},{id:1,name:'Future ISP',active:true}],resellers:[{id:1,username:'fictional-reseller',name:'Fictional Reseller',active:true}]});
const empty=()=>({supplierPayments:[],resellerFunding:[],resellerCollections:[],identities:identities()});
function sourceEvent(kind,id,changes={}){return {id:'fictional:'+kind+':'+id,requestId:'fictional-'+kind+'-'+id,receiptNo:'FICTIONAL-'+kind+'-'+id,date:'2026-01-20',amountCents:kind==='supplierPayments'?-5000:kind==='resellerFunding'?9900:10000,paymentMethod:'Cash',sourceWorkspaceId:'main',actorKey:'main:1',recordedAt:'2026-06-01T10:00:00',...(kind==='supplierPayments'?{supplierId:1,supplierName:'Future ISP'}:{resellerUsername:'fictional-reseller',resellerName:'Fictional Reseller'}),allocations:[],provenance:{fictional:true},...changes};}
function compose(book,streams,options={}){const authority=options.authority??monthlyAuthority(),base=Bandwidth.project(book,options.purchases??[],{authority:bwAuthority(),programOnly:authority.mode==='program_only',overrides:options.overrides,origins:options.origins});return {base,result:Monthly.project(base,streams,{authority,overrides:options.overrides,origins:options.origins})};}
const calculate=result=>Model.calculate(result.snapshot,result.calculationOverrides).values;
test('supplier actual payments use payment month with negative M, leaving inherited cost and immutable workbook unchanged',()=>{
 const book=workbook(),feb=by(book,'Bandwidth');feb.cells.C27={value:'Future ISP'};feb.cells.D27={value:5};feb.cells.F27={value:3};feb.cells.G27.value=15;const before=JSON.stringify(book),streams=empty();streams.supplierPayments=[sourceEvent('supplierPayments',1,{date:'2026-02-12',amountCents:-100})];
 const {result}=compose(book,streams,{purchases:[receipt(1)]}),values=calculate(result),jan=result.monthlyMetadata.months[0],month=result.monthlyMetadata.months[1],supplier=month.suppliers.find(value=>value.supplierId===1);
 assert.equal(values.Bandwidth.G23,2);assert.equal(values.Bandwidth.G47,15);assert.equal(values.Jan.M3,0);assert.equal(values.Feb.D3,-15);assert.equal(values.Feb.M3,-1);assert.equal(values.Feb.N3,-14);assert.equal(month.supplierPaymentCents,-100);assert.equal(jan.suppliers[0].paymentCents,0);assert.equal(supplier.row,3);
 assert.equal(by(result.snapshot,'Feb').cells.F3.value,(Date.parse('2026-02-12T00:00:00Z')-Date.UTC(1899,11,30))/86400000);for(const column of ['G','H','I','J','K','L'])assert.equal(by(result.snapshot,'Feb').cells[column+'3'].value,null);assert.equal(by(result.snapshot,'Feb').cells.D3.formula,by(book,'Feb').cells.D3.formula);assert.equal(JSON.stringify(book),before);
});
test('reseller net funding and dated Admin collections produce 99 minus 100 and annual receipts exactly once without note counts',()=>{
 const book=workbook(),streams=empty();streams.resellerFunding=[sourceEvent('resellerFunding',1,{date:'2026-01-02',grossCents:10000,nativeDeductionCents:100})];streams.resellerCollections=[sourceEvent('resellerCollections',1,{date:'2026-01-25'})];const overrides={Jan:{D17:777,G17:9,A17:46000}},origins={Jan:{D17:{createdAt:'2026-06-01T09:00:00',deleted:false},G17:{createdAt:'2026-06-01T09:00:00',deleted:false},A17:{createdAt:'2026-06-01T09:00:00',deleted:false}}};
 const before=JSON.stringify({book,overrides,origins}),{base,result}=compose(book,streams,{overrides,origins}),values=calculate(result),group=result.monthlyMetadata.months[0].resellers[0];
 assert.equal(values.Jan.D17,99);assert.equal(values.Jan.M17,100);assert.equal(values.Jan.N17,-1);assert.equal(values.Accounting.B17,99);assert.equal(values.Accounting.O17,100);assert.equal(values.Accounting.P17,-1);assert.equal(values.Jan.A17,46000);assert.equal(group.funding[0].grossCents,10000);assert.equal(group.collections[0].date,'2026-01-25');assert.equal(group.addedCents,9900);assert.equal(group.collectionCents,10000);assert.equal(by(result.snapshot,'Jan').cells.F17.value,(Date.parse('2026-01-25T00:00:00Z')-Date.UTC(1899,11,30))/86400000);assert.equal(result.metadata,base.metadata);
 assert(!Object.hasOwn(result.calculationOverrides.Jan,'D17'));assert(!Object.hasOwn(result.calculationOverrides.Jan,'G17'));assert.equal(result.calculationOverrides.Jan.A17,46000);assert.equal(JSON.stringify({book,overrides,origins}),before);assert.deepEqual(by(result.snapshot,'Jan').tables,by(book,'Jan').tables);assert.deepEqual(result.snapshot.styles,book.styles);
});
test('one-sided reseller activity zeros only its paired amount while untouched months and mixed payment metadata remain faithful',()=>{
 const book=workbook(),streams=empty();by(book,'Feb').cells.D17={value:60};by(book,'Feb').cells.G17={value:7};streams.resellerFunding=[sourceEvent('resellerFunding',1)];const {result}=compose(book,streams),values=calculate(result);assert.equal(values.Jan.D17,99);assert.equal(values.Jan.M17,0);assert.equal(values.Feb.D17,60);assert.equal(values.Feb.M17,7);assert.equal(result.monthlyMetadata.months[1].source,'imported');assert.equal(by(result.snapshot,'Jan').cells.E17.value,null);assert.equal(by(result.snapshot,'Jan').cells.F17.value,null);
 streams.resellerFunding=[];streams.resellerCollections=[sourceEvent('resellerCollections',1),sourceEvent('resellerCollections',2,{date:'2026-01-26',paymentMethod:'Whish Money',amountCents:50})];const next=compose(book,streams).result,paid=calculate(next);assert.equal(paid.Jan.D17,0);assert.equal(paid.Jan.M17,100.5);assert.equal(paid.Jan.N17,-100.5);assert.equal(by(next.snapshot,'Jan').cells.E17.value,null);assert.equal(by(next.snapshot,'Jan').cells.F17.value,null);
});
test('payment-only prior-year supplier debt receives a safe annual provider row and signed payment without manufacturing current costs',()=>{
 const book=workbook(),annual=by(book,'Accounting');delete annual.cells.A3;const streams=empty();streams.supplierPayments=[sourceEvent('supplierPayments',1,{amountCents:-500,allocations:[{purchaseId:123,purchaseDate:'2025-12-12',amountCents:500}]})];const {result}=compose(book,streams),values=calculate(result),month=result.monthlyMetadata.months[0],group=month.suppliers[0];assert.equal(values.Jan.D3,0);assert.equal(values.Jan.M3,-5);assert.equal(values.Accounting.O3,-5);assert.equal(values.Accounting.N3,0);assert.equal(values.Accounting.P3,5);assert.equal(by(result.snapshot,'Accounting').cells.A3.value,'**Future ISP');assert.equal(group.supplierId,1);assert(result.managedCells.Accounting.includes('O3'));
});
test('unknown identities use only safe original income slots and historical cash/date claims cannot be retargeted',()=>{
 const book=workbook(),jan=by(book,'Jan'),annual=by(book,'Accounting'),streams=empty();streams.resellerFunding=[sourceEvent('resellerFunding',1,{resellerUsername:'fictional-new',resellerName:'New Fictional Reseller'})];streams.identities.resellers.push({id:2,username:'fictional-new',name:'New Fictional Reseller',active:true});annual.cells.O14={value:2};annual.cells.A15={value:'z'};
 const origins={Jan:{E18:{createdAt:'2026-06-15T10:59:59',deleted:true},A19:{createdAt:'2026-06-15T10:59:59',deleted:true}},Accounting:{O13:{createdAt:'2026-06-15T10:59:59',deleted:true}}};const {result}=compose(book,streams,{origins}),group=result.monthlyMetadata.months[0].resellers[0];assert.equal(group.row,20);assert.equal(by(result.snapshot,'Jan').cells.C18,jan.cells.C18);assert.equal(by(result.snapshot,'Accounting').cells.A16.value,'fictional-new');assert.equal(by(result.snapshot,'Accounting').cells.O14.value,2);assert.equal(by(result.snapshot,'Accounting').cells.A15.value,'z');
});
test('annual aliases, namespace collisions and duplicate source requests fail before returning double-counted amounts',()=>{
 const book=workbook(),streams=empty();streams.resellerFunding=[sourceEvent('resellerFunding',1)];by(book,'Accounting').cells.A18={value:'FICTIONAL-RESELLER'};assert.throws(()=>compose(book,streams),/annual.*double-count|annual alias|more than one original annual/);
 const wildcard=workbook();by(wildcard,'Accounting').cells.A18={value:'fictional-*'};assert.throws(()=>compose(wildcard,streams),/annual.*double-count|annual alias/);
 const duplicate=empty();duplicate.resellerFunding=[sourceEvent('resellerFunding',1),sourceEvent('resellerFunding',1)];assert.throws(()=>compose(workbook(),duplicate),/more than once/);
 const namespace=empty();namespace.identities.suppliers.push({id:3,name:'FICTIONAL-RESELLER',active:true});assert.throws(()=>compose(workbook(),namespace),/same worksheet identity/);
});
test('program-only view removes unknown imports and duplicate BWidth income, keeps known zero accounts and preserves every source cell',()=>{
 const book=workbook(),jan=by(book,'Jan'),annual=by(book,'Accounting');jan.cells.C12={value:'fictional-reseller'};jan.cells.D12={value:80};jan.cells.G12={value:2};jan.cells.C18={value:'Unknown import'};jan.cells.D18={value:70};jan.cells.G18={value:3};jan.cells.B17={value:'Imported receiver'};annual.cells.A18={value:'Unknown import'};annual.cells.O18={value:12};const before=JSON.stringify(book),streams=empty();streams.resellerFunding=[sourceEvent('resellerFunding',1)];streams.resellerCollections=[sourceEvent('resellerCollections',1)];
 const {result}=compose(book,streams,{authority:monthlyAuthority({mode:'program_only'})}),values=calculate(result);assert.equal(values.Jan.D17,99);assert.equal(values.Jan.M17,100);assert.equal(values.Accounting.B17,99);assert.equal(values.Accounting.O17,100);assert.equal(values.Accounting.P17,-1);assert.equal(by(result.snapshot,'Jan').cells.C12.value,null);assert.equal(by(result.snapshot,'Jan').cells.D12.value,null);assert.equal(by(result.snapshot,'Jan').cells.C18.value,null);assert.equal(by(result.snapshot,'Accounting').cells.A18.value,null);assert.equal(by(result.snapshot,'Jan').cells.B17.value,'Radius');assert.equal(by(result.snapshot,'Jan').cells.A17.value,null);assert.equal(by(result.snapshot,'Feb').cells.C17.value,'fictional-reseller');assert.equal(values.Feb.D17,0);assert.equal(values.Feb.M17,0);assert(result.monthlyMetadata.months.every(value=>value.source==='program'));assert.equal(JSON.stringify(book),before);
});
test('profile and identity roster gate destructive mode and a missing policy preserves the base projection exactly',()=>{
 const book=workbook(),base=Bandwidth.project(book,[],{authority:bwAuthority()}),streams=empty();assert.strictEqual(Monthly.project(base,streams,{}),base);assert.throws(()=>Monthly.project(base,streams,{authority:monthlyAuthority({sourceSha256:'b'.repeat(64)})}),/does not match/);assert.throws(()=>Monthly.project(base,streams,{authority:monthlyAuthority({resellerAddedBasis:'gross'})}),/authority/);delete streams.identities;assert.throws(()=>Monthly.project(base,streams,{authority:monthlyAuthority({mode:'program_only'})}),/identity roster/);
});
test('program-only duplicate imports retain one programme identity row and prefer an already managed supplier alias',()=>{
 const book=workbook(),jan=by(book,'Jan'),annual=by(book,'Accounting');jan.cells.C3={value:'Future ISP'};jan.cells.C4={value:'Future ISP'};jan.cells.C18={value:'fictional-reseller'};jan.cells.D18={value:12};annual.cells.A4={value:'**Future ISP'};annual.cells.A18={value:'fictional-reseller'};
 const before=JSON.stringify(book),base={snapshot:book,signature:'b'.repeat(64),metadata:{purchases:[]},managedCells:{Jan:['C4']}},result=Monthly.project(base,empty(),{authority:monthlyAuthority({mode:'program_only'})}),values=calculate(result);
 assert.equal(result.monthlyMetadata.months[0].suppliers.find(value=>value.supplierId===1).row,4);assert.equal(by(result.snapshot,'Jan').cells.C3.value,null);assert.equal(values.Jan.D3,null);assert.equal(by(result.snapshot,'Jan').cells.C18.value,null);assert.equal(by(result.snapshot,'Accounting').cells.A4.value,null);assert.equal(by(result.snapshot,'Accounting').cells.A18.value,null);assert.equal(values.Accounting.B17,0);assert.equal(JSON.stringify(book),before);
 const legacy=workbook(),events=empty();by(legacy,'Jan').cells.C12={value:'fictional-reseller'};by(legacy,'Jan').cells.D12={value:1};events.resellerFunding=[sourceEvent('resellerFunding',1)];assert.throws(()=>compose(legacy,events),/monthly name.*several rows/);
});
test('cleanup rejects incomplete or duplicate rosters and preserves fractional-second cash ownership boundaries',()=>{
 const invalid=empty();invalid.identities.resellers.push({...invalid.identities.resellers[0]});assert.throws(()=>compose(workbook(),invalid),/duplicate identity/);const missing=empty();missing.resellerFunding=[sourceEvent('resellerFunding',1,{resellerUsername:'absent-program-account'})];assert.throws(()=>compose(workbook(),missing),/absent from.*roster/);
 const book=workbook(),events=empty();events.resellerFunding=[sourceEvent('resellerFunding',1,{resellerUsername:'fractional-account',recordedAt:'2026-06-15T10:59:59.9'})];events.identities.resellers.push({id:2,username:'fractional-account',name:'Fictional Fractional Account',active:true});const origins={Jan:{E18:{createdAt:'2026-06-15T11:00:00.12',deleted:true},E19:{createdAt:'2026-06-15T11:00:00.09',deleted:true}}};const result=compose(book,events,{authority:monthlyAuthority({activatedAt:'2026-06-15T08:00:00.100Z'}),origins}).result;assert.equal(result.monthlyMetadata.months[0].resellers[0].row,18);
});
test('saved username case changes retain one roster identity and programme-only annual literals and overrides are replaced by source totals',()=>{
 const book=workbook(),annual=by(book,'Accounting'),streams=empty();streams.identities.resellers[0].username='FICTIONAL-RESELLER';streams.resellerFunding=[sourceEvent('resellerFunding',1)];streams.resellerCollections=[sourceEvent('resellerCollections',1)];const compatible=compose(book,streams).result;assert.equal(calculate(compatible).Accounting.O17,100);assert.equal(compatible.monthlyMetadata.months[0].resellers[0].username,'FICTIONAL-RESELLER');assert.equal(compatible.monthlyMetadata.months[0].resellers[0].funding[0].resellerUsername,'fictional-reseller');
 for(const column of ['N','O','P'])annual.cells[column+'17']={value:9000};const overrides={Accounting:{N17:8100,O17:8200,P17:8300}},result=compose(book,streams,{authority:monthlyAuthority({mode:'program_only'}),overrides}).result,values=calculate(result);assert.equal(values.Accounting.N17,99);assert.equal(values.Accounting.O17,100);assert.equal(values.Accounting.P17,-1);for(const column of ['N','O','P'])assert(!Object.hasOwn(result.calculationOverrides.Accounting,column+'17'));assert.equal(annual.cells.O17.value,9000);assert.equal(overrides.Accounting.O17,8200);assert.throws(()=>compose(book,streams),/annual manual cash input/);
});
