'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Baseline=require('../app/accounting-bandwidth-baseline.cjs'),Backup=require('../app/backup-archive.cjs');
const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),{extractVerifiedBackup}=require('../tools/verify-backup.cjs');
const {workbookSnapshot}=require('./helpers/accounting-workbook-fixture.cjs');
const value=(extra={})=>({format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-BASELINE-1',year:2026,sourceSha256:'a'.repeat(64),cutoverAt:'2026-11-23T00:00:00.000Z',purchases:[{requestId:'fictional-existing-receipt',fingerprint:'b'.repeat(64)}],...extra});
function directory(t){const result=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-fictional-bandwidth-baseline-'));t.after(()=>{assert.equal(path.dirname(path.resolve(result)),path.resolve(os.tmpdir()));assert(path.basename(result).startsWith('fibernet-fictional-bandwidth-baseline-'));fs.rmSync(result,{recursive:true,force:true});});return result;}

test('future-purchase baseline validates exact fields, calendar timestamps, bounded immutable receipt identities and independent copies',()=>{
 assert.equal(Baseline.FILE,'accounting-bandwidth-baseline.json');assert.equal(Baseline.FORMAT,value().format);assert.equal(Baseline.validateBaseline(null),null);
 const supplied=value(),result=Baseline.validateBaseline(supplied);assert.deepEqual(result,value());assert(Object.isFrozen(result));assert(Object.isFrozen(result.purchases));assert(Object.isFrozen(result.purchases[0]));supplied.purchases[0].fingerprint='c'.repeat(64);supplied.purchases.length=0;assert.deepEqual(result,value());
 assert.equal(Baseline.validateBaseline(value({sourceSha256:'A'.repeat(64)})).sourceSha256,'a'.repeat(64));assert.deepEqual(Baseline.validateBaseline(value({purchases:[]})).purchases,[]);
 for(const invalid of [[],{},value({unknown:true}),value({format:'Unknown'}),value({year:1999}),value({year:2100}),value({year:2026.5}),value({sourceSha256:'invalid'}),value({cutoverAt:'2026-02-30T00:00:00.000Z'}),value({cutoverAt:'2026-11-23T00:00:00Z'}),value({cutoverAt:'2026-11-23T00:00:00.000+00:00'}),value({purchases:{}}),value({purchases:[{}]}),value({purchases:[{...value().purchases[0],unknown:1}]}),value({purchases:[{requestId:'short',fingerprint:'b'.repeat(64)}]}),value({purchases:[{requestId:'x'.repeat(101),fingerprint:'b'.repeat(64)}]}),value({purchases:[{requestId:'fictional-control\nreceipt',fingerprint:'b'.repeat(64)}]}),value({purchases:[{requestId:'fictional-original',fingerprint:'B'.repeat(64)}]}),value({purchases:[value().purchases[0],value().purchases[0]]}),value({purchases:Array(Baseline.MAX_PURCHASES+1).fill(value().purchases[0])})])assert.throws(()=>Baseline.validateBaseline(invalid),/baseline/i);
});

test('baseline reader accepts only bounded absolute regular nonlink files and never treats malformed JSON as a missing baseline',t=>{
 const parent=directory(t),file=path.join(parent,Baseline.FILE);assert.equal(Baseline.readBaseline(file),null);assert.throws(()=>Baseline.readBaseline('relative-baseline.json'),/absolute/);
 fs.writeFileSync(file,JSON.stringify(value()),{mode:0o600});assert.deepEqual(Baseline.readBaseline(file),value());
 for(const text of ['null','[]','{}','{invalid']){fs.writeFileSync(file,text);assert.throws(()=>Baseline.readBaseline(file),/invalid/i);}
 fs.writeFileSync(file,Buffer.alloc(Baseline.MAX_BYTES+1,32));assert.throws(()=>Baseline.readBaseline(file),/bounded/);assert.throws(()=>Baseline.readBaseline(parent),/regular file/);
 fs.writeFileSync(file,JSON.stringify(value()));const alias=path.join(parent,'linked-baseline.json');fs.linkSync(file,alias);assert.throws(()=>Baseline.readBaseline(alias),/without links/);
});

test('genuine encrypted all-business backup and verified extraction preserve the private future baseline byte for byte',async t=>{
 const parent=directory(t),data=path.join(parent,'data');fs.mkdirSync(data,{mode:0o700});const baseline=value({purchases:[]}),bytes=Buffer.from(JSON.stringify(baseline,null,2)+'\n');fs.writeFileSync(path.join(data,Baseline.FILE),bytes,{mode:0o600});
 assert(Backup.OPTIONAL.includes(Baseline.FILE),'The actual encrypted-backup configuration allowlist includes the baseline.');
 const secrets=createSecretStorage(crypto.randomBytes(32)),password='Fictional-baseline-owner-123',passphrase='Fictional-baseline-backup-only-123';let backend;
 t.after(async()=>{await backend?.close();secrets.destroy();});
 backend=await createBackend({dataDirectory:data,initialize:true,providersEnabled:false,automaticMonthClose:false,secrets,accountingWorkbookSnapshot:workbookSnapshot()});
 await backend.createOwner({username:'fictional.baseline.owner',fullName:'Fictional Baseline Owner',password});const login=await backend.request({workspaceId:'main',channel:'auth:login',args:[{username:'fictional.baseline.owner',password}]});assert.equal(login.status,200,login.error);const token=login.data.sessionToken;
 const good=async(channel,input)=>{const result=await backend.request({workspaceId:'main',token,channel,args:input===undefined?[]:[input]});assert.equal(result.status,200,result.error);return result.data;};
 await good('backups:save',{enabled:false,time:'23:00',passphrase,ftp:{enabled:false},email:{enabled:false}});const result=await good('backups:run'),job=result.history[0];assert.equal(job.local,'saved');
 const archive=path.join(data,'scheduled-backups',job.filename),opened=await Backup.openBackup(fs.readFileSync(archive),passphrase),saved=opened.entries.filter(entry=>entry.name===Baseline.FILE);assert.equal(saved.length,1);assert.deepEqual(saved[0].data,bytes);assert.equal(opened.entries.filter(entry=>Backup.DATABASES.includes(entry.name)).length,7);
 await backend.close();backend=null;const restored=path.join(parent,'restored');await extractVerifiedBackup({archive,destination:restored,passphrase});assert.deepEqual(fs.readFileSync(path.join(restored,Baseline.FILE)),bytes);assert.deepEqual(Baseline.readBaseline(path.join(restored,Baseline.FILE)),baseline);assert.deepEqual(fs.readFileSync(path.join(data,Baseline.FILE)),bytes);
});
