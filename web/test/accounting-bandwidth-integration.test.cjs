'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const initSqlJs=require('sql.js'),Store=require('../app/accounting-workbook-store.cjs'),Register=require('../app/accounting-register.cjs');
const Projection=require('../app/accounting-bandwidth.cjs'),Source=require('../app/accounting-bandwidth-source.cjs'),Bandwidth=require('../app/bandwidth-accounting.cjs'),Model=require('../app/accounting-workbook.cjs');
const {purchaseFingerprint}=Projection,{query:q}=require('../app/finance-ledger.cjs');
const sql=initSqlJs(),at='2026-11-22T12:00:00';
const actor={id:1,role:'admin',active:1,account_key:'main:1',full_name:'Fictional Projection Owner'};
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
function snapshot(year=2026){
 const book=fixture();return {...book,format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',year,name:'Fictional-bandwidth.xlsx',activeSheet:'Bandwidth',sheets:[...book.sheets,...Array.from({length:11},(_,i)=>({name:'Fictional '+String(i+1).padStart(2,'0'),maxRow:1,maxCol:1,cells:{A1:i===0?{value:0,formula:'=Accounting!N3'}:{value:i+1}}}))]};
}
const by=(book,name)=>book.sheets.find(sheet=>sheet.name===name);
const policy=()=>({format:'FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',year:2026,sourceSha256:'a'.repeat(64),excludedSheets:Array.from({length:9},(_,i)=>'Fictional '+String(i+3).padStart(2,'0'))});
const edit=(requestId,sheet,cell,value,version=0)=>({requestId,id:Store.cellId(2026,sheet,cell),version,kind:'sheetcell',year:2026,data:{sheet,cell,value}});
async function services(t,options={}){
 const SQL=await sql,db=new SQL.Database();t.after(()=>db.close());Register.initialize(db);Store.initialize(db);
 let store;const register=new Register.AccountingRegister({db,authorize:()=>actor,now:options.now??(()=>at),validateCell:(data,year,id)=>store.assertEditable(data,year,id),assertCellMutable:(data,year)=>store.assertCellMutable(data,year),saveEntry:options.saveEntry??(()=>{})});
 store=new Store.WorkbookStore({db,register,viewPolicy:options.viewPolicy??policy(),authorize:()=>actor,now:options.now??(()=>at),getBandwidthProjection:options.getBandwidthProjection});
 const original=options.snapshot??snapshot();store.install(original);return {db,store,register,original};
}
test('future-only links use original monthly and annual formulas, preserve manual edits, and recover exact original saved requests after cells become managed',async t=>{
 const old=receipt(1),proof=baseline([old]);let sourceRows=[old],sourceError=false,failSave=false,reads=0;
 const {db,store,register,original}=await services(t,{saveEntry:()=>{if(failSave)throw Error('Fictional uncertain save');},getBandwidthProjection:({year,snapshot:source,overrides,origins})=>{reads++;assert.equal(year,2026);assert(origins&&typeof origins==='object');if(sourceError)throw Error('Fictional source validation failed');return Projection.project(source,sourceRows,{baseline:proof,overrides,origins});}});
 const originalJson=JSON.stringify(original),sourceBefore=q(db,'SELECT * FROM accounting_workbook_sources');
 const initial=store.workbook({year:2026});assert.equal(initial.bandwidth.count,0);assert.equal(initial.values.Bandwidth.G23,6);assert.equal(initial.snapshot.sheetIndex.length,16);
 const priorCell=edit('fictional-prior-cell-save','Bandwidth','C4','Prior manual label'),savedPrior=await register.save(priorCell);
 const removal={requestId:'fictional-prior-cell-restore',id:priorCell.id,version:1,reason:'Restore the original fictional blank'},removed=await register.remove(removal);
 const instruction=edit('fictional-original-manual-save','Bandwidth','D3',3);failSave=true;await assert.rejects(register.save(instruction),/save could not be confirmed/);
 const pending=register.status({requestId:instruction.requestId});assert.equal(pending.state,'save_required');assert.equal(pending.result.record.data.value,3);
 const requestsBefore=q(db,'SELECT * FROM accounting_register_requests'),auditsBefore=q(db,'SELECT * FROM accounting_register_audit');
 sourceRows=[old,receipt(2)];const first=store.workbook({year:2026});
 assert.equal(first.bandwidth.signature,Projection.project(original,sourceRows,{baseline:proof,overrides:{Bandwidth:{D3:3}},origins:{Bandwidth:{C4:{createdAt:at,deleted:true},D3:{createdAt:at,deleted:false}}}}).signature);
 assert.equal(first.bandwidth.mode,'in_place');assert.equal(first.bandwidth.count,1);assert.equal(first.values.Bandwidth.G23,11,'The original total includes preserved manual cost and only the future receipt.');
 assert.equal(first.snapshot.sheets[0].maxRow,288);assert.deepEqual(first.snapshot.sheets[0].tables,by(original,'Bandwidth').tables);assert.equal(first.snapshot.sheets[0].cells.G23.formula,by(original,'Bandwidth').cells.G23.formula);
 assert.equal(first.snapshot.sheets[0].cells.C3.value,'Legacy ISP');assert.equal(first.snapshot.sheets[0].cells.G4.value,2);assert(first.managedCells.includes('C4'));
 const jan=store.workbook({year:2026,sheet:'Jan'});assert.equal(jan.values.Jan.D3,-2);assert(jan.managedCells.includes('C3'));assert.equal(jan.bandwidth,null);
 const annual=store.workbook({year:2026,sheet:'Accounting'});assert.equal(annual.values.Accounting.N2,-9);assert.equal(annual.values.Accounting.N3,-2);assert.equal(annual.bandwidth,null);
 assert.equal(store.workbook({year:2026,sheet:'Fictional 01'}).values['Fictional 01'].A1,-2);
 sourceError=true;failSave=false;
 assert.deepEqual(await register.resume({requestId:instruction.requestId}),pending.result,'Pending saves persist their original result without consulting changed automatic links.');
 assert.deepEqual(await register.save(instruction),pending.result);assert.deepEqual(await register.save(priorCell),savedPrior);assert.deepEqual(await register.remove(removal),removed);
 assert.deepEqual(register.status({requestId:priorCell.requestId}).result,savedPrior);assert.deepEqual(await register.resume({requestId:removal.requestId}),removed);
 sourceError=false;
 for(const request of [edit('fictional-linked-row-edit','Bandwidth','C4','Replace linked supplier',2),edit('fictional-linked-provider-edit','Jan','C3','Replace linked provider')])await assert.rejects(register.save(request),/linked to a saved bandwidth purchase/);
 assert.equal(register.status({requestId:'fictional-linked-row-edit'}).state,'not_found');assert.equal(register.status({requestId:'fictional-linked-provider-edit'}).state,'not_found');
 assert.deepEqual(q(db,'SELECT * FROM accounting_register_requests'),requestsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_audit'),auditsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_workbook_sources'),sourceBefore);assert.equal(JSON.stringify(store.source(2026)),originalJson);assert(reads>0);
});
test('every selected sheet validates before cache and propagates new future costs while hidden Bandwidth metadata remains private',async t=>{
 let rows=[receipt(2)],calls=0,invalid=false;const proof=baseline();
 const callback=({snapshot:source,overrides,origins})=>{calls++;if(invalid)throw Error('Fictional source proof unavailable');return Projection.project(source,rows,{baseline:proof,overrides,origins});};
 const {db,store,register}=await services(t,{getBandwidthProjection:callback});
 assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-2);
 rows.push(receipt(3,{unitPriceCents:333,totalCents:333}));const updated=store.workbook({year:2026,sheet:'Accounting'});assert.equal(updated.values.Accounting.N3,-5.33);assert.equal(updated.bandwidth,null);
 const before=calls;invalid=true;assert.throws(()=>store.workbook({year:2026,sheet:'Accounting'}),/proof unavailable/);assert.equal(calls,before+1);invalid=false;
 const hiddenPolicy={...policy(),excludedSheets:['Bandwidth',...Array.from({length:8},(_,i)=>'Fictional '+String(i+4).padStart(2,'0'))]},hidden=new Store.WorkbookStore({db,register,viewPolicy:hiddenPolicy,authorize:()=>actor,now:()=>at,getBandwidthProjection:callback});hidden.assertViewPolicy();
 const response=hidden.workbook({year:2026,sheet:'Accounting'});assert.equal(response.values.Accounting.N3,-5.33);assert.equal(response.snapshot.sheetIndex.length,16);assert.equal(response.bandwidth,null);assert(!response.snapshot.sheetIndex.some(s=>s.name==='Bandwidth'));
 const publicJson=JSON.stringify(response);for(const row of rows)assert(!publicJson.includes(row.requestId),'An unrelated worksheet must not disclose receipt identity.');assert(!publicJson.includes('baselineCount'));assert(!publicJson.includes('linkedTotalCents'));
 const priorCalls=calls;assert.throws(()=>hidden.workbook({year:2026,sheet:'Bandwidth'}),/visible/);assert.equal(calls,priorCalls);
 invalid=true;assert.throws(()=>hidden.workbook({year:2026,sheet:'Accounting'}),/proof unavailable/,'Hidden source dependencies still require a fresh source proof.');
});
test('fixed original capacity groups only a single saved supplier and fails closed without shifting manual or saved coordinates',async t=>{
 const original=snapshot(),bw=by(original,'Bandwidth');for(let row=3;row<=21;row++){bw.cells['C'+row]={value:'Legacy ISP'};bw.cells['D'+row]={value:1};bw.cells['F'+row]={value:1};bw.cells['G'+row].value=1;}
 let rows=[receipt(2,{unitPriceCents:100,totalCents:100}),receipt(3,{quantityMicros:2000000,unitPriceCents:200,totalCents:400}),receipt(4,{unit:'Gbps',unitPriceCents:100,totalCents:100})];
 const sourceJson=JSON.stringify(original),{store}=await services(t,{snapshot:original,getBandwidthProjection:({snapshot:source,overrides,origins})=>Projection.project(source,rows,{baseline:baseline(),overrides,origins})});
 const view=store.workbook({year:2026}),month=view.bandwidth.months[0],sheet=view.snapshot.sheets[0];assert.deepEqual(month.rows.map(row=>row.row),[22,22,22]);assert.equal(month.purchases.length,3);assert.equal(sheet.cells.D22.value,null);assert.equal(sheet.cells.F22.value,null);assert.equal(sheet.cells.G22.value,6);assert.equal(view.values.Bandwidth.G23,25);
 assert.equal(store.workbook({year:2026,sheet:'Jan'}).values.Jan.D3,-6);assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-6);assert.equal(sheet.maxRow,288);assert.deepEqual(sheet.tables,bw.tables);
 rows.push(receipt(5,{supplierName:'Other future ISP'}));assert.throws(()=>store.workbook({year:2026,sheet:'Accounting'}),/not enough safe original monthly rows/);assert.equal(JSON.stringify(store.source(2026)),sourceJson);
});

async function sourceFixture(t){
 const SQL=await sql,db=new SQL.Database(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-fictional-bandwidth-source-')),file=path.join(directory,'main.sqlite');
 t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernet-fictional-bandwidth-source-'));fs.rmSync(directory,{recursive:true,force:true});});
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT,full_name TEXT,role TEXT,active INTEGER);INSERT INTO users VALUES(1,'main:1','Fictional Projection Owner','admin',1);CREATE TABLE finance_months(month TEXT PRIMARY KEY);CREATE TABLE expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,expense_date TEXT,category TEXT,description TEXT,amount REAL,user_id INTEGER,source_type TEXT,source_id TEXT,created_at TEXT);");
 Bandwidth.initialize(db);const core=new Bandwidth.BandwidthAccounting({db,workspaceId:'main',actor,now:()=>at});
 const supplier=core.createSupplier({requestId:'fictional-source-supplier',name:'Future ISP'}),type=core.createType({requestId:'fictional-source-type',name:'Fictional transit',unit:'Mbps'}),exportBytes=db.export.bind(db),persist=()=>fs.writeFileSync(file,exportBytes(),{mode:0o600});let counter=0;
 function purchase(date='2026-01-12'){
  const requestId='fictional-source-purchase-'+(++counter);db.exec('BEGIN');try{
   const row=core.createPurchase({requestId,supplierId:supplier.id,typeId:type.id,purchaseDate:date,quantity:'2',unitPrice:'5',note:'Fictional source purchase'});
   db.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id,created_at) VALUES(?,'Bandwidth cost',?,?,?,'bandwidth_purchase',?,?)",[row.purchaseDate,'Fictional linked cost',row.totalCost,row.actorId,String(row.id),at]);
   const expenseId=q(db,'SELECT last_insert_rowid() AS id')[0].id,result=core.linkPurchaseExpense(row.id,{expenseId,sourceType:'bandwidth_purchase',sourceId:String(row.id)});db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {SQL,db,file,entry:{db,path:file},purchase,persist,exportBytes};
}
test('durability validation covers dependent cached sheets without exporting Main or replaying financial writes',async t=>{
 const {db,entry,purchase,persist}=await sourceFixture(t),old=purchase(),proof=baseline([old]);Store.initialize(db);Register.initialize(db);let store;
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=>at,saveEntry:()=>{}});store=new Store.WorkbookStore({db,register,authorize:()=>actor,now:()=>at,getBandwidthProjection:({year,snapshot:source,overrides,origins})=>Source.project({year,snapshot:source,entry,actor,now:()=>at,baseline:proof,overrides,origins})});store.install(snapshot());persist();
 db.export=()=>{throw Error('Exporting live Main is forbidden during this read.');};const statement=db.prepare('SELECT receipt_no FROM bandwidth_purchases WHERE id=?');statement.bind([old.id]);
 assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,0);assert(statement.step());assert.match(statement.get()[0],/^BWP-fictional-source-purchase-/);statement.free();
 const fresh=purchase();assert.throws(()=>store.workbook({year:2026,sheet:'Accounting'}),/save could not be confirmed/);assert.equal(q(db,'SELECT COUNT(*) AS n FROM bandwidth_purchases')[0].n,2);persist();
 assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-10);const view=store.workbook({year:2026});assert.equal(view.bandwidth.count,1);assert.equal(view.bandwidth.purchases[0].id,fresh.id);assert.equal(view.values.Bandwidth.G23,16);
 const bytes=fs.readFileSync(entry.path);store.workbook({year:2026,sheet:'Jan'});assert.deepEqual(fs.readFileSync(entry.path),bytes);
 const changed={...proof,purchases:proof.purchases.map(p=>({...p,fingerprint:'b'.repeat(64)}))};assert.throws(()=>Source.project({year:2026,snapshot:snapshot(),entry,actor,now:()=>at,baseline:changed}),/missing or changed/);
});
test('source adapter verifies out-of-year audits and baseline identity before accepting selected-year receipts',async t=>{
 const {SQL,db,entry,purchase,persist}=await sourceFixture(t),old=purchase('2026-01-12'),future=purchase('2026-02-01'),nextYear=purchase('2027-02-01');persist();const original=snapshot(),proof=baseline([old]);
 const first=Source.project({year:2026,snapshot:original,entry,actor,now:()=>at,baseline:proof});assert.equal(first.metadata.count,1);assert.equal(first.metadata.purchases[0].id,future.id);
 const next=Source.project({year:2027,snapshot:snapshot(2027),entry,actor,now:()=>at,baseline:{...baseline(),year:2027}});assert.equal(next.metadata.count,1);assert.equal(next.metadata.months[1].count,1);
 const damaged=new SQL.Database(fs.readFileSync(entry.path));try{damaged.exec("DROP TRIGGER bandwidth_audit_update;UPDATE bandwidth_audit SET result_json='{}' WHERE action='purchase_create' AND record_id="+nextYear.id);fs.writeFileSync(entry.path,damaged.export());}finally{damaged.close();}
 assert.throws(()=>Source.project({year:2026,snapshot:original,entry,actor,now:()=>at,baseline:proof}),/save could not be confirmed/);persist();
 db.exec("DROP TRIGGER bandwidth_audit_update;UPDATE bandwidth_audit SET result_json='{}' WHERE action='purchase_create' AND record_id="+nextYear.id);assert.throws(()=>Source.project({year:2026,snapshot:original,entry,actor,now:()=>at,baseline:proof}),/purchase cost could not be verified/);
 const skipped=Source.project({year:2026,snapshot:original,entry:{},actor});assert.strictEqual(skipped.snapshot,original);assert.equal(skipped.metadata,null,'An absent baseline disables automatic backfill without reading financial data.');
 const unrelated={...original,sheets:[{name:'Fictional only',maxRow:1,maxCol:1,cells:{A1:{value:1}}}]};assert.strictEqual(Source.project({year:2026,snapshot:unrelated,entry:{},actor,baseline:proof}).snapshot,unrelated);
});
test('post-link date and cash edits keep their original provider association while earlier restored edits reserve provider rows',async t=>{
 let currentTime='2026-11-22T09:00:00',rows=[],forwarded;
 const {store,register}=await services(t,{now:()=>currentTime,getBandwidthProjection:({snapshot:source,overrides,origins})=>{forwarded=origins;return Projection.project(source,rows,{baseline:baseline(),overrides,origins});}});
 const oldPayment=edit('fictional-prior-payment-save','Jan','E3',5),oldSaved=await register.save(oldPayment),restore={requestId:'fictional-prior-payment-restore',id:oldPayment.id,version:1,reason:'Restore an earlier fictional payment'};
 await register.remove(restore);rows=[receipt(2,{recordedAt:'2026-11-22T10:00:00'})];
 const linked=store.workbook({year:2026,sheet:'Jan'});assert.equal(linked.snapshot.sheets[0].cells.C4.value,'Future ISP');assert.equal(linked.snapshot.sheets[0].cells.C3.value,0);assert.equal(linked.values.Jan.D4,-2);
 assert.deepEqual(forwarded.Jan.E3,{createdAt:oldSaved.record.createdAt,deleted:true},'The projection receives verified lifetime origins for restored edits.');
 currentTime='2026-11-22T11:00:00';const payment=await register.save(edit('fictional-post-link-payment','Jan','E4',1));
 const after=store.workbook({year:2026,sheet:'Jan'});assert.equal(after.snapshot.sheets[0].cells.C4.value,'Future ISP');assert.equal(after.values.Jan.D4,-2);assert.equal(after.values.Jan.M4,1);assert.equal(after.values.Jan.N4,-3);assert(after.managedCells.includes('C4'));assert(!after.managedCells.includes('E4'));
 assert.deepEqual(forwarded.Jan.E4,{createdAt:payment.record.createdAt,deleted:false});
 currentTime='2026-11-22T12:00:00';await register.save(edit('fictional-post-link-date','Jan','A4',46000));rows.push(receipt(3,{recordedAt:'2026-11-22T12:00:00',unitPriceCents:300,totalCents:300}));
 const refreshed=store.workbook({year:2026,sheet:'Jan'});assert.equal(refreshed.snapshot.sheets[0].cells.C4.value,'Future ISP');assert.equal(refreshed.values.Jan.D4,-5);assert.equal(refreshed.values.Jan.M4,1);assert.equal(refreshed.values.Jan.A4,46000);assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-5);
 await assert.rejects(register.save(edit('fictional-provider-rename-denied','Jan','C4','Another provider')),/linked to a saved bandwidth purchase/);
 assert.deepEqual(await register.save(oldPayment),oldSaved,'Restored prior requests retain their exact saved result after later automatic linking.');
});
test('an accepted payment cannot lose its linked provider when ownership timestamps are tied, missing or incomparable',async t=>{
 for(const [label,recordedAt]of [['same-second',at],['missing',undefined],['different-zone',at+'Z']]){
  const rows=[receipt(2,{recordedAt})],{store,register}=await services(t,{getBandwidthProjection:({snapshot:source,overrides,origins})=>Projection.project(source,rows,{baseline:baseline(),overrides,origins})});
  const initial=store.workbook({year:2026,sheet:'Jan'});assert.equal(initial.snapshot.sheets[0].cells.C3.value,'Future ISP');
  const request=edit('fictional-ambiguous-payment-'+label,'Jan','E3',1);let saved=false;
  try{await register.save(request);saved=true;}catch(error){assert(error instanceof Error);assert.equal(register.status({requestId:request.requestId}).state,'not_found','Ambiguous ownership rejection happens before journaling a payment.');}
  if(saved){const result=store.workbook({year:2026,sheet:'Jan'});assert.equal(result.snapshot.sheets[0].cells.C3.value,'Future ISP',label+': a successfully saved payment retains its provider association.');assert.equal(result.values.Jan.M3,1);assert.equal(result.values.Jan.D3,-2);}
 }
});


const authorityProfile=(changes={})=>({format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-11-22T08:00:00.000Z',...changes});
test('program-month authority replaces imported and overridden costs while retaining exact saved results and unrelated inputs',async t=>{
 const original=snapshot(),bw=by(original,'Bandwidth'),annual=by(original,'Accounting');
 bw.cells.C27={value:'Legacy ISP'};bw.cells.D27={value:2};bw.cells.F27={value:4};bw.cells.G27.value=8;
 annual.cells.B3={value:0};annual.cells.L3={value:0,formula:'=SUMIF(Oct!C2:C200,A3,Oct!D2:D200)'};
 const rows=[receipt(1),receipt(2,{purchaseDate:'2026-11-12',unitPriceCents:500,totalCents:500})],proof=baseline(rows);let authority=null,invalid=false,failSave=false,lastProjection;
 const {db,store,register}=await services(t,{snapshot:original,saveEntry:()=>{if(failSave)throw Error('Fictional uncertain save');},getBandwidthProjection:({snapshot:source,overrides,origins})=>{if(invalid)throw Error('Fictional source unavailable');return lastProjection=Projection.project(source,rows,{baseline:proof,authority,overrides,origins});}});
 const oldAnnual=edit('fictional-authority-old-annual','Accounting','B3',123),annualSaved=await register.save(oldAnnual);
 await register.save(edit('fictional-authority-other-month','Bandwidth','F27',5));await register.save(edit('fictional-authority-margin','Bandwidth','H3','Unrelated margin note'));await register.save(edit('fictional-authority-annual-payment','Accounting','O3',4));
 const oldBandwidth=edit('fictional-authority-old-bandwidth','Bandwidth','D3',9);failSave=true;await assert.rejects(register.save(oldBandwidth),/save could not be confirmed/);const oldSaved=register.status({requestId:oldBandwidth.requestId}).result;
 assert.equal(store.workbook({year:2026}).values.Bandwidth.G23,27);assert.equal(store.workbook({year:2026}).bandwidth.count,0);
 const originalBytes=JSON.stringify(store.source(2026)),requestsBefore=q(db,'SELECT * FROM accounting_register_requests'),auditsBefore=q(db,'SELECT * FROM accounting_register_audit'),sourcesBefore=q(db,'SELECT * FROM accounting_workbook_sources');authority=authorityProfile();
 const result=store.workbook({year:2026});assert.equal(result.bandwidth.policy,'program_months');assert.equal(result.bandwidth.count,2);assert.deepEqual(result.bandwidth.purchases.map(p=>p.requestId).sort(),rows.map(p=>p.requestId).sort());
 assert.equal(result.values.Bandwidth.G23,2,'Program purchase cost replaces the imported amount and saved input edit.');assert.equal(result.values.Bandwidth.G263,5);assert.equal(result.values.Bandwidth.G47,10,'A month without program purchases retains its imported input and saved edit.');assert.equal(result.values.Bandwidth.D3,1);assert.equal(result.values.Bandwidth.H3,'Unrelated margin note');
 assert.equal(result.managedCells.length,240);for(const range of [[3,22],[243,262]])for(let row=range[0];row<=range[1];row++)for(const col of ['B','C','D','E','F','G'])assert(result.managedCells.includes(col+row));
 assert.equal(result.snapshot.sheets[0].maxRow,288);assert.deepEqual(result.snapshot.sheets[0].tables,bw.tables);assert.equal(result.snapshot.sheets[0].cells.G23.formula,bw.cells.G23.formula);
 assert(!Object.hasOwn(lastProjection.calculationOverrides.Bandwidth,'D3'));assert(!Object.hasOwn(lastProjection.calculationOverrides.Accounting,'B3'));assert.equal(lastProjection.calculationOverrides.Bandwidth.F27,5);assert.equal(lastProjection.calculationOverrides.Accounting.O3,4);
 const account=store.workbook({year:2026,sheet:'Accounting'});assert.equal(account.values.Accounting.B3,-2);assert.equal(account.values.Accounting.L3,-5);assert.equal(account.values.Accounting.C2,-10);assert.equal(account.values.Accounting.O3,4);assert.equal(account.values.Accounting.N3,-7);assert.equal(account.edits.Accounting.B3.version,1);assert(account.managedCells.includes('B3'));assert(account.managedCells.includes('L3'));
 assert.equal(account.snapshot.sheets[0].cells.L3.formula,'=IF(A3<>"",SUMIF(Nov!C2:C200,A3,Nov!D2:D200),"")');
 invalid=true;failSave=false;assert.deepEqual(await register.resume({requestId:oldBandwidth.requestId}),oldSaved);assert.deepEqual(await register.save(oldBandwidth),oldSaved);assert.deepEqual(await register.save(oldAnnual),annualSaved);assert.deepEqual(register.status({requestId:oldAnnual.requestId}).result,annualSaved);invalid=false;
 for(const input of [edit('fictional-authority-new-bandwidth-denied','Bandwidth','D3',55,1),edit('fictional-authority-new-annual-denied','Accounting','B3',55,1)])await assert.rejects(register.save(input),/linked to a saved bandwidth purchase/);
 await assert.rejects(register.remove({requestId:'fictional-authority-restore-denied',id:oldBandwidth.id,version:1,reason:'Cannot restore an authoritative program cell'}),/linked to a saved bandwidth purchase/);
 assert.deepEqual(q(db,'SELECT * FROM accounting_register_requests'),requestsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_audit'),auditsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_workbook_sources'),sourcesBefore);assert.equal(JSON.stringify(store.source(2026)),originalBytes);
});
test('authority activation protects existing date and cash entries and keeps subsequent provider edits associated through restore',async t=>{
 let now='2026-11-14T10:00:00',authority=null,rows=[receipt(1,{recordedAt:'2026-11-01T10:00:00'})];const proof=baseline(rows);
 const {store,register}=await services(t,{now:()=>now,getBandwidthProjection:({snapshot:source,overrides,origins})=>Projection.project(source,rows,{baseline:proof,authority,overrides,origins})});
 const priorPayment=await register.save(edit('fictional-authority-preexisting-cash','Jan','E3',7));await register.save(edit('fictional-authority-preexisting-date','Jan','A4',46000));
 authority=authorityProfile();now='2026-11-22T11:00:00';const initial=store.workbook({year:2026,sheet:'Jan'});assert.equal(initial.snapshot.sheets[0].cells.C3.value,0);assert.equal(initial.snapshot.sheets[0].cells.C4.value,0);assert.equal(initial.snapshot.sheets[0].cells.C5.value,'Future ISP');assert.equal(initial.values.Jan.E3,7);assert.equal(initial.values.Jan.A4,46000);assert.equal(initial.values.Jan.D5,-2);
 const payment=await register.save(edit('fictional-authority-new-cash','Jan','E5',1));let response=store.workbook({year:2026,sheet:'Jan'});assert.equal(response.snapshot.sheets[0].cells.C5.value,'Future ISP');assert.equal(response.values.Jan.M5,1);assert.equal(response.values.Jan.D5,-2);
 const removal={requestId:'fictional-authority-new-cash-restore',id:payment.record.id,version:1,reason:'Restore this fictional cash input'};await register.remove(removal);response=store.workbook({year:2026,sheet:'Jan'});assert.equal(response.snapshot.sheets[0].cells.C5.value,'Future ISP');assert.equal(response.values.Jan.M5,0);assert.equal(response.values.Jan.E3,7);assert.equal(response.edits.Jan.E5.deleted,true);
 rows=[...rows,receipt(2,{recordedAt:'2026-11-22T12:00:00',unitPriceCents:300,totalCents:300})];response=store.workbook({year:2026,sheet:'Jan'});assert.equal(response.snapshot.sheets[0].cells.C5.value,'Future ISP');assert.equal(response.values.Jan.D5,-5);assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-5);assert.deepEqual(register.status({requestId:priorPayment.requestId}).result,priorPayment);
});
test('durable authoritative reads include captured receipts once and reject unconfirmed source before dependent cache without posting expenses',async t=>{
 const {db,entry,purchase,persist}=await sourceFixture(t),old=purchase(),proof=baseline([old]);let authority=null;Store.initialize(db);Register.initialize(db);
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=>at,saveEntry:()=>{}}),callback=({year,snapshot:source,overrides,origins})=>Source.project({year,snapshot:source,entry,actor,now:()=>at,baseline:proof,authority,overrides,origins}),store=new Store.WorkbookStore({db,register,viewPolicy:policy(),authorize:()=>actor,now:()=>at,getBandwidthProjection:callback});store.install(snapshot());persist();
 assert.equal(store.workbook({year:2026}).bandwidth.count,0);authority=authorityProfile();db.export=()=>{throw Error('Exporting live Main during a read is forbidden.');};
 const initial=store.workbook({year:2026});assert.equal(initial.bandwidth.count,1);assert.equal(initial.bandwidth.purchases[0].requestId,old.requestId);assert.equal(initial.values.Bandwidth.G23,10);assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-10);
 purchase();assert.throws(()=>store.workbook({year:2026,sheet:'Accounting'}),/save could not be confirmed/);assert.equal(q(db,'SELECT COUNT(*) AS n FROM bandwidth_purchases')[0].n,2);assert.equal(q(db,'SELECT COUNT(*) AS n FROM expenses')[0].n,2);persist();
 assert.equal(store.workbook({year:2026,sheet:'Accounting'}).values.Accounting.N3,-20);assert.equal(store.workbook({year:2026}).values.Bandwidth.G23,20);const bytes=fs.readFileSync(entry.path);store.workbook({year:2026,sheet:'Jan'});assert.deepEqual(fs.readFileSync(entry.path),bytes);assert.equal(q(db,'SELECT COUNT(*) AS n FROM expenses')[0].n,2);
 const hiddenPolicy={...policy(),excludedSheets:['Bandwidth',...Array.from({length:8},(_,i)=>'Fictional '+String(i+4).padStart(2,'0'))]},hidden=new Store.WorkbookStore({db,register,viewPolicy:hiddenPolicy,authorize:()=>actor,getBandwidthProjection:callback}),response=hidden.workbook({year:2026,sheet:'Accounting'});assert.equal(response.values.Accounting.N3,-20);assert.equal(response.bandwidth,null);assert.equal(response.snapshot.sheetIndex.length,16);assert(!JSON.stringify(response).includes(old.requestId));
 authority=authorityProfile({sourceSha256:'b'.repeat(64)});assert.throws(()=>store.workbook({year:2026,sheet:'Accounting'}),/does not match/);
});
test('Store calculates repaired Accounting provider formulas in every original month column from the corresponding program month',async t=>{
 const original=snapshot(),annual=by(original,'Accounting');for(let month=0;month<12;month++){const ref=Model.columnName(month+2)+'3';if(month%2===0)delete annual.cells[ref];else annual.cells[ref]={value:0,formula:'=SUMIF(Jan!C2:C200,A3,Jan!D2:D200)'};}
 const rows=MONTHS.map((_,month)=>receipt(month+1,{purchaseDate:'2026-'+String(month+1).padStart(2,'0')+'-12',unitPriceCents:101+month,totalCents:101+month})),{store}=await services(t,{snapshot:original,getBandwidthProjection:({snapshot:source,overrides,origins})=>Projection.project(source,rows,{authority:authorityProfile(),baseline:baseline(rows),overrides,origins})});
 const response=store.workbook({year:2026,sheet:'Accounting'});for(let month=0;month<12;month++){const ref=Model.columnName(month+2)+'3',cost=(101+month)/100;assert.equal(response.values.Accounting[ref],-cost,ref+' references its own monthly provider ledger.');assert(response.managedCells.includes(ref));assert.equal(store.workbook({year:2026,sheet:MONTHS[month]}).values[MONTHS[month]].D3,-cost);}
 const bw=store.workbook({year:2026});assert.equal(bw.bandwidth.count,12);assert.equal(bw.snapshot.sheets[0].maxRow,288);assert.deepEqual(bw.snapshot.sheets[0].tables,by(original,'Bandwidth').tables);assert.equal(response.errors.length,0);
});
