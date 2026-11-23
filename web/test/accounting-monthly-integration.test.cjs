'use strict';
// Fictional Core/RPC and Store/Register composition only; never a provider or live database.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const initSqlJs=require('sql.js'),{createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs');
const Register=require('../app/accounting-register.cjs'),Store=require('../app/accounting-workbook-store.cjs'),Bandwidth=require('../app/accounting-bandwidth.cjs'),Monthly=require('../app/accounting-monthly.cjs'),Model=require('../app/accounting-workbook.cjs'),{query:q}=require('../app/finance-ledger.cjs'),{WORKSPACES}=require('../app/workspaces.cjs');
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],SQL=initSqlJs(),version=require('../package.json').version;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function originalWorkbook(){
 const styles=[{font:{name:'Calibri',size:10,color:'#1F497D'},fill:{pattern:'none'},border:{},alignment:{vertical:'center'},numberFormat:'General'},{font:{name:'Calibri',size:10,color:'#1F497D'},numberFormat:'$#,##0.00'}];
 const sheet=(name,maxRow,maxCol,cells,extra={})=>({name,maxRow,maxCol,cells,merges:[],tables:[],styleRuns:[],columnWidths:{1:25,2:120,3:170,4:100,5:220,6:110,7:110,8:90},rowHeights:{},defaultColumnWidth:90,defaultRowHeight:24,hiddenRows:[],hiddenColumns:[],filteredRows:[],zoomScale:100,...extra});
 const bandwidth=sheet('Bandwidth',288,8,{H4:{value:12,styleId:0}});
 const monthly=MONTHS.map((name,m)=>{
  const first=3+24*m,last=22+24*m,total=23+24*m,header=first-1,title=header-1;
  bandwidth.cells['B'+title]={value:name,styleId:0};bandwidth.merges.push('B'+title+':G'+title);
  const headers=['Date','Name','Quantity','Description','Unit Price','Payment'];headers.forEach((value,i)=>{bandwidth.cells[Model.columnName(i+2)+header]={value,styleId:0}});
  bandwidth.tables.push({name:'OriginalMonth'+m,ref:'B'+header+':G'+last,columns:headers,headerRowCount:1,totalsRowCount:0,styleInfo:{name:'TableStyleMedium23',showRowStripes:true}});
  bandwidth.cells['G'+total]={value:m===0?50:0,formula:'=SUM(G'+first+':G'+last+')',styleId:1};
  const cells={C1:{value:'Account',styleId:0},D1:{value:'Amount',styleId:0}};
  for(let row=2;row<=11;row++){cells['B'+row]={value:'ISP',styleId:0};cells['C'+row]={value:row===2?'Imported supplier':'',styleId:0};cells['D'+row]={value:m===0&&row===2?-50:0,formula:'=-SUMIF(Bandwidth!C'+first+':C'+last+',C'+row+',Bandwidth!G'+first+':G'+last+')',styleId:1}}
  return sheet(name,201,14,cells);
 });
 for(const [col,value]of Object.entries({B:46034,C:'Imported supplier',D:2,E:'Imported purchase stays',F:25,G:50}))bandwidth.cells[col+'3']={value,styleId:col==='F'||col==='G'?1:0};
 const accountingCells={A1:{value:'Account',styleId:0}};
 for(let row=2;row<=11;row++){accountingCells['A'+row]={value:row===2?'Imported supplier':'',styleId:0};MONTHS.forEach((name,m)=>{accountingCells[Model.columnName(m+2)+row]={value:m===0&&row===2?-50:0,formula:'=SUMIF('+name+'!C2:C200,A'+row+','+name+'!D2:D200)',styleId:1}});accountingCells['N'+row]={value:row===2?-50:0,formula:'=SUM(B'+row+':M'+row+')',styleId:1};accountingCells['O'+row]={value:0,styleId:1};accountingCells['P'+row]={value:row===2?-50:0,formula:'=N'+row+'-O'+row,styleId:1}}
 return {format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',name:'Fictional imported workbook',year:2026,sha256:'a'.repeat(64),activeSheet:'Bandwidth',styles,sheets:[bandwidth,...monthly,sheet('Accounting',45,16,accountingCells)]};
}

function monthlyWorkbook(){
 const original=originalWorkbook();original.styles.push({font:{name:'Calibri',size:9,color:'#1F497D'},fill:{pattern:'solid',color:'#DCE6F1'},alignment:{vertical:'center'},numberFormat:'$#,##0.00'});
 original.styles.push({font:{name:'Calibri',size:9,color:'#1F497D'},numberFormat:'dd/mm/yyyy'});
 const headers=['Due Date','Type','Username','Amount','Payment Method','Payment Date','$1','$5','$10','$20','$50','$100','Total Amount','Balance'];
 for(const sh of original.sheets.filter(sh=>MONTHS.includes(sh.name))){
  headers.forEach((value,i)=>{sh.cells[Model.columnName(i+1)+'1']={value,styleId:0}});
  sh.tables=[{name:'Monthly'+sh.name,ref:'A1:N201',columns:headers,headerRowCount:1,totalsRowCount:1,styleInfo:{name:'TableStyleMedium23',showRowStripes:true}}];
  for(let row=2;row<=200;row++){
   sh.cells['F'+row]={value:null,styleId:3};
   if(row>=12&&row<=16){sh.cells['B'+row]={value:'Bandwidth',styleId:0};sh.cells['C'+row]={value:0,styleId:0};sh.cells['D'+row]={value:0,styleId:1}}
   sh.cells['M'+row]={value:row===17?25:0,formula:`=(G${row}*1)+(H${row}*5)+(I${row}*10)+(J${row}*20)+(K${row}*50)+(L${row}*100)`,styleId:2};
   sh.cells['N'+row]={value:row===17?275:0,formula:`=D${row}-M${row}`,styleId:2};
  }
  for(const [col,value]of Object.entries({A:46023,B:'Radius',C:'fictional-reseller',D:300,E:'Imported method',F:46024,G:25}))sh.cells[col+'17']={value,styleId:col==='A'||col==='F'?3:2};
 }
 const ac=original.sheets.find(sh=>sh.name==='Accounting');ac.cells.A17={value:'fictional-reseller',styleId:0};
 for(const row of [2,3,17]){
  if(row===17)MONTHS.forEach((name,m)=>{ac.cells[Model.columnName(m+2)+row]={value:300,formula:`=SUMIF(${name}!C2:C200,A${row},${name}!D2:D200)`,styleId:1}});
  ac.cells['N'+row]={value:0,formula:`=SUM(B${row}:M${row})`,styleId:1};
  ac.cells['O'+row]={value:0,formula:MONTHS.map(name=>`SUMIF(${name}!C2:C200,A${row},${name}!M2:M200)`).join('+').replace(/^/,'='),styleId:1};
  ac.cells['P'+row]={value:0,formula:`=N${row}-O${row}`,styleId:1};
 }
 return original;
}

function workbook(){
 const book=monthlyWorkbook();book.activeSheet='Jan';
 // A historical direct-input Payments cell can have a saved revision before the policy.
 for(const sh of book.sheets.filter(sh=>MONTHS.includes(sh.name)))sh.cells.M17={value:25,styleId:2};
 book.sheets.push({name:'Notes',maxRow:3,maxCol:3,cells:{A1:{value:0,formula:'=Nov!D17+Nov!M17',styleId:1},A2:{value:'Fictional worksheet note',styleId:0}},defaultColumnWidth:90,defaultRowHeight:24,columnWidths:{},rowHeights:{},merges:[],tables:[],styleRuns:[],hiddenRows:[],hiddenColumns:[],filteredRows:[]});
 return book;
}
const monthlyAuthority=(changes={})=>({format:'FIBERNETLB-ACCOUNTING-MONTHLY-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_only',activatedAt:'2026-06-15T08:00:00.000Z',resellerAddedBasis:'net_credit',resellerPaymentBasis:'admin_paybill',...changes});
const bandwidthAuthority=(changes={})=>({format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-06-15T08:00:00.000Z',...changes});
const viewPolicy=excludedSheets=>({format:'FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',year:2026,sourceSha256:'a'.repeat(64),excludedSheets});
const edit=(sheet,cell,value,revision=0)=>({requestId:crypto.randomUUID(),id:Store.cellId(2026,sheet,cell),version:revision,kind:'sheetcell',year:2026,data:{sheet,cell,value}});
function verifiedSource(){
 const common=(id,date,amountCents)=>({id:'fictional:'+id,requestId:'fictional-'+id,receiptNo:'FICTIONAL-'+id,date,amountCents,paymentMethod:'Cash',sourceWorkspaceId:'main',actorKey:'fictional-source-actor',recordedAt:date+'T12:00:00',provenance:{marker:'fictional-private-receipt-marker'}});
 const requestId='fictional-program-purchase-0001';
 return {signature:'f'.repeat(64),purchases:[{id:2,requestId,receiptNo:'BWP-'+requestId,supplierId:2,typeId:1,purchaseDate:'2026-11-14',supplierName:'Program supplier',typeName:'Fictional transit',unit:'Mbps',quantityMicros:1000000,unitPriceCents:20000,totalCents:20000,note:'fictional-private-purchase-note',recordedAt:'2026-11-14T12:00:00'}],identities:{suppliers:[{id:2,name:'Program supplier',active:true}],resellers:[{id:3,username:'fictional-reseller',name:'Fictional reseller',active:true}]},streams:{supplierPayments:[{...common('supplier-payment-0001','2026-11-20',-5000),supplierId:2,supplierName:'Program supplier',allocations:[]}],resellerFunding:[{...common('net-funding-0001','2026-11-21',9900),resellerUsername:'fictional-reseller',resellerName:'Fictional reseller',grossCents:10000,nativeDeductionCents:100}],resellerCollections:[{...common('admin-collection-0001','2026-11-25',10000),resellerUsername:'fictional-reseller',resellerName:'Fictional reseller',allocations:[]}]}};
}
function history(db){return JSON.stringify([q(db,'SELECT * FROM accounting_register_records ORDER BY id'),q(db,'SELECT * FROM accounting_register_requests ORDER BY request_id'),q(db,'SELECT * FROM accounting_register_audit ORDER BY id')]);}
async function composition(t,{enabled=true,excluded=[]}={}){
 const db=new (await SQL).Database();Register.initialize(db);Store.initialize(db);db.exec("CREATE TABLE fictional_operational_guard(id TEXT PRIMARY KEY,value INTEGER);INSERT INTO fictional_operational_guard VALUES('cash',123),('wallet',456);");
 const actor={role:'admin',active:1,account_key:'fictional-main-admin',full_name:'Fictional Main Admin'},state={enabled,error:false,phase:'',calls:0,saves:0,source:verifiedSource(),at:'2026-01-01T10:00:00'},original=workbook();let store;
 const register=new Register.AccountingRegister({db,authorize:()=>actor,now:()=>state.at,saveEntry:async()=>{state.saves++;if(state.phase==='fail')throw Error('Fictional unacknowledged durable save');state.durable=Buffer.from(db.export())},validateCell:(...args)=>store.assertEditable(...args),assertCellMutable:(...args)=>store.assertCellMutable(...args)});
 const project=({year,snapshot,overrides,origins})=>{
  state.calls++;if(state.error)throw Error('Fictional verified source unavailable');
  if(!state.enabled)return {snapshot,signature:'manual-source',metadata:null,managedCells:{}};
  // Exact Core pipeline; the source DTO is injected instead of opening operational databases.
  const verified=state.source,authority=monthlyAuthority();assert.equal(year,authority.year);assert(Array.isArray(verified.purchases));
  const base=Bandwidth.project(snapshot,verified.purchases,{authority:bandwidthAuthority(),overrides,origins,programOnly:authority.mode==='program_only',identities:verified.identities});
  const projected=Monthly.project(base,{...verified.streams,identities:verified.identities},{authority,overrides,origins});
  return {...projected,signature:sha(JSON.stringify([projected.signature,verified.signature]))};
 };
 const makeStore=names=>new Store.WorkbookStore({db,register,authorize:()=>actor,now:()=>state.at,getBandwidthProjection:project,viewPolicy:viewPolicy(names)});
 store=makeStore(excluded);store.install(original);store.assertViewPolicy();state.durable=Buffer.from(db.export());t.after(()=>db.close());
 return {db,register,state,original,get store(){return store},setView(names){store=makeStore(names);store.assertViewPolicy()}};
}

test('genuine Main Admin Accounting RPC composes empty durable sources and validates the private program-only profiles',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-monthly-integration-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32)),source=workbook();let backend;
 const monthlyFile=path.join(directory,'accounting-monthly-authority.json'),bandwidthFile=path.join(directory,'accounting-bandwidth-authority.json'),password='Fictional-monthly-integration-only-123';
 const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
 t.after(async()=>{await backend?.close();secrets.destroy();const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('fibernet-monthly-integration-fictional-'));fs.rmSync(target,{recursive:true,force:true});});
 const start=async initialize=>{backend=await createBackend({dataDirectory:directory,initialize,version,secrets,automaticMonthClose:false,providersEnabled:false,...initialize?{accountingWorkbookSnapshot:source}:{}})};
 const login=async()=>{const result=await backend.request({channel:'auth:login',args:[{username:'monthly.owner',password}],workspaceId:'main'});assert.equal(result.status,200,result.error);assert.equal(result.data.user.role,'admin');return result.data.sessionToken;};
 await start(true);await backend.createOwner({username:'monthly.owner',fullName:'Fictional Monthly Integration Owner',password});await backend.close();
 write(monthlyFile,monthlyAuthority());write(bandwidthFile,bandwidthAuthority());await start(false);let token=await login();
 const rpc=(sheet)=>backend.request({channel:'accounting:workbook',args:[{year:2026,...sheet?{sheet}:{}}],workspaceId:'main',token});
 const dbFiles=WORKSPACES.map(section=>section.id==='main'?path.join(directory,'isp-desk.sqlite'):path.join(directory,'sections',section.id+'.sqlite')),before=dbFiles.map(file=>sha(fs.readFileSync(file)));
 const monthly=await rpc('Jan');assert.equal(monthly.status,200,monthly.error);assert.equal(monthly.data.monthly.policy,'program_only');assert.equal(monthly.data.monthly.month,'2026-01');assert.equal(monthly.data.monthly.supplierPaymentCents,0);assert.equal(monthly.data.monthly.resellerAddedCents,0);assert.equal(monthly.data.monthly.resellerCollectionCents,0);assert.equal(monthly.data.values.Jan.C17,null);assert([null,0,''].includes(monthly.data.values.Jan.D17));assert([null,0,''].includes(monthly.data.values.Jan.M17));assert.equal(monthly.data.snapshot.sheets[0].maxRow,201);assert.equal(monthly.data.snapshot.sheets[0].maxCol,14);assert.deepEqual(monthly.data.snapshot.sheets[0].tables,source.sheets.find(sheet=>sheet.name==='Jan').tables);assert.deepEqual(monthly.data.snapshot.styles.slice(0,source.styles.length),source.styles);
 const annual=await rpc('Accounting');assert.equal(annual.status,200,annual.error);assert.equal(annual.data.monthly.months.length,12);assert(annual.data.monthly.months.every(month=>month.source==='program'&&month.resellerAddedCents===0));assert.equal((await rpc('Notes')).data.monthly,null);assert.deepEqual(dbFiles.map(file=>sha(fs.readFileSync(file))),before,'Accounting reads never initialize or save any of the seven financial databases.');
 const foreign=await backend.request({channel:'accounting:workbook',args:[{year:2026}],workspaceId:'fiber-users',token});assert(foreign.status>=400);assert((await backend.request({channel:'accounting:workbook',args:[{year:2026}],workspaceId:'main'})).status>=400);
 await backend.close();write(monthlyFile,{...monthlyAuthority(),unsupported:true});await assert.rejects(start(false),/monthly accounting authority|monthly accounting.*profile/i);
 write(monthlyFile,monthlyAuthority({sourceSha256:'b'.repeat(64)}));write(bandwidthFile,bandwidthAuthority({sourceSha256:'b'.repeat(64)}));await start(false);token=await login();assert((await rpc('Jan')).status>=400,'A pair of profiles bound to a different source cannot clear the installed workbook.');await backend.close();
 write(monthlyFile,monthlyAuthority());fs.unlinkSync(bandwidthFile);await start(false);token=await login();assert((await rpc('Notes')).status>=400,'The monthly policy requires the matching bandwidth authority even on an unrelated selected sheet.');
});

test('Store and Register preserve original uncertain cell results while the program projection supersedes saved financial inputs',async t=>{
 const f=await composition(t,{enabled:false}),operational=q(f.db,'SELECT * FROM fictional_operational_guard ORDER BY id'),d=edit('Nov','D17',777),m=edit('Nov','M17',888);
 const savedD=await f.register.save(d);f.state.phase='fail';await assert.rejects(f.register.save(m),/could not be confirmed/);const pending=f.register.status({requestId:m.requestId});assert.equal(pending.state,'save_required');assert.equal(pending.result.record.data.value,888);const rows=history(f.db);
 f.state.enabled=true;f.state.error=true;f.state.phase='';const calls=f.state.calls;assert.deepEqual(await f.register.resume({requestId:m.requestId}),pending.result);assert.deepEqual(await f.register.save(m),pending.result);assert.deepEqual(await f.register.save(d),savedD);assert.deepEqual(f.register.status({requestId:m.requestId}).result,pending.result);assert.equal(f.state.calls,calls,'Prior recovery does not evaluate the new readonly/source guard.');assert.equal(history(f.db),rows,'Recovery cannot rewrite the original cells or audits.');
 f.state.error=false;const visible=f.store.workbook({year:2026,sheet:'Nov'});assert.equal(visible.values.Nov.D17,99);assert.equal(visible.values.Nov.M17,100);assert.equal(visible.values.Nov.N17,-1);assert.equal(visible.edits.Nov.D17.version,1);assert.equal(visible.edits.Nov.M17.version,1);assert.equal(history(f.db),rows,'Calculated program values do not rewrite saved cell history.');
 for(const cell of ['D17','M17','G17']){const input=edit('Nov',cell,123,cell==='G17'?0:1);await assert.rejects(f.register.save(input),/linked to saved program records/);assert.equal(f.register.status({requestId:input.requestId}).state,'not_found','A denied managed edit is never journaled.');assert.equal(history(f.db),rows)}
 const removal={requestId:crypto.randomUUID(),id:d.id,version:1,reason:'Denied fictional managed restoration'};await assert.rejects(f.register.remove(removal),/linked to saved program records/);assert.equal(f.register.status({requestId:removal.requestId}).state,'not_found');assert.equal(history(f.db),rows);
 for(const sheet of ['Nov','Accounting','Notes'])f.store.workbook({year:2026,sheet});assert(f.store.calculations.size>=3);f.state.error=true;for(const sheet of ['Nov','Accounting','Notes'])assert.throws(()=>f.store.workbook({year:2026,sheet}),/verified source unavailable/,'Source errors precede cached rendering for '+sheet);
 assert.deepEqual(q(f.db,'SELECT * FROM fictional_operational_guard ORDER BY id'),operational);assert.equal(history(f.db),rows);
});

test('hidden monthly sheets remain calculation dependencies without exposing receipt metadata through annual or unrelated views',async t=>{
 const f=await composition(t,{excluded:['Nov','Bandwidth']}),nov=f.state.source.streams.resellerFunding[0],annual=f.store.workbook({year:2026,sheet:'Accounting'});
 assert(!annual.snapshot.sheetIndex.some(sheet=>['Nov','Bandwidth'].includes(sheet.name)));assert.deepEqual(annual.snapshot.sheets.map(sheet=>sheet.name),['Accounting']);assert.deepEqual(Object.keys(annual.values),['Accounting']);assert.equal(annual.values.Accounting.L17,99,'The hidden November sheet still feeds its annual amount.');assert.equal(annual.values.Accounting.O17,100);assert.equal(annual.values.Accounting.P17,-1);assert.equal(annual.monthly.months.length,11);assert(!annual.monthly.months.some(month=>month.sheet==='Nov'));assert.equal(annual.bandwidth,null);
 const serialized=JSON.stringify(annual);for(const marker of [nov.id,nov.requestId,nov.receiptNo,nov.actorKey,'fictional-private-receipt-marker','fictional-private-purchase-note'])assert(!serialized.includes(marker),'Annual responses exclude source receipt details: '+marker);
 assert.throws(()=>f.store.workbook({year:2026,sheet:'Nov'}),/visible installed worksheet/);assert.throws(()=>f.store.workbook({year:2026,sheet:'Bandwidth'}),/visible installed worksheet/);
 const note=f.store.workbook({year:2026,sheet:'Notes'});assert.equal(note.monthly,null);assert.equal(note.bandwidth,null);assert.equal(note.values.Notes.A1,199,'Unrelated sheets also calculate through the complete hidden dependency graph.');assert(!JSON.stringify(note).includes(nov.receiptNo));assert.equal(f.original.sheets.length,15);assert(f.store.source(2026).sheets.some(sheet=>sheet.name==='Nov'));
 f.setView(['Bandwidth',...MONTHS]);const noMonths=f.store.workbook({year:2026,sheet:'Accounting'});assert.equal(noMonths.monthly,null,'No visible monthly tabs means no monthly aggregate metadata.');assert.equal(noMonths.values.Accounting.L17,99);assert.deepEqual(noMonths.snapshot.sheetIndex.map(sheet=>sheet.name),['Accounting','Notes']);
});
