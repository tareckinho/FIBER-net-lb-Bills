'use strict';
// Private loopback review of imported workbook records. Never opens production data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs');
const {createServer}=require('../server.cjs');
const {createSecretStorage}=require('../lib/secrets.cjs');
const version=require('../package.json').version;
function argumentsFor(args){
 const result={port:3811};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!value||!['--data-directory','--import','--workbook','--port'].includes(key)||Object.hasOwn(result,key))throw Error('Use --data-directory ABSOLUTE_PRIVATE_DIRECTORY [--import ABSOLUTE_IMPORT_JSON] [--workbook ABSOLUTE_WORKBOOK_JSON] [--port 3811].');result[key]=value;}
 if(!result['--data-directory']||!path.isAbsolute(result['--data-directory'])||result['--import']&&!path.isAbsolute(result['--import'])||result['--workbook']&&!path.isAbsolute(result['--workbook']))throw Error('Choose explicit absolute private paths.');
 result.port=Number(result['--port']??3811);if(!Number.isInteger(result.port)||result.port<1024||result.port>65535)throw Error('Choose a loopback port from 1024 through 65535.');return result;
}
async function main(args=process.argv.slice(2)){
 const options=argumentsFor(args),directory=path.resolve(options['--data-directory']),markerFile=path.join(directory,'.accounting-local-preview.json');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('Choose a private directory without symbolic links.');
 let marker;
 if(fs.existsSync(markerFile)){marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));if(marker.format!=='FIBERNETLB-PRIVATE-ACCOUNTING-LOCAL-1'||marker.directory!==directory)throw Error('The private preview ownership marker does not match.');}
 else{if(fs.readdirSync(directory).some(name=>name!=='import'))throw Error('A new Accounting preview requires an empty directory or its own import subdirectory. Existing installations are never opened.');marker={format:'FIBERNETLB-PRIVATE-ACCOUNTING-LOCAL-1',directory,instance:crypto.randomUUID(),createdAt:new Date().toISOString()};fs.writeFileSync(markerFile,JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600});}
 const keyFile=path.join(directory,'server.key'),credentialsFile=path.join(directory,'local-login.json');
 if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});
 let credentials;if(fs.existsSync(credentialsFile))credentials=JSON.parse(fs.readFileSync(credentialsFile,'utf8'));else{credentials={username:'accounting.admin',password:crypto.randomBytes(21).toString('base64url')+'!9',fullName:'Accounting Administrator'};fs.writeFileSync(credentialsFile,JSON.stringify(credentials,null,2)+'\n',{flag:'wx',mode:0o600});}
 const key=fs.readFileSync(keyFile);if(key.length!==32)throw Error('The local preview key must contain exactly 32 bytes.');const secrets=createSecretStorage(key);key.fill(0);
 const initialized=fs.existsSync(path.join(directory,'isp-desk.sqlite'));
 let snapshot;if(options['--workbook']){if(!path.isAbsolute(options['--workbook'])||fs.statSync(options['--workbook']).size>64*1024*1024)throw Error('Choose a bounded absolute private workbook snapshot.');snapshot=JSON.parse(fs.readFileSync(options['--workbook'],'utf8'));}
 const backend=await createBackend({dataDirectory:directory,initialize:!initialized,providersEnabled:false,automaticMonthClose:false,secrets,version,accountingWorkbookSnapshot:snapshot});let server;
 try{
  if(backend.metadata().needsSetup)await backend.createOwner(credentials);
  if(options['--import']){
   const file=options['--import'],stat=fs.statSync(file);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('Choose a bounded prepared private import.');
   const batch=JSON.parse(fs.readFileSync(file,'utf8'));if(batch.format!=='FIBERNETLB-ACCOUNTING-IMPORT-1'||!Array.isArray(batch.records)||batch.records.length>10000||!Number.isInteger(batch.year)||!/^[a-f0-9]{64}$/.test(batch.sha256||''))throw Error('Invalid prepared Accounting import.');
   const login=await backend.request({workspaceId:'main',channel:'auth:login',args:[credentials]});if(login.status!==200)throw Error('The private Accounting owner could not sign in.');const token=login.data.sessionToken;
   let imported=0;
   for(const row of batch.records){if(row.year!==batch.year||row.source?.sha256!==batch.sha256)throw Error('An import row does not match the source identity.');const result=await backend.request({workspaceId:'main',token,channel:'accounting:save',args:[row]});if(result.status!==200)throw Error('Import stopped at '+row.source?.sheet+' row '+row.source?.row+': '+result.error);imported++;}
   const overview=await backend.request({workspaceId:'main',token,channel:'accounting:overview',args:[{year:batch.year}]});if(overview.status!==200)throw Error('The saved import could not be read back.');
   const records=overview.data.records,actual=records.filter(row=>row.source?.sha256===batch.sha256);if(actual.length!==batch.records.length)throw Error('Saved import record count did not reconcile.');
   const ledger=actual.filter(row=>row.kind==='ledger'),sum=field=>ledger.reduce((total,row)=>total+row.data[field],0),report={source:batch.source,sha256:batch.sha256,year:batch.year,imported,stored:actual.length,counts:Object.fromEntries([...new Set(actual.map(row=>row.kind))].map(kind=>[kind,actual.filter(row=>row.kind===kind).length])),chargeCents:sum('amountCents'),paymentCents:sum('paymentCents'),balanceCents:sum('amountCents')-sum('paymentCents'),verifiedAt:new Date().toISOString()};
   const expectedFile=path.join(path.dirname(file),'accounting-import-report.json');if(fs.existsSync(expectedFile)){const expected=JSON.parse(fs.readFileSync(expectedFile,'utf8'));for(const field of ['chargeCents','paymentCents','balanceCents'])if(report[field]!==expected.annualLedger?.[field])throw Error('Saved import '+field+' differs from Excel.');}
   fs.writeFileSync(path.join(directory,'import-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});await backend.request({workspaceId:'main',token,channel:'auth:logout',args:[]});console.log(JSON.stringify({imported:report.imported,stored:report.stored,counts:report.counts,totalsReconciled:true}));
  }
  const url='http://127.0.0.1:'+options.port;server=createServer({backend,origin:url,demo:true,demoLabel:'Local Accounting preview — imported Excel records; external providers disabled'});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',resolve);});
  console.log('PRIVATE ACCOUNTING LOCAL PREVIEW\n'+url+'\nUsername: '+credentials.username+'\nPassword: '+credentials.password+'\nPrivate records persist in the explicitly selected directory.');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});await backend.close();secrets.destroy();};process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{if(chunk.trim()==='STOP '+marker.instance){process.stdin.pause();void stop();}});
 }catch(error){if(server?.listening)await new Promise(resolve=>server.close(resolve));await backend.close();secrets.destroy();throw error;}
}
if(require.main===module)main().catch(error=>{console.error('The private Accounting preview could not start: '+error.message);process.exitCode=1;});
module.exports={argumentsFor};

