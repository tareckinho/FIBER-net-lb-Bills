'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const initSqlJs = require('sql.js'), Register = require('../app/accounting-register.cjs');
const { query: q } = require('../app/finance-ledger.cjs');
const sql = initSqlJs();
const ledger = (extra = {}) => ({
  period: '2026-03', date: '2026-03-11', category: 'Radius', account: 'Fictional account',
  amountCents: 12345, paymentCents: 4500, paymentMethod: 'Cash', paymentDate: '2026-03-12', note: '', ...extra
});
const instruction = (extra = {}) => ({
  requestId: 'accounting-request-new', id: 'accounting-record-new', version: 0,
  kind: 'ledger', year: 2026, data: ledger(), ...extra
});
async function fixture(t, bytes) {
  const SQL = await sql, db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  if (!bytes) {
    db.exec("CREATE TABLE cash_drawer_transactions(id INTEGER PRIMARY KEY,amount REAL);INSERT INTO cash_drawer_transactions VALUES(1,37.5);CREATE TABLE finance_wallet_entries(id TEXT PRIMARY KEY,amount_cents INTEGER);INSERT INTO finance_wallet_entries VALUES('fictional-original',2222);");
    assert.equal(Register.needsMigration(db), true);
    Register.initialize(db);
  }
  assert.equal(Register.needsMigration(db), false);
  const state = {
    user: { role: 'admin', active: 1, account_key: 'fictional-main-admin', full_name: 'Fictional Main Admin' },
    at: '2026-03-12T14:00:00', phase: '', durable: db.export(), saves: 0
  };
  const service = new Register.AccountingRegister({
    db, authorize: () => state.user, now: () => state.at,
    saveEntry: async () => {
      state.saves++;
      if (state.phase === 'before') throw Error('Fictional disk interruption before durable write');
      state.durable = db.export();
      if (state.phase === 'after') throw Error('Fictional disk interruption after durable write');
    }
  });
  t.after(() => db.close());
  return { db, service, state };
}

test('Accounting begins empty, checks active administrator authority, and never writes operational funds', async t => {
  const { db, service, state } = await fixture(t);
  assert.deepEqual(service.overview({ year: 2026 }), { year: 2026, records: [], scope: 'main', pending: [] });
  const original = {
    cash: q(db, 'SELECT * FROM cash_drawer_transactions'),
    wallets: q(db, 'SELECT * FROM finance_wallet_entries')
  };
  const user = state.user;
  for (const denied of [null, { ...user, role: 'cashier' }, { ...user, active: 0 },
    { ...user, active: false }, { ...user, activity_inspection: true }, { ...user, activityInspection: true }]) {
    state.user = denied;
    assert.throws(() => service.overview({ year: 2026 }), /active Main administrator/);
    assert.throws(() => service.status({ requestId: 'fictional-not-found' }), /active Main administrator/);
    await assert.rejects(service.save(instruction()), /active Main administrator/);
    await assert.rejects(service.resume({ requestId: 'fictional-not-found' }), /active Main administrator/);
  }
  state.user = user;
  await service.save(instruction());
  await service.save(instruction({ requestId: 'fictional-settlement', id: 'fictional-settlement', data: ledger({ amountCents: 0, paymentCents: -1000, category: 'ISP' }) }));
  assert.deepEqual(q(db, 'SELECT * FROM cash_drawer_transactions'), original.cash);
  assert.deepEqual(q(db, 'SELECT * FROM finance_wallet_entries'), original.wallets);
  const records = service.overview({ year: 2026 }).records;
  assert.equal(records.length, 2);
  assert.equal(records.reduce((n, r) => n + r.data.amountCents, 0), 12345);
  assert.equal(records.reduce((n, r) => n + r.data.paymentCents, 0), 3500);
  assert.equal(service.overview({ year: 2027 }).records.length, 0);
  assert.throws(() => service.overview({ year: 2026, accountKey: 'another-admin' }), /unsupported/);
});

test('exact original requests remain actor-bound and replay the original result after later revisions and deletion', async t => {
  const { service, state, db } = await fixture(t);
  const input = instruction({ id: null }), first = await service.save(input);
  assert.match(first.record.id, /^register-[a-f0-9]{32}$/);
  assert.equal(first.record.version, 1);
  assert.deepEqual(await service.save(input), first);
  assert.equal(state.saves, 1);
  await assert.rejects(service.save({ ...input, data: ledger({ amountCents: 12346 }) }), /different details/);
  const second = await service.save(instruction({
    id: first.record.id, version: 1, requestId: 'fictional-revision-two',
    data: ledger({ amountCents: -2500, paymentCents: -500, category: 'ISP' })
  }));
  assert.equal(second.record.version, 2);
  assert.equal(second.record.data.amountCents - second.record.data.paymentCents, -2000);
  await assert.rejects(service.save(instruction({ id: first.record.id, version: 1, requestId: 'fictional-stale-change' })), /changed/);
  await assert.rejects(service.remove({ id: first.record.id, version: 1, requestId: 'fictional-stale-delete', reason: 'Fictional correction' }), /changed/);
  const removed = await service.remove({ id: first.record.id, version: 2, requestId: 'fictional-delete-three', reason: 'Fictional duplicate entry' });
  assert.equal(removed.record.version, 3);
  assert.equal(removed.record.deleted, true);
  assert.equal(removed.record.deletionReason, 'Fictional duplicate entry');
  assert.equal(service.overview({ year: 2026 }).records.length, 0);
  assert.deepEqual(await service.save(input), first);
  assert.deepEqual(await service.resume({ requestId: input.requestId }), first);
  assert.deepEqual(service.status({ requestId: input.requestId }).result, first);
  await assert.rejects(service.save(instruction({ id: first.record.id, version: 3, requestId: 'fictional-rewrite-deleted' })), /deleted/);
  assert.equal(q(db, 'SELECT * FROM accounting_register_records').length, 1);
  assert.equal(q(db, 'SELECT * FROM accounting_register_audit').length, 3);
  for (const table of ['accounting_register_audit', 'accounting_register_requests']) {
    assert.throws(() => db.run('DELETE FROM ' + table), /immutable/);
    assert.throws(() => db.run('UPDATE ' + table + " SET request_id='fictional-tampered'"), /immutable/);
  }
  const owner = state.user;
  state.user = { ...owner, account_key: 'fictional-second-admin' };
  assert.throws(() => service.status({ requestId: input.requestId }), /another administrator/);
  await assert.rejects(service.resume({ requestId: input.requestId }), /another administrator/);
  await assert.rejects(service.save(input), /another administrator/);
  state.user = owner;
  assert.deepEqual(service.status({ requestId: 'fictional-unknown-id' }), { requestId: 'fictional-unknown-id', state: 'not_found', canRelease: true });
});

test('purchase, resale, project, plan and unique month allocation preserve exact independently calculated cents', async t => {
  const { service } = await fixture(t);
  const line = { period: '2026-03', date: '', supplier: 'Fictional supplier', description: 'Fictional service', quantity: '1.005', unitPriceCents: 100, note: '' };
  const purchase = await service.save(instruction({ kind: 'purchase', requestId: 'fictional-purchase', id: 'fictional-purchase', data: line }));
  assert.equal(purchase.record.data.totalCents, 101, 'Half cents round upward once after exact quantity multiplication.');
  const resale = await service.save(instruction({ kind: 'resale', requestId: 'fictional-resale', id: 'fictional-resale', data: { ...line, account: 'Fictional buyer', quantity: '2.500', unitPriceCents: 199, unitCostCents: 201 } }));
  assert.equal(resale.record.data.quantity, '2.5');
  assert.equal(resale.record.data.totalCents, 498);
  assert.equal(resale.record.data.costCents, 503);
  assert.equal(resale.record.data.marginCents, -5);
  const project = await service.save(instruction({ kind: 'project', requestId: 'fictional-project', id: 'fictional-project', data: { ...line, project: 'Fictional NOC', quantity: '0.125' } }));
  assert.equal(project.record.data.totalCents, 13);
  const planData = { account: 'Fictional supplier', category: 'Other', description: 'Fictional recurring cost', direction: 'expense', amountCents: 1000, months: [1000, 0, 2500, 0, 0, 0, 0, 0, 0, 0, 0, 500], date: '', note: 'Historical date unknown' };
  const plan = await service.save(instruction({ kind: 'plan', requestId: 'fictional-plan', id: 'fictional-plan', data: planData }));
  assert.equal(plan.record.data.months.reduce((a, b) => a + b, 0), 4000);
  const budget = instruction({ kind: 'budget', id: 'budget-2026-03', requestId: 'fictional-budget', data: { period: '2026-03', percentageBasisPoints: 7500 } });
  assert.equal((await service.save(budget)).record.data.percentageBasisPoints, 7500);
  await assert.rejects(service.save({ ...budget, id: 'fictional-budget-other', requestId: 'fictional-budget-wrong-id' }), /unique budget record/);
  await assert.rejects(service.save({ ...budget, requestId: 'fictional-budget-duplicate' }), /changed/);
  assert.equal(service.overview({ year: 2026 }).records.length, 5);
});

test('validation rejects impossible dates, unsupported fields, fractional cents, unsafe totals and incomplete plans before writing', async t => {
  const { service, db } = await fixture(t);
  const variants = [
    { year: 2025 }, { data: ledger({ period: '2026-13' }) }, { data: ledger({ date: '2026-02-29' }) },
    { data: ledger({ paymentDate: '2026-04-31' }) }, { data: ledger({ amountCents: 1.5 }) },
    { data: ledger({ amountCents: Number.MAX_SAFE_INTEGER }) }, { data: ledger({ amountCents: 0, paymentCents: 0 }) },
    { data: ledger({ paymentMethod: 'Unpaid' }) }, { data: ledger({ account: 'bad\nname' }) },
    { data: ledger({ account: '' }) }, { data: ledger({ totalCents: 1 }) }, { kind: 'unexpected' },
    { data: ledger({ category: 'Unexpected' }) }, { version: -1 },
    { id: null, version: 2 }, { extraField: 'not accepted' }
  ];
  for (const [index, variant] of variants.entries()) {
    await assert.rejects(service.save(instruction({ ...variant, requestId: 'fictional-invalid-' + index })), undefined, JSON.stringify(variant));
  }
  const line = { period: '2026-03', date: '', supplier: 'Fictional supplier', description: 'Fictional service', quantity: '1', unitPriceCents: 100, note: '' };
  for (const quantity of [1, '0', '-1', '1e3', '1.0001', '1000000.001', '01']) {
    await assert.rejects(service.save(instruction({ kind: 'purchase', data: { ...line, quantity }, requestId: 'fictional-invalid-quantity' })), /positive quantity/);
  }
  await assert.rejects(service.save(instruction({ kind: 'purchase', data: { ...line, quantity: '1000000', unitPriceCents: Register.MAX_MONEY_CENTS } })), /calculated Accounting total/);
  const sparse = new Array(12);
  assert.throws(() => Register.normalizeData('plan', 2026, { account: 'Fictional', category: 'Other', description: '', direction: 'income', amountCents: 0, months: sparse }), /twelve/);
  assert.throws(() => Register.normalizeData('budget', 2026, { period: '2026-03', percentageBasisPoints: 10001 }), /allocation percentage/);
  const leap = ledger({ period: '2024-03', date: '2024-02-29', paymentDate: '', paymentMethod: 'Other' });
  assert.equal(Register.normalizeData('ledger', 2024, leap).date, '2024-02-29');
  assert.equal(Register.normalizeData('ledger', 2026, ledger({ date: '2025-12-31', paymentDate: '' })).date, '2025-12-31', 'Assigned period and actual dates are distinct.');
  assert.equal(q(db, 'SELECT * FROM accounting_register_records').length, 0);
  assert.equal(q(db, 'SELECT * FROM accounting_register_requests').length, 0);
});

test('source workbook provenance is immutable, path-free and retained when an imported record is edited', async t => {
  const { service } = await fixture(t);
  const source = { file: 'fictional-workbook.xlsx', sheet: 'Jan', row: 15, sha256: 'A'.repeat(64) };
  const input = instruction({ source, data: ledger({ date: '', paymentDate: '', paymentMethod: 'Other' }) });
  const first = await service.save(input);
  assert.equal(first.record.source.sha256, 'a'.repeat(64));
  const second = await service.save({ ...instruction({ id: first.record.id, version: 1, requestId: 'fictional-import-edit' }), data: ledger({ date: '', paymentDate: '' }) });
  assert.deepEqual(second.record.source, first.record.source);
  await assert.rejects(service.save(instruction({ id: first.record.id, version: 2, requestId: 'fictional-change-source', source: { ...source, row: 16 } })), /original source/);
  for (const bad of [{ ...source, file: 'C:\\private\\fictional.xlsx' }, { ...source, row: 0 }, { ...source, row: 1048577 }, { ...source, sha256: 'bad' }, { ...source, extra: 1 }]) {
    await assert.rejects(service.save(instruction({ id: 'fictional-bad-source', requestId: 'fictional-source-reject', source: bad })));
  }
  const manual = await service.save(instruction({ id: 'fictional-manual', requestId: 'fictional-manual' }));
  await assert.rejects(service.save(instruction({ id: manual.record.id, version: 1, requestId: 'fictional-add-source', source })), /original source/);
});

for (const phase of ['before', 'after']) {
  test('an unconfirmed ' + phase + '-write save preserves request identity, blocks replacement edits and recovers after restart', async t => {
    const { service, state, db } = await fixture(t);
    const input = instruction({ id: null, requestId: 'fictional-save-' + phase });
    const before = state.durable;
    state.phase = phase;
    await assert.rejects(service.save(input), /could not be confirmed/);
    const status = service.status({ requestId: input.requestId });
    assert.equal(status.state, 'save_required');
    assert.equal(service.overview({ year: 2026 }).pending[0].requestId, input.requestId);
    await assert.rejects(service.save(instruction({ id: 'fictional-replacement', requestId: 'fictional-replacement' })), /Finish saving the original/);
    assert.equal(q(db, 'SELECT * FROM accounting_register_records').length, 1);
    const restart = await fixture(t, phase === 'before' ? before : state.durable);
    assert.equal(restart.service.status({ requestId: input.requestId }).state, phase === 'before' ? 'not_found' : 'completed');
    const recoveredAfterRestart = await restart.service.save(input);
    assert.deepEqual(recoveredAfterRestart, status.result);
    assert.equal(restart.service.overview({ year: 2026 }).records.length, 1);
    state.phase = '';
    assert.deepEqual(await service.resume({ requestId: input.requestId }), status.result);
    assert.equal(service.status({ requestId: input.requestId }).state, 'completed');
    assert.equal(q(db, 'SELECT * FROM accounting_register_audit').length, 1);
  });
}

test('concurrent submissions serialize revisions and a changed saved snapshot never produces plausible partial totals', async t => {
  const { service, state, db } = await fixture(t);
  const first = await service.save(instruction());
  const a = instruction({ version: 1, requestId: 'fictional-concurrent-a', data: ledger({ amountCents: 2000 }) });
  const b = instruction({ version: 1, requestId: 'fictional-concurrent-b', data: ledger({ amountCents: 3000 }) });
  const results = await Promise.allSettled([service.save(a), service.save(b)]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
  assert.equal(service.overview({ year: 2026 }).records[0].version, 2);
  assert.equal(state.saves, 2);
  db.run('UPDATE accounting_register_records SET data_json=? WHERE id=?', [JSON.stringify(ledger({ amountCents: 1 })), first.record.id]);
  assert.throws(() => service.overview({ year: 2026 }), /could not be verified/);
});


test('fractional-cent unit rates and unpriced historical projects retain meaning without rounding unit rates or inventing totals', async t => {
  const { service } = await fixture(t);
  const line = { period: '2026-03', date: '', supplier: 'Fictional supplier', description: 'Fictional capacity', quantity: '1000', unitPriceCents: 16.8, note: '' };
  const saved = await service.save(instruction({ kind: 'purchase', id: 'fictional-precise-rate', requestId: 'fictional-precise-rate', data: line }));
  assert.equal(saved.record.data.unitPriceCents, 16.8);
  assert.equal(saved.record.data.totalCents, 16800);
  const tiny = Register.normalizeData('resale', 2026, { ...line, account: 'Fictional buyer', quantity: '1', unitCostCents: '0.0001', unitPriceCents: '0.5000' });
  assert.equal(tiny.unitCostCents, 0.0001);
  assert.equal(tiny.unitPriceCents, 0.5);
  assert.equal(tiny.totalCents, 1);
  assert.equal(tiny.costCents, 0);
  assert.throws(() => Register.normalizeData('purchase', 2026, { ...line, unitPriceCents: 16.80001 }), /four decimal places/);
  const unknown = await service.save(instruction({ kind: 'project', id: 'fictional-unpriced-project', requestId: 'fictional-unpriced-project',
    data: { ...line, period: '', date: '2024-08-05', project: 'Fictional historical site', supplier: '', quantity: '', unitPriceCents: null } }));
  assert.equal(unknown.record.data.period, '');
  assert.equal(unknown.record.data.date, '2024-08-05');
  assert.equal(unknown.record.data.quantity, '');
  assert.equal(unknown.record.data.unitPriceCents, null);
  assert.equal(unknown.record.data.totalCents, null);
  assert.equal(Register.normalizeData('project', 2026, { ...line, project: 'Fictional site', quantity: '', unitPriceCents: 20 }).totalCents, null);
  const plan = Register.normalizeData('plan', 2026, { account: 'Fictional plan', category: 'Education', description: '', direction: 'expense', amountCents: 100, months: Array(12).fill(0) });
  assert.equal(plan.category, 'Education');
});


test('multiline notes, descriptions and deletion reasons survive saved revisions, replay and persistence while identities reject line breaks', async t => {
  const { service, state } = await fixture(t);
  const note = 'Fictional first line\r\nSecond line\tchecked';
  const input = instruction({ data: ledger({ note }) });
  const saved = await service.save(input);
  assert.equal(saved.record.data.note, note);
  const reopened = await fixture(t, state.durable);
  assert.equal(reopened.service.overview({ year: 2026 }).records[0].data.note, note);
  assert.equal((await reopened.service.save(input)).record.data.note, note);
  const description = 'Fictional installation\nReviewed materials\tand labor';
  const purchase = await service.save(instruction({ kind: 'purchase', id: 'fictional-multiline-line', requestId: 'fictional-multiline-line',
    data: { period: '2026-03', date: '', supplier: 'Fictional supplier', description, quantity: '1', unitPriceCents: 100, note } }));
  assert.equal(purchase.record.data.description, description);
  assert.equal(service.overview({ year: 2026 }).records.find(record => record.id === purchase.record.id).data.note, note);
  const reason = 'Fictional correction\r\nOriginal explanation\tretained';
  const removed = await service.remove({ id: purchase.record.id, version: 1, requestId: 'fictional-multiline-remove', reason });
  assert.equal(removed.record.deletionReason, reason);
  assert.equal(service.status({ requestId: 'fictional-multiline-remove' }).result.record.deletionReason, reason);
  await assert.rejects(service.save(instruction({ id: 'fictional-bad-linebreak', requestId: 'fictional-bad-linebreak', data: ledger({ account: 'Fictional\naccount' }) })), /valid account/);
  await assert.rejects(service.save(instruction({ id: 'fictional-bad-control', requestId: 'fictional-bad-control', data: ledger({ note: 'Fictional\u0000note' }) })), /valid note/);
});
