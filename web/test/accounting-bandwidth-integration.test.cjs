'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const initSqlJs=require('sql.js'),Store=require('../app/accounting-workbook-store.cjs'),Register=require('../app/accounting-register.cjs');
const Projection=require('../app/accounting-bandwidth.cjs'),Source=require('../app/accounting-bandwidth-source.cjs'),Bandwidth=require('../app/bandwidth-accounting.cjs');
const {query:q}=require('../app/finance-ledger.cjs');
const sql=initSqlJs(),at='2026-11-22T12:00:00';
const actor={id:1,role:'admin',active:1,account_key:'main:1',full_name:'Fictional Projection Owner'};
function snapshot(year=2026){
 const cells={},tables=[],styleRuns=[];
 for(let month=0;month<12;month++){
  const header=2+24*month,first=header+1,last=header+20,total=last+1;
  ['Date','Name','Quantity','Description','Unit Price','Payment'].forEach((value,index)=>{cells[String.fromCharCode(66+index)+header]={value,styleId:1};});
  cells['G'+first]={value:5,styleId:2};cells['G'+total]={value:5,formula:'=SUM(G'+first+':G'+last+')',styleId:3};
  styleRuns.push([header,1,8,1],[first,1,8,2],[total,1,8,3]);
  tables.push({name:'FictionalMonth'+month,ref:'B'+header+':G'+last,columns:['Date','Name','Quantity','Description','Unit Price','Payment'],headerRowCount:1,totalsRowCount:0,styleInfo:{name:'TableStyleMedium23',showRowStripes:true}});
 }
 cells.D3={value:2,styleId:2};cells.F3={value:5,styleId:2};cells.G3={value:10,formula:'=D3*F3',styleId:2};
 const extra=Array.from({length:24},(_,index)=>({name:'Fictional '+String(index+1).padStart(2,'0'),maxRow:1,maxCol:1,cells:{A1:index===0?{value:10,formula:'=Bandwidth!G23'}:{value:index+1}}}));
 return {format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',year,name:'Fictional-bandwidth.xlsx',sha256:'a'.repeat(64),activeSheet:'Bandwidth',styles:[
  {numberFormat:'General',font:{name:'Calibri',size:10}},{numberFormat:'General',font:{name:'Calibri',size:10,bold:true},fill:{pattern:'solid',color:'#DCE6F1'}},
  {numberFormat:'0.00',font:{name:'Calibri',size:10}},{numberFormat:'$0.00',font:{name:'Calibri',size:10,bold:true}}
 ],sheets:[{name:'Bandwidth',maxRow:288,maxCol:8,cells,tables,styleRuns,columnWidths:{1:9,2:140,3:160,4:92,5:300,6:93,7:161,8:68},rowHeights:{},defaultRowHeight:20,hiddenRows:[],filteredRows:[],merges:[]},...extra]};
}
const policy=()=>({format:'FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',year:2026,sourceSha256:'a'.repeat(64),excludedSheets:Array.from({length:9},(_,i)=>'Fictional '+String(i+16).padStart(2,'0'))});
function receipt(id,extra={}){const requestId='fictional-linked-'+String(id).padStart(5,'0');return {id,requestId,receiptNo:'BWP-'+requestId,supplierId:1,typeId:1,purchaseDate:'2026-01-12',supplierName:'Saved fictional supplier',typeName:'Fictional Transit',unit:'Mbps',quantityMicros:1000000,unitPriceCents:200,totalCents:200,note:'Fictional original note',...extra};}
const edit=(requestId,sheet,cell,value,version=0)=>({requestId,id:Store.cellId(2026,sheet,cell),version,kind:'sheetcell',year:2026,data:{sheet,cell,value}});

test('Store refreshes linked costs before cached reads, keeps sixteen tabs and original manual cells, and recovers exact pending requests',async t=>{
 const SQL=await sql,db=new SQL.Database();t.after(()=>db.close());Register.initialize(db);Store.initialize(db);
 let store,sourceRows=[],sourceError=false,reads=0,failSave=false;
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=>at,validateCell:(data,year,id)=>store.assertEditable(data,year,id),assertCellMutable:(data,year)=>store.assertCellVisible(data,year),saveEntry:()=>{if(failSave)throw Error('Fictional uncertain disk save');}});
 store=new Store.WorkbookStore({db,register,viewPolicy:policy(),authorize:()=>actor,now:()=>at,getBandwidthProjection:({year,snapshot:original})=>{reads++;assert.equal(year,original.year);if(sourceError)throw Error('Fictional source validation failed');return Projection.project(original,sourceRows);}});
 const original=snapshot(),sourceJson=JSON.stringify(original);store.install(original);
 const initial=store.workbook({year:2026});assert.equal(initial.bandwidth.count,0);assert.equal(initial.snapshot.sheets[0].maxRow,288);assert.equal(initial.snapshot.sheetIndex.length,16);
 const instruction=edit('fictional-original-manual-save','Bandwidth','D3',3);failSave=true;await assert.rejects(register.save(instruction),/save could not be confirmed/);
 const saved=register.status({requestId:instruction.requestId}).result;assert.equal(saved.record.data.value,3);
 const sourceBefore=q(db,'SELECT * FROM accounting_workbook_sources'),requestsBefore=q(db,'SELECT * FROM accounting_register_requests'),auditsBefore=q(db,'SELECT * FROM accounting_register_audit');
 sourceRows=[receipt(1)];const first=store.workbook({year:2026}),jan=first.bandwidth.months[0];
 assert.equal(first.bandwidth.signature,Projection.project(original,sourceRows).signature,'Browser metadata carries the exact source projection signature.');
 assert.equal(first.snapshot.sheetIndex.length,16);assert.equal(first.bandwidth.count,1);assert.equal(first.values.Bandwidth.G23,15,'Original manual total uses its existing edit only, without adding linked costs.');assert.equal(first.values.Bandwidth['G'+jan.totalRow],2,'Linked cost has its own monthly total.');
 assert.equal(first.snapshot.sheets[0].cells.G23.formula,original.sheets[0].cells.G23.formula);assert.equal(store.workbook({year:2026,sheet:'Fictional 01'}).values['Fictional 01'].A1,15);
 sourceRows=[receipt(1),receipt(2,{unitPriceCents:333,totalCents:333,note:'New fictional receipt'})];const refreshed=store.workbook({year:2026}),month=refreshed.bandwidth.months[0],newRow=month.rows.find(row=>row.id===2).row;
 assert.equal(refreshed.bandwidth.count,2);assert.equal(refreshed.values.Bandwidth['G'+newRow],3.33);assert.equal(refreshed.values.Bandwidth['G'+month.totalRow],5.33,'A changed source signature cannot reuse cached cells.');assert.equal(refreshed.values.Bandwidth.G23,15);
 const previousReads=reads;sourceError=true;assert.throws(()=>store.workbook({year:2026}),/source validation failed/);assert.equal(reads,previousReads+1,'Source validation happens even when a completed result was cached.');sourceError=false;
 failSave=false;assert.deepEqual(await register.save(instruction),saved);assert.deepEqual(await register.resume({requestId:instruction.requestId}),saved);assert.deepEqual(register.status({requestId:instruction.requestId}).result,saved);
 await assert.rejects(register.save(edit('fictional-linked-edit-denied','Bandwidth','G'+newRow,999)),/outside the installed worksheet/);
 assert.throws(()=>store.workbook({year:2026,sheet:'Fictional 16'}),/visible/);
 assert.deepEqual(q(db,'SELECT * FROM accounting_workbook_sources'),sourceBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_requests'),requestsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_audit'),auditsBefore);assert.equal(JSON.stringify(store.source(2026)),sourceJson);
 sourceRows=Array.from({length:21},(_,index)=>receipt(index+1));const overflow=store.workbook({year:2026}),expanded=overflow.bandwidth.months[0];
 assert.equal(expanded.count,21);assert.equal(expanded.rows.length,21);assert(expanded.lastRow-expanded.firstRow+1>=21);assert.equal(overflow.values.Bandwidth['G'+expanded.totalRow],42);assert.equal(overflow.values.Bandwidth.G23,15);assert.equal(overflow.snapshot.sheetIndex.length,16);
 for(const row of expanded.rows)assert.equal(overflow.snapshot.sheets[0].cells['G'+row.row].editable,false);
});

async function sourceFixture(t){
 const SQL=await sql,db=new SQL.Database(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-fictional-bandwidth-source-')),file=path.join(directory,'main.sqlite');
 t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('fibernet-fictional-bandwidth-source-'));fs.rmSync(directory,{recursive:true,force:true});});
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,account_key TEXT,full_name TEXT,role TEXT,active INTEGER);INSERT INTO users VALUES(1,'main:1','Fictional Projection Owner','admin',1);CREATE TABLE finance_months(month TEXT PRIMARY KEY);CREATE TABLE expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,expense_date TEXT,category TEXT,description TEXT,amount REAL,user_id INTEGER,source_type TEXT,source_id TEXT,created_at TEXT);");
 Bandwidth.initialize(db);const core=new Bandwidth.BandwidthAccounting({db,workspaceId:'main',actor,now:()=>at});
 const supplier=core.createSupplier({requestId:'fictional-source-supplier',name:'Fictional Source Supplier'}),type=core.createType({requestId:'fictional-source-type',name:'Fictional Transit',unit:'Mbps'});
 const exportBytes=db.export.bind(db),persist=()=>fs.writeFileSync(file,exportBytes(),{mode:0o600});
 let counter=0;
 function purchase(date='2026-01-12'){
  const requestId='fictional-source-purchase-'+(++counter);db.exec('BEGIN');
  try{const row=core.createPurchase({requestId,supplierId:supplier.id,typeId:type.id,purchaseDate:date,quantity:'2',unitPrice:'5',note:'Fictional source purchase'});
   db.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id,created_at) VALUES(?,'Bandwidth cost',?,?,?,'bandwidth_purchase',?,?)",[row.purchaseDate,'Fictional linked cost',row.totalCost,row.actorId,String(row.id),at]);
   const expenseId=q(db,'SELECT last_insert_rowid() AS id')[0].id,result=core.linkPurchaseExpense(row.id,{expenseId,sourceType:'bandwidth_purchase',sourceId:String(row.id)});db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {SQL,db,file,entry:{db,path:file},purchase,persist,exportBytes};
}

test('durability adapter rejects an unconfirmed purchase before a cache hit and preserves live prepared statements without exporting Main',async t=>{
 const fixture=await sourceFixture(t),{db,entry,purchase,persist}=fixture;purchase();persist();
 Store.initialize(db);Register.initialize(db);let store;
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=>at,saveEntry:()=>{}});
 store=new Store.WorkbookStore({db,register,authorize:()=>actor,now:()=>at,getBandwidthProjection:({year,snapshot:original})=>Source.project({year,snapshot:original,entry,actor,now:()=>at})});store.install(snapshot());persist();
 db.export=()=>{throw Error('Exporting live Main is forbidden during this read.');};
 const statement=db.prepare('SELECT receipt_no FROM bandwidth_purchases WHERE id=?');statement.bind([1]);
 const first=store.workbook({year:2026});assert.equal(first.bandwidth.count,1);assert(statement.step());assert.match(statement.get()[0],/^BWP-fictional-source-purchase-/);statement.free();
 const second=purchase();assert.throws(()=>store.workbook({year:2026}),/save could not be confirmed/,'Unconfirmed in-memory source cannot fall back to the prior cached sheet.');
 assert.equal(q(db,'SELECT COUNT(*) AS n FROM bandwidth_purchases')[0].n,2,'The read did not replay or duplicate the purchase.');persist();
 const refreshed=store.workbook({year:2026}),jan=refreshed.bandwidth.months[0],row=jan.rows.find(value=>value.id===second.id).row;assert.equal(refreshed.bandwidth.count,2);assert.equal(refreshed.values.Bandwidth['G'+row],10);assert.equal(refreshed.values.Bandwidth['G'+jan.totalRow],20);
 const bytesBefore=fs.readFileSync(entry.path);store.workbook({year:2026});assert.deepEqual(fs.readFileSync(entry.path),bytesBefore,'Repeated reads never save a financial database.');
});

test('durability adapter verifies out-of-year audits, rejects damaged disk receipts, and selects only the requested year',async t=>{
 const fixture=await sourceFixture(t),{SQL,db,entry,purchase,persist}=fixture;purchase('2026-01-12');const nextYear=purchase('2027-02-01');persist();
 const original=snapshot(),first=Source.project({year:2026,snapshot:original,entry,actor,now:()=>at}),future=Source.project({year:2027,snapshot:snapshot(2027),entry,actor,now:()=>at});assert.equal(first.metadata.count,1);assert.equal(future.metadata.count,1);assert.equal(future.metadata.months[1].count,1);
 const damaged=new SQL.Database(fs.readFileSync(entry.path));
 try{damaged.exec("DROP TRIGGER bandwidth_audit_update;UPDATE bandwidth_audit SET result_json='{}' WHERE action='purchase_create' AND record_id="+nextYear.id);fs.writeFileSync(entry.path,damaged.export());}finally{damaged.close();}
 assert.throws(()=>Source.project({year:2026,snapshot:original,entry,actor,now:()=>at}),/save could not be confirmed/,'Out-of-year disk audit damage is not an acceptable verified zero.');persist();
 db.exec("DROP TRIGGER bandwidth_audit_update;UPDATE bandwidth_audit SET result_json='{}' WHERE action='purchase_create' AND record_id="+nextYear.id);
 assert.throws(()=>Source.project({year:2026,snapshot:original,entry,actor,now:()=>at}),/purchase cost could not be verified/,'Out-of-year live audit damage is validated before projecting selected-year rows.');
 const unrelated={...snapshot(),sheets:[{name:'Fictional only',maxRow:1,maxCol:1,cells:{A1:{value:1}}}]};const skipped=Source.project({year:2026,snapshot:unrelated,entry:{},actor,now:()=>at});assert.strictEqual(skipped.snapshot,unrelated);assert.equal(skipped.metadata,null);
});

test('non-Bandwidth and excluded worksheet views never call the source callback or disclose linked receipt metadata',async t=>{
 const SQL=await sql,db=new SQL.Database();t.after(()=>db.close());Register.initialize(db);Store.initialize(db);
 const register=new Register.AccountingRegister({db});let calls=0;
 const service=viewPolicy=>new Store.WorkbookStore({db,register,viewPolicy,authorize:()=>actor,now:()=>at,getBandwidthProjection:({snapshot:original})=>{calls++;return Projection.project(original,[receipt(1)]);}});
 let store=service(policy());store.install(snapshot());
 const unrelated=store.workbook({year:2026,sheet:'Fictional 01'});assert.equal(calls,0);assert.equal(unrelated.bandwidth,null);assert.equal(unrelated.values['Fictional 01'].A1,10);
 const excluded=['Bandwidth',...Array.from({length:8},(_,i)=>'Fictional '+String(i+17).padStart(2,'0'))];store=service({...policy(),excludedSheets:excluded});store.assertViewPolicy();
 const selected=store.workbook({year:2026});assert.equal(calls,0);assert.equal(selected.snapshot.sheetIndex.length,16);assert.equal(selected.snapshot.sheets[0].name,'Fictional 01');assert.equal(selected.bandwidth,null);assert(!selected.snapshot.sheetIndex.some(sheet=>sheet.name==='Bandwidth'));
 assert.throws(()=>store.workbook({year:2026,sheet:'Bandwidth'}),/visible/);assert.equal(calls,0);
});
