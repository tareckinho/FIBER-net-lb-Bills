'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {createBackend} = require('../app/core.cjs');
const {createServer} = require('../server.cjs');
const version = require('../package.json').version;
const password = 'Fictional-register-only-123';

function browser(url) {
  const origin = new URL(url);
  let cookie = '', csrf = '';
  async function send(route, payload) {
    return new Promise((resolve, reject) => {
      const request = http.request(url + route, {method: payload ? 'POST' : 'GET', headers: {
        Host: origin.host, ...(cookie ? {Cookie: cookie} : {}),
        ...(payload ? {Origin: origin.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-App-Version': version} : {})
      }}, response => {
        if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          try { resolve({status: response.statusCode, ...JSON.parse(Buffer.concat(chunks).toString())}); }
          catch (error) { reject(error); }
        });
      });
      request.setTimeout(15000, () => request.destroy(Error('Fictional Accounting HTTP request timed out.')));
      request.on('error', reject);
      request.end(payload ? JSON.stringify(payload) : undefined);
    });
  }
  async function call(channel, args = [], workspaceId = 'main') {
    return send('/api/rpc', {channel, args, workspaceId});
  }
  async function good(channel, args = [], workspaceId = 'main') {
    const value = await call(channel, args, workspaceId);
    assert.equal(value.status, 200, channel + ': ' + value.error);
    assert(!JSON.stringify(value).includes('sessionToken'), 'Internal tokens stay outside browser results.');
    return value.data;
  }
  return {call, good, async login(username) {
    const initial = await send('/api/session');
    csrf = initial.data.csrfToken;
    return good('auth:login', [{username, password}]);
  }};
}
const ledger = (year, account, amountCents = 12345, paymentCents = 4500) => ({
  period: year + '-03', date: year + '-03-11', category: 'Radius', account,
  amountCents, paymentCents, paymentMethod: 'Cash', paymentDate: year + '-03-12', note: 'Fictional test record'
});
const save = (year, account, data = ledger(year, account)) => ({requestId: crypto.randomUUID(), id: null, version: 0, kind: 'ledger', year, data});

test('Accounting HTTP keeps Main Admin scope, actor-owned request recovery, revisions and private persisted records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fibernet-accounting-http-fictional-'));
  let backend, server;
  const stop = async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
    await backend?.close();
  };
  t.after(async () => { await stop(); const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert(path.basename(resolved).startsWith('fibernet-accounting-http-fictional-')); fs.rmSync(resolved, {recursive: true, force: true}); });
  async function start(initialize) {
    backend = await createBackend({dataDirectory: directory, initialize, version, automaticMonthClose: false});
    server = createServer({backend, origin: 'http://127.0.0.1', demo: true});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    // createServer's exact-origin selection must match the listener's actual port.
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
    server = createServer({backend, origin: url, demo: true});
    await new Promise(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve));
    return url;
  }
  const url = await start(true);
  await backend.createOwner({username: 'owner', fullName: 'Fictional Register Owner', password});
  const owner = browser(url);
  await owner.login('owner');
  const staff = {};
  for (const role of ['cashier', 'support', 'viewer', 'admin']) {
    staff[role] = await owner.good('users:create', [{username: 'register.' + role, fullName: 'Fictional Register ' + role, password, role}]);
  }
  const custodyBefore = await owner.good('drawer:get');
  const year = 2026;
  assert.deepEqual((await owner.good('accounting:overview', [{year}])).records, [], 'New Accounting begins without imported private rows.');
  const source = {file: 'fictional-register.xlsx', sheet: 'March fixture', row: 2, sha256: 'a'.repeat(64)};
  const firstInput = {...save(year, 'Fictional HTTP customer'), source};
  const created = await owner.good('accounting:save', [firstInput]);
  assert.equal(created.state, 'completed');
  assert.equal(created.requestId, firstInput.requestId);
  assert.equal(created.record.version, 1);
  assert.deepEqual(created.record.source, source, 'Import provenance is exposed as a safe basename and exact workbook row.');
  assert.deepEqual(created.record.data, firstInput.data);
  assert.equal(created.record.year, year);
  assert.equal(created.record.deleted, false);
  assert.deepEqual(await owner.good('accounting:save', [firstInput]), created, 'An exact request replay returns its original saved result.');
  assert.equal((await owner.good('accounting:overview', [{year}])).records.length, 1, 'Replays do not insert another row.');
  const recovered = await owner.good('accounting:status', [{requestId: firstInput.requestId}]);
  assert.equal(recovered.state, 'completed');
  assert.deepEqual(recovered.result, created);
  assert.deepEqual(await owner.good('accounting:resume', [{requestId: firstInput.requestId}]), created, 'Recovery uses the original request identity.');
  const unknownId = crypto.randomUUID();
  const missing = await owner.good('accounting:status', [{requestId: unknownId}]);
  assert.equal(missing.state, 'not_found');
  assert.equal(missing.canRelease, true);

  for (const role of ['cashier', 'support', 'viewer']) {
    const client = browser(url);
    await client.login('register.' + role);
    for (const [channel, input] of [
      ['overview', {year}], ['save', save(year, 'Denied ' + role)],
      ['remove', {requestId: crypto.randomUUID(), id: created.record.id, version: 1, reason: 'Fictional denial check'}],
      ['status', {requestId: firstInput.requestId}], ['resume', {requestId: firstInput.requestId}]
    ]) assert((await client.call('accounting:' + channel, [input])).status >= 400, role + ' cannot use ' + channel);
  }
  const secondAdmin = browser(url);
  await secondAdmin.login('register.admin');
  assert.equal((await secondAdmin.good('accounting:overview', [{year}])).records.length, 1, 'Main administrators can see shared register records.');
  for (const method of ['status', 'resume']) {
    const response = await secondAdmin.call('accounting:' + method, [{requestId: firstInput.requestId}]);
    assert(response.status >= 400 || response.data?.state === 'not_found', 'Another actor cannot retrieve the original request through ' + method);
    assert(!JSON.stringify(response).includes('Fictional HTTP customer'), 'Recovery does not disclose another actor\'s saved result.');
  }
  await owner.good('users:update', [staff.admin.accountKey, {username: 'register.admin', fullName: 'Fictional Register demoted administrator', role: 'viewer', active: true}]);
  assert((await secondAdmin.call('accounting:overview', [{year}])).status >= 400, 'An existing browser session loses Accounting access immediately after Admin demotion.');
  await owner.good('auth:switch', ['fiber-users']);
  for (const [method, input] of [['overview', {year}], ['save', save(year, 'Denied business Admin')], ['remove', {requestId: crypto.randomUUID(), id: created.record.id, version: 1, reason: 'Fictional business denial'}], ['status', {requestId: firstInput.requestId}], ['resume', {requestId: firstInput.requestId}]]) {
    assert((await owner.call('accounting:' + method, [input], 'fiber-users')).status >= 400, 'Business Admin cannot call Accounting ' + method);
  }

  for (const input of [
    {...save(year, 'Unexpected root'), unexpected: 'reject'},
    {...save(year, 'Unsafe provenance'), source: {...source, file: 'C:/private/fictional-register.xlsx'}},
    save(year, 'Unexpected data', {...ledger(year, 'Unexpected data'), password: 'never persist this'}),
    save(year, 'Cross-year', {...ledger(year, 'Cross-year'), period: '2025-03'}),
    save(year, 'Fractional cents', {...ledger(year, 'Fractional cents'), amountCents: 1.25})
  ]) assert((await owner.call('accounting:save', [input])).status >= 400, 'Invalid data is rejected before saving.');
  assert((await owner.call('accounting:save', [firstInput, {}])).status >= 400, 'Extra arguments cannot evade the Accounting contract.');
  assert((await owner.call('accounting:overview', [{year, token: 'reject'}])).status >= 400);
  assert((await owner.call('accounting:status', [{requestId: firstInput.requestId, actor: 'reject'}])).status >= 400);
  assert((await owner.call('accounting:save', [{...firstInput, data: {...firstInput.data, amountCents: 999}}])).status >= 400, 'An existing request ID cannot be reused for different details.');
  assert.equal((await owner.good('accounting:overview', [{year}])).records.length, 1);

  const editInput = {...firstInput, requestId: crypto.randomUUID(), id: created.record.id, version: 1, data: {...firstInput.data, amountCents: -2500, paymentCents: -500}};
  delete editInput.source;
  assert((await owner.call('accounting:save', [{...editInput, source: {...source, row: 99}}])).status >= 400, 'An imported row cannot be reassigned to different provenance.');
  const edited = await owner.good('accounting:save', [editInput]);
  assert.deepEqual(edited.record.source, source, 'Ordinary edits retain original import provenance.');
  assert.equal(edited.record.version, 2);
  assert.equal(edited.record.data.amountCents, -2500, 'Signed costs and settlement corrections remain signed.');
  assert((await owner.call('accounting:save', [{...editInput, requestId: crypto.randomUUID(), version: 1}])).status >= 400, 'Stale form revisions cannot overwrite a later save.');
  const nextYear = await owner.good('accounting:save', [save(year + 1, 'Fictional next-year customer')]);
  assert.equal((await owner.good('accounting:overview', [{year}])).records.length, 1);
  assert.equal((await owner.good('accounting:overview', [{year: year + 1}])).records[0].id, nextYear.record.id);
  const wire = JSON.stringify(await owner.good('accounting:overview', [{year}]));
  assert(!/password_hash|password_salt|sessionToken|request_json|result_json|never persist this/.test(wire), 'Browser overview returns record fields without internal request/auth storage.');

  await stop();
  const reopenedUrl = await start(false);
  const reopened = browser(reopenedUrl);
  await reopened.login('owner');
  const persisted = await reopened.good('accounting:overview', [{year}]);
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].version, 2);
  assert.equal(persisted.records[0].data.amountCents, -2500, 'Saved register entries survive reopening the actual database.');
  assert.deepEqual(await reopened.good('accounting:resume', [{requestId: firstInput.requestId}]), created, 'Original recovery results remain stable after later edits and database reopen.');
  assert.deepEqual(await reopened.good('drawer:get'), custodyBefore, 'Manual register entries do not move operational custody.');
  const removal = {requestId: crypto.randomUUID(), id: edited.record.id, version: 2, reason: 'Fictional test void after review'};
  const removed = await reopened.good('accounting:remove', [removal]);
  assert.equal(removed.record.deleted, true);
  assert.equal(removed.record.version, 3);
  assert.deepEqual(await reopened.good('accounting:remove', [removal]), removed, 'A repeated void returns the original void result.');
  assert.equal((await reopened.good('accounting:overview', [{year}])).records.length, 0);
  assert.equal((await reopened.good('accounting:overview', [{year: year + 1}])).records.length, 1, 'Voiding one year does not change another year.');
});




