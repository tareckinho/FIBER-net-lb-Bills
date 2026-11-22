'use strict';
// Real Chromium, isolated fictional API: guarded read refresh must never repeat a cell mutation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const {connect,evaluate,waitFor,click}=require('../tools/accounting-register-browser-check.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(count){
 const style={font:{name:'Calibri',size:10,color:'#1F497D'},fill:{pattern:'none'},border:{},alignment:{vertical:'center'},numberFormat:'0.00'};
 const cells={B1:{value:'Date',styleId:0},C1:{value:'Name',styleId:0},D1:{value:'Quantity',styleId:0},E1:{value:'Description',styleId:0},F1:{value:'Unit Price',styleId:0},G1:{value:'Payments',styleId:0},B2:{value:12,styleId:0},C2:{value:'Fictional original entry',styleId:0}};
 const sheet={name:'Bandwidth',maxRow:4,maxCol:8,cells,merges:[],tables:[{name:'OriginalAmounts',ref:'B1:G4',headerRowCount:1,totalsRowCount:0,columns:['Date','Name','Quantity','Description','Unit Price','Payments'],styleInfo:{name:'TableStyleMedium23',showRowStripes:true}}],styleRuns:[],columnWidths:{1:25,2:120,3:170,4:100,5:220,6:110,7:110,8:64},rowHeights:{},defaultColumnWidth:64,defaultRowHeight:24,hiddenRows:[],hiddenColumns:[],filteredRows:[],zoomScale:100};
 const months=[];
 if(count){sheet.maxRow=58;for(let i=0;i<12;i++){const row=10+i*4,month='2026-'+String(i+1).padStart(2,'0');months.push({month,ref:'B'+row,count:i===0?count:0,totalCents:i===0?count*10000:0});sheet.merges.push('B'+row+':G'+row);sheet.tables.push({name:'Automatic'+i,ref:'B'+(row+1)+':G'+(row+3),headerRowCount:1,totalsRowCount:1,styleInfo:{name:'TableStyleMedium23',showRowStripes:true}});cells['B'+row]={value:'Fictional automatic month '+(i+1),styleId:0,editable:false};cells['B'+(row+1)]={value:'Date',styleId:0,editable:false};cells['B'+(row+2)]={value:i===0?'Fictional automatic receipt':'',styleId:0,editable:false};cells['G'+(row+2)]={value:i===0?count*100:0,styleId:0,editable:false};}}
 const values=Object.fromEntries(Object.entries(cells).map(([ref,cell])=>[ref,cell.value]));
 return {year:2026,available:true,snapshot:{name:'Fictional purchase workbook',activeSheet:'Bandwidth',styles:[style],sheetIndex:[{name:'Bandwidth',maxRow:sheet.maxRow,maxCol:sheet.maxCol}],sheets:[sheet]},values:{Bandwidth:values},edits:{Bandwidth:{}},errors:[],bandwidth:{sheet:'Bandwidth',basis:'purchase_cost',count,signature:'fictional-'+count,months,generatedStartRow:count?10:null}};
}
// Exercise the production projector/metadata contract, rather than fabricating its response.
const {project}=require('../app/accounting-bandwidth.cjs'),Model=require('../app/accounting-workbook.cjs');
const responseFixtures=Object.fromEntries([0,1,2].map(count=>{
 const original=fixture(0).snapshot;original.year=2026;original.sha256='a'.repeat(64);
 const source=original.sheets[0];source.maxRow=9;source.tables[0].ref='B2:G4';
 ['Date','Name','Quantity','Description','Unit Price','Payments'].forEach((value,i)=>{source.cells[String.fromCharCode(66+i)+'2']={value,styleId:0}});
 source.cells.B3={value:12,styleId:0};source.cells.C3={value:'Fictional original entry',styleId:0};
 const receipts=Array.from({length:count},(_,i)=>({id:i+1,requestId:'fictional-purchase-'+(i+1),receiptNo:'BWP-fictional-purchase-'+(i+1),supplierId:1,typeId:1,purchaseDate:'2026-01-12',supplierName:'Fictional saved supplier',typeName:'Fictional bandwidth',unit:'Mbps',quantityMicros:1000000,unitPriceCents:10000,totalCents:10000,note:'Fictional receipt description'}));
 const derived=project(original,receipts),calculated=Model.calculate(derived.snapshot);
 assert.equal(typeof derived.metadata.signature,'string');assert.equal(derived.metadata.signature,derived.signature,'The UI requires the actual projector signature on response metadata.');
 const snapshot={...derived.snapshot,sheetIndex:derived.snapshot.sheets.map(sheet=>({name:sheet.name,maxRow:sheet.maxRow,maxCol:sheet.maxCol}))};
 return [count,{year:2026,available:true,snapshot,values:calculated.values,edits:{Bandwidth:{}},errors:calculated.errors,bandwidth:derived.metadata}];
}));
function documentBody(){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/accounting-workbook.css"><style>*{box-sizing:border-box}body{margin:0;padding:12px}#root{width:100%}</style></head><body><div id="root"></div><script>
window.__reads=0;window.__saves=0;window.__sourceCount=0;window.__timers=new Map();window.__timerId=1000;
window.setInterval=(callback,delay)=>{const id=++window.__timerId;window.__timers.set(id,{callback,delay});return id};window.clearInterval=id=>window.__timers.delete(id);window.__tick=()=>{for(const timer of window.__timers.values())timer.callback()};
window.__user={accountKey:'fictional-owner',role:'admin',active:true,permissions:[]};window.__responses=${JSON.stringify(responseFixtures)};
window.__api={workbook:async()=>{window.__reads++;const value=structuredClone(window.__responses[window.__sourceCount]);window.__lastResponse=value;if(window.__delay)await new Promise(resolve=>{window.__release=()=>{window.__delay=false;resolve()}});return value},save:async payload=>{window.__saves++;window.__lastSave=payload;throw new TypeError('Fictional unconfirmed cell response')},remove:async()=>{throw Error('No removal in this UI fixture')}};
window.__config={container:'root',api:window.__api,user:window.__user,workspace:{id:'main'},getUser:()=>window.__user,getWorkspace:()=>({id:'main'})};
</script><script src="/accounting-workbook.js"></script><script>window.AccountingWorkbook.init(window.__config)</script></body></html>`;}

test('automatic bandwidth navigation and read refresh preserve editing, recovery, position and session boundaries',async t=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fibernet-bandwidth-ui-fictional-'));
 let server,child,browser,page;
 t.after(async()=>{
  page?.close();try{await browser?.send('Browser.close');}catch{}browser?.close();
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);}
  if(server?.listening)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve)});
  const resolved=path.resolve(temporary);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('fibernet-bandwidth-ui-fictional-'));
  for(let i=0;i<10;i++){try{fs.rmSync(resolved,{recursive:true,force:true});break}catch(error){if(i===9)throw error;await pause(200)}}
 });
 server=http.createServer((request,response)=>{
  if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});return response.end(documentBody())}
  const files={'/accounting-workbook.js':'accounting-workbook.js','/accounting-workbook.css':'accounting-workbook.css'};
  if(!files[request.url]){response.writeHead(404);return response.end()}
  response.writeHead(200,{'Content-Type':request.url.endsWith('.js')?'text/javascript':'text/css'});response.end(fs.readFileSync(path.join(__dirname,'../app/src',files[request.url])));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);assert(chrome,'Set CHROME_BIN for the fictional Chromium refresh regression.');
 const debug=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Fictional browser startup timeout')),25000);child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-component-update',...(process.env.CHROME_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),'--remote-debugging-port=0','--user-data-dir='+path.join(temporary,'chrome'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});child.once('error',reject);child.stderr.on('data',chunk=>{log+=String(chunk);const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}})});
 browser=await connect(debug);
 const target=await(await fetch('http://127.0.0.1:'+new URL(debug).port+'/json/new?'+encodeURIComponent('http://127.0.0.1:'+server.address().port),{method:'PUT'})).json();
 page=await connect(target.webSocketDebuggerUrl);await page.send('Runtime.enable');await page.send('Page.enable');await page.send('Page.bringToFront');
 await waitFor(page,"document.querySelector('#aw-year')",'Workbook initialized');
 assert.equal(await evaluate(page,'window.__reads'),0,'Init performs no network read.');
 assert.deepEqual(await evaluate(page,'Array.from(window.__timers.values(),v=>v.delay)'),[10000]);
 await evaluate(page,'window.__tick()');assert.equal(await evaluate(page,'window.__reads'),0,'Idle refresh waits for explicit first load.');
 await evaluate(page,"document.querySelector('#aw-year').value='2026';document.querySelector('#aw-year').dispatchEvent(new Event('change'))");
 await waitFor(page,"document.querySelector('#aw-bandwidth-auto')&&!document.querySelector('#aw-bandwidth-auto').hidden&&!document.querySelector('#aw-refresh').disabled",'Ready automatic receipts banner');
 assert.equal(await evaluate(page,"document.querySelector('#aw-bandwidth-month-tools').hidden"),true,'The empty year does not invent generated month rows.');
 await evaluate(page,'window.__sourceCount=1;window.__tick()');
 await waitFor(page,"document.querySelector('#aw-bandwidth-month').options.length===12&&!document.querySelector('#aw-refresh').disabled",'Receipt appears through periodic read');
 assert(await evaluate(page,"document.querySelector('#aw-bandwidth-auto').textContent.includes('Payments is the purchase total')"));
 for(const width of [320,390,768,1440]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
  await evaluate(page,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert(await evaluate(page,'document.documentElement.scrollWidth<=innerWidth+2'),'Automatic controls fit '+width+'px.');
 }
 await evaluate(page,"document.querySelector('#aw-bandwidth-month').value='2026-03'");await click(page,'#aw-bandwidth-go');
 await waitFor(page,"document.querySelector('#aw-address').value==='B58'",'Automatic month jump');
 const position=await evaluate(page,"(()=>{const s=document.querySelector('#aw-scroll');return {top:s.scrollTop,left:s.scrollLeft,cell:document.querySelector('#aw-address').value}})()");
 assert(position.top>0);
 await evaluate(page,'window.__sourceCount=2;window.dispatchEvent(new Event("focus"))');
 await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.signature===window.__responses[2].bandwidth.signature&&!document.querySelector('#aw-refresh').disabled",'Focus refresh');
 assert.deepEqual(await evaluate(page,"(()=>{const s=document.querySelector('#aw-scroll');return {top:s.scrollTop,left:s.scrollLeft,cell:document.querySelector('#aw-address').value}})()"),position,'Refresh preserves the selected cell and grid position.');
 const go=async ref=>{await evaluate(page,`document.querySelector('#aw-address').value=${JSON.stringify(ref)};document.querySelector('#aw-address').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await evaluate(page,'new Promise(resolve=>requestAnimationFrame(resolve))');};
 await go('B59');assert.equal(await evaluate(page,"document.querySelector('[data-aw-cell=B59]').querySelector('[data-aw-filter]')"),null,'Automatic table headers have no editable/filter affordance.');
 await go('A20');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),true,'Blank generated-area cells remain read-only.');
 assert.equal(await evaluate(page,"document.querySelector('[data-aw-cell=A20]').getAttribute('aria-readonly')"),'true');
 await go('B3');await click(page,'#aw-edit-cell');await waitFor(page,"document.querySelector('#aw-cell-dialog[open] #aw-cell-form')",'Original editable cell');
 await evaluate(page,"document.querySelector('#aw-cell-value').value='37'");
 let reads=await evaluate(page,'window.__reads');
 await evaluate(page,'window.__tick();window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("pos-web-bandwidth-purchase-saved"))');
 assert.equal(await evaluate(page,'window.__reads'),reads,'An unsaved editor blocks all automatic refresh signals.');assert.equal(await evaluate(page,"document.querySelector('#aw-cell-value').value"),'37');
 await click(page,'#aw-cell-close');await waitFor(page,"!document.querySelector('#aw-cell-dialog').innerHTML",'Editor fully closed');
 await go('B2');await click(page,'[data-aw-cell=B2] [data-aw-filter]');await waitFor(page,"document.querySelector('#aw-filter-form')",'Original table filter');
 await evaluate(page,'window.__tick()');assert.equal(await evaluate(page,'window.__reads'),reads,'An open filter also blocks refresh.');
 await click(page,'#aw-cell-close');await waitFor(page,"!document.querySelector('#aw-cell-dialog').innerHTML",'Filter fully closed');
 await evaluate(page,"document.querySelector('#root').style.display='none';window.__tick();window.dispatchEvent(new Event('focus'))");assert.equal(await evaluate(page,'window.__reads'),reads,'Hidden worksheet views never poll.');
 await evaluate(page,"document.querySelector('#root').style.display='block';window.__delay=true;window.__tick()");await waitFor(page,'Boolean(window.__release)','Refresh in flight');
 await evaluate(page,'window.__tick();window.dispatchEvent(new Event("focus"))');assert.equal(await evaluate(page,'window.__reads'),reads+1,'An in-flight refresh cannot overlap another read.');await evaluate(page,'window.__release()');await waitFor(page,"!document.querySelector('#aw-refresh').disabled",'Read completed');
 await go('B3');await click(page,'#aw-edit-cell');await waitFor(page,"document.querySelector('#aw-cell-form')",'Original cell for held request');await evaluate(page,"document.querySelector('#aw-cell-value').value='38';document.querySelector('#aw-cell-form').requestSubmit()");
 await waitFor(page,"!document.querySelector('#aw-recovery').hidden&&!document.querySelector('#aw-editor-recover').hidden",'Unconfirmed original request held');reads=await evaluate(page,'window.__reads');
 await click(page,'#aw-cell-close');await waitFor(page,"!document.querySelector('#aw-cell-dialog').innerHTML",'Held dialog closed');await evaluate(page,'window.__tick();window.dispatchEvent(new Event("focus"))');
 assert.equal(await evaluate(page,'window.__reads'),reads,'A closed uncertain request still blocks automatic reads.');assert.equal(await evaluate(page,'window.__saves'),1,'Read refresh never retries an original mutation.');
 assert.equal(await evaluate(page,'localStorage.length'),1);
 await evaluate(page,'window.AccountingWorkbook.reset()');assert.equal(await evaluate(page,'window.__timers.size'),0);assert.equal(await evaluate(page,'localStorage.length'),1,'Reset preserves the original recovery payload.');
 await evaluate(page,'localStorage.clear();window.AccountingWorkbook.init(window.__config)');await evaluate(page,"document.querySelector('#aw-year').value='2026';document.querySelector('#aw-year').dispatchEvent(new Event('change'))");await waitFor(page,"!document.querySelector('#aw-refresh').disabled",'Second fictional session');
 await evaluate(page,'window.__delay=true;window.__tick()');await waitFor(page,'Boolean(window.__delay&&window.__release)','Pending read before identity change');
 await evaluate(page,"window.__user.role='viewer';window.AccountingWorkbook.updateUser(window.__user);window.__release()");await pause(50);
 assert.equal(await evaluate(page,"document.querySelector('#root').innerHTML"),'','A late read cannot render private cells after rights change.');assert.equal(await evaluate(page,'window.__timers.size'),0);
});