'use strict';
// Fictional HTTP/restart and genuine encrypted-backup regression; no private workbook data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{createServer}=require('../server.cjs');
const {createSecretStorage}=require('../lib/secrets.cjs');
const {DATABASES,OPTIONAL,openBackup}=require('../app/backup-archive.cjs');
const {extractVerifiedBackup}=require('../tools/verify-backup.cjs');
const {workbookSnapshot,cellId}=require('./helpers/accounting-workbook-fixture.cjs');
const version=require('../package.json').version,password='Fictional-worksheet-view-123',passphrase='Fictional-view-backup-only-123',policyFile='accounting-workbook-view.json';
async function unusedPort(){const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
function browser(origin){
  let cookie='',csrf='';
  function send(route,payload){return new Promise((resolve,reject)=>{
    const request=http.request(origin+route,{method:payload?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-App-Version':version}:{})}},response=>{
      if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,...JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});
    });
    request.setTimeout(15000,()=>request.destroy(Error('Fictional worksheet-view HTTP timeout.')));request.on('error',reject);request.end(payload?JSON.stringify(payload):undefined);
  });}
  const call=(channel,args=[])=>send('/api/rpc',{channel,args,workspaceId:'main'});
  async function good(channel,args=[]){const response=await call(channel,args);assert.equal(response.status,200,channel+': '+response.error);assert(!JSON.stringify(response).includes('sessionToken'),'Internal session tokens stay outside HTTP results.');return response.data;}
  return {send,call,good,async login(){const session=await send('/api/session');csrf=session.data.csrfToken;return good('auth:login',[{username:'view.owner',password}]);}};
}
const edit=(sheet,cell,value,revision=0)=>({requestId:crypto.randomUUID(),id:cellId(2026,sheet,cell),version:revision,kind:'sheetcell',year:2026,data:{sheet,cell,value}});
async function recovered(client,action,payload,expected){
  assert.deepEqual(await client.good('accounting:'+action,[payload]),expected,'Completed requests replay their exact original result after worksheet exclusion.');
  const status=await client.good('accounting:status',[{requestId:payload.requestId}]);assert.equal(status.state,'completed');assert.deepEqual(status.result,expected);
  assert.deepEqual(await client.good('accounting:resume',[{requestId:payload.requestId}]),expected);
}
async function excluded(client,originalEdit){
  assert((await client.call('accounting:workbook',[{year:2026,sheet:'Jan'}])).status>=400,'Explicit excluded-sheet reads are rejected.');
  const input=edit('Jan','A2',99,originalEdit.record.version);
  assert((await client.call('accounting:save',[input])).status>=400,'A new request cannot edit an excluded worksheet.');
  assert.equal((await client.good('accounting:status',[{requestId:input.requestId}])).state,'not_found','The denied mutation never becomes a saved request.');
  assert((await client.call('accounting:remove',[{requestId:crypto.randomUUID(),id:originalEdit.record.id,version:originalEdit.record.version,reason:'Denied fictional restoration'}])).status>=400,'Restoring an original excluded cell is also a forbidden new mutation.');
}

test('private worksheet view survives HTTP restart and encrypted backup while preserving original request recovery',async t=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-workbook-view-http-fictional-')),directory=path.join(parent,'original');fs.mkdirSync(directory,{mode:0o700});
  const secrets=createSecretStorage(crypto.randomBytes(32));let backend,server;
  async function stop(){if(server?.listening)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});await backend?.close();}
  t.after(async()=>{await stop();secrets.destroy();const resolved=path.resolve(parent);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('fibernet-workbook-view-http-fictional-'));fs.rmSync(resolved,{recursive:true,force:true});});
  async function start(dataDirectory,initialize=false,snapshot){
    backend=await createBackend({dataDirectory,initialize,version,secrets,automaticMonthClose:false,...(snapshot?{accountingWorkbookSnapshot:snapshot}:{})});
    const port=await unusedPort(),origin='http://127.0.0.1:'+port;server=createServer({backend,origin,demo:true});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return browser(origin);
  }
  const source=workbookSnapshot();let owner=await start(directory,true,source);
  await backend.createOwner({username:'view.owner',fullName:'Fictional Worksheet View Owner',password});await owner.login();
  const before=await owner.good('accounting:workbook',[{year:2026}]);assert.deepEqual(before.snapshot.sheetIndex.map(sheet=>sheet.name),['Jan','Summary'],'No private policy preserves the original worksheet list.');
  const savedInput=edit('Jan','A2',15),saved=await owner.good('accounting:save',[savedInput]);
  const removedInput=edit('Jan','B2',5),toRemove=await owner.good('accounting:save',[removedInput]);
  const removalInput={requestId:crypto.randomUUID(),id:toRemove.record.id,version:toRemove.record.version,reason:'Restore the fictional source input before excluding its tab'};
  const removed=await owner.good('accounting:remove',[removalInput]);await stop();

  const policy={format:'FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1',year:2026,sourceSha256:source.sha256,excludedSheets:['Jan']},policyBytes=Buffer.from(JSON.stringify(policy)+'\n');
  fs.writeFileSync(path.join(directory,policyFile),policyBytes,{flag:'wx',mode:0o600});owner=await start(directory);await owner.login();
  const filtered=await owner.good('accounting:workbook',[{year:2026}]);
  assert.deepEqual(filtered.snapshot.sheetIndex.map(sheet=>sheet.name),['Summary']);assert.deepEqual(filtered.snapshot.sheets.map(sheet=>sheet.name),['Summary'],'An excluded original active sheet falls back to the first retained worksheet.');
  assert.deepEqual(Object.keys(filtered.values),['Summary']);assert.equal(filtered.snapshot.sha256,source.sha256,'The view policy preserves immutable source identity.');
  assert.equal(filtered.values.Summary.B2,46,'Retained formulas still use the excluded-sheet input and its original saved edit.');assert.equal((await owner.send('/'+policyFile)).status,404,'The private policy is not a static asset.');
  await excluded(owner,saved);await recovered(owner,'save',savedInput,saved);await recovered(owner,'remove',removalInput,removed);
  const retainedInput=edit('Summary','A3','Fictional retained worksheet note'),retained=await owner.good('accounting:save',[retainedInput]);await recovered(owner,'save',retainedInput,retained);
  const retainedBook=await owner.good('accounting:workbook',[{year:2026,sheet:'Summary'}]);assert.equal(retainedBook.values.Summary.A3,retainedInput.data.value);assert.equal(retainedBook.values.Summary.B2,46);

  assert(OPTIONAL.includes(policyFile),'The encrypted backup allowlist includes the private view policy.');
  await owner.good('backups:save',[{enabled:false,time:'23:00',passphrase,ftp:{enabled:false},email:{enabled:false}}]);
  const backupResult=await owner.good('backups:run'),job=backupResult.history[0];assert.equal(job.local,'saved');
  const archiveFile=path.join(directory,'scheduled-backups',job.filename),archive=await openBackup(fs.readFileSync(archiveFile),passphrase),archivedPolicy=archive.entries.filter(entry=>entry.name===policyFile);
  assert.equal(archivedPolicy.length,1,'A genuine scheduled backup captures exactly one policy file.');assert.deepEqual(archivedPolicy[0].data,policyBytes);assert.equal(archive.entries.filter(entry=>DATABASES.includes(entry.name)).length,7);await stop();
  const restoredDirectory=path.join(parent,'restored');await extractVerifiedBackup({archive:archiveFile,destination:restoredDirectory,passphrase});assert.deepEqual(fs.readFileSync(path.join(restoredDirectory,policyFile)),policyBytes);
  owner=await start(restoredDirectory);await owner.login();const restoredBook=await owner.good('accounting:workbook',[{year:2026}]);
  assert.deepEqual(restoredBook.snapshot.sheetIndex.map(sheet=>sheet.name),['Summary']);assert.equal(restoredBook.snapshot.sheets[0].name,'Summary');assert.equal(restoredBook.snapshot.sha256,source.sha256);assert.equal(restoredBook.values.Summary.A3,retainedInput.data.value);assert.equal(restoredBook.values.Summary.B2,46);
  await excluded(owner,saved);await recovered(owner,'save',savedInput,saved);await recovered(owner,'remove',removalInput,removed);await recovered(owner,'save',retainedInput,retained);
});