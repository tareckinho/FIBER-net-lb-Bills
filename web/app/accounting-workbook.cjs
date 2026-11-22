'use strict';

// A small, read-only Excel evaluator for the copied workbook's actual formula
// language. It never executes JavaScript or uses cached formula results.
const FUNCTIONS = Object.freeze(['IF', 'SUMIF', 'SUM', 'SUBTOTAL']);
const MAX_CELLS = 300000, MAX_RANGE = 100000, MAX_OPERATIONS = 20000000;
const ERROR_CODES = new Set(['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#CYCLE!']);
const RANGE = Symbol('workbook-range');
class FormulaError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new FormulaError(code, message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function columnNumber(name) {
  let result = 0;
  for (const char of name.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}
function columnName(index) {
  let result = '';
  while (index > 0) { index--; result = String.fromCharCode(65 + index % 26) + result; index = Math.floor(index / 26); }
  return result;
}
function addressParts(address) {
  const match = typeof address === 'string' && /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(address);
  if (!match) fail('#REF!', 'Invalid cell address.');
  const col = columnNumber(match[1]), row = Number(match[2]);
  if (col > 16384 || row > 1048576) fail('#REF!', 'A cell reference is outside Excel limits.');
  return { row, col, address: columnName(col) + row };
}
function rectangle(ref) {
  if (typeof ref !== 'string') fail('#REF!', 'A table requires a valid cell range.');
  const pieces = ref.split(':');
  if (pieces.length > 2) fail('#REF!', 'Invalid cell range.');
  const a = addressParts(pieces[0]), b = addressParts(pieces[1] ?? pieces[0]);
  return { r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) };
}
function scalar(value) {
  return value === null || typeof value === 'string' && value.length <= 32767 ||
    typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
}
function validRowList(rows) {
  return rows === undefined || Array.isArray(rows) && rows.length <= 1048576 && rows.every(row => Number.isSafeInteger(row) && row >= 1 && row <= 1048576);
}
function validateSnapshot(snapshot) {
  if (!plain(snapshot) || !Array.isArray(snapshot.sheets) || !snapshot.sheets.length || snapshot.sheets.length > 100) throw Error('Choose a bounded workbook snapshot with named sheets.');
  const names = new Set(), tables = new Set(); let count = 0;
  for (const sheet of snapshot.sheets) {
    if (!plain(sheet) || typeof sheet.name !== 'string' || !sheet.name || sheet.name.length > 31 ||
        /[\u0000-\u001f\u007f]/.test(sheet.name) || names.has(sheet.name.toLowerCase()) || !plain(sheet.cells)) throw Error('Workbook sheet names and cells must be unique and valid.');
    names.add(sheet.name.toLowerCase());
    if (!validRowList(sheet.hiddenRows) || !validRowList(sheet.filteredRows)) throw Error('Workbook row visibility must use valid row numbers.');
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (++count > MAX_CELLS) throw Error('The workbook snapshot exceeds the supported populated-cell capacity.');
      if (addressParts(address).address !== address || !plain(cell) || cell.value !== undefined && !scalar(cell.value) ||
          cell.formula !== undefined && (typeof cell.formula !== 'string' || !cell.formula.trim() || cell.formula.length > 16384)) throw Error('A workbook cell has an invalid address, value or formula.');
      if (cell.error !== undefined && !ERROR_CODES.has(cell.error)) throw Error('A workbook cell has an unsupported error code.');
    }
    if (sheet.tables !== undefined && (!Array.isArray(sheet.tables) || sheet.tables.length > 2000)) throw Error('Workbook tables must be a bounded list.');
    for (const table of sheet.tables ?? []) {
      if (!plain(table) || typeof table.name !== 'string' || !/^[A-Za-z_\\][A-Za-z0-9_.\\]{0,254}$/.test(table.name) || tables.has(table.name.toLowerCase()) ||
          !Array.isArray(table.columns) || table.columns.some(name => typeof name !== 'string' || !name || name.length > 255) ||
          new Set(table.columns.map(name => name.toLowerCase())).size !== table.columns.length) throw Error('Workbook table names and columns must be unique and valid.');
      tables.add(table.name.toLowerCase());
      const box = rectangle(table.ref), headers = table.headerRowCount ?? 1;
      const totals = table.totalsRowCount ?? (table.totalsRowShown === true ? 1 : 0);
      if (![0, 1].includes(headers) || ![0, 1].includes(totals) || table.columns.length !== box.c2 - box.c1 + 1 || headers + totals > box.r2 - box.r1 + 1) throw Error('Workbook table dimensions do not match their columns and header/total rows.');
    }
  }
  return snapshot;
}

class Parser {
  constructor(formula) {
    this.source = formula.trim().replace(/^=/, '');
    this.tokens = []; this.index = 0; this.depth = 0;
    this.lex();
  }
  lex() {
    const source = this.source; let at = 0;
    const push = token => { if (this.tokens.length >= 4096) fail('#NUM!', 'The formula exceeds the supported token limit.'); this.tokens.push(token); };
    const brackets = start => {
      let depth = 0, end = start;
      for (; end < source.length; end++) {
        if (source[end] === '[') depth++;
        if (source[end] === ']' && --depth === 0) return end + 1;
      }
      fail('#VALUE!', 'Unclosed structured table reference.');
    };
    while (at < source.length) {
      if (/\s/.test(source[at])) { at++; continue; }
      const char = source[at];
      if (char === '"' || char === "'") {
        const quote = char; let value = '', closed = false; at++;
        while (at < source.length) {
          if (source[at] === quote) {
            if (source[at + 1] === quote) { value += quote; at += 2; continue; }
            at++; closed = true; break;
          }
          value += source[at++];
        }
        if (!closed) fail('#VALUE!', 'Unclosed formula string or sheet name.');
        push({ type: quote === '"' ? 'literal' : 'name', value }); continue;
      }
      const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(source.slice(at));
      if (number) {
        const value = Number(number[0]); if (!Number.isFinite(value)) fail('#NUM!', 'A formula number is outside the supported range.');
        push({ type: 'literal', value }); at += number[0].length; continue;
      }
      const name = /^\$?[A-Za-z_\\][A-Za-z0-9_.$\\]*/.exec(source.slice(at));
      if (name) {
        at += name[0].length; let next = at;
        while (/\s/.test(source[next] ?? '') && next < source.length) next++;
        if (source[next] === '[') { const end = brackets(next); push({ type: 'structured', table: name[0], value: source.slice(next, end) }); at = end; }
        else push({ type: 'name', value: name[0] });
        continue;
      }
      if (char === '[') { const end = brackets(at); push({ type: 'structured', table: null, value: source.slice(at, end) }); at = end; continue; }
      const op = ['<>', '<=', '>='].find(value => source.startsWith(value, at));
      if (op) { push({ type: op }); at += op.length; continue; }
      if ('+-*/()!,=:<>'.includes(char)) { push({ type: char }); at++; continue; }
      fail('#NAME?', 'This formula contains an unsupported token.');
    }
    push({ type: 'end' });
  }
  peek(type) { return this.tokens[this.index].type === type; }
  take(type) {
    if (!this.peek(type)) fail('#VALUE!', 'Unexpected formula syntax.');
    return this.tokens[this.index++];
  }
  parse() {
    const result = this.expression(); this.take('end'); return result;
  }
  expression() {
    if (++this.depth > 128) fail('#NUM!', 'The formula nesting exceeds the supported limit.');
    try {
      let node = this.addition();
      while (['=', '<>', '<', '>', '<=', '>='].includes(this.tokens[this.index].type)) {
        const op = this.tokens[this.index++].type; node = { type: 'binary', op, left: node, right: this.addition() };
      }
      return node;
    } finally { this.depth--; }
  }
  addition() {
    let node = this.multiplication();
    while (this.peek('+') || this.peek('-')) {
      const op = this.tokens[this.index++].type; node = { type: 'binary', op, left: node, right: this.multiplication() };
    }
    return node;
  }
  multiplication() {
    let node = this.unary();
    while (this.peek('*') || this.peek('/')) {
      const op = this.tokens[this.index++].type; node = { type: 'binary', op, left: node, right: this.unary() };
    }
    return node;
  }
  unary() {
    let negative = false;
    while (this.peek('+') || this.peek('-')) { if (this.tokens[this.index++].type === '-') negative = !negative; }
    const node = this.primary(); return negative ? { type: 'unary', value: node } : node;
  }
  primary() {
    if (this.peek('literal')) return { type: 'literal', value: this.take('literal').value };
    if (this.peek('(')) { this.take('('); const result = this.expression(); this.take(')'); return result; }
    if (this.peek('structured')) {
      const token = this.take('structured'); let match;
      if ((match = /^\[\[#This Row\],\[(.*)\]\]$/i.exec(token.value))) return { type: 'structured', table: token.table, column: match[1], thisRow: true };
      if ((match = /^\[@([^\[\]]+)\]$/.exec(token.value))) return { type: 'structured', table: token.table, column: match[1], thisRow: true };
      if ((match = /^\[([^\[\]]+)\]$/.exec(token.value))) return { type: 'structured', table: token.table, column: match[1], thisRow: false };
      fail('#REF!', 'This structured table reference is unsupported.');
    }
    if (!this.peek('name')) fail('#VALUE!', 'A formula value was expected.');
    const name = this.take('name').value;
    if (this.peek('(')) {
      this.take('('); const args = [];
      if (!this.peek(')')) do {
        if (args.length >= 255) fail('#NUM!', 'Too many formula arguments.');
        args.push(this.expression());
        if (!this.peek(',')) break;
        this.take(',');
      } while (true);
      this.take(')'); return { type: 'call', name: name.toUpperCase(), args };
    }
    let sheet = null, ref = name;
    if (this.peek('!')) { this.take('!'); sheet = name; ref = this.take('name').value; }
    if (/^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/.test(ref)) {
      const first = addressParts(ref).address;
      if (this.peek(':')) { this.take(':'); return { type: 'range', sheet, ref: first + ':' + addressParts(this.take('name').value).address }; }
      return { type: 'ref', sheet, address: first };
    }
    if (sheet === null && ['TRUE', 'FALSE'].includes(name.toUpperCase())) return { type: 'literal', value: name.toUpperCase() === 'TRUE' };
    fail('#NAME?', 'An unknown named reference appears in the formula.');
  }
}
function number(value) {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value.trim())) {
    const n = Number(value); if (Number.isFinite(n)) return n;
  }
  return fail('#VALUE!', 'Text or a range cannot be used as a numeric value.');
}
function compare(left, right) {
  if (left === null) left = typeof right === 'string' ? '' : typeof right === 'boolean' ? false : 0;
  if (right === null) right = typeof left === 'string' ? '' : typeof left === 'boolean' ? false : 0;
  if (typeof left === typeof right) {
    if (typeof left === 'string') { left = left.toLowerCase(); right = right.toLowerCase(); }
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const rank = value => typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;
  return rank(left) < rank(right) ? -1 : 1;
}
function truth(value) {
  if (value === null || value === '') return false;
  if (typeof value === 'number' || typeof value === 'boolean') return Boolean(value);
  if (typeof value === 'string' && /^(?:TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE';
  return fail('#VALUE!', 'IF needs a logical value.');
}
function containsSubtotal(node) {
  return node.type === 'call' && (node.name === 'SUBTOTAL' || node.args.some(containsSubtotal)) ||
    node.type === 'binary' && (containsSubtotal(node.left) || containsSubtotal(node.right)) ||
    node.type === 'unary' && containsSubtotal(node.value);
}
class Engine {
  constructor(snapshot, overrides) {
    this.sheets = new Map(); this.tables = new Map(); this.cache = new Map(); this.compiled = new Map(); this.active = new Set(); this.operations = 0;
    for (const source of snapshot.sheets) {
      const sheet = { ...source, cells: { ...source.cells }, hidden: new Set(source.hiddenRows ?? []), filtered: new Set(source.filteredRows ?? []) };
      this.sheets.set(source.name.toLowerCase(), sheet);
      for (const table of source.tables ?? []) {
        const box = rectangle(table.ref), headers = table.headerRowCount ?? 1, totals = table.totalsRowCount ?? (table.totalsRowShown === true ? 1 : 0);
        this.tables.set(table.name.toLowerCase(), { ...table, sheet, ...box, firstRow: box.r1 + headers, lastRow: box.r2 - totals });
      }
    }
    if (!plain(overrides)) throw Error('Workbook cell overrides must be grouped by sheet name.');
    let count = 0;
    for (const [name, cells] of Object.entries(overrides)) {
      const sheet = this.sheets.get(name.toLowerCase());
      if (!sheet || !plain(cells)) throw Error('A cell override refers to an unknown sheet.');
      for (const [address, value] of Object.entries(cells)) {
        if (++count > 20000 || addressParts(address).address !== address || !scalar(value)) throw Error('A cell override has an invalid address or value.');
        if (sheet.cells[address]?.formula !== undefined) throw Error('Formula cells are read-only; edit their original inputs instead.');
        sheet.cells[address] = { ...sheet.cells[address], value, error: undefined, dataType: undefined };
      }
    }
  }
  step() { if (++this.operations > MAX_OPERATIONS) fail('#NUM!', 'The workbook calculation exceeds the supported operation capacity.'); }
  sheet(name) {
    const result = this.sheets.get(name.toLowerCase());
    if (!result) fail('#REF!', 'A referenced sheet does not exist.');
    return result;
  }
  ast(sheet, address) {
    const key = sheet.name + '\u0000' + address;
    if (!this.compiled.has(key)) this.compiled.set(key, new Parser(sheet.cells[address].formula).parse());
    return this.compiled.get(key);
  }
  cell(sheet, address) {
    this.step(); const key = sheet.name + '\u0000' + address;
    if (this.cache.has(key)) { const saved = this.cache.get(key); if (saved.error) throw saved.error; return saved.value; }
    if (this.active.has(key)) fail('#CYCLE!', 'A circular formula reference was found.');
    this.active.add(key);
    try {
      const cell = sheet.cells[address]; let value = cell?.value ?? null;
      if (cell?.error || cell?.dataType === 'e') fail(cell.error ?? (ERROR_CODES.has(value) ? value : '#VALUE!'), 'The source cell contains an Excel error.');
      if (cell?.formula !== undefined) value = this.evaluate(this.ast(sheet, address), { sheet, address, ...addressParts(address) });
      if (value?.[RANGE]) fail('#VALUE!', 'A formula returned a range where one value is required.');
      if (cell?.formula !== undefined && value === null) value = 0;
      if (typeof value === 'number' && !Number.isFinite(value)) fail('#NUM!', 'A calculated result is not finite.');
      if (Object.is(value, -0)) value = 0;
      this.cache.set(key, { value }); return value;
    } catch (error) {
      const failure = error instanceof FormulaError ? error : new FormulaError('#VALUE!', 'The formula could not be calculated.');
      this.cache.set(key, { error: failure }); throw failure;
    } finally { this.active.delete(key); }
  }
  range(sheet, ref) {
    const box = rectangle(ref), size = (box.r2 - box.r1 + 1) * (box.c2 - box.c1 + 1);
    if (size > MAX_RANGE) fail('#NUM!', 'A formula range exceeds the supported size.');
    return { [RANGE]: true, sheet, ...box };
  }
  structured(node, context) {
    let table;
    if (node.table) table = this.tables.get(node.table.toLowerCase());
    else table = [...this.tables.values()].find(t => t.sheet === context.sheet && context.row >= t.firstRow && context.row <= t.lastRow && context.col >= t.c1 && context.col <= t.c2);
    if (!table) fail('#REF!', 'A structured reference has no original table.');
    const offset = table.columns.findIndex(name => name.toLowerCase() === node.column.toLowerCase());
    if (offset < 0) fail('#REF!', 'A referenced table column does not exist.');
    const col = table.c1 + offset;
    if (node.thisRow) {
      if (table.sheet !== context.sheet || context.row < table.firstRow || context.row > table.lastRow) fail('#VALUE!', 'This Row is outside the original table data.');
      return this.cell(table.sheet, columnName(col) + context.row);
    }
    if (table.firstRow > table.lastRow) return { [RANGE]: true, sheet: table.sheet, r1: 1, r2: 0, c1: col, c2: col };
    return this.range(table.sheet, columnName(col) + table.firstRow + ':' + columnName(col) + table.lastRow);
  }
  evaluate(node, context) {
    this.step();
    if (node.type === 'literal') return node.value;
    if (node.type === 'ref') return this.cell(node.sheet === null ? context.sheet : this.sheet(node.sheet), node.address);
    if (node.type === 'range') return this.range(node.sheet === null ? context.sheet : this.sheet(node.sheet), node.ref);
    if (node.type === 'structured') return this.structured(node, context);
    if (node.type === 'unary') return -number(this.evaluate(node.value, context));
    if (node.type === 'binary') {
      const left = this.evaluate(node.left, context), right = this.evaluate(node.right, context);
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        if (left?.[RANGE] || right?.[RANGE]) fail('#VALUE!', 'Range comparisons are unsupported.');
        const order = compare(left, right);
        return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[node.op];
      }
      const a = number(left), b = number(right);
      if (node.op === '/' && b === 0) fail('#DIV/0!', 'A formula divides by zero.');
      const result = node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : a / b;
      if (!Number.isFinite(result)) fail('#NUM!', 'A calculated number exceeds the supported range.');
      return result;
    }
    if (node.type === 'call') return this.call(node, context);
    return fail('#NAME?', 'Unknown formula expression.');
  }
  *positions(range) {
    for (let row = range.r1; row <= range.r2; row++) for (let col = range.c1; col <= range.c2; col++) {
      this.step(); yield { row, col, address: columnName(col) + row };
    }
  }
  sumArgument(value, subtotal) {
    if (!value?.[RANGE]) return value === null ? 0 : number(value);
    let total = 0;
    for (const position of this.positions(value)) {
      if (subtotal && (value.sheet.filtered.has(position.row) || subtotal === 109 && value.sheet.hidden.has(position.row))) continue;
      if (subtotal && value.sheet.cells[position.address]?.formula !== undefined && containsSubtotal(this.ast(value.sheet, position.address))) continue;
      const item = this.cell(value.sheet, position.address);
      if (typeof item === 'number') total += item;
    }
    return total;
  }
  wildcard(pattern, value) {
    const tokens = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '~' && i + 1 < pattern.length) tokens.push({ char: pattern[++i] });
      else if (pattern[i] === '*') { if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' }); }
      else if (pattern[i] === '?') tokens.push({ kind: 'any' });
      else tokens.push({ char: pattern[i] });
    }
    let p = 0, s = 0, star = -1, resume = 0;
    while (s < value.length) {
      this.step();
      if (tokens[p]?.kind === 'any' || tokens[p]?.char === value[s]) { p++; s++; }
      else if (tokens[p]?.kind === 'star') { star = p++; resume = s; }
      else if (star >= 0) { p = star + 1; s = ++resume; }
      else return false;
    }
    while (tokens[p]?.kind === 'star') p++;
    return p === tokens.length;
  }
  matches(value, criterion) {
    this.step();
    if (criterion === null) criterion = 0;
    if (typeof criterion !== 'string') return compare(value, criterion) === 0;
    const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criterion), op = match?.[1] ?? '=', target = match?.[2] ?? criterion;
    if (target.length > 1000) fail('#VALUE!', 'A SUMIF criterion is too long.');
    if (['=', '<>'].includes(op) && /[*?~]/.test(target)) {
      const equal = typeof value === 'string' && this.wildcard(target.toLowerCase(), value.toLowerCase());
      return op === '=' ? equal : !equal;
    }
    let expected = target, candidate = value;
    if (target.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(target.trim())) {
      expected = Number(target);
      if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) candidate = Number(candidate);
    }
    const order = compare(candidate, expected);
    return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[op];
  }
  call(node, context) {
    if (!FUNCTIONS.includes(node.name)) fail('#NAME?', 'Unsupported workbook function ' + node.name + '.');
    const args = node.args;
    if (node.name === 'IF') {
      if (args.length < 2 || args.length > 3) fail('#VALUE!', 'IF expects two or three arguments.');
      return truth(this.evaluate(args[0], context)) ? this.evaluate(args[1], context) : args[2] ? this.evaluate(args[2], context) : false;
    }
    if (node.name === 'SUMIF') {
      if (args.length < 2 || args.length > 3) fail('#VALUE!', 'SUMIF expects two or three arguments.');
      const range = this.evaluate(args[0], context), criterion = this.evaluate(args[1], context);
      const sumRange = args[2] ? this.evaluate(args[2], context) : range;
      if (!range?.[RANGE] || !sumRange?.[RANGE] || criterion?.[RANGE]) fail('#VALUE!', 'SUMIF expects cell ranges and one criterion.');
      if (sumRange.r1 + range.r2 - range.r1 > 1048576 || sumRange.c1 + range.c2 - range.c1 > 16384) fail('#REF!', 'A SUMIF sum range leaves the sheet.');
      let total = 0;
      for (const position of this.positions(range)) {
        if (this.matches(this.cell(range.sheet, position.address), criterion)) {
          const value = this.cell(sumRange.sheet, columnName(sumRange.c1 + position.col - range.c1) + (sumRange.r1 + position.row - range.r1));
          if (typeof value === 'number') total += value;
        }
      }
      return total;
    }
    let subtotal = null, start = 0;
    if (node.name === 'SUBTOTAL') {
      if (args.length < 2) fail('#VALUE!', 'SUBTOTAL expects a function number and ranges.');
      subtotal = number(this.evaluate(args[0], context));
      if (![9, 109].includes(subtotal)) fail('#VALUE!', 'Only the workbook sum SUBTOTAL functions 9 and 109 are supported.');
      start = 1;
    }
    let total = 0;
    for (let index = start; index < args.length; index++) total += this.sumArgument(this.evaluate(args[index], context), subtotal);
    return total;
  }
}
function calculate(snapshot, cellOverrides = {}) {
  validateSnapshot(snapshot);
  const engine = new Engine(snapshot, cellOverrides), values = Object.create(null), errors = [];
  for (const sheet of engine.sheets.values()) {
    const result = Object.create(null); values[sheet.name] = result;
    for (const address of Object.keys(sheet.cells)) {
      try { result[address] = engine.cell(sheet, address); }
      catch (error) {
        const code = error instanceof FormulaError ? error.code : '#VALUE!';
        result[address] = code; errors.push({ sheet: sheet.name, address, code, message: error.message });
      }
    }
  }
  return { values, errors, supportedFunctions: [...FUNCTIONS] };
}
module.exports = { validateSnapshot, calculate, supportedFunctions: FUNCTIONS, columnNumber, columnName };
