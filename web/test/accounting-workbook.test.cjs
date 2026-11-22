'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Workbook = require('../app/accounting-workbook.cjs');
const cell = (value, formula) => formula === undefined ? { value } : { value, formula };
const book = sheets => ({ format: 'FIBERNETLB-ACCOUNTING-WORKBOOK-1', year: 2026, name: 'Fictional workbook.xlsx', sheets });
function sameNumber(actual, expected) { assert.equal(typeof actual, 'number'); assert(Math.abs(actual - expected) < 1e-10, 'Calculated number differs from expected exact arithmetic.'); }

test('original columns, formulas and raw unit rates recalculate through cross-sheet dependencies without changing the snapshot', () => {
  const snapshot = book([
    { name: 'Jan Records', cells: {
      A1: cell('Quantity'), B1: cell('Unit Price'), C1: cell('Payment'), D1: cell('Balance'),
      A2: cell(1000), B2: cell(0.168), C2: cell(50), D2: cell(999, '=A2*B2-C2'),
      A3: cell(null), B3: cell(7.44), C3: cell(null), D3: cell(999, '=A3*B3-C3'),
      A4: cell(999, '=SUM(D2:D3)')
    }, tables: [], styleRuns: [[1, 1, 4, 2]], merges: [], columnWidths: { 1: 100 } },
    { name: "O'Brien", cells: { A1: cell(999, "='Jan Records'!$A$4/2") } },
    { name: 'Summary', cells: { A1: cell(999, "='O''Brien'!A1+2*3"), A2: cell(null, '=$A$1-(1+2)*2') } }
  ]);
  const original = JSON.stringify(snapshot);
  const initial = Workbook.calculate(snapshot);
  assert.deepEqual(initial.errors, []);
  sameNumber(initial.values['Jan Records'].D2, 118);
  sameNumber(initial.values["O'Brien"].A1, 59);
  sameNumber(initial.values.Summary.A1, 65);
  sameNumber(initial.values.Summary.A2, 59);
  const changed = Workbook.calculate(snapshot, { 'Jan Records': { C2: 68 } });
  sameNumber(changed.values['Jan Records'].D2, 100);
  sameNumber(changed.values.Summary.A1, 56);
  assert.equal(JSON.stringify(snapshot), original);
  assert.deepEqual(Workbook.supportedFunctions, ['IF', 'SUMIF', 'SUM', 'SUBTOTAL']);
});

test('structured references use original table columns, current row and exact data boundaries', () => {
  const snapshot = book([{ name: 'Purchases', cells: {
    A1: cell('Quantity'), B1: cell('Unit Price'), C1: cell('Total'),
    A2: cell(2), B2: cell(1.25), C2: cell(999, '=SyntheticPurchases[[#This Row],[Quantity]]*SyntheticPurchases[[#This Row],[Unit Price]]'),
    A3: cell(0.5), B3: cell(16.8), C3: cell(999, '=SyntheticPurchases[[#This Row],[Quantity]]*SyntheticPurchases[[#This Row],[Unit Price]]'),
    C4: cell(999, '=SUBTOTAL(109,SyntheticPurchases[Total])'),
    E1: cell(999, '=SUM(SyntheticPurchases[Total])')
  }, tables: [{ name: 'SyntheticPurchases', ref: 'A1:C4', columns: ['Quantity', 'Unit Price', 'Total'], headerRowCount: 1, totalsRowCount: 1 }] }]);
  const result = Workbook.calculate(snapshot);
  assert.deepEqual(result.errors, []);
  sameNumber(result.values.Purchases.C2, 2.5);
  sameNumber(result.values.Purchases.C3, 8.4);
  sameNumber(result.values.Purchases.C4, 10.9);
  sameNumber(result.values.Purchases.E1, 10.9);
  snapshot.sheets[0].hiddenRows = [3];
  const hidden = Workbook.calculate(snapshot);
  sameNumber(hidden.values.Purchases.C4, 2.5);
  sameNumber(hidden.values.Purchases.E1, 10.9);
});

test('SUBTOTAL preserves filtered and manually hidden rows and excludes nested subtotal results', () => {
  const snapshot = book([{ name: 'Loan', cells: {
    A1: cell(5), A2: cell(7), A3: cell(11),
    A4: cell(999, '=SUBTOTAL(109,A1:A3)'), A5: cell(999, '=SUBTOTAL(109,A1:A4)'),
    B1: cell(999, '=SUBTOTAL(9,A1:A3)'), B2: cell(999, '=SUM(A1:A3)')
  }, hiddenRows: [2], filteredRows: [3] }]);
  const result = Workbook.calculate(snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.values.Loan.A4, 5);
  assert.equal(result.values.Loan.A5, 5);
  assert.equal(result.values.Loan.B1, 12);
  assert.equal(result.values.Loan.B2, 23);
  const empty = Workbook.calculate(book([{ name: 'Empty', cells: { A1: cell('Amount'), A2: cell(999, '=SUBTOTAL(109,EmptyTable[Amount])') },
    tables: [{ name: 'EmptyTable', ref: 'A1:A2', columns: ['Amount'], headerRowCount: 1, totalsRowCount: 1 }] }]));
  assert.deepEqual(empty.errors, []);
  assert.equal(empty.values.Empty.A2, 0);
});

test('SUMIF reproduces case-insensitive account matching, wildcard stars/questions and escaped literal wildcards', () => {
  const snapshot = book([{ name: 'Accounts', cells: {
    A1: cell('alpha'), A2: cell('ALPHA'), A3: cell('Alpha2'), A4: cell('literal*name'), A5: cell(null),
    B1: cell(1), B2: cell(2), B3: cell(3), B4: cell(4), B5: cell(100),
    C1: cell(999, '=SUMIF(A1:A5,"alpha",B1:B5)'),
    C2: cell(999, '=SUMIF(A1:A5,"A*",B1:B5)'),
    C3: cell(999, '=SUMIF(A1:A5,"Alpha?",B1:B5)'),
    C4: cell(999, '=SUMIF(A1:A5,"literal~*name",B1:B5)'),
    C5: cell(999, '=SUMIF(A1:A5,"<>",B1:B5)'),
    C6: cell(999, '=SUMIF(A1:A5,"",B1:B5)'),
    D1: cell(1), D2: cell(2), D3: cell(3), D4: cell(4),
    E1: cell(999, '=SUMIF(D1:D4,">=3")')
  }, hiddenRows: [2] }]);
  const result = Workbook.calculate(snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.values.Accounts.C1, 3);
  assert.equal(result.values.Accounts.C2, 6);
  assert.equal(result.values.Accounts.C3, 3);
  assert.equal(result.values.Accounts.C4, 4);
  assert.equal(result.values.Accounts.C5, 10);
  assert.equal(result.values.Accounts.C6, 100);
  assert.equal(result.values.Accounts.E1, 7);
});

test('IF is lazy and blank references retain Excel empty-cell and arithmetic behavior', () => {
  const snapshot = book([{ name: 'Monthly', cells: {
    A1: cell(null), B1: cell(999, '=IF(A1<>"",SUMIF(A2:A3,A1,B2:B3),"")'),
    A2: cell(0), B2: cell(5), A3: cell('Fictional account'), B3: cell(7),
    C1: cell(999, '=A1'), C2: cell(999, '=A1+2'), C3: cell(999, '=IF(A1="",4,MissingSheet!A1)'),
    D1: cell(999, '=IF(TRUE,6,1/0)'), D2: cell(999, '=IF(FALSE,1/0,8)'),
    E1: cell(999, '=IF(A2<>"",10,20)'), E2: cell(999, '=IF(A3="fictional ACCOUNT",12,20)')
  } }]);
  const result = Workbook.calculate(snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.values.Monthly.B1, '');
  assert.equal(result.values.Monthly.C1, 0);
  assert.equal(result.values.Monthly.C2, 2);
  assert.equal(result.values.Monthly.C3, 4);
  assert.equal(result.values.Monthly.D1, 6);
  assert.equal(result.values.Monthly.D2, 8);
  assert.equal(result.values.Monthly.E1, 10);
  assert.equal(result.values.Monthly.E2, 12);
});

test('cycles, division by zero and missing references are visible errors rather than cached or zero values', () => {
  const snapshot = book([{ name: 'Errors', cells: {
    A1: cell(123, '=B1+1'), B1: cell(123, '=A1+1'), C1: cell(123, '=1/0'),
    D1: cell(123, '=Missing!A1'), E1: cell(123, '=SUM(A1:B1)'), F1: cell(123, '=IF(TRUE,4,A1)'),
    G1: { value: '#N/A', dataType: 'e' }, H1: cell(123, '=SUM(G1:G1)')
  } }]);
  const result = Workbook.calculate(snapshot);
  for (const address of ['A1', 'B1', 'E1']) assert.equal(result.values.Errors[address], '#CYCLE!');
  assert.equal(result.values.Errors.C1, '#DIV/0!');
  assert.equal(result.values.Errors.D1, '#REF!');
  assert.equal(result.values.Errors.G1, '#N/A');
  assert.equal(result.values.Errors.H1, '#N/A');
  assert.equal(result.values.Errors.F1, 4);
  assert.equal(result.errors.length, 7);
  assert(result.errors.every(error => typeof error.message === 'string' && error.address && error.sheet === 'Errors'));
});

test('readonly formulas, malformed snapshots and unsupported formula syntax cannot execute code or silently bypass bounds', () => {
  const snapshot = book([{ name: 'Safe', cells: {
    A1: cell(1), B1: cell(999, '=SUM(A1:A1)'),
    C1: cell(999, '=EXEC("fictional")'), D1: cell(999, '=globalThis.process.exit()'),
    E1: cell(999, '=SUM(A1:XFD1048576)')
  } }]);
  assert.throws(() => Workbook.calculate(snapshot, { Safe: { B1: 42 } }), /read-only/);
  assert.throws(() => Workbook.calculate(snapshot, { Missing: { A1: 42 } }), /unknown sheet/);
  assert.throws(() => Workbook.calculate(snapshot, { Safe: { A1: {} } }), /invalid address or value/);
  assert.throws(() => Workbook.validateSnapshot(book([{ name: 'Bad', cells: { XFE1: cell(1) } }])), /Excel limits/);
  assert.throws(() => Workbook.validateSnapshot(book([{ name: 'Duplicate', cells: {} }, { name: 'duplicate', cells: {} }])), /unique/);
  assert.throws(() => Workbook.validateSnapshot(book([{ name: 'Table', cells: {}, tables: [{ name: 'BadTable', ref: 'A1:B3', columns: ['Only one'] }] }])), /dimensions/);
  const result = Workbook.calculate(snapshot, { Safe: { A1: '=1+2' } });
  assert.equal(result.values.Safe.A1, '=1+2', 'An edited text input is never parsed as a new formula.');
  assert.equal(result.values.Safe.B1, 0, 'SUM ignores text input in referenced cells.');
  assert.equal(result.values.Safe.C1, '#NAME?');
  assert.equal(result.values.Safe.D1, '#NAME?');
  assert.equal(result.values.Safe.E1, '#NUM!');
});

