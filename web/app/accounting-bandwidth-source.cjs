'use strict';
// Read-only receipt projection. Never export or reopen the live database.
const fs=require('node:fs'),Bandwidth=require('./bandwidth-accounting.cjs'),Spending=require('./bandwidth-spending.cjs'),Projection=require('./accounting-bandwidth.cjs');
function witness(rows){return JSON.stringify(rows.map(p=>[p.id,p.requestId,p.receiptNo,p.supplierId,p.supplierName,p.typeId,p.typeName,p.unit,p.purchaseDate,p.quantityMicros,p.unitPriceCents,p.totalCents,p.note,p.actorKey,p.actorName,p.actorId,p.recordedAt,p.expenseId,p.expenseLink]).sort((a,b)=>a[0]-b[0]));}
function project({year,snapshot,entry,actor,now,baseline=null,authority=null,overrides={},origins={}}){
 if(!snapshot.sheets.some(s=>s.name==='Bandwidth')||!(authority?.year===year||baseline?.year===year))return {snapshot,signature:'',metadata:null,managedCells:{}};
 const start=year+'-01-01',end=year+'-12-31';
 const verified=db=>{Spending.purchaseSummary({entries:new Map([['main',{db}]]),start,end,accountKey:null});return new Bandwidth.BandwidthAccounting({db,workspaceId:'main',actor,now}).purchases({start,end});};
 const live=verified(entry.db);let disk;
 try{
  const stat=fs.lstatSync(entry.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error('Invalid source');
  disk=new entry.db.constructor(fs.readFileSync(entry.path));const saved=verified(disk);
  if(witness(live)!==witness(saved))throw Error('Unsaved source');
 }catch(error){throw Error('The bandwidth purchase save could not be confirmed. Check the original purchase result before refreshing Accounting.',{cause:error});}
 finally{disk?.close();}
 return Projection.project(snapshot,live,{baseline,authority,overrides,origins});
}
module.exports={project};
