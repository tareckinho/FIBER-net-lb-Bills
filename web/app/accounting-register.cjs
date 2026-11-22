'use strict';

// Independent reviewed register: these entries never move operational funds.
const crypto = require('node:crypto');
const { query: q } = require('./finance-ledger.cjs');
const MAX_RECORDS_PER_YEAR = 10000, MAX_MONEY_CENTS = 100000000000;
const KINDS = ['ledger', 'purchase', 'resale', 'plan', 'project', 'budget', 'sheetcell'];
const CATEGORIES = ['Radius', 'ISP', 'Bandwidth', 'Other'];
const METHODS = ['Cash', 'Whish', 'OMT', 'Other', 'Unpaid'];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));

function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) {
    throw Error('Choose valid Accounting details; missing or unsupported fields were rejected.');
  }
  return value;
}
function text(value, label, max = 200, empty = false, multiline = false) {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (typeof value !== 'string' || value.length > max || controls.test(value) || !empty && !value.trim()) {
    throw Error('Enter valid ' + label + '.');
  }
  return value.trim();
}
function identifier(value, label = 'reference') {
  const id = text(value, 'Accounting ' + label, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(id)) throw Error('Use a valid unique Accounting ' + label + '.');
  return id;
}
function year(value) {
  if (!Number.isSafeInteger(value) || value < 2000 || value > 2099) throw Error('Choose an Accounting year from 2000 through 2099.');
  return value;
}
function date(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T12:00:00Z')) ||
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw Error('Choose a real Accounting calendar date or leave an unknown historical date blank.');
  return value;
}
function period(value, selectedYear) {
  if (typeof value !== 'string' || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value) ||
      Number(value.slice(0, 4)) !== selectedYear) throw Error('Choose a period in the selected Accounting year.');
  return value;
}
function money(value, label = 'amount', signed = false) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_CENTS || !signed && value < 0) {
    throw Error('Enter ' + label + ' as supported exact integer USD cents.');
  }
  return Object.is(value, -0) ? 0 : value;
}
function choice(value, values, label) {
  if (!values.includes(value)) throw Error('Choose a valid Accounting ' + label + '.');
  return value;
}
function quantity(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(value)) {
    throw Error('Enter a positive quantity, at most 1,000,000, with up to three decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (milli <= 0n || milli > 1000000000n) throw Error('Enter a positive quantity, at most 1,000,000, with up to three decimal places.');
  const tail = fraction.replace(/0+$/, '');
  return { value: whole + (tail ? '.' + tail : ''), milli };
}
function unitMoney(value, label) {
  if (!['number', 'string'].includes(typeof value) || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(String(value))) {
    throw Error('Enter ' + label + ' as exact USD cents with up to four decimal places.');
  }
  const [whole, fraction = ''] = String(value).split('.');
  const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (scaled > BigInt(MAX_MONEY_CENTS) * 10000n) throw Error('The unit price exceeds the supported amount.');
  return { value: Number(value), scaled };
}
function product(milli, scaledUnitCents) {
  const rounded = (milli * scaledUnitCents + 5000000n) / 10000000n;
  if (rounded > BigInt(MAX_MONEY_CENTS)) throw Error('The calculated Accounting total exceeds the supported amount.');
  return Number(rounded);
}
function normalizeData(kind, selectedYear, input) {
  year(selectedYear);
  choice(kind, KINDS, 'record type');
  if(kind==='sheetcell'){
    object(input,['sheet','cell','value']);
    const sheet=text(input.sheet,'worksheet name',31),cell=text(input.cell,'worksheet cell',10);
    if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell))throw Error('Choose a valid worksheet cell.');
    const value=input.value;if(!(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER||typeof value==='string'&&value.length<=32767&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)))throw Error('Enter a valid literal worksheet value.');
    return {sheet,cell,value};
  }
  if (kind === 'budget') {
    object(input, ['period', 'percentageBasisPoints']);
    if (!Number.isSafeInteger(input.percentageBasisPoints) || input.percentageBasisPoints < 0 || input.percentageBasisPoints > 10000) throw Error('Choose a bandwidth allocation percentage from 0% through 100%.');
    return { period: period(input.period, selectedYear), percentageBasisPoints: input.percentageBasisPoints };
  }
  if (kind === 'ledger') {
    object(input, ['period', 'date', 'category', 'account', 'amountCents', 'paymentCents', 'paymentMethod', 'paymentDate', 'note']);
    const amountCents = money(input.amountCents, 'charge', true), paymentCents = money(input.paymentCents, 'payment', true);
    const paymentMethod = choice(input.paymentMethod, METHODS, 'payment method'), paymentDate = date(input.paymentDate);
    if (!amountCents && !paymentCents) throw Error('Enter a nonzero charge or a settlement payment.');
    if (paymentMethod === 'Unpaid' && paymentCents) throw Error('An Unpaid entry cannot contain a payment.');
    return {
      period: period(input.period, selectedYear), date: date(input.date),
      category: choice(input.category, CATEGORIES, 'category'), account: text(input.account, 'account', 200),
      amountCents, paymentCents, paymentMethod, paymentDate, note: text(input.note, 'note', 2000, true, true)
    };
  }
  if (kind === 'plan') {
    object(input, ['account', 'category', 'description', 'direction', 'amountCents', 'months', 'date', 'note'],
      ['account', 'category', 'description', 'direction', 'amountCents', 'months']);
    if (!Array.isArray(input.months) || input.months.length !== 12 ||
        Array.from({ length: 12 }, (_, index) => Object.hasOwn(input.months, index)).some(present => !present)) {
      throw Error('Enter all twelve monthly plan amounts.');
    }
    const months = input.months.map(value => money(value, 'monthly plan amount'));
    if (months.reduce((total, value) => total + BigInt(value), 0n) > BigInt(MAX_MONEY_CENTS)) throw Error('The annual plan exceeds the supported amount.');
    return {
      account: text(input.account, 'account', 200), category: text(input.category, 'plan category', 100),
      description: text(input.description, 'description', 1000, true, true),
      direction: choice(input.direction, ['income', 'expense'], 'plan direction'),
      amountCents: money(input.amountCents, 'plan amount'), months,
      ...(Object.hasOwn(input, 'date') ? { date: date(input.date) } : {}),
      ...(Object.hasOwn(input, 'note') ? { note: text(input.note, 'note', 2000, true, true) } : {})
    };
  }
  object(input, kind === 'resale'
    ? ['period', 'date', 'account', 'supplier', 'description', 'quantity', 'unitCostCents', 'unitPriceCents', 'note']
    : ['period', 'date', ...(kind === 'project' ? ['project'] : []), 'supplier', 'description', 'quantity', 'unitPriceCents', 'note']);
  const isProject = kind === 'project';
  const qty = isProject && input.quantity === '' ? null : quantity(input.quantity);
  const unitPrice = isProject && input.unitPriceCents === null ? null : unitMoney(input.unitPriceCents, 'unit price');
  if (!isProject && unitPrice.scaled <= 0n) throw Error('Enter a positive known unit price.');
  const totalCents = qty && unitPrice ? product(qty.milli, unitPrice.scaled) : null;
  const unitCost = kind === 'resale' ? unitMoney(input.unitCostCents, 'unit cost') : null;
  const result = {
    period: isProject && input.period === '' ? '' : period(input.period, selectedYear), date: date(input.date),
    ...(isProject ? { project: text(input.project, 'project name', 200) } : {}),
    ...(kind === 'resale' ? { account: text(input.account, 'account', 200) } : {}),
    supplier: text(input.supplier, 'supplier', 200, isProject), description: text(input.description, 'description', 1000, false, true),
    quantity: qty?.value ?? '', ...(unitCost ? { unitCostCents: unitCost.value } : {}),
    unitPriceCents: unitPrice?.value ?? null, totalCents, note: text(input.note, 'note', 2000, true, true)
  };
  if (kind === 'resale') {
    result.costCents = product(qty.milli, unitCost.scaled);
    result.marginCents = totalCents - result.costCents;
  }
  return result;
}
function provenance(value) {
  object(value, ['file', 'sheet', 'row', 'sha256']);
  if (!Number.isSafeInteger(value.row) || value.row < 1 || value.row > 1048576 ||
      typeof value.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.sha256)) throw Error('Choose valid source workbook provenance.');
  const filename = text(value.file, 'source filename', 160);
  if (/[\\/:]/.test(filename) || ['.', '..'].includes(filename)) throw Error('Use a source workbook filename without a private directory path.');
  return { file: filename, sheet: text(value.sheet, 'source sheet', 80), row: value.row, sha256: value.sha256.toLowerCase() };
}
function actor(user) {
  const key = user?.account_key ?? user?.accountKey;
  if (!user || user.active === false || user.active === 0 || user.activity_inspection || user.activityInspection ||
      user.role !== 'admin' || typeof key !== 'string' || !key.trim()) throw Error('Only the active Main administrator can manage Accounting.');
  return { key: text(key, 'administrator identity', 200), name: text(user.full_name ?? user.fullName ?? user.username ?? key, 'administrator name', 200) };
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw Error('Refresh the Accounting record before editing.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw Error('The Accounting save time could not be verified.');
  date(value.slice(0, 10));
  return value;
}
function initialize(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS accounting_register_records(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),kind TEXT NOT NULL,year INTEGER NOT NULL,data_json TEXT NOT NULL,deleted INTEGER NOT NULL CHECK(deleted IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,deletion_reason TEXT NOT NULL,source_json TEXT NOT NULL);',
    'CREATE INDEX IF NOT EXISTS accounting_register_year ON accounting_register_records(year,deleted,kind,id);',
    'CREATE TABLE IF NOT EXISTS accounting_register_requests(request_id TEXT PRIMARY KEY,actor_key TEXT NOT NULL,input_json TEXT NOT NULL,input_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,created_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS accounting_register_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,record_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,actor_key TEXT NOT NULL,actor_name TEXT NOT NULL,created_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL);',
    'CREATE UNIQUE INDEX IF NOT EXISTS accounting_register_revision ON accounting_register_audit(record_id,version);'
  ].join('\n'));
  for (const table of ['accounting_register_requests', 'accounting_register_audit']) {
    for (const action of ['UPDATE', 'DELETE']) {
      db.exec('CREATE TRIGGER IF NOT EXISTS ' + table + '_' + action.toLowerCase() + ' BEFORE ' + action + ' ON ' + table +
        " BEGIN SELECT RAISE(ABORT,'Accounting request and revision history is immutable.');END;");
    }
  }
}
function needsMigration(db) {
  return ['accounting_register_records', 'accounting_register_year', 'accounting_register_requests', 'accounting_register_audit', 'accounting_register_revision',
    'accounting_register_requests_update', 'accounting_register_requests_delete', 'accounting_register_audit_update', 'accounting_register_audit_delete']
    .some(name => !q(db, 'SELECT name FROM sqlite_master WHERE name=?', [name]).length);
}
function recordDto(row) {
  let data, source;
  try { data = JSON.parse(row.data_json); source = row.source_json ? JSON.parse(row.source_json) : null; } catch { throw Error('The saved Accounting record could not be verified.'); }
  return {
    id: row.id, version: row.version, kind: row.kind, year: row.year, data, deleted: Boolean(row.deleted),
    createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by,
    ...(row.deleted ? { deletionReason: row.deletion_reason } : {}), ...(source ? { source } : {})
  };
}
class AccountingRegister {
  constructor(context) { Object.assign(this, context); this.queue = Promise.resolve(); this.dirty = null; }
  user() { return actor(this.authorize()); }
  enqueue(task) { const run = this.queue.then(task); this.queue = run.catch(() => {}); return run; }
  assertIdle(ownId) {
    if (this.dirty && this.dirty !== ownId) throw Error('Finish saving the original Accounting request ' + this.dirty + ' before making another change.');
  }
  prior(requestId, currentActor, fingerprint) {
    const row = q(this.db, 'SELECT * FROM accounting_register_requests WHERE request_id=?', [requestId])[0];
    if (!row) return null;
    if (row.actor_key !== currentActor.key || fingerprint && row.input_hash !== fingerprint) throw Error('This Accounting request belongs to another administrator or already contains different details.');
    let input, result;
    try { input = JSON.parse(row.input_json); result = JSON.parse(row.result_json); } catch { throw Error('The original Accounting request could not be verified.'); }
    if (hash(input) !== row.input_hash || hash(result) !== row.result_hash ||
        input.requestId !== requestId || result.requestId !== requestId || result.state !== 'completed') throw Error('The original Accounting request could not be verified.');
    const audits = q(this.db, 'SELECT * FROM accounting_register_audit WHERE request_id=?', [requestId]), audit = audits[0];
    if (audits.length !== 1 || audit.actor_key !== row.actor_key || audit.created_at !== row.created_at ||
        audit.record_id !== result.record?.id || audit.version !== result.record?.version || audit.action !== input.action ||
        audit.snapshot_json !== JSON.stringify(result.record) || audit.snapshot_hash !== hash(result.record)) throw Error('The original Accounting audit could not be verified.');
    return result;
  }
  verifyRecord(row) {
    const record = recordDto(row), audits = q(this.db, 'SELECT * FROM accounting_register_audit WHERE record_id=? AND version=?', [row.id, row.version]);
    if (audits.length !== 1 || audits[0].snapshot_json !== JSON.stringify(record) || audits[0].snapshot_hash !== hash(record)) throw Error('The saved Accounting revision could not be verified.');
    return record;
  }
  overview(input) {
    this.user(); object(input, ['year']); const selectedYear = year(input.year);
    const count = q(this.db, "SELECT COUNT(*) AS n FROM accounting_register_records WHERE year=? AND deleted=0 AND kind<>'sheetcell'", [selectedYear])[0].n;
    if (count > MAX_RECORDS_PER_YEAR) throw Error('This Accounting year exceeds the supported register capacity; no partial totals were shown.');
    const records = q(this.db, "SELECT * FROM accounting_register_records WHERE year=? AND deleted=0 AND kind<>'sheetcell' ORDER BY kind,updated_at,id", [selectedYear]).map(row => this.verifyRecord(row));
    return { year: selectedYear, records, scope: 'main', pending: this.dirty ? [{ requestId: this.dirty, state: 'save_required' }] : [] };
  }
  async persist(requestId, result) {
    this.dirty = requestId;
    try { await this.saveEntry(); this.dirty = null; return copy(result); }
    catch { throw Error('The Accounting save could not be confirmed. Keep request ' + requestId + ' and check or resume its original saved result before retrying.'); }
  }
  status(input) {
    const currentActor = this.user(); object(input, ['requestId']); const requestId = identifier(input.requestId, 'request ID');
    const result = this.prior(requestId, currentActor);
    return result ? { requestId, state: this.dirty === requestId ? 'save_required' : 'completed', result: copy(result) } : { requestId, state: 'not_found', canRelease: true };
  }
  resume(input) {
    return this.enqueue(async () => {
      const currentActor = this.user(); object(input, ['requestId']); const requestId = identifier(input.requestId, 'request ID');
      this.assertIdle(requestId); const result = this.prior(requestId, currentActor);
      if (!result) throw Error('The original Accounting request was not found.');
      return this.dirty === requestId ? this.persist(requestId, result) : copy(result);
    });
  }
  save(input) { return this.mutate('save', input); }
  remove(input) { return this.mutate('remove', input); }
  mutate(action, value) {
    return this.enqueue(async () => {
      const currentActor = this.user();
      object(value, action === 'save' ? ['requestId', 'id', 'version', 'kind', 'year', 'data', 'source'] : ['requestId', 'id', 'version', 'reason'],
        action === 'save' ? ['requestId', 'id', 'version', 'kind', 'year', 'data'] : ['requestId', 'id', 'version', 'reason']);
      const requestId = identifier(value.requestId, 'request ID'), version = revision(value.version);
      const inputId = action === 'save' && value.id === null && version === 0 ? null : identifier(value.id, 'record ID');
      const id = inputId ?? 'register-' + hash(['record', requestId]).slice(0, 32);
      const input = {
        action, requestId, id: inputId, version,
        ...(action === 'save' ? { kind: choice(value.kind, KINDS, 'record type'), year: year(value.year), data: normalizeData(value.kind, value.year, value.data),
          ...(Object.hasOwn(value, 'source') ? { source: provenance(value.source) } : {}) } : { reason: text(value.reason, 'deletion reason', 1000, false, true) })
      };
      if (action === 'save' && input.kind === 'budget' && id !== 'budget-' + input.data.period) throw Error('Use the unique budget record ID budget-' + input.data.period + '.');
      if(action==='save'&&input.kind==='sheetcell'){if(typeof this.validateCell!=='function')throw Error('Install the original workbook before editing cells.');this.validateCell(input.data,input.year,id);}
      const fingerprint = hash(input), saved = this.prior(requestId, currentActor, fingerprint);
      this.assertIdle(requestId);
      if (saved) return this.dirty === requestId ? this.persist(requestId, saved) : copy(saved);
      const row = q(this.db, 'SELECT * FROM accounting_register_records WHERE id=?', [id])[0], existing = row ? this.verifyRecord(row) : null;
      if (existing ? existing.version !== version : action !== 'save' || version !== 0) throw Error('This Accounting record changed or was removed. Refresh before editing; your draft has not replaced it.');
      if(existing?.deleted&&!(action==='save'&&existing.kind==='sheetcell'))throw Error('This Accounting record was deleted and its history cannot be rewritten.');
      if(action==='remove'&&existing?.kind==='sheetcell'){if(typeof this.validateCell!=='function')throw Error('The original workbook is unavailable.');this.validateCell(existing.data,existing.year,id);}
      if (action === 'save' && existing && (existing.kind !== input.kind || existing.year !== input.year)) throw Error('An existing Accounting record must keep its original type and year.');
      if (action === 'save' && existing && Object.hasOwn(input, 'source') && JSON.stringify(existing.source ?? null) !== JSON.stringify(input.source)) throw Error('An Accounting record must keep its original source workbook provenance.');
      if(action==='save'&&!existing){const cell=input.kind==='sheetcell',limit=cell?50000:MAX_RECORDS_PER_YEAR,count=q(this.db,'SELECT COUNT(*) AS n FROM accounting_register_records WHERE year=? AND deleted=0 AND kind '+(cell?'=':'<>')+' ?',[input.year,'sheetcell'])[0].n;if(count>=limit)throw Error('The Accounting year reached its supported record capacity; no record was added.');}
      const at = timestamp(this.now()), source = existing?.source ?? input.source;
      const record = {
        id, version: version + 1, kind: existing?.kind ?? input.kind, year: existing?.year ?? input.year,
        data: action === 'save' ? input.data : existing.data, deleted: action === 'remove',
        createdAt: existing?.createdAt ?? at, updatedAt: at, createdBy: existing?.createdBy ?? currentActor.key, updatedBy: currentActor.key,
        ...(action === 'remove' ? { deletionReason: input.reason } : {}), ...(source ? { source } : {})
      };
      const result = { state: 'completed', requestId, record };
      this.db.exec('BEGIN');
      try {
        this.db.run('INSERT INTO accounting_register_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data_json=excluded.data_json,deleted=excluded.deleted,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deletion_reason=excluded.deletion_reason',
          [id, record.version, record.kind, record.year, JSON.stringify(record.data), Number(record.deleted), record.createdAt, record.updatedAt, record.createdBy, record.updatedBy, record.deletionReason ?? '', source ? JSON.stringify(source) : '']);
        this.db.run('INSERT INTO accounting_register_requests VALUES(?,?,?,?,?,?,?)', [requestId, currentActor.key, JSON.stringify(input), fingerprint, JSON.stringify(result), hash(result), at]);
        this.db.run('INSERT INTO accounting_register_audit(request_id,record_id,version,action,actor_key,actor_name,created_at,snapshot_json,snapshot_hash) VALUES(?,?,?,?,?,?,?,?,?)',
          [requestId, id, record.version, action, currentActor.key, currentActor.name, at, JSON.stringify(record), hash(record)]);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return this.persist(requestId, result);
    });
  }
}
module.exports = { initialize, needsMigration, AccountingRegister, normalizeData, MAX_RECORDS_PER_YEAR, MAX_MONEY_CENTS };

