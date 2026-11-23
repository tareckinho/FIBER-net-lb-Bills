'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createBackend}=require('../app/core.cjs'),{createSecretStorage}=require('../lib/secrets.cjs'),Source=require('../app/accounting-monthly-source.cjs'),Finance=require('../app/finance-ledger.cjs'),Bandwidth=require('../app/bandwidth-accounting.cjs'),Payments=require('../app/bandwidth-payments.cjs'),A=require('../app/reseller-accounting.cjs'),C=require('../app/reseller-collections.cjs'),Funding=require('../app/reseller-funding-service.cjs'),Portal=require('../app/portal-operations.cjs'),{WORKSPACES}=require('../app/workspaces.cjs');
const q=Finance.query,sql=require('sql.js')();
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-monthly-source-fictional-')),secrets=createSecretStorage(crypto.randomBytes(32));let backend;
 backend=await createBackend({dataDirectory:directory,initialize:true,automaticMonthClose:false,providersEnabled:false,secrets});await backend.createOwner({username:'fictional.monthly.owner',fullName:'Fictional Monthly Owner',password:'Fictional-Monthly-2026-only'});await backend.close();secrets.destroy();
 const SQL=await sql,entries=new Map(),clock={at:'2026-10-10T10:00:00'};
 for(const section of WORKSPACES){const file=section.id==='main'?path.join(directory,'isp-desk.sqlite'):path.join(directory,'sections',section.id+'.sqlite');entries.set(section.id,{id:section.id,path:file,db:new SQL.Database(fs.readFileSync(file))});}
 const main=entries.get('main').db,admin=q(main,"SELECT * FROM users WHERE role='admin'")[0];assert(admin);
 for(const entry of entries.values()){
  if(!q(entry.db,'SELECT id FROM users WHERE account_key=?',[admin.account_key]).length){const columns=q(entry.db,'PRAGMA table_info(users)').map(r=>r.name),row={...admin,id:1};entry.db.run('INSERT INTO users('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(c=>row[c]??null));}
  const original=q(entry.db,'SELECT * FROM users WHERE account_key=?',[admin.account_key])[0],columns=q(entry.db,'PRAGMA table_info(users)').map(r=>r.name),cashier={...original,id:2,username:'fictional.cashier',full_name:'Fictional Cashier',account_key:'main:2',role:'cashier',active:1};
  entry.db.run('INSERT INTO users('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(c=>cashier[c]??null));
  entry.db.run("INSERT OR REPLACE INTO whish_destinations VALUES('fictional-wallet','Fictional Wallet','03000000',1,?)",[clock.at]);
  for(const key of [admin.account_key,'main:2'])entry.db.run('INSERT INTO finance_wallet_entries VALUES(?,?,?,?,?,?)',['fictional-opening-'+key,'fictional-opening','fictional-wallet',key,100000,clock.at]);
  entry.db.run("INSERT INTO cash_drawer_transactions(amount,transaction_type,note,created_at,user_id,user_name) VALUES(1000,'fictional-opening','Fictional opening',?,1,?)",[clock.at,admin.full_name]);
 }
 const reseller=entries.get('fiber-resellers').db;reseller.run("INSERT INTO resellers(username,full_name,active) VALUES('fictional-reseller','Fictional Reseller',1)");const resellerId=q(reseller,"SELECT id FROM resellers WHERE username='fictional-reseller'")[0].id;
 let persist=true;const member=(key,section)=>q(entries.get(section).db,'SELECT * FROM users WHERE account_key=?',[key])[0],now=()=>clock.at,save=entry=>{if(persist)fs.writeFileSync(entry.path,Buffer.from(entry.db.export()));},flush=()=>{for(const e of entries.values())save(e);},destinations=()=>[{id:'fictional-wallet',label:'Fictional Wallet',number:'03000000',active:true}];
 const ledger=new Portal.PortalOperationLedger(reseller,()=>save(entries.get('fiber-resellers')),()=>{}, {scope:()=>null,key:()=> 'main:2'});
 const funding=new Funding.ResellerFundingService({entries,now,authorize:()=>member('main:2','fiber-resellers'),member,cashiers:section=>q(entries.get(section).db,"SELECT * FROM users WHERE role='cashier'"),destinations,receiverKey:()=>admin.account_key,ledger:()=>ledger,save,api:()=>({topUp:async(input,before)=>{before({fictional:true});return {success:true};},withdraw:async(input,before)=>{before({fictional:true});return {success:true};}})});
 const collections=new C.ResellerCollections({entries,now,destinations,member,authorizeAdmin:()=>member(admin.account_key,'fiber-resellers'),receiver:()=>member(admin.account_key,'fiber-resellers'),saveEntry:save});
 const bandwidth=new Bandwidth.BandwidthAccounting({db:main,workspaceId:'main',actor:admin,now}),payments=new Payments.BandwidthPayments({entries,now,authorize:()=>admin,saveEntry:save});
 const fund=async(id,amount=100,method='Whish Money',refundOfRequest='')=>funding.apply({requestId:id,resellerId,portalResellerId:101,amount,paymentMethod:method,custodianKey:'main:2',whishDestinationId:method==='Whish Money'?'fictional-wallet':'',reference:'Fictional verified funding',confirm:true,applyWhishFee:true,...refundOfRequest?{refundOfRequest}:{}},!!refundOfRequest);
 const collect=async(id,fundRequestId)=>{const input={requestId:id,resellerId,fundRequestId},preview=collections.prepare(input);return collections.apply({...input,token:preview.token,confirm:true,confirmation:'PAY BILL'});};
 const purchase=(id,date='2026-10-12')=>{const supplier=bandwidth.createSupplier({requestId:id+'-supplier',name:'Fictional Supplier'}),type=bandwidth.createType({requestId:id+'-type',name:'Fictional Transit',unit:'Mbps'}),p=bandwidth.createPurchase({requestId:id,supplierId:supplier.id,typeId:type.id,purchaseDate:date,quantity:1,unitPrice:50,note:'Fictional purchase'});main.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id) VALUES(?,'Bandwidth cost','Fictional purchase',50,?,'bandwidth_purchase',?)",[date,admin.id,String(p.id)]);const expenseId=q(main,'SELECT last_insert_rowid() AS id')[0].id;bandwidth.linkPurchaseExpense(p.id,{expenseId,sourceType:'bandwidth_purchase',sourceId:String(p.id)});return p;};
 flush();t.after(()=>{for(const e of entries.values())e.db.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^fibernet-monthly-source-fictional-/);fs.rmSync(directory,{recursive:true,force:true});});
 const read=year=>Source.read({year:year||2026,entries,actor:admin,now});return {directory,entries,main,reseller,admin,clock,save,flush,fund,collect,purchase,payments,read,persist:value=>persist=value};
}
test('monthly sources use real saved payment, funding, refund and Admin collection flows and keep all databases byte-identical',async t=>{
 const f=await fixture(t);await f.fund('fictional-fund-0001');await f.fund('fictional-refund-0001',9.9,'Whish Money','fictional-fund-0001');const p=f.purchase('fictional-bandwidth-0001');f.flush();
 f.clock.at='2026-11-02T10:00:00';await f.collect('fictional-collect-0001','fictional-fund-0001');await f.payments.pay({requestId:'fictional-supplier-pay-0001',supplierId:p.supplierId,paymentDate:'2026-11-02',amount:25,paymentMethod:'Cash',sourceWorkspaceId:'iptv'});f.flush();
 const before=[...f.entries.values()].map(e=>[e.path,fs.readFileSync(e.path),Buffer.from(e.db.export()),e.db.export.bind(e.db)]);for(const e of f.entries.values())e.db.export=()=>{throw Error('Adapter must never export a database');};
 const value=f.read();assert.equal(value.purchases.length,1);assert.equal(value.purchases[0].requestId,p.requestId);assert.equal(value.purchases[0].totalCents,5000);assert.equal(value.purchases[0].quantityMicros,1000000);assert.equal(value.purchases[0].purchaseDate,'2026-10-12');assert.equal(value.streams.supplierPayments.length,1);assert.equal(value.streams.supplierPayments[0].amountCents,-2500);assert.equal(value.streams.supplierPayments[0].date,'2026-11-02');assert.equal(value.streams.supplierPayments[0].sourceWorkspaceId,'iptv');
 assert.deepEqual(value.streams.resellerFunding.map(e=>e.amountCents),[9900,-990]);assert.equal(value.streams.resellerFunding[0].grossCents,10000);assert.equal(value.streams.resellerFunding[0].nativeDeductionCents,100);assert.equal(value.streams.resellerFunding[1].refundOfRequest,'fictional-fund-0001');
 assert.equal(value.streams.resellerCollections.length,1);assert.equal(value.streams.resellerCollections[0].amountCents,9000);assert.equal(value.streams.resellerCollections[0].date,'2026-11-02');assert.equal(value.streams.resellerCollections[0].allocations[0].fundRequestId,'fictional-fund-0001');assert.equal(value.signature,f.read().signature);
 for(const [file,bytes,memory,originalExport]of before){assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(Buffer.from(originalExport()),memory);}
});
test('unsaved live receipts, completed receipt tampering, pending operations and actor changes fail closed',async t=>{
 const f=await fixture(t);await f.fund('fictional-fund-tamper');f.flush();const before=f.read();
 f.reseller.run("UPDATE reseller_funds SET paid_at='2026-11-01T10:00:00' WHERE request_id='fictional-fund-tamper'");assert.throws(()=>f.read(),/verified|confirmed/);f.reseller.run("UPDATE reseller_funds SET paid_at='2026-10-10T10:00:00' WHERE request_id='fictional-fund-tamper'");
 f.reseller.run("UPDATE portal_operations SET state='unknown' WHERE request_id='fictional-fund-tamper'");assert.throws(()=>f.read(),/verified/);f.reseller.run("UPDATE portal_operations SET state='succeeded' WHERE request_id='fictional-fund-tamper'");
 f.entries.get('fiber-resellers').db.run("UPDATE finance_wallet_entries SET amount_cents=amount_cents+1 WHERE id='fictional-fund-tamper-credit'");f.flush();assert.throws(()=>f.read(),/verified|match/);
 assert.throws(()=>Source.read({year:2026,entries:f.entries,actor:{...f.admin,role:'cashier'},now:()=>f.clock.at}),/verified/);assert.match(before.signature,/^[a-f0-9]{64}$/);
});
test('unpaginated earlier-month source includes more than five hundred equal-valued receipts without value deduplication',async t=>{
 const f=await fixture(t);for(let i=0;i<505;i++)await f.fund('fictional-bulk-'+String(i).padStart(4,'0'),1,'Cash');f.flush();const value=f.read();assert.equal(value.streams.resellerFunding.length,505);assert.equal(new Set(value.streams.resellerFunding.map(e=>e.id)).size,505);assert.equal(value.streams.resellerFunding.reduce((n,e)=>n+e.amountCents,0),50500);assert.equal(f.read(2025).streams.resellerFunding.length,0);
});
test('fully verified but unsaved source and mid-read durable changes cannot pass the live versus disk gate',async t=>{
 const f=await fixture(t);await f.fund('fictional-saved-fund');f.flush();const prior=f.read();f.persist(false);await f.fund('fictional-unsaved-fund');assert.throws(()=>f.read(),/saves could not be confirmed/);f.persist(true);f.flush();assert.notEqual(f.read().signature,prior.signature);
 const original=fs.readFileSync;let injected=false;fs.readFileSync=function(file,...args){const bytes=original.call(this,file,...args);if(!injected&&file===f.entries.get('main').path){injected=true;const db=f.main;db.run("UPDATE whish_destinations SET label='Changed during read' WHERE id='fictional-wallet'");fs.writeFileSync(file,Buffer.from(db.export()));}return bytes;};
 try{assert.throws(()=>f.read(),/saves could not be confirmed/);assert.equal(injected,true);}finally{fs.readFileSync=original;}
});
test('verified identity rosters retain inactive and zero-activity accounts while a missing receipt identity fails closed',async t=>{
 const f=await fixture(t);await f.fund('fictional-identity-fund',1,'Cash');f.reseller.run("UPDATE resellers SET active=0 WHERE username='fictional-reseller'");f.reseller.run("INSERT INTO resellers(username,full_name,active) VALUES('fictional-zero','Fictional Zero Activity',0)");f.flush();
 const value=f.read();assert.equal(value.identities.resellers.find(r=>r.username==='fictional-reseller').active,false);assert.equal(value.identities.resellers.find(r=>r.username==='fictional-zero').active,false);assert.equal(value.streams.resellerFunding.length,1);
 f.reseller.run("DELETE FROM resellers WHERE username='fictional-reseller'");f.flush();assert.throws(()=>f.read(),/verified/);
});
test('orphan or pending custody corrections cannot manufacture a monthly collection or silently pass verification',async t=>{
 const f=await fixture(t);await f.fund('fictional-correction-fund',1,'Cash');f.flush();
 f.reseller.run("INSERT INTO reseller_admin_wallet_corrections VALUES('fictional-correction','completed',?,'2026-10-10T11:00:00',?,?,'fictional-token','{}')",[f.admin.account_key,JSON.stringify({collectionRequestIds:['missing-collection']}),'{}']);f.flush();assert.throws(()=>f.read(),/verified/);
 f.reseller.run("DELETE FROM reseller_admin_wallet_corrections WHERE request_id='fictional-correction'");f.reseller.run("INSERT INTO reseller_wallet_reconciliations VALUES('fictional-reconciliation','prepared',?,'2026-10-10T11:00:00','{}','{}','fictional-token','{}')",[f.admin.account_key]);f.flush();assert.throws(()=>f.read(),/verified|pending|Finish/);
});
test('missing funding receipts and orphan completed funding journals never become a verified zero',async t=>{
 const f=await fixture(t);await f.fund('fictional-orphan-fund',1,'Cash');f.flush();assert.equal(f.read().streams.resellerFunding.length,1);
 f.reseller.run("DELETE FROM reseller_funds WHERE request_id='fictional-orphan-fund'");f.flush();assert.throws(()=>f.read(),/verified/,'Succeeded financial operation requires its saved funding receipt.');
 f.reseller.run("DELETE FROM portal_operations WHERE request_id='fictional-orphan-fund'");f.flush();assert.throws(()=>f.read(),/verified/,'An orphan complete credit journal cannot be hidden by deleting both parent records.');
});
test('legacy default funding snapshots require receipts while unrelated portal actions do not become guessed funding',async t=>{
 const f=await fixture(t),put=(id,input)=>{f.reseller.run("INSERT INTO portal_operations(request_id,kind,entity,fingerprint,input_json,quote_json,state,actor,recorded_at,message,result_json,actor_key) VALUES(?,'topup','reseller:101',?,?,'{}','succeeded','Fictional Cashier','2026-10-10T10:00:00','Fictional legacy operation','{}','main:2')",[id,crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),JSON.stringify(input)]);};
 put('fictional-unrelated-topup',{username:'fictional-reseller',amount:1,paymentMethod:'Cash',billingPeriod:'2026-10'});f.flush();assert.equal(f.read().streams.resellerFunding.length,0);
 put('fictional-default-ledger',{username:'fictional-reseller',amount:1,paymentMethod:'Cash',receiverKey:f.admin.account_key});f.flush();assert.throws(()=>f.read(),/verified/);
});
test('orphan funding fees and Admin collection credits remain unverified even after their other parent legs disappear',async t=>{
 const f=await fixture(t);await f.fund('fictional-orphan-collection',100);await f.collect('fictional-orphan-collection-pay','fictional-orphan-collection');f.flush();assert.equal(f.read().streams.resellerCollections.length,1);
 f.reseller.run("INSERT INTO expenses(expense_date,category,description,amount,user_id,source_type,source_id) VALUES('2026-10-10','Whish Money fees','Fictional orphan fee',1,2,'reseller_whish_fee','fictional-missing-fee-parent')");f.flush();assert.throws(()=>f.read(),/verified/);f.reseller.run("DELETE FROM expenses WHERE source_id='fictional-missing-fee-parent'");
 f.reseller.run("DELETE FROM reseller_collections WHERE request_id='fictional-orphan-collection-pay'");f.reseller.run("DELETE FROM reseller_money_journal WHERE request_id='collection-fictional-orphan-collection-pay' AND phase<>'collection-credit'");f.flush();assert.throws(()=>f.read(),/verified/,'An orphan complete Admin credit cannot be presented as zero collections.');
});
