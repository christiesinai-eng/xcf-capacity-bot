'use strict';
// Run with: node --test test/
// The "sheet" below is a small model of how Google Sheets applies spreadsheets.batchUpdate requests,
// so these tests prove the planner's output turns any old tab into any new one, in order.

const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/sheetSync');
const { buildTables, PIPELINE_TABS, S, N, B } = require('../src/sheetSchema');

const TYPES = [S, S, N, B];
const HEADERS = ['id', 'text', 'num', 'flag'];

// ── a model of one sheet tab ────────────────────────────────────────────────
class FakeTab {
  constructor(rows, grid) {
    this.cells = Array.from({ length: grid }, () => null);
    this.cells[0] = 'HEADER';
    rows.forEach((r, i) => { this.cells[1 + i] = r; });
  }
  get grid() { return this.cells.length; }
  apply(req) {
    if (req.appendDimension) {
      for (let i = 0; i < req.appendDimension.length; i++) this.cells.push(null);
    } else if (req.deleteDimension) {
      const { startIndex: s, endIndex: e } = req.deleteDimension.range;
      assert.ok(s >= 1, 'never delete the header');
      assert.ok(e <= this.cells.length, 'delete inside the grid');
      this.cells.splice(s, e - s);
    } else if (req.insertDimension) {
      const { startIndex: s, endIndex: e } = req.insertDimension.range;
      assert.ok(s >= 1, 'never insert above the header');
      assert.ok(s < this.cells.length, `insert at ${s} must fall inside the grid (${this.cells.length})`);
      this.cells.splice(s, 0, ...Array.from({ length: e - s }, () => null));
    } else if (req.updateCells) {
      const { start, rows } = req.updateCells;
      rows.forEach((row, i) => {
        assert.ok(this.cells[start.rowIndex + i] === null, 'only write into freshly inserted rows');
        this.cells[start.rowIndex + i] = row.values.map((c, k) => {
          const v = c.userEnteredValue;
          if (TYPES[k] === S) return v ? v.stringValue : '';
          if (TYPES[k] === N) return v ? v.numberValue : null;
          return v.boolValue;
        });
      });
    } else throw new Error('unknown request ' + Object.keys(req));
  }
  data() {
    const out = [];
    let i = 1;
    while (i < this.cells.length && this.cells[i] !== null) out.push(this.cells[i++]);
    for (; i < this.cells.length; i++) assert.equal(this.cells[i], null, 'no gaps inside the data');
    return out;
  }
}

const table = (rows) => ({ name: 'T', headers: HEADERS, types: TYPES, key: 0, rows });
const HEADER_CHARS = 'id'.length + 'text'.length; // the two text columns' headers

// A reproducible random generator.
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function randomRows(rand, n, vocab) {
  return Array.from({ length: n }, () => {
    const k = Math.floor(rand() * vocab);
    return [`id${k}`, k % 3 === 0 ? '' : `text ${k} with, commas "quotes" and\nnewlines`, k % 4 === 0 ? null : k / 4, k % 2 === 0];
  });
}

function runPlan(oldRows, newRows, grid, { known = true } = {}) {
  const tab = new FakeTab(oldRows, grid);
  const oldHashes = known ? oldRows.map(sync.hashRow) : null;
  const plan = sync.planTab(table(newRows), 7, grid, oldHashes, oldRows.length);
  let applied = 0;
  for (const batch of sync.batches(plan.requests)) for (const r of batch) { tab.apply(r); applied++; }
  return { tab, plan, applied };
}

test('runs groups consecutive numbers', () => {
  assert.deepEqual(sync.runs([1, 2, 3, 7, 9, 10]), [[1, 4], [7, 8], [9, 11]]);
  assert.deepEqual(sync.runs([]), []);
});

test('an unchanged tab needs no requests', () => {
  const rows = randomRows(rng(1), 20, 30);
  const { plan } = runPlan(rows, rows, 100);
  assert.equal(plan.action, 'none');
  assert.deepEqual(plan.requests, []);
});

test('one changed row is one delete and one insert', () => {
  const rows = randomRows(rng(2), 50, 1000);
  const next = rows.map((r) => r.slice());
  next[20][2] = 99.5;
  const { tab, plan } = runPlan(rows, next, 200);
  assert.deepEqual(tab.data(), next);
  assert.equal(plan.deleted, 1);
  assert.equal(plan.inserted, 1);
});

test('fuzz: any old tab becomes any new tab, in order, with spare rows left', () => {
  const rand = rng(42);
  for (let round = 0; round < 400; round++) {
    const vocab = [3, 8, 30, 500][round % 4];
    const oldRows = randomRows(rand, Math.floor(rand() * 60), vocab);
    // The new tab keeps most of the old rows, in order, with random removals, edits and additions.
    let next = oldRows.filter(() => rand() > 0.2).map((r) => r.slice());
    next = next.map((r) => { if (rand() < 0.1) r = [r[0], 'edited', r[2], !r[3]]; return r; });
    for (let k = Math.floor(rand() * 10); k > 0; k--) next.splice(Math.floor(rand() * (next.length + 1)), 0, ...randomRows(rand, 1 + Math.floor(rand() * 3), vocab));
    if (rand() < 0.1) next = randomRows(rand, Math.floor(rand() * 40), vocab);
    const grid = [1000, 1 + oldRows.length + 2, 1 + oldRows.length][round % 3];
    const { tab } = runPlan(oldRows, next, grid);
    assert.deepEqual(tab.data(), next, `round ${round}`);
    assert.ok(tab.grid - (1 + next.length) >= sync.MIN_TRAILING_BLANK_ROWS, `spare rows after round ${round}`);
  }
});

test('an unknown sheet is cleared and rewritten', () => {
  const rand = rng(7);
  const oldRows = randomRows(rand, 30, 50); // whatever is in the sheet, we do not know it
  const next = randomRows(rand, 45, 50);
  const { tab, plan } = runPlan(oldRows, next, 1000, { known: false });
  assert.equal(plan.action, 'rewrite');
  assert.deepEqual(tab.data(), next);
});

test('a big rewrite is split into calls, each a sensible size, and still applies in order', () => {
  const rand = rng(9);
  const next = Array.from({ length: 400 }, (_, i) => [`id${i}`, 'x'.repeat(200) + i, i, i % 2 === 0]);
  const plan = sync.planTab(table(next), 7, 1000, [], 0);
  const calls = sync.batches(plan.requests);
  assert.ok(calls.length > 3, 'split into several calls');
  for (const c of calls) assert.ok(JSON.stringify(c).length < 40000, 'each call stays small');
  const tab = new FakeTab([], 1000);
  for (const c of calls) for (const r of c) tab.apply(r);
  assert.deepEqual(tab.data(), next);
  void rand;
});

test('expected checks match what is in the sheet', () => {
  const rows = [['a', 'héllo', 1.5, true], ['b', '', null, false], ['c', 'line\nbreak', 2, true]];
  const e = sync.expectedChecks(table(rows));
  assert.deepEqual(e, { rows: 3, textChars: HEADER_CHARS + 1 + 5 + 1 + 0 + 1 + 10, numSum: 3.5, trueCount: 2 });
});

test('checks formulas cover every column of every tab, by column letter', () => {
  const f = sync.checksFormulas();
  assert.deepEqual(f[0], ['tab', 'rows', 'text_chars', 'num_sum', 'true_count']);
  assert.equal(f.length, PIPELINE_TABS.length + 1);
  const tasks = f.find((r) => r[0] === 'Tasks');
  assert.equal(tasks[1], "=COUNTA('Tasks'!A:A)-1");
  assert.equal(tasks[2], '=' + 'ABCDEF'.split('').map((c) => `SUMPRODUCT(LEN('Tasks'!${c}:${c}))`).join('+'));
  assert.equal(tasks[3], "=SUM('Tasks'!G:G)");
  assert.equal(tasks[4], "=COUNTIF('Tasks'!H:H,TRUE)");
  const meta = f.find((r) => r[0] === 'Regional_Meta');
  assert.equal(meta[4], '=0');
});

test('observed checks parse from a get_values reply, with thousands separators', () => {
  const obs = sync.parseObservedChecks({ values: [['tab', 'rows'], ['Tasks', '242', '12,345', '71.5', '3']] });
  assert.deepEqual(obs.Tasks, { rows: 242, textChars: 12345, numSum: 71.5, trueCount: 3 });
  assert.ok(sync.checksMatch({ rows: 242, textChars: 12345, numSum: 71.5000001, trueCount: 3 }, obs.Tasks));
  assert.ok(!sync.checksMatch({ rows: 243, textChars: 12345, numSum: 71.5, trueCount: 3 }, obs.Tasks));
  assert.ok(!sync.checksMatch({ rows: 242, textChars: 12345, numSum: 71.5, trueCount: 3 }, undefined));
});

test('a tab whose sheet no longer matches what we wrote is rewritten', () => {
  const rows = [['a', 'x', 1, true], ['b', 'y', 2, false]];
  const state = { sheets: {} };
  const tables = { T: table(rows) };
  const st = { sheetId: 7, grid: 1000, hashes: rows.map(sync.hashRow), expected: sync.expectedChecks(table(rows)) };
  state.sheets.T = st;
  // sheet matches: nothing to do
  let plans = sync.planAll(tables, state, { T: { ...st.expected } });
  assert.equal(plans.T.action, 'none');
  // someone edited a cell in the sheet: character count differs, so rewrite using the observed row count
  plans = sync.planAll(tables, state, { T: { ...st.expected, textChars: st.expected.textChars + 3, rows: 2 } });
  assert.equal(plans.T.action, 'rewrite');
  // flagged dirty by a failed verify
  state.sheets.T = { ...st, dirty: true };
  plans = sync.planAll(tables, state, null);
  assert.equal(plans.T.action, 'rewrite');
});

test('buildTables normalises types and leaves manual leave to the OOO_Manual tab', () => {
  const t = buildTables({
    members: [{ name: 'Ada', pod: 'Design', ooo: false, today: 1, week: 2, month: 3, qualifying: 1, missing: 0, overdue: 0,
      tasks: [{ name: 'Task', due: '2026-10-30', est: 4, proj: '', th: 1, wh: 2 }, { name: 'Late', due: '2026-10-01', est: 2, proj: 'XCF-1', overdue: true }] }],
    oooData: [
      { name: 'Ada', pod: 'Design', start: '2026-11-01', end: '2026-11-05', source: 'asana' },
      { name: 'Bo', pod: 'Design', start: '2026-07-01', end: '2027-07-31', source: 'manual' },
      { name: 'Cy', pod: 'Design', stub: true },
    ],
    roadmapData: [{ name: 'R', url: 'u', pmName: 'P', completed: false, dropped: false, regions: ['MY', 'RoAsia (ID, PH, HK)'], subtasks: [{ name: 's', start_on: null, due_on: '2026-12-01' }] }],
    requestsData: [{ gid: '1219962096154488', code: 'XCF-1', name: 'n', regions: [], comments: [{ author: 'A', at: 't', text: 'see https://canva.com/x now' }], matched: false, isRealStart: false, durationHours: null, commentCount: 1 }],
  });
  assert.deepEqual(t.Tasks.rows[0], ['Ada', 'Design', 'Task', '', '', '2026-10-30', 4, false]);
  assert.deepEqual(t.Tasks.rows[1], ['Ada', 'Design', 'Late', 'XCF-1', '', '2026-10-01', 2, true]);
  assert.equal(t.OOO.rows.length, 2, 'manual rows are not repeated in OOO');
  assert.deepEqual(t.OOO.rows[1], ['Cy', 'Design', '', '', '', true]);
  assert.equal(t.Roadmap.rows[0][5], 'MY; RoAsia (ID, PH, HK)');
  assert.equal(t.Roadmap_Subtasks.rows[0][3], '');
  assert.equal(t.Requests.rows[0][0], '1219962096154488', 'ids stay text');
  assert.equal(t.Requests.rows[0][19], null, 'a missing number is empty, not 0');
  assert.equal(t.Request_Comments.rows[0][4], 'see now', 'external links are stripped as in the report');
});

test('every pipeline tab builds from an empty report without throwing', () => {
  const t = buildTables({});
  assert.equal(Object.keys(t).length, PIPELINE_TABS.length);
  for (const tab of Object.values(t)) assert.deepEqual(tab.rows, []);
});

// ── safeguards: never publish a bad fetch ───────────────────────────────────
function guardFixture(oldCount, newCount) {
  const mk = (n) => Array.from({ length: n }, (_, i) => [`id${i}`, `t${i}`, i, false]);
  const oldRows = mk(oldCount);
  const t = { ...table(mk(newCount)), source: 'requestsData' };
  const st = { sheetId: 7, grid: 1000, hashes: oldRows.map(sync.hashRow), expected: sync.expectedChecks(table(oldRows)) };
  return { tables: { T: t }, state: { sheets: { T: st } }, st };
}

test('a dataset that failed to build leaves its tab untouched', () => {
  const { tables, state, st } = guardFixture(50, 0);
  const plans = sync.planAll(tables, state, null, { failures: ['requestsData'] });
  assert.equal(plans.T.action, 'skipped');
  assert.deepEqual(plans.T.requests, []);
  assert.deepEqual(plans.T.newHashes, st.hashes, 'state is carried over, so verify still checks the old rows');
  assert.deepEqual(plans.T.expected, st.expected);
});

test('a tab that would lose more than half its rows is held back unless forced', () => {
  let { tables, state } = guardFixture(100, 30);
  assert.equal(sync.planAll(tables, state, null).T.action, 'skipped');
  assert.equal(sync.planAll(tables, state, null, { forceShrink: ['T'] }).T.action, 'incremental');
  ({ tables, state } = guardFixture(100, 60));
  assert.equal(sync.planAll(tables, state, null).T.action, 'incremental', 'a normal drop goes through');
  ({ tables, state } = guardFixture(10, 0));
  assert.equal(sync.planAll(tables, state, null).T.action, 'incremental', 'small tabs may empty out');
});

test('notes: only summaries that are not yet in the sheet are added, and nothing already there is touched', () => {
  const cache = { requests: {
    1001: { code: 'XCF-1', summary: 'New summary', cause: 'No blocker', causedAt: '2026-10-28' },
    1002: { code: 'XCF-2', summary: 'Already in the sheet', cause: 'x', causedAt: '2026-10-27' },
    1003: { code: 'XCF-3', summary: null, cause: null, causedAt: null },
  } };
  const slack = [{ weekStart: '2026-10-19', weekLabel: '23 Oct', executiveSummary: 'Week text' }, { weekStart: '2026-10-12', weekLabel: '16 Oct' }];
  assert.deepEqual(sync.notesToAdd(cache, slack, ['1002']), [
    ['request', '1001', 'XCF-1', 'New summary', 'No blocker', '2026-10-28'],
    ['week', '2026-10-19', '23 Oct', 'Week text', '', ''],
  ]);
  assert.deepEqual(sync.notesToAdd(cache, slack, ['1001', '1002', '2026-10-19']), []);
});

test('tabs another writer owns can be left out of the plan, and a wrong name is an error', () => {
  const tables = { A: table([]), B: table([]), C: table([]) };
  const log = console.log;
  console.log = () => {};
  try {
    assert.deepEqual(Object.keys(sync.dropTabs(tables, ['B'])), ['A', 'C']);
    assert.deepEqual(Object.keys(sync.dropTabs(tables, [])), ['A', 'B', 'C']);
    assert.throws(() => sync.dropTabs(tables, ['Nope']), /not a tab the sync writes/);
  } finally { console.log = log; }
});
