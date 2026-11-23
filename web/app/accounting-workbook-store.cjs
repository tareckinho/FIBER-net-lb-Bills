'use strict';
const crypto=require('node:crypto'),zlib=require('node:zlib'),fs=require('node:fs'),path=require('node:path');
const {query:q}=require('./finance-ledger.cjs');
const Model=require('./accounting-workbook.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const POLICY_FILE='accounting-workbook-view.json',POLICY_FORMAT='FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',MAX_POLICY_BYTES=64*1024;
function viewPolicy(value){
 if(value==null)return null;
 const fields=['format','year','sourceSha256','excludedSheets'];
 if(!plain(value)||Reflect.ownKeys(value).length!==fields.length||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!fields.includes(k))||fields.some(k=>!Object.hasOwn(value,k))||value.format!==POLICY_FORMAT||!Number.isInteger(value.year)||value.year<2000||value.year>2099||typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sourceSha256)||!Array.isArray(value.excludedSheets)||value.excludedSheets.length>100||Array.from(value.excludedSheets).some(name=>typeof name!=='string'||!name||name.length>31||/[\u0000-\u001f\u007f]/.test(name))||new Set(value.excludedSheets.map(name=>name.toLowerCase())).size!==value.excludedSheets.length)throw Error('Choose a valid private workbook view policy.');
 return Object.freeze({format:POLICY_FORMAT,year:value.year,sourceSha256:value.sourceSha256.toLowerCase(),excludedSheets:Object.freeze([...value.excludedSheets])});
}
function readViewPolicy(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('The private workbook view policy requires an absolute path.');
 let before;try{before=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw Error('The private workbook view policy could not be read.');}
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_POLICY_BYTES)throw Error('The private workbook view policy must be a bounded regular file without links.');
 let descriptor;
 try{
  descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(descriptor);
  if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>MAX_POLICY_BYTES)throw Error('changed');
  const buffer=Buffer.alloc(MAX_POLICY_BYTES+1);let length=0,count;
  do{count=fs.readSync(descriptor,buffer,length,buffer.length-length,null);length+=count;}while(count&&length<buffer.length);
  const after=fs.fstatSync(descriptor);
  if(length>MAX_POLICY_BYTES||length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error('changed');
  const parsed=JSON.parse(buffer.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''));if(parsed===null)throw Error('shape');return viewPolicy(parsed);
 }catch{throw Error('The private workbook view policy is invalid or could not be read.');}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function keys(v,allowed,required=[]){if(!plain(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))throw Error('Choose valid workbook request fields.');}
function validYear(y){if(!Number.isInteger(y)||y<2000||y>2099)throw Error('Choose a workbook year from 2000 through 2099.');return y;}
function address(a){const m=typeof a==='string'&&/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(a);if(!m)throw Error('Choose a valid worksheet cell.');const col=Model.columnNumber(m[1]),row=Number(m[2]);if(col>16384||row>1048576)throw Error('Choose a valid worksheet cell.');return {col,row};}
function rectangle(ref){const [a,b=a]=String(ref).split(':'),p=address(a.replace(/\$/g,'')),s=address(b.replace(/\$/g,''));return {c1:p.col,c2:s.col,r1:p.row,r2:s.row};}
const inside=(p,r)=>p.col>=r.c1&&p.col<=r.c2&&p.row>=r.r1&&p.row<=r.r2;
function cellId(year,sheet,cell){return 'cell-'+hash(String(year)+'\0'+sheet+'\0'+cell).slice(0,32);}
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS accounting_workbook_sources(year INTEGER PRIMARY KEY,source_name TEXT NOT NULL,source_sha256 TEXT NOT NULL,payload_sha256 TEXT NOT NULL,snapshot_gzip BLOB NOT NULL,installed_at TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS accounting_workbook_sources_update BEFORE UPDATE ON accounting_workbook_sources BEGIN SELECT RAISE(ABORT,'Original workbook snapshots are immutable.');END;CREATE TRIGGER IF NOT EXISTS accounting_workbook_sources_delete BEFORE DELETE ON accounting_workbook_sources BEGIN SELECT RAISE(ABORT,'Original workbook snapshots are immutable.');END;`);}
function needsMigration(db){return ['accounting_workbook_sources','accounting_workbook_sources_update','accounting_workbook_sources_delete'].some(name=>!q(db,'SELECT name FROM sqlite_master WHERE name=?',[name]).length);}
function validateLayout(snapshot){
 Model.validateSnapshot(snapshot);validYear(snapshot.year);
 if(snapshot.format!=='FIBERNETLB-ACCOUNTING-WORKBOOK-1'||typeof snapshot.name!=='string'||!snapshot.name||snapshot.name.length>160||/[\\/:\u0000-\u001f]/.test(snapshot.name)||!/^[a-f0-9]{64}$/i.test(snapshot.sha256||''))throw Error('Choose a valid private workbook source.');
 if(!Array.isArray(snapshot.styles)||snapshot.styles.length>5000)throw Error('The workbook style list is invalid.');
 let runs=0;
 for(const style of snapshot.styles){if(!plain(style))throw Error('A workbook cell style is invalid.');if(style.font){if(typeof style.font.name!=='string'||style.font.name.length>100||/[{};<>\u0000-\u001f]/.test(style.font.name)||!Number.isFinite(style.font.size)||style.font.size<=0||style.font.size>1000)throw Error('A workbook font is invalid.');}for(const c of [style.font?.color,style.fill?.color,...Object.values(style.border||{}).map(edge=>edge.color)])if(c!=null&&!/^#[a-f0-9]{6}$/i.test(c))throw Error('A workbook color is invalid.');if(style.numberFormat!==undefined&&(typeof style.numberFormat!=='string'||style.numberFormat.length>2048))throw Error('A workbook number format is invalid.');}
 for(const sheet of snapshot.sheets){
  if(!Number.isInteger(sheet.maxRow)||sheet.maxRow<1||sheet.maxRow>1048576||!Number.isInteger(sheet.maxCol)||sheet.maxCol<1||sheet.maxCol>16384)throw Error('Workbook dimensions are invalid.');
  for(const [cell,value]of Object.entries(sheet.cells)){const p=address(cell);if(p.row>sheet.maxRow||p.col>sheet.maxCol)throw Error('A workbook cell is outside its worksheet.');if(value.styleId!==undefined&&(!Number.isInteger(value.styleId)||value.styleId<0||value.styleId>=Math.max(snapshot.styles.length,1)))throw Error('A workbook style reference is invalid.');}
  for(const [map,maximum]of [[sheet.columnWidths,sheet.maxCol],[sheet.rowHeights,sheet.maxRow]])if(map!==undefined){if(!plain(map))throw Error('Workbook dimensions must be indexed sizes.');for(const [index,size]of Object.entries(map))if(!/^\d+$/.test(index)||Number(index)<1||Number(index)>maximum||!Number.isFinite(size)||size<0||size>10000)throw Error('A workbook row or column size is invalid.');}
  for(const run of sheet.styleRuns||[]){if(++runs>500000||!Array.isArray(run)||run.length!==4||run.some(n=>!Number.isInteger(n))||run[0]<1||run[0]>sheet.maxRow||run[1]<1||run[2]<run[1]||run[2]>sheet.maxCol||run[3]<0||run[3]>=Math.max(snapshot.styles.length,1))throw Error('A workbook formatting range is invalid.');}
  if((sheet.merges||[]).length>20000)throw Error('Too many merged workbook ranges.');for(const merge of sheet.merges||[]){const box=rectangle(merge);if(box.r2>sheet.maxRow||box.c2>sheet.maxCol)throw Error('A merged range is outside its worksheet.');}
 }
 return snapshot;
}
class WorkbookStore{
 constructor(context){Object.assign(this,context);this.viewPolicy=viewPolicy(context.viewPolicy);this.snapshots=new Map();this.calculations=new Map();}
 install(snapshot){validateLayout(snapshot);const existing=q(this.db,'SELECT source_sha256 FROM accounting_workbook_sources WHERE year=?',[snapshot.year])[0];if(existing){if(existing.source_sha256!==snapshot.sha256)throw Error('An original workbook is already installed for this year. Preserve its records before changing sources.');return false;}const raw=Buffer.from(JSON.stringify(snapshot));if(raw.length>64*1024*1024)throw Error('The private workbook exceeds the supported size.');this.db.run('INSERT INTO accounting_workbook_sources VALUES(?,?,?,?,?,?)',[snapshot.year,snapshot.name,snapshot.sha256,hash(raw),zlib.gzipSync(raw),this.now()]);this.snapshots.delete(snapshot.year);return true;}
 source(year){validYear(year);if(this.snapshots.has(year))return this.snapshots.get(year);const row=q(this.db,'SELECT * FROM accounting_workbook_sources WHERE year=?',[year])[0];if(!row)return null;let raw,snapshot;try{raw=zlib.gunzipSync(Buffer.from(row.snapshot_gzip),{maxOutputLength:64*1024*1024});snapshot=JSON.parse(raw.toString('utf8'));}catch{throw Error('The private workbook snapshot could not be read.');}if(hash(raw)!==row.payload_sha256||snapshot.sha256!==row.source_sha256||snapshot.name!==row.source_name||snapshot.year!==year)throw Error('The original workbook snapshot could not be verified.');validateLayout(snapshot);this.snapshots.set(year,snapshot);return snapshot;}
 assertViewPolicy(){const policy=this.viewPolicy;if(!policy)return null;const snapshot=this.source(policy.year);if(!snapshot||String(snapshot.sha256).toLowerCase()!==policy.sourceSha256)throw Error('The private workbook view policy does not match its installed source.');const names=new Set(snapshot.sheets.map(sheet=>sheet.name));if(policy.excludedSheets.some(name=>!names.has(name))||policy.excludedSheets.length>=snapshot.sheets.length)throw Error('The private workbook view policy must retain an installed worksheet and name only original sheets.');return snapshot;}
 visibleSheets(snapshot){this.assertViewPolicy();return this.viewPolicy?.year===snapshot.year?snapshot.sheets.filter(sheet=>!this.viewPolicy.excludedSheets.includes(sheet.name)):snapshot.sheets;}
 assertCellVisible(data,year){this.assertViewPolicy();if(this.viewPolicy?.year===year&&this.viewPolicy.excludedSheets.includes(data?.sheet))throw Error('This worksheet has been removed from the Accounting view. Its original records are preserved.');return true;}
 projection(year,snapshot,changes){return this.getBandwidthProjection?.({year,snapshot,overrides:changes.values,origins:changes.origins})??{snapshot,signature:'',metadata:null,managedCells:{}};}
 assertCellMutable(data,year){
  this.assertCellVisible(data,year);const snapshot=this.source(year);if(!snapshot)throw Error('Install the original workbook before editing cells.');
  const changes=this.overrides(year),projected=this.projection(year,snapshot,changes);
  if((projected.managedCells?.[data?.sheet]||[]).includes(data?.cell))throw Error('This cell is linked to a saved bandwidth purchase. Change the original purchase workflow instead.');
  const aliases=Object.entries(projected.managedCells||{}).filter(([name])=>name!=='Bandwidth').flatMap(([name,refs])=>refs.filter(ref=>name==='Accounting'?/^A[1-9]\d*$/.test(ref):/^C[1-9]\d*$/.test(ref)).map(ref=>[name,ref]));
  if(aliases.length){
   // A new date or payment must keep the supplier label that the operator saw.
   // Test the proposed state before journaling; exact saved-result replay has
   // already returned in AccountingRegister and never reaches this guard.
   const copyGroups=input=>Object.assign(Object.create(null),Object.fromEntries(Object.entries(input||{}).map(([name,cells])=>[name,Object.assign(Object.create(null),cells)])));const values=copyGroups(changes.values),origins=copyGroups(changes.origins);
   values[data.sheet]??={};values[data.sheet][data.cell]=data.value;origins[data.sheet]??={};
   const existing=origins[data.sheet][data.cell];origins[data.sheet][data.cell]={createdAt:existing?.createdAt??this.now?.(),deleted:false};
   let next;try{next=this.projection(year,snapshot,{...changes,values,origins});}catch(error){throw Error('This change could not safely keep its linked supplier. No cell was saved. Check the original result, then retry the same request.',{cause:error});}
   for(const [name,ref]of aliases){const prior=projected.snapshot.sheets.find(s=>s.name===name)?.cells[ref],current=next.snapshot.sheets.find(s=>s.name===name)?.cells[ref];
    if(!(next.managedCells?.[name]||[]).includes(ref)||!current||current.value!==prior?.value)throw Error('This change would move a linked supplier away from its date or payment. No cell was saved. Check the original result, then retry the same request.');
   }
  }
  return true;
 }
 assertEditable(data,year,id){keys(data,['sheet','cell','value'],['sheet','cell','value']);const snapshot=this.source(year);if(!snapshot)throw Error('Install the original workbook before editing cells.');const sheet=snapshot.sheets.find(s=>s.name===data.sheet);if(!sheet)throw Error('Choose an installed worksheet.');const p=address(data.cell);if(p.row>sheet.maxRow||p.col>sheet.maxCol)throw Error('This cell is outside the installed worksheet.');if(id!==cellId(year,data.sheet,data.cell))throw Error('This workbook cell reference does not match the original worksheet.');if(sheet.cells[data.cell]?.formula)throw Error('Formula cells are read-only; edit the original input cells instead.');for(const table of sheet.tables||[]){const box=rectangle(table.ref);if(inside(p,box)&&p.row<box.r1+(table.headerRowCount??1))throw Error('Original table headers are read-only.');}for(const merge of sheet.merges||[]){const box=rectangle(merge);if(inside(p,box)&&(p.row!==box.r1||p.col!==box.c1))throw Error('Edit the first cell of this merged range.');}return true;}
 overrides(year){const values=Object.create(null),edits=Object.create(null),origins=Object.create(null);const rows=q(this.db,"SELECT * FROM accounting_register_records WHERE year=? AND kind='sheetcell' ORDER BY id",[year]);for(const row of rows){const record=this.register.verifyRecord(row),d=record.data;this.assertEditable(d,year,record.id);origins[d.sheet]??=Object.create(null);origins[d.sheet][d.cell]={createdAt:record.createdAt,deleted:record.deleted};edits[d.sheet]??=Object.create(null);edits[d.sheet][d.cell]={id:record.id,version:record.version,deleted:record.deleted};if(!record.deleted){values[d.sheet]??=Object.create(null);values[d.sheet][d.cell]=d.value;}}return {values,edits,origins,signature:hash(JSON.stringify(rows.map(row=>[row.id,row.version,row.deleted])))};}
 workbook(input){
  this.authorize();keys(input,['year','sheet','filters','showAllRows'],['year']);const year=validYear(input.year),snapshot=this.source(year);if(!snapshot)return {year,available:false};
  const visible=this.visibleSheets(snapshot),visibleNames=new Set(visible.map(sheet=>sheet.name)),activeSheet=visibleNames.has(snapshot.activeSheet)?snapshot.activeSheet:visible[0].name;
  const name=input.sheet??activeSheet;if(typeof name!=='string'||!visibleNames.has(name))throw Error('Choose a visible installed worksheet.');
  if(input.showAllRows!==undefined&&typeof input.showAllRows!=='boolean')throw Error('Choose valid row visibility.');
  if(input.filters!==undefined&&(!Array.isArray(input.filters)||input.filters.length>32))throw Error('Choose a bounded workbook filter.');
  const changes=this.overrides(year),projection=this.projection(year,snapshot,changes),projected=projection.snapshot,calculationOverrides=projection.calculationOverrides??changes.values;let sheets=projected.sheets.map(s=>{const overrides=calculationOverrides[s.name]||{},missing=Object.keys(overrides).filter(a=>!s.cells[a]);return missing.length?{...s,cells:{...s.cells,...Object.fromEntries(missing.map(a=>[a,{value:null}]))}}:s;});
  const selected=sheets.find(s=>s.name===name),filterKey=JSON.stringify([input.filters??null,input.showAllRows??false,name]),cacheKey=year+':'+changes.signature+':'+projection.signature+':'+filterKey;
  let cached=this.calculations.get(cacheKey);
  if(!cached){
   let result=Model.calculate({...projected,sheets},calculationOverrides),view=selected;
   if(input.showAllRows||input.filters?.length){const hidden=new Set(input.showAllRows?[]:(selected.hiddenRows||[])),filtered=new Set(input.showAllRows?[]:(selected.filteredRows||[]));for(const filter of input.filters||[]){keys(filter,['table','column','values'],['table','column','values']);const table=selected.tables?.find(t=>t.name===filter.table);if(!table||!Number.isInteger(filter.column)||filter.column<0||filter.column>=table.columns.length||!Array.isArray(filter.values)||filter.values.length>2000||filter.values.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='string'&&v.length>32767||typeof v==='number'&&!Number.isFinite(v)))throw Error('Choose valid worksheet table filter values.');const box=rectangle(table.ref),col=Model.columnName(box.c1+filter.column),end=box.r2-(table.totalsRowCount||0);const match=v=>filter.values.some(w=>typeof v==='string'&&typeof w==='string'?v.toLowerCase()===w.toLowerCase():v===w);for(let row=box.r1+(table.headerRowCount??1);row<=end;row++){const value=result.values[name][col+row]??null;if(!match(value))filtered.add(row);}}view={...selected,hiddenRows:[...hidden].sort((a,b)=>a-b),filteredRows:[...filtered].sort((a,b)=>a-b)};sheets=sheets.map(s=>s.name===name?view:s);result=Model.calculate({...projected,sheets},calculationOverrides);}
   cached={view,result};this.calculations.set(cacheKey,cached);if(this.calculations.size>16)this.calculations.delete(this.calculations.keys().next().value);
  }
  return {year,available:true,bandwidth:name==='Bandwidth'&&visibleNames.has(name)?projection.metadata:null,managedCells:projection.managedCells?.[name]??[],snapshot:{format:snapshot.format,name:snapshot.name,sha256:snapshot.sha256,activeSheet,styles:projected.styles,sheetIndex:visible.map(s=>({name:s.name,maxRow:projected.sheets.find(p=>p.name===s.name).maxRow,maxCol:s.maxCol,hidden:Boolean(s.hidden),tabColor:s.tabColor??null})),sheets:[cached.view]},values:{[name]:cached.result.values[name]},edits:{[name]:changes.edits[name]??{}},errors:cached.result.errors.filter(error=>!this.viewPolicy||this.viewPolicy.year!==year||!this.viewPolicy.excludedSheets.includes(error.sheet))};
 }
}
module.exports={initialize,needsMigration,WorkbookStore,validateLayout,cellId,POLICY_FILE,readViewPolicy};
