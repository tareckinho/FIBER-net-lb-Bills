'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const initSqlJs=require('sql.js'),Store=require('../app/accounting-workbook-store.cjs'),Register=require('../app/accounting-register.cjs');
const {query:q}=require('../app/finance-ledger.cjs');
const sql=initSqlJs();
const policy=(extra={})=>({format:'FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',year:2026,sourceSha256:'a'.repeat(64),excludedSheets:['Input'],...extra});
const snapshot=()=>({format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',year:2026,name:'Fictional-view.xlsx',sha256:'a'.repeat(64),activeSheet:'Input',styles:[],sheets:[
 {name:'Input',maxRow:4,maxCol:3,tables:[],cells:{A1:{value:12},A2:{value:8},A3:{value:20,formula:'=SUM(A1:A2)'},B1:{value:0,formula:'=DOESNOTEXIST(1)'}}},
 {name:'Summary',maxRow:4,maxCol:3,tables:[],cells:{A1:{value:40,formula:'=Input!A3*2'},B1:{value:0,formula:'=Input!B1'},C1:{value:1}}}
]});
const input=(requestId,sheet,cell,value,version=0)=>({requestId,id:Store.cellId(2026,sheet,cell),version,kind:'sheetcell',year:2026,data:{sheet,cell,value}});

test('private workbook view policy is bounded, strict, copied and fail-closed while an absent file means no exclusions',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-fictional-workbook-policy-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 const file=path.join(directory,Store.POLICY_FILE);
 assert.equal(Store.POLICY_FILE,'accounting-workbook-view.json');assert.equal(Store.readViewPolicy(file),null);
 assert.throws(()=>Store.readViewPolicy('relative-view.json'),/absolute path/);
 fs.writeFileSync(file,JSON.stringify(policy()));const read=Store.readViewPolicy(file);assert.deepEqual(read,policy());assert(Object.isFrozen(read));assert(Object.isFrozen(read.excludedSheets));
 for(const invalid of [null,[],{},policy({unknown:true}),policy({format:'Unknown'}),policy({year:1999}),policy({sourceSha256:'invalid'}),policy({excludedSheets:['Input','Input']}),policy({excludedSheets:['Input','input']}),policy({excludedSheets:['bad\0name']}),policy({excludedSheets:['x'.repeat(32)]}),policy({excludedSheets:Array(101).fill('Input')})]){
  fs.writeFileSync(file,JSON.stringify(invalid));assert.throws(()=>Store.readViewPolicy(file),/policy/);
 }
 fs.writeFileSync(file,'{invalid');assert.throws(()=>Store.readViewPolicy(file),/policy/);
 fs.writeFileSync(file,' '.repeat(64*1024+1));assert.throws(()=>Store.readViewPolicy(file),/bounded/);
 assert.throws(()=>Store.readViewPolicy(directory),/regular file/);
 const alias=path.join(directory,'linked-policy.json');fs.writeFileSync(file,JSON.stringify(policy()));fs.linkSync(file,alias);assert.throws(()=>Store.readViewPolicy(alias),/without links/);
});

test('policy validates exact source membership and leaves unrelated installed years and immutable source cells intact',async t=>{
 const SQL=await sql,db=new SQL.Database();t.after(()=>db.close());Register.initialize(db);Store.initialize(db);
 const original=snapshot(),base=new Store.WorkbookStore({db,now:()=> '2026-11-22T12:00:00',authorize:()=>({})});base.install(original);
 const second={...snapshot(),year:2027,sha256:'b'.repeat(64)};base.install(second);
 const register={verifyRecord(){throw Error('No edits exist in this fixture.');}};
 for(const value of [policy({sourceSha256:'c'.repeat(64)}),policy({year:2025}),policy({excludedSheets:['Unknown']}),policy({excludedSheets:['input']}),policy({excludedSheets:['Input','Summary']})]){
  const service=new Store.WorkbookStore({db,register,viewPolicy:value,authorize:()=>({})});assert.throws(()=>service.assertViewPolicy(),/policy/);
 }
 const supplied=policy(),service=new Store.WorkbookStore({db,register,viewPolicy:supplied,authorize:()=>({})});supplied.excludedSheets.length=0;
 service.assertViewPolicy();assert.deepEqual(service.visibleSheets(service.source(2026)).map(sheet=>sheet.name),['Summary']);
 const originalBytes=Buffer.from(q(db,'SELECT snapshot_gzip FROM accounting_workbook_sources WHERE year=2026')[0].snapshot_gzip);
 const selected=service.workbook({year:2026});assert.equal(selected.snapshot.activeSheet,'Summary');assert.equal(selected.snapshot.sheets[0].name,'Summary');assert.equal(selected.values.Summary.A1,40);assert.deepEqual(selected.snapshot.sheetIndex.map(sheet=>sheet.name),['Summary']);assert.throws(()=>service.workbook({year:2026,sheet:'Input'}),/visible/);
 const unscoped=service.workbook({year:2027});assert.equal(unscoped.snapshot.activeSheet,'Input');assert.deepEqual(unscoped.snapshot.sheetIndex.map(sheet=>sheet.name),['Input','Summary']);
 assert.equal(service.source(2026).sheets.length,2);assert.equal(service.source(2026).activeSheet,'Input');assert.deepEqual(Buffer.from(q(db,'SELECT snapshot_gzip FROM accounting_workbook_sources WHERE year=2026')[0].snapshot_gzip),originalBytes);
 const noExclusions=new Store.WorkbookStore({db,register,viewPolicy:policy({excludedSheets:[]}),authorize:()=>({})});assert.equal(noExclusions.workbook({year:2026}).snapshot.activeSheet,'Input');
});

test('excluded edited inputs still calculate; exact saved save/remove recovery survives while fresh hidden writes are rejected',async t=>{
 const SQL=await sql,db=new SQL.Database();t.after(()=>db.close());Register.initialize(db);Store.initialize(db);
 let store,failSave=false,saves=0;
 const actor={role:'admin',active:1,account_key:'fictional-view-admin',full_name:'Fictional View Admin'};
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=> '2026-11-22T12:00:00',validateCell:(data,year,id)=>store.assertEditable(data,year,id),assertCellMutable:(data,year)=>store.assertCellVisible(data,year),saveEntry:()=>{saves++;if(failSave)throw Error('Fictional uncertain save');}});
 const open=viewPolicy=>new Store.WorkbookStore({db,register,viewPolicy,authorize:()=>actor,now:()=> '2026-11-22T12:00:00'});
 store=open(null);store.install(snapshot());
 const priorSecond=input('fictional-prior-second','Input','A2',9),savedSecond=await register.save(priorSecond),priorRemove={requestId:'fictional-prior-remove',id:priorSecond.id,version:1,reason:'Restore fictional original'};
 const removed=await register.remove(priorRemove);assert.equal(removed.record.deleted,true);
 const prior=input('fictional-hidden-lost-reply','Input','A1',15);failSave=true;await assert.rejects(register.save(prior),/save could not be confirmed/);
 const original=register.status({requestId:prior.requestId}).result;assert.equal(original.record.data.value,15);
 const sourceBefore=q(db,'SELECT * FROM accounting_workbook_sources'),requestsBefore=q(db,'SELECT * FROM accounting_register_requests'),auditsBefore=q(db,'SELECT * FROM accounting_register_audit');
 store=open(policy());store.assertViewPolicy();const visible=store.workbook({year:2026});assert.equal(visible.values.Summary.A1,46,'Hidden edited input and restored tombstone still feed the retained formula.');assert.deepEqual(visible.errors.map(error=>error.sheet),['Summary'],'Independent excluded-sheet errors are omitted; visible propagated dependency errors remain.');
 assert.equal(register.status({requestId:prior.requestId}).state,'save_required');failSave=false;
 assert.deepEqual(await register.save(prior),original,'Exact pending save replays before visibility restriction.');assert.deepEqual(await register.resume({requestId:prior.requestId}),original);assert.equal(register.status({requestId:prior.requestId}).state,'completed');
 assert.deepEqual(await register.save(priorSecond),savedSecond);assert.deepEqual(await register.remove(priorRemove),removed,'Exact completed removal returns its saved result after exclusion.');assert.deepEqual(await register.resume({requestId:priorRemove.requestId}),removed);
 const saveCount=saves;
 await assert.rejects(register.save(input('fictional-new-hidden-save','Input','A1',99,1)),/removed from the Accounting view/);
 await assert.rejects(register.remove({requestId:'fictional-new-hidden-remove',id:prior.id,version:1,reason:'Fictional hidden edit'}),/removed from the Accounting view/);
 assert.equal(saves,saveCount);assert.deepEqual(q(db,'SELECT * FROM accounting_workbook_sources'),sourceBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_requests'),requestsBefore);assert.deepEqual(q(db,'SELECT * FROM accounting_register_audit'),auditsBefore);
 const retained=await register.save(input('fictional-visible-change','Summary','C1',3));assert.equal(retained.record.data.value,3);assert.equal(store.workbook({year:2026}).values.Summary.C1,3);
 const reopenedDb=new SQL.Database(db.export());t.after(()=>reopenedDb.close());let reopenedStore;
 const reopened=new Register.AccountingRegister({db:reopenedDb,authorize:()=>actor,now:()=> '2026-11-22T12:00:00',validateCell:(data,year,id)=>reopenedStore.assertEditable(data,year,id),assertCellMutable:(data,year)=>reopenedStore.assertCellVisible(data,year),saveEntry:()=>{}});
 reopenedStore=new Store.WorkbookStore({db:reopenedDb,register:reopened,viewPolicy:policy(),authorize:()=>actor});reopenedStore.assertViewPolicy();assert.equal(reopenedStore.workbook({year:2026}).values.Summary.A1,46);assert.deepEqual(await reopened.resume({requestId:prior.requestId}),original);assert.deepEqual(await reopened.remove(priorRemove),removed);
});
