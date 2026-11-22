'use strict';
// Legacy register-layout check and shared CDP helpers. Current UI verification uses accounting-workbook-browser-check.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {createDemo} = require('./demo.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let next = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); if (!value.id) return; const request = pending.get(value.id); if (!request) return; pending.delete(value.id); clearTimeout(request.timer); value.error ? request.reject(Error(value.error.message)) : request.resolve(value.result); });
  return {close: () => socket.close(), send(method, params = {}) { const id = ++next; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('Browser command timed out: ' + method)); }, 20000); pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params})); }); }};
}
async function evaluate(page, expression) {
  const value = await page.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true});
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result.value;
}
async function waitFor(page, expression, label) {
  const start = Date.now();
  while (Date.now() - start < 20000) { if (await evaluate(page, expression)) return; await pause(100); }
  const detail = await evaluate(page, "({url:location.href,body:document.body.innerText.slice(-2500)})");
  throw Error(label + ' timed out: ' + JSON.stringify(detail));
}
async function click(page, selector) {
  await waitFor(page, `(()=>{const element=document.querySelector(${JSON.stringify(selector)});return element&&!element.disabled;})()`, 'Enabled control ' + selector);
  await evaluate(page, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
  await evaluate(page, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const target = await evaluate(page, `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};})()`);
  assert(target.width > 0 && target.height > 0, 'Visible control ' + selector);
  await page.send('Input.dispatchMouseEvent', {type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
}
async function accountingIdsUnique(page) {
  const duplicates = await evaluate(page, "(()=>{const root=document.querySelector('#accounting-register-root'),dialog=document.querySelector('#ar-dialog'),all=[...document.querySelectorAll('[id]')].map(el=>el.id);const own=[root,dialog,...(root?[...root.querySelectorAll('[id]')]:[]),...(dialog?[...dialog.querySelectorAll('[id]')]:[])].filter(Boolean).map(el=>el.id);return [...new Set(own.filter(id=>all.filter(value=>value===id).length!==1))];})()");
  assert.deepEqual(duplicates, [], 'Every mounted Accounting root/dialog ID is unique across the existing app.');
}
async function responsive(page, label, outputDirectory) {
  for (const [width, height] of [[320, 700], [390, 844], [768, 1024], [1440, 1000]]) {
    await page.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: width < 900});
    await evaluate(page, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const size = await evaluate(page, "(()=>{const dialog=document.querySelector('#ar-dialog[open]'),r=dialog?.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,dialog:r?{left:r.left,right:r.right,overflow:dialog.scrollWidth-dialog.clientWidth}:null};})()");
    assert(size.overflow <= 2, label + ' overflow at ' + width + ': ' + JSON.stringify(size));
    if (size.dialog) assert(size.dialog.left >= -1 && size.dialog.right <= width + 1 && size.dialog.overflow <= 2, label + ' dialog does not fit at ' + width + ': ' + JSON.stringify(size));
    if (outputDirectory && (width === 390 || width === 1440)) {
      const screenshot = await page.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false, fromSurface: true});
      fs.writeFileSync(path.join(outputDirectory, label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + width + '.png'), Buffer.from(screenshot.data, 'base64'));
    }
  }
}
async function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 2 || args[0] !== '--output-directory')) throw Error('Use node tools/accounting-register-browser-check.cjs [--output-directory DIRECTORY].');
  const outputDirectory = args.length ? path.resolve(args[1]) : null;
  if (outputDirectory) fs.mkdirSync(outputDirectory, {recursive: true});
  const chrome = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file));
  assert(chrome, 'Set CHROME_BIN to a Chromium browser for Accounting validation.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernet-accounting-browser-fictional-'));
  let demo, child, browser, page;
  try {
    demo = await createDemo({port: 0});
    const debugUrl = await new Promise((resolve, reject) => {
      let log = ''; const timer = setTimeout(() => reject(Error('Chrome did not expose its debugging socket.')), 20000);
      child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-component-update', ...(process.env.CHROME_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'chrome'), 'about:blank'], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.on('data', chunk => { log += String(chunk); const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited before startup: ' + code)); });
    });
    browser = await connect(debugUrl);
    const target = await (await fetch('http://127.0.0.1:' + new URL(debugUrl).port + '/json/new?' + encodeURIComponent(demo.url), {method: 'PUT'})).json();
    page = await connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable'); await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    async function login(username) {
      await waitFor(page, "document.querySelector('#login-form')&&!document.querySelector('#auth-screen').classList.contains('hidden')", 'Login screen');
      await evaluate(page, `document.querySelector('#login-username').value=${JSON.stringify(username)};document.querySelector('#login-password').value=${JSON.stringify(demo.credentials.password)};document.querySelector('#login-form').requestSubmit();`);
      await waitFor(page, "!document.querySelector('#app-shell').classList.contains('hidden')", 'Signed-in dashboard');
    }
    const accountingVisible = "(()=>{const el=document.querySelector('[data-view=accounting]');return Boolean(el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none');})()";
    async function openAccounting() {
      await waitFor(page, accountingVisible, 'Accounting navigation for Main Admin');
      await click(page, '[data-view=accounting]');
      await waitFor(page, "document.querySelector('#accounting-register-root #ar-year')", 'Accounting register');
      await evaluate(page, "document.querySelector('#ar-year').value='2026';document.querySelector('#ar-year').dispatchEvent(new Event('change',{bubbles:true}));");
      await waitFor(page, "document.querySelector('#ar-year').value==='2026'&&!document.querySelector('#ar-add').disabled", 'Accounting year loaded');
    }
    await login(demo.credentials.username);
    await openAccounting();
    await accountingIdsUnique(page);

    await responsive(page, 'Accounting empty register', outputDirectory);
    async function add(account, amount, payment) {
      await waitFor(page, "document.querySelector('#ar-add')?.disabled===false", 'Accounting ready for another entry');
      await click(page, '#ar-add');
      await waitFor(page, "document.querySelector('#ar-dialog[open] #ar-form')", 'Accounting entry form');
      await accountingIdsUnique(page);
      await evaluate(page, `(()=>{const values=${JSON.stringify({'#ar-period':'2026-03','#ar-date':'2026-03-11','#ar-category':'Radius','#ar-account':account,'#ar-amount':amount,'#ar-payment':payment,'#ar-payment-method':'Cash','#ar-payment-date':'2026-03-12','#ar-note':'Fictional browser check only'})};for(const [selector,value]of Object.entries(values)){const input=document.querySelector(selector);if(!input)throw Error('Missing field '+selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      if (account === 'Fictional Chrome income') await responsive(page, 'Accounting entry form', outputDirectory);
      await evaluate(page, "document.querySelector('#ar-form').requestSubmit()");
      await waitFor(page, "!document.querySelector('#ar-dialog[open]')&&document.querySelector('#ar-add')?.disabled===false", 'Accounting entry saved and refreshed');
    }
    await add('Fictional Chrome income', '100.00', '60.00');
    await add('Fictional Chrome cost', '-25.00', '-10.00');
    await add('Fictional Chrome settlement', '0.00', '15.00');
    const metrics = "['charges','payments','balance'].map(key=>document.querySelector('[data-ar-metric='+key+']')?.textContent.trim())";
    await waitFor(page, `${metrics}.every(Boolean)`, 'Accounting signed totals');
    const readMetrics = await evaluate(page, metrics);
    const numbers = readMetrics.map(text => Number(text.replace(/[^0-9.-]/g, '')));
    assert.deepEqual(numbers, [75, 65, 10], 'Income, cost and settlement summaries retain signed charges/payments.');
    const persisted = await evaluate(page, "posApi.accounting.overview({year:2026})");
    assert.equal(persisted.records.filter(row => row.kind === 'ledger').length, 3);
    assert(persisted.records.some(row => row.data.amountCents === -2500 && row.data.paymentCents === -1000));
    await responsive(page, 'Accounting saved register', outputDirectory);
    await evaluate(page, `(async()=>{for(const [year,month,account]of [[2026,'04','Fictional April filtered'],[2027,'03','Fictional next-year filtered']])await posApi.accounting.save({requestId:crypto.randomUUID(),id:null,version:0,kind:'ledger',year,data:{period:year+'-'+month,date:year+'-'+month+'-11',category:'Radius',account,amountCents:2000,paymentCents:0,paymentMethod:'Cash',paymentDate:'',note:'Fictional filter fixture'}});})()`);
    await click(page, '#ar-register-refresh');
    await waitFor(page, "document.querySelector('#accounting-register-root').innerText.includes('Fictional April filtered')&&!document.querySelector('#accounting-register-root').innerText.includes('Fictional next-year filtered')", 'Year selection excludes another year');
    await evaluate(page, "document.querySelector('#ar-month').value='03';document.querySelector('#ar-month').dispatchEvent(new Event('change',{bubbles:true}));");
    await waitFor(page, "document.querySelector('#accounting-register-root').innerText.includes('Fictional Chrome income')&&!document.querySelector('#accounting-register-root').innerText.includes('Fictional April filtered')", 'March records exclude April');
    await evaluate(page, "document.querySelector('#ar-search').value='Fictional Chrome cost';document.querySelector('#ar-search').dispatchEvent(new Event('input',{bubbles:true}));");
    await waitFor(page, "!document.querySelector('#accounting-register-root').innerText.includes('Fictional Chrome income')&&document.querySelector('#accounting-register-root').innerText.includes('Fictional Chrome cost')", 'Search isolates matching records');
    await evaluate(page, "document.querySelector('#ar-search').value='';document.querySelector('#ar-search').dispatchEvent(new Event('input',{bubbles:true}));");

    await evaluate(page, `(()=>{const original=window.fetch;window.__arCalls=[];window.__arRestoreFetch=()=>{window.fetch=original};window.fetch=async(...args)=>{const payload=typeof args[1]?.body==='string'?JSON.parse(args[1].body):null;if(payload?.channel?.startsWith('accounting:'))window.__arCalls.push(payload);const response=await original(...args);if(payload?.channel==='accounting:save'&&!window.__arLostPayload){window.__arLostPayload=payload;await response.clone().json();throw new TypeError('Fictional connection lost after server commit');}return response;};})()`);
    await click(page, '#ar-add');
    await waitFor(page, "document.querySelector('#ar-dialog[open] #ar-form')", 'Recovery fixture form');
    await evaluate(page, `(()=>{const values=${JSON.stringify({'#ar-period':'2026-03','#ar-date':'2026-03-13','#ar-category':'Radius','#ar-account':'Fictional Chrome lost reply','#ar-amount':'12.00','#ar-payment':'12.00','#ar-payment-method':'Cash','#ar-payment-date':'2026-03-13','#ar-note':'Synthetic response loss'})};for(const [selector,value]of Object.entries(values))document.querySelector(selector).value=value;document.querySelector('#ar-form').requestSubmit();})()`);
    await waitFor(page, "document.querySelector('#ar-dialog[open] #ar-dialog-recover')&&!document.querySelector('#ar-recovery').hidden", 'Uncertain save holds original request');
    await click(page, '#ar-dialog-recover');
    await waitFor(page, "window.__arCalls.some(row=>row.channel==='accounting:status')", 'Exact request status checked');
    await waitFor(page, "!document.querySelector('#ar-dialog[open]')", 'Saved result recovered without a second save');
    const calls = await evaluate(page, "(()=>{window.__arRestoreFetch();return {calls:window.__arCalls,lost:window.__arLostPayload};})()");
    assert.equal(calls.calls.filter(row => row.channel === 'accounting:save').length, 1, 'Lost responses never automatically retry a write.');
    assert(calls.calls.some(row => row.channel === 'accounting:status' && row.args[0].requestId === calls.lost.args[0].requestId));
    assert.equal((await evaluate(page, 'posApi.accounting.overview({year:2026})')).records.length, 5, 'Recovery finds exactly one committed entry.');

    await page.send('Page.reload');
    await waitFor(page, "document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')", 'Reloaded authenticated website');
    await openAccounting();
    assert.equal((await evaluate(page, 'posApi.accounting.overview({year:2026})')).records.length, 5, 'Browser reload retains actual database entries.');
    async function createOther(kind, values) {
      await click(page, '[data-ar-section=' + kind + ']');
      await waitFor(page, "document.querySelector('#ar-add')?.disabled===false", 'Ready to create ' + kind);
      await click(page, '#ar-add');
      await waitFor(page, "document.querySelector('#ar-dialog[open] #ar-form')", kind + ' editor');
      await evaluate(page, `(()=>{const values=${JSON.stringify(values)};for(const [selector,value]of Object.entries(values)){const input=document.querySelector(selector);if(!input)throw Error('Missing field '+selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('#ar-form').requestSubmit();})()`);
      await waitFor(page, "!document.querySelector('#ar-dialog[open]')&&document.querySelector('#ar-add')?.disabled===false", kind + ' saved and refreshed');
    }
    await evaluate(page, "document.querySelector('#ar-month').value='03';document.querySelector('#ar-month').dispatchEvent(new Event('change',{bubbles:true}));");
    await createOther('purchase', {'#ar-period':'2026-03','#ar-date':'2026-03-11','#ar-supplier':'Fictional Transit','#ar-description':'Fictional fractional bandwidth purchase','#ar-quantity':'1000','#ar-unit-price':'0.168','#ar-note':'Synthetic arithmetic test'});
    assert.equal(await evaluate(page, "document.querySelector('[data-ar-metric=cost]').textContent"), '$168.00', 'Fractional unit price is multiplied before rounding total cents.');
    await createOther('resale', {'#ar-period':'2026-03','#ar-date':'2026-03-11','#ar-account':'Fictional resale account','#ar-supplier':'Fictional Transit','#ar-description':'Fictional resale bandwidth','#ar-quantity':'100','#ar-unit-cost':'1.60','#ar-unit-price':'1.90','#ar-note':'Synthetic arithmetic test'});
    assert.equal(await evaluate(page, "document.querySelector('[data-ar-metric=margin]').textContent"), '$30.00');
    await click(page, '[data-ar-section=purchase]');
    await click(page, '#ar-budget-add');
    await waitFor(page, "document.querySelector('#ar-dialog[open] #ar-percentage')", 'Budget allocation editor');
    await evaluate(page, "document.querySelector('#ar-period').value='2026-03';document.querySelector('#ar-percentage').value='15';document.querySelector('#ar-form').requestSubmit();");
    await waitFor(page, "!document.querySelector('#ar-dialog[open]')&&document.querySelector('#ar-add')?.disabled===false", 'Budget allocation saved');
    assert(await evaluate(page, "document.querySelector('.ar-budget').innerText.includes('$8.80')"), 'March budget is positive charges112×15% plus resale cost160 less purchase168 =8.80.');
    await responsive(page, 'Accounting purchase budget', outputDirectory);
    await evaluate(page, "document.querySelector('#ar-month').value='all';document.querySelector('#ar-month').dispatchEvent(new Event('change',{bubbles:true}));");
    await createOther('project', {'#ar-period':'','#ar-date':'','#ar-project':'Fictional unpriced project','#ar-supplier':'','#ar-description':'Fictional unspecified materials','#ar-quantity':'','#ar-unit-price':'','#ar-note':'Unknown values are not zero-price materials'});
    assert(await evaluate(page, "document.querySelector('#ar-results').innerText.includes('Not priced')"), 'Unpriced imported-style project items remain explicit.');
    assert.equal(await evaluate(page, "document.querySelector('[data-ar-metric=cost]').textContent"), '$0.00', 'Unknown project costs are excluded from known costs.');
    await click(page, '[data-ar-section=annual]');
    await responsive(page, 'Accounting annual matrix', outputDirectory);
    await evaluate(page, "posApi.workspace.open('fiber-users')");
    await waitFor(page, "location.search.includes('fiber-users')&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')", 'Business Admin tab');
    assert.equal(await evaluate(page, accountingVisible), false, 'Accounting is hidden for Admin in a business tab.');
    await evaluate(page, "posApi.workspace.login()");
    await waitFor(page, "location.search.includes('main')&&document.querySelector('#app-shell')&&!document.querySelector('#app-shell').classList.contains('hidden')", 'Return to Main');
    for (const role of ['cashier', 'support', 'viewer']) {
      await click(page, '#logout-button');
      await login(demo.credentials[role].username);
      assert.equal(await evaluate(page, accountingVisible), false, 'Accounting is hidden for ' + role + '.');
    }
    process.stdout.write(JSON.stringify({passed: true, viewports: [320, 390, 768, 1440], signedTotals: {charges: 75, payments: 65, balance: 10}, recordsAfterRecovery: 5, purchaseTotal: 168, resaleMargin: 30, budgetRemaining: 8.8, unpricedProject: true, writeRequestsForLostReply: 1, source: 'Disposable fictional SQLite database', screenshots: outputDirectory}) + '\n');
  } finally {
    page?.close();
    try { await browser?.send('Browser.close'); } catch {} browser?.close();
    if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(2000)]); }
    await demo?.stop();
    const resolved = path.resolve(directory), temporary = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), temporary); assert(path.basename(resolved).startsWith('fibernet-accounting-browser-fictional-'));
    for (let attempt = 0; attempt < 10; attempt++) { try { fs.rmSync(resolved, {recursive: true, force: true}); break; } catch (error) { if (attempt === 9) throw error; await pause(250); } }
  }
}
if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
module.exports = {main, connect, evaluate, waitFor, click, responsive};









