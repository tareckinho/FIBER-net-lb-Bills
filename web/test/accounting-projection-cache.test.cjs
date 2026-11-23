'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ProjectionCache}=require('../app/accounting-projection-cache.cjs');
const Source=require('../app/accounting-monthly-source.cjs'),Bandwidth=require('../app/accounting-bandwidth.cjs'),Store=require('../app/accounting-workbook-store.cjs'),Model=require('../app/accounting-workbook.cjs');
const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),version=require('../package.json').version;

test('one-entry projection cache owns an immutable copy and never freezes or aliases source inputs',()=>{
 const cache=new ProjectionCache(),inputs={year:2026,snapshot:{cells:{A1:{value:1}}},overrides:{},origins:{},verified:{signature:'verified',identities:{suppliers:[]}},profiles:{mode:'program_only'}},result={snapshot:inputs.snapshot,managedCells:{Jan:['A1']},metadata:{months:[{count:1}]} };let calls=0;
 const first=cache.get(inputs,()=>{calls++;return result;}),second=cache.get(structuredClone(inputs),()=>{calls++;return {};});
 assert.equal(calls,1);assert.equal(first,second);assert.notEqual(first,result);assert.notEqual(first.snapshot,inputs.snapshot);
 assert(Object.isFrozen(first)&&Object.isFrozen(first.snapshot.cells.A1)&&Object.isFrozen(first.managedCells.Jan));
 assert.throws(()=>first.snapshot.cells.A1.value=9,TypeError);assert.throws(()=>first.managedCells.Jan.push('B1'),TypeError);
 result.metadata.months[0].count=90;assert.equal(cache.get(inputs,()=>assert.fail()).metadata.months[0].count,1);
 assert(!Object.isFrozen(inputs.snapshot));inputs.snapshot.cells.A1.value=2;assert.equal(cache.get(inputs,()=>({snapshot:inputs.snapshot})).snapshot.cells.A1.value,2);
});

test('complete snapshot, verified receipts, identities, profiles, baseline and ownership inputs invalidate the single cached projection',()=>{
 const seed={year:2026,snapshot:{cells:{A1:{value:1}},styles:[{numberFormat:'General'}]},overrides:{Jan:{E2:1}},origins:{Jan:{E2:{createdAt:'2026-01-01T10:00:00',deleted:false}}},verified:{signature:'same-signature',purchases:[{id:1,totalCents:100}],streams:{refunds:[]},identities:{suppliers:[{id:1,active:true}]}},baseline:{purchases:[{requestId:'old',fingerprint:'one'}]},bandwidthAuthority:{activatedAt:'2026-01-01T08:00:00.000Z'},monthlyAuthority:{mode:'program_only'}};
 const changes=[x=>x.year++,x=>x.snapshot.cells.A1.value++,x=>x.snapshot.styles[0].numberFormat='$0.00',x=>x.overrides.Jan.E2++,x=>x.origins.Jan.E2.createdAt='2026-01-02T10:00:00',x=>x.origins.Jan.E2.deleted=true,x=>x.verified.signature='changed-proof',x=>x.verified.purchases[0].totalCents++,x=>x.verified.streams.refunds.push({id:'refund',amountCents:-1}),x=>x.verified.identities.suppliers[0].active=false,x=>x.baseline.purchases[0].fingerprint='two',x=>x.bandwidthAuthority.activatedAt='2026-01-02T08:00:00.000Z',x=>x.monthlyAuthority.mode='program_months'];
 for(const change of changes){const cache=new ProjectionCache();let calls=0;const calculate=()=>({calls:++calls});cache.get(seed,calculate);const next=structuredClone(seed);change(next);assert.equal(cache.get(next,calculate).calls,2);assert.equal(cache.get(seed,calculate).calls,3,'Only one completed input set is retained.');}
 const cache=new ProjectionCache();assert.notEqual(cache.get({},()=>({key:1})),cache.get({missing:undefined},()=>({key:2})),'Undefined fields cannot collapse into missing complete inputs.');
 assert.notEqual(cache.get({zero:0},()=>({key:3})),cache.get({zero:-0},()=>({key:4})));
 assert.notEqual(cache.get({array:[,]},()=>({key:5})),cache.get({array:[undefined]},()=>({key:6})),'Array length and absent slots are part of the key.');
 const ordered=cache.get({a:1,b:2},()=>({key:7}));assert.equal(cache.get({b:2,a:1},()=>assert.fail()),ordered,'Equivalent own fields have one deterministic key.');
 const hidden={};Object.defineProperty(hidden,'value',{value:1,enumerable:false});assert.notEqual(cache.get({value:1},()=>({key:8})),cache.get(hidden,()=>({key:9})),'Enumeration changes cannot reuse a projection with different visible inputs.');
 assert.notEqual(cache.get({text:'\ud800'},()=>({key:10})),cache.get({text:'\ufffd'},()=>({key:11})),'Distinct JSON strings cannot collide through replacement UTF-8 characters.');
});

test('failed, asynchronous or input-mutating calculations never replace a completed projection',()=>{
 const cache=new ProjectionCache(),prior=cache.get({id:1},()=>({value:1}));let calls=0;
 for(let i=0;i<2;i++)assert.throws(()=>cache.get({id:2},()=>{calls++;throw Error('Fictional formula failure');}),/formula failure/);
 assert.equal(calls,2);assert.equal(cache.get({id:1},()=>assert.fail()),prior);
 assert.throws(()=>cache.get({id:3},()=>Promise.resolve({value:3})),/synchronously/);
 const input={id:4};assert.throws(()=>cache.get(input,()=>{input.id=5;return {}; }),/inputs changed/);
 const cycle={};cycle.self=cycle;
 for(const unsupported of [new Date(),new Map(),new Set(),new Uint8Array([1]),{fn(){}},cycle])assert.throws(()=>cache.get(unsupported,()=>assert.fail()),/plain data/);
 const accessor={};Object.defineProperty(accessor,'danger',{get(){assert.fail('An accessor must never execute.');}});assert.throws(()=>cache.get(accessor,()=>assert.fail()),/accessors/);
 assert.equal(cache.get({id:1},()=>assert.fail()),prior);
});

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function workbook(){
 const sheet=(name,maxRow,maxCol,cells)=>({name,maxRow,maxCol,cells,merges:[],tables:[],styleRuns:[],columnWidths:{},rowHeights:{},hiddenRows:[],hiddenColumns:[],filteredRows:[]});
 const bandwidth=sheet('Bandwidth',288,8,{}),annual=sheet('Accounting',40,16,{A1:{value:'Account'},A2:{value:'**Fictional provider'}}),months=[];
 for(let m=0;m<12;m++){
  const first=3+24*m,last=22+24*m,total=23+24*m,header=first-1;
  ['Date','Name','Quantity','Description','Unit Price','Payments'].forEach((value,i)=>bandwidth.cells[Model.columnName(i+2)+header]={value});
  bandwidth.tables.push({name:'CacheMonth'+m,ref:'B'+header+':G'+last,columns:['Date','Name','Quantity','Description','Unit Price','Payments'],headerRowCount:1,totalsRowCount:0});
  bandwidth.cells['G'+total]={value:0,formula:'=SUM(G'+first+':G'+last+')'};
  const month=sheet(MONTHS[m],201,14,{A1:{value:'No.'}});
  for(let row=2;row<=11;row++){month.cells['A'+row]={value:row-1};month.cells['B'+row]={value:'ISP'};month.cells['C'+row]={value:row===2?'Fictional provider':0};month.cells['D'+row]={value:0,formula:'=-SUMIF(Bandwidth!C'+first+':C'+last+',C'+row+',Bandwidth!G'+first+':G'+last+')'};month.cells['M'+row]={value:0,formula:'=SUM(G'+row+':L'+row+')'};month.cells['N'+row]={value:0,formula:'=D'+row+'-M'+row};}
  for(let row=2;row<=39;row++)annual.cells[Model.columnName(m+2)+row]={value:0,formula:'=IF(A'+row+'<>"",SUMIF('+MONTHS[m]+'!C2:C200,A'+row+','+MONTHS[m]+'!D2:D200),"")'};
  months.push(month);
 }
 for(let row=2;row<=39;row++){annual.cells['N'+row]={value:0,formula:'=SUM(B'+row+':M'+row+')'};annual.cells['O'+row]={value:0};annual.cells['P'+row]={value:0,formula:'=N'+row+'-O'+row};}
 return {format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',name:'Fictional cache workbook',year:2026,sha256:'a'.repeat(64),activeSheet:'Nov',styles:[{font:{name:'Calibri',size:10},numberFormat:'General'}],sheets:[bandwidth,...months,annual,sheet('Notes',3,3,{A1:{value:0,formula:'=Nov!D2'}})]};
}
function verified(){return {signature:'f'.repeat(64),purchases:[],streams:{supplierPayments:[],resellerFunding:[],resellerCollections:[]},identities:{suppliers:[{id:1,name:'Fictional provider',active:true}],resellers:[]}};}

test('Core freshly verifies every workbook read before reusing a pure projection and rejects tampering even after a cache hit',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-projection-cache-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32)),password='Fictional-cache-only-password-123',source=workbook();let backend,reads=0,projections=0,fail=false,current=verified();
 const originalRead=Source.read,originalProject=Bandwidth.project;
 Source.read=()=>{reads++;if(fail)throw Error('Fictional source tamper detected');return structuredClone(current);};Bandwidth.project=(...args)=>{projections++;return originalProject(...args);};
 t.after(async()=>{Source.read=originalRead;Bandwidth.project=originalProject;await backend?.close();secrets.destroy();const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('fibernet-projection-cache-fictional-'));fs.rmSync(target,{recursive:true,force:true});});
 const start=async initialize=>{backend=await createBackend({dataDirectory:directory,version,secrets,initialize,automaticMonthClose:false,providersEnabled:false,...initialize?{accountingWorkbookSnapshot:source}:{}});};
 const login=async()=>{const response=await backend.request({channel:'auth:login',args:[{username:'cache.owner',password}],workspaceId:'main'});assert.equal(response.status,200,response.error);return response.data.sessionToken;};
 let token;const rpc=(channel,args)=>backend.request({channel,args,workspaceId:'main',token});
 await start(true);await backend.createOwner({username:'cache.owner',fullName:'Fictional Cache Owner',password});token=await login();
 const savedInput={requestId:crypto.randomUUID(),id:Store.cellId(2026,'Notes','B1'),version:0,kind:'sheetcell',year:2026,data:{sheet:'Notes',cell:'B1',value:'Saved before policy'}},saved=await rpc('accounting:save',[savedInput]);assert.equal(saved.status,200,saved.error);await backend.close();
 const authority={year:2026,sourceSha256:source.sha256,mode:'program_months',activatedAt:'2026-06-15T08:00:00.000Z'};
 fs.writeFileSync(path.join(directory,'accounting-bandwidth-authority.json'),JSON.stringify({format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',...authority}),{mode:0o600});fs.writeFileSync(path.join(directory,'accounting-monthly-authority.json'),JSON.stringify({format:'FIBERNETLB-ACCOUNTING-MONTHLY-AUTHORITY-1',...authority,mode:'program_only',resellerAddedBasis:'net_credit',resellerPaymentBasis:'admin_paybill'}),{mode:0o600});
 await start(false);token=await login();reads=0;projections=0;
 const get=sheet=>rpc('accounting:workbook',[{year:2026,sheet}]),first=await get('Nov'),second=await get('Nov');assert.equal(first.status,200,first.error);assert.equal(second.status,200,second.error);assert.equal(reads,2);assert.equal(projections,1);assert.equal((await get('Notes')).status,200);assert.equal(reads,3);assert.equal(projections,1,'Selected sheets reuse the same immutable full-workbook projection.');
 fail=true;const refused=await get('Nov');assert(refused.status>=400);assert.equal(projections,1,'Cached results never bypass the fresh source gate.');const beforeReplay=reads;assert.deepEqual(await rpc('accounting:save',[savedInput]),saved);assert.equal(reads,beforeReplay,'Exact original saved-request recovery still precedes new projection guards.');
 fail=false;const requestId='fictional-cache-purchase-0001';current.purchases.push({id:1,requestId,receiptNo:'BWP-'+requestId,supplierId:1,typeId:1,purchaseDate:'2026-11-12',supplierName:'Fictional provider',typeName:'Fictional transit',unit:'Mbps',quantityMicros:1000000,unitPriceCents:100,totalCents:100,note:'Fictional receipt',recordedAt:'2026-11-12T12:00:00'});
 const changed=await get('Nov');assert.equal(changed.status,200,changed.error);assert.equal(changed.data.values.Nov.D2,-1);assert.equal(projections,2,'A receipt change invalidates even if a test double reuses its signature.');
 const denied={requestId:crypto.randomUUID(),id:Store.cellId(2026,'Nov','D2'),version:0,kind:'sheetcell',year:2026,data:{sheet:'Nov',cell:'D2',value:500}};assert((await rpc('accounting:save',[denied])).status>=400,'Managed-cell guards remain active with a cached projection.');
 const next={...savedInput,requestId:crypto.randomUUID(),version:1,data:{...savedInput.data,value:'Changed override'}};const updated=await rpc('accounting:save',[next]);assert.equal(updated.status,200,updated.error);const refreshed=await get('Notes');assert.equal(refreshed.status,200,refreshed.error);assert.equal(refreshed.data.values.Notes.B1,'Changed override');assert(projections>2,'A new override and its ownership origin invalidate the pure result.');
});
