'use strict';
// Real Chromium, isolated fictional API: guarded read refresh must never repeat a cell mutation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const {connect,evaluate,waitFor,click}=require('../tools/accounting-register-browser-check.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const {project,purchaseFingerprint}=require('../app/accounting-bandwidth.cjs'),Model=require('../app/accounting-workbook.cjs');
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
const importedReceipt={id:1,requestId:'fictional-imported-0001',receiptNo:'BWP-fictional-imported-0001',supplierId:1,typeId:1,purchaseDate:'2026-01-12',supplierName:'Imported supplier',typeName:'Fictional bandwidth',unit:'Mbps',quantityMicros:2000000,unitPriceCents:2500,totalCents:5000,note:'Already represented in the imported workbook'};
const baseline={format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-BASELINE-1',year:2026,sourceSha256:'a'.repeat(64),cutoverAt:'2026-01-13T00:00:00.000Z',purchases:[{requestId:importedReceipt.requestId,fingerprint:purchaseFingerprint(importedReceipt)}]};
const responseFixtures=Object.fromEntries([0,1,2,21].map(count=>{
 const original=originalWorkbook(),future=Array.from({length:count},(_,i)=>({id:i+2,requestId:'fictional-future-'+(i+1),receiptNo:'BWP-fictional-future-'+(i+1),supplierId:2,typeId:i+1,purchaseDate:'2026-01-14',supplierName:'Future supplier',typeName:'Fictional type '+(i+1),unit:'Mbps',quantityMicros:1000000,unitPriceCents:10000+i*100,totalCents:10000+i*100,note:i===0?'Literal <img src=x onerror="window.__receiptXss=true">\nSecond note line':'Fictional future note '+(i+1)}));
 const derived=project(original,[importedReceipt,...future],{baseline,overrides:{}}),calculated=Model.calculate(derived.snapshot);
 assert.equal(derived.metadata?.mode,'in_place');assert.equal(derived.metadata.count,count,'The cutover excludes already imported receipts.');assert.equal(derived.metadata.signature,derived.signature);
 assert.equal(derived.snapshot.sheets[0].maxRow,288);assert.equal(derived.snapshot.sheets[0].tables.length,12);assert.deepEqual(derived.snapshot.sheets[0].tables.map(t=>t.ref),original.sheets[0].tables.map(t=>t.ref));
 return [count,Object.fromEntries(derived.snapshot.sheets.map(selected=>[selected.name,{year:2026,available:true,snapshot:{...derived.snapshot,sheets:[selected],sheetIndex:derived.snapshot.sheets.map(value=>({name:value.name,maxRow:value.maxRow,maxCol:value.maxCol}))},values:{[selected.name]:calculated.values[selected.name]},edits:{[selected.name]:{}},errors:calculated.errors,managedCells:derived.managedCells[selected.name]||[],bandwidth:selected.name==='Bandwidth'?derived.metadata:null}]))];
}));
const programAuthority={format:'FIBERNETLB-ACCOUNTING-BANDWIDTH-AUTHORITY-1',year:2026,sourceSha256:'a'.repeat(64),mode:'program_months',activatedAt:'2026-06-15T08:00:00.000Z'};
const programResponses=(()=>{
 const original=originalWorkbook(),band=original.sheets[0];
 for(const [col,value]of Object.entries({B:46054,C:'Imported supplier',D:4,E:'Imported February stays',F:20,G:80}))band.cells[col+'27']={value,styleId:col==='F'||col==='G'?1:0};
 const records=[0,1].map(i=>({id:i+2,requestId:'fictional-program-'+(i+1),receiptNo:'BWP-fictional-program-'+(i+1),supplierId:2,typeId:i+1,purchaseDate:'2026-01-14',supplierName:'Future supplier',typeName:'Fictional program type '+(i+1),unit:'Mbps',quantityMicros:1000000,unitPriceCents:10000+i*100,totalCents:10000+i*100,note:'Fictional program receipt'}));
 const derived=project(original,records,{authority:programAuthority,overrides:{Bandwidth:{G3:999,H4:12}}}),calculated=Model.calculate(derived.snapshot,derived.calculationOverrides);
 assert.equal(derived.metadata.policy,'program_months');assert.equal(derived.metadata.count,2);assert.equal(calculated.values.Bandwidth.G23,201,'Program cost replaces the imported 50 rather than adding to it.');assert.equal(calculated.values.Bandwidth.G47,80,'A month without program purchases keeps imported amounts.');
 assert.equal(derived.snapshot.sheets[0].maxRow,288);assert.equal(derived.snapshot.sheets[0].tables.length,12);
 for(let row=3;row<=22;row++)for(let col=2;col<=7;col++)assert(derived.managedCells.Bandwidth.includes(Model.columnName(col)+row),'Every program-owned B:G entry cell, including blanks, is protected.');
 assert(derived.managedCells.Accounting.includes('B3'),'The program-owned annual formula is managed.');
 return Object.fromEntries(derived.snapshot.sheets.map(selected=>[selected.name,{year:2026,available:true,snapshot:{...derived.snapshot,sheets:[selected],sheetIndex:derived.snapshot.sheets.map(value=>({name:value.name,maxRow:value.maxRow,maxCol:value.maxCol}))},values:{[selected.name]:calculated.values[selected.name]},edits:{[selected.name]:{}},errors:calculated.errors,managedCells:derived.managedCells[selected.name]||[],bandwidth:selected.name==='Bandwidth'?derived.metadata:null}]));
})();
function documentBody(){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/accounting-workbook.css"><style>*{box-sizing:border-box}body{margin:0;padding:12px}#root{width:100%}</style></head><body><div id="root"></div><script>
window.__reads=0;window.__readSettled=0;window.__saves=0;window.__sourceCount=0;window.__timers=new Map();window.__timerId=1000;
window.setInterval=(callback,delay)=>{const id=++window.__timerId;window.__timers.set(id,{callback,delay});return id};window.clearInterval=id=>window.__timers.delete(id);window.__tick=()=>{for(const timer of window.__timers.values())timer.callback()};
window.__user={accountKey:'fictional-owner',role:'admin',active:true,permissions:[]};window.__responses=${JSON.stringify(responseFixtures)};window.__program=false;window.__programResponses=${JSON.stringify(programResponses)};
window.__api={workbook:async request=>{window.__reads++;window.__lastRequest=request;const value=structuredClone((window.__program?window.__programResponses:window.__responses[window.__sourceCount])[request.sheet||'Bandwidth']);window.__lastResponse=value;if(window.__delay)await new Promise(resolve=>{window.__release=()=>{window.__delay=false;resolve()}});window.__readSettled++;return value},save:async payload=>{window.__saves++;window.__lastSave=payload;throw new TypeError('Fictional unconfirmed cell response')},remove:async()=>{throw Error('No removal in this UI fixture')}};
window.__config={container:'root',api:window.__api,user:window.__user,workspace:{id:'main'},getUser:()=>window.__user,getWorkspace:()=>({id:'main'})};
</script><script src="/accounting-workbook.js"></script><script>window.AccountingWorkbook.init(window.__config)</script></body></html>`;}

test('program bandwidth months replace imported amounts while preserving future-only refresh and recovery guards',async t=>{
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
 assert.deepEqual(await evaluate(page,'Array.from(window.__timers.values(),v=>v.delay)'),[30000]);
 await evaluate(page,'window.__tick()');assert.equal(await evaluate(page,'window.__reads'),0,'Idle refresh waits for explicit first load.');
 await evaluate(page,"document.querySelector('#aw-year').value='2026';document.querySelector('#aw-year').dispatchEvent(new Event('change'))");
 await waitFor(page,"document.querySelector('#aw-bandwidth-auto')&&!document.querySelector('#aw-bandwidth-auto').hidden&&!document.querySelector('#aw-refresh').disabled",'Ready automatic receipts banner');
 assert.equal(await evaluate(page,"document.querySelector('#aw-bandwidth-details').hidden"),true,'Imported receipts are excluded from the new-purchase detail list.');
 await evaluate(page,'window.__sourceCount=1;window.__tick()');
 await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.signature===window.__responses[1].Bandwidth.bandwidth.signature&&window.__readSettled===window.__reads",'Receipt appears through periodic read');
 assert(await evaluate(page,"document.querySelector('#aw-bandwidth-auto').textContent.includes('Imported values are kept')"));
 for(const width of [320,390,768,1440]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
  await evaluate(page,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert(await evaluate(page,'document.documentElement.scrollWidth<=innerWidth+2'),'Automatic controls fit '+width+'px.');
 }
 await evaluate(page,"document.querySelector('#aw-bandwidth-month').value='2026-03'");await click(page,'#aw-bandwidth-go');
 await waitFor(page,"document.querySelector('#aw-address').value==='B49'",'Automatic month jump');
 const position=await evaluate(page,"(()=>{const s=document.querySelector('#aw-scroll');return {top:s.scrollTop,left:s.scrollLeft,cell:document.querySelector('#aw-address').value}})()");
 assert(position.top>0);
 await evaluate(page,'window.__sourceCount=2;window.dispatchEvent(new Event("focus"))');
 await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.signature===window.__responses[2].Bandwidth.bandwidth.signature&&!document.querySelector('#aw-refresh').disabled",'Focus refresh');
 assert.deepEqual(await evaluate(page,"(()=>{const s=document.querySelector('#aw-scroll');return {top:s.scrollTop,left:s.scrollLeft,cell:document.querySelector('#aw-address').value}})()"),position,'Refresh preserves the selected cell and grid position.');
 const go=async ref=>{await evaluate(page,`document.querySelector('#aw-address').value=${JSON.stringify(ref)};document.querySelector('#aw-address').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await evaluate(page,'new Promise(resolve=>requestAnimationFrame(resolve))');};
 assert.equal(await evaluate(page,"document.querySelector('#aw-scroll').getAttribute('aria-rowcount')"),'288','No appended monthly blocks are created.');
 await go('G4');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),true,'The linked original-table cost cell is read-only.');
 assert.equal(await evaluate(page,"document.querySelector('[data-aw-cell=G4]').getAttribute('aria-readonly')"),'true');
 await go('H4');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),false,'An unrelated cell in the same original row stays editable.');
 await evaluate(page,'window.__sourceCount=21;window.__tick()');await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.signature===window.__responses[21].Bandwidth.bandwidth.signature&&!document.querySelector('#aw-refresh').disabled",'Overflow receipts refresh in place');
 await click(page,'#aw-bandwidth-details');await waitFor(page,"document.querySelector('#aw-cell-dialog[open] .aw-purchase-table')",'Full future purchase detail list');
 assert.equal(await evaluate(page,"document.querySelectorAll('.aw-purchase-table tbody tr').length"),21,'All receipts remain individually visible after worksheet grouping.');
 const detailReads=await evaluate(page,'window.__reads');await evaluate(page,'window.__tick()');assert.equal(await evaluate(page,'window.__reads'),detailReads,'Receipt review blocks automatic refresh.');
 for(const width of [320,390,768,1440]){await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});await evaluate(page,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert(await evaluate(page,"(()=>{const r=document.querySelector('#aw-cell-dialog').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+2})()"),'Read-only receipt details fit '+width+'px.');}
 assert(await evaluate(page,"document.querySelector('.aw-purchase-table').textContent.includes('BWP-fictional-future-21')&&!document.querySelector('.aw-purchase-table img')&&!window.__receiptXss"),'Receipt source text is safely escaped.');
 await click(page,'#aw-cell-close');await waitFor(page,"!document.querySelector('#aw-cell-dialog').innerHTML",'Details fully closed');
 await click(page,'#aw-tabs [data-aw-sheet=Accounting]');await waitFor(page,"document.querySelector('#aw-scroll').dataset.awSheet==='Accounting'&&!document.querySelector('#aw-refresh').disabled",'Accounting summary');
 await evaluate(page,'window.__sourceCount=1;window.__tick()');await waitFor(page,"window.__lastResponse?.values?.Accounting?.B3===-100&&!document.querySelector('#aw-refresh').disabled",'Accounting recalculates while selected');
 await evaluate(page,'window.__sourceCount=2;window.__tick()');await waitFor(page,"document.querySelector('[data-aw-cell=B3]')?.textContent.includes('201.00')&&!document.querySelector('#aw-refresh').disabled",'Future costs update the visible Accounting formula');
 assert.equal(await evaluate(page,'window.__lastResponse.bandwidth'),null,'Summary refresh does not require Bandwidth-only metadata.');
 await click(page,'#aw-tabs [data-aw-sheet=Bandwidth]');await waitFor(page,"document.querySelector('#aw-scroll').dataset.awSheet==='Bandwidth'&&!document.querySelector('#aw-refresh').disabled",'Original bandwidth sheet returns');
 await evaluate(page,"window.__program=true;window.AccountingWorkbook.load('Bandwidth')");await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.policy==='program_months'&&!document.querySelector('#aw-refresh').disabled",'Program authority policy');
 assert(await evaluate(page,"(()=>{const b=document.querySelector('#aw-bandwidth-auto');return b.textContent.includes('replace imported bandwidth values')&&b.textContent.includes('2 program purchases')&&!b.textContent.includes(' since ')&&!b.textContent.includes(' added')&&document.querySelector('#aw-bandwidth-details').textContent==='View program purchases'})()"),'Program policy has no future-only or additive labels.');
 assert(await evaluate(page,"document.querySelector('#aw-bandwidth-month option[value=\"2026-02\"]').textContent.includes('Imported entries preserved')"));
 await evaluate(page,"document.querySelector('#aw-bandwidth-month').value='2026-01';document.querySelector('#aw-bandwidth-go').click()");await waitFor(page,"document.querySelector('#aw-address').value==='B1'",'Program January original coordinates');
 await go('G23');assert(await evaluate(page,"document.querySelector('[data-aw-cell=G23]').textContent.includes('201.00')"),'The original monthly total is the program cost, not imported plus program cost.');
 await go('G22');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),true,'Blank program-owned slots stay read-only.');await go('H22');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),false,'The same-row margin remains editable.');
 await click(page,'#aw-bandwidth-details');await waitFor(page,"document.querySelector('#aw-cell-dialog[open] .aw-purchase-table')",'Program purchase details');assert.equal(await evaluate(page,"document.querySelectorAll('.aw-purchase-table tbody tr').length"),2);assert.equal(await evaluate(page,"document.querySelector('#aw-editor-title').textContent"),'Program bandwidth purchases');await click(page,'#aw-cell-close');await waitFor(page,"!document.querySelector('#aw-cell-dialog').innerHTML",'Program details closed');
 await click(page,'#aw-tabs [data-aw-sheet=Accounting]');await waitFor(page,"document.querySelector('#aw-scroll').dataset.awSheet==='Accounting'&&!document.querySelector('#aw-refresh').disabled",'Program Accounting');await go('B3');assert.equal(await evaluate(page,"document.querySelector('#aw-edit-cell').disabled"),true,'Repaired annual cost formulas are read-only.');
 let programReads=await evaluate(page,'window.__reads');await evaluate(page,'window.__tick()');await waitFor(page,'window.__reads>'+programReads,'Program Accounting refreshes without banner metadata');await waitFor(page,'window.__readSettled===window.__reads','Program summary read settled');await evaluate(page,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await evaluate(page,'window.__lastResponse.bandwidth'),null);
 await evaluate(page,"window.__program=false;window.AccountingWorkbook.load('Bandwidth')");await waitFor(page,"document.querySelector('#aw-bandwidth-auto').dataset.policy==='future_only'&&!document.querySelector('#aw-refresh').disabled",'Legacy future-only behavior remains');
 await go('H4');await click(page,'#aw-edit-cell');await waitFor(page,"document.querySelector('#aw-cell-dialog[open] #aw-cell-form')",'Original editable cell');
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
 await evaluate(page,'window.__tick();window.dispatchEvent(new Event("focus"))');assert.equal(await evaluate(page,'window.__reads'),reads+1,'An in-flight refresh cannot overlap another read.');await evaluate(page,'window.__release()');await waitFor(page,'window.__readSettled===window.__reads','Read completed');await evaluate(page,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await go('H4');await click(page,'#aw-edit-cell');await waitFor(page,"document.querySelector('#aw-cell-form')",'Original cell for held request');await evaluate(page,"document.querySelector('#aw-cell-value').value='38';document.querySelector('#aw-cell-form').requestSubmit()");
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