'use strict';
// Keeps the Google Sheet "XCF Lighthouse - Dashboard Data" in step with the build.
//
// The build computes the datasets. This module turns them into tab rows, compares them with what
// the sheet already holds, and writes the smallest set of row deletions and insertions that makes
// the sheet match, as ready-to-send `spreadsheets.batchUpdate` requests. It never talks to Google
// itself: the requests are applied by whatever has access (the Sheets connector in a Claude session
// today), and the sheet's own Checks tab proves afterwards that the write landed.
//
//   node src/sheetSync.js plan   [--data file] [--checks file] [--skip Tab,Tab] [--force-shrink Tab]
//                                                                  decide what to write
//   node src/sheetSync.js verify <checks file>                   confirm it landed, then remember it
//   node src/sheetSync.js setup                                  one-off: Checks + Sync_Log tabs
//   node src/sheetSync.js meta <get_spreadsheet file>            learn tab ids and grid sizes
//   node src/sheetSync.js notes <Notes key column file>        copy new summaries from the caches into Notes
//   node src/sheetSync.js status
//
// Rows are matched by content, so a changed task is one deleted row plus one inserted row, and the
// sheet always ends up in exactly the order the build produced.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PIPELINE_TABS, buildTables, S, N, B } = require('./sheetSchema');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SPREADSHEET_ID = '1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U';
const STATE_PATH = path.join(ROOT, 'sheet-sync-state.json');
const OUT_DIR = path.join(ROOT, 'sheet-sync');
const MIN_TRAILING_BLANK_ROWS = 20; // keeps room so insertDimension never lands past the end of the grid
const MAX_BATCH_CHARS = 28000;      // one update_spreadsheet call; small enough to carry in a single tool call
const MAX_LCS_CELLS = 40e6;         // beyond this, rewrite the tab instead of diffing it
const NUM_TOLERANCE = 1e-6;
const SHRINK_GUARD_MIN_ROWS = 20;   // a tab this big losing more than half its rows is held back

// ───────────────────────────── helpers ─────────────────────────────────────────

const hashRow = (row) => crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 12);

function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// What the sheet's Checks tab will report for these rows (see checksFormulas). The Checks formulas read
// whole columns, so that a row inserted at the top of a tab cannot push the first data row out of range;
// whole columns include the header row, hence the header terms below.
function expectedChecks(table) {
  const { rows, types, key, headers } = table;
  let textChars = 0;
  let numSum = 0;
  let trueCount = 0;
  let counted = 0;
  headers.forEach((h, i) => { if (types[i] === S) textChars += h.length; });
  for (const r of rows) {
    if (r[key] !== '' && r[key] !== null) counted++;
    r.forEach((v, i) => {
      if (types[i] === S) textChars += v.length;
      else if (types[i] === N) numSum += v === null ? 0 : v;
      else if (v === true) trueCount++;
    });
  }
  return { rows: counted, textChars, numSum, trueCount };
}

// Longest common subsequence of two hash lists. Returns the old / new positions that are NOT shared.
function diffRows(oldH, newH) {
  let head = 0;
  while (head < oldH.length && head < newH.length && oldH[head] === newH[head]) head++;
  let tail = 0;
  while (tail < oldH.length - head && tail < newH.length - head && oldH[oldH.length - 1 - tail] === newH[newH.length - 1 - tail]) tail++;
  const a = oldH.slice(head, oldH.length - tail);
  const b = newH.slice(head, newH.length - tail);
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS) return null;

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keptOld = new Set();
  const keptNew = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keptOld.add(i); keptNew.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const del = [];
  const ins = [];
  for (let k = 0; k < n; k++) if (!keptOld.has(k)) del.push(head + k);
  for (let k = 0; k < m; k++) if (!keptNew.has(k)) ins.push(head + k);
  return { del, ins };
}

// Consecutive integers → [start, end) runs.
function runs(sorted) {
  const out = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === x) last[1] = x + 1;
    else out.push([x, x + 1]);
  }
  return out;
}

function apiCell(v, type) {
  if (type === S) return v === '' ? {} : { userEnteredValue: { stringValue: v } };
  if (type === N) return v === null ? {} : { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { boolValue: v } };
}

const apiRows = (rows, types) => rows.map((r) => ({ values: r.map((v, i) => apiCell(v, types[i])) }));

// ───────────────────────────── planning one tab ───────────────────────────────

// oldHashes: what the sheet holds now (null = unknown). Returns { requests, newGrid, action, ... }.
// `observedRows` is how many data rows the sheet has when oldHashes is unknown (taken from Checks).
function planTab(table, sheetId, grid, oldHashes, observedRows) {
  const types = table.types;
  const newHashes = table.rows.map(hashRow);
  const oldLen = oldHashes ? oldHashes.length : observedRows;
  let action = 'incremental';
  let diff = null;

  if (oldHashes) diff = diffRows(oldHashes, newHashes);
  if (!diff) {
    // Unknown or too different: drop every existing data row and write the whole tab.
    action = 'rewrite';
    diff = { del: Array.from({ length: oldLen }, (_, i) => i), ins: newHashes.map((_, i) => i) };
  }
  if (diff.del.length === 0 && diff.ins.length === 0) return { action: 'none', requests: [], newGrid: grid, newHashes };

  const reqs = [];

  // Keep spare blank rows below the data so an insert never falls outside the grid.
  const trailing = grid - (1 + oldLen);
  let newGrid = grid;
  if (trailing < MIN_TRAILING_BLANK_ROWS) {
    const add = MIN_TRAILING_BLANK_ROWS - trailing;
    reqs.push({ appendDimension: { sheetId, dimension: 'ROWS', length: add } });
    newGrid += add;
  }

  // 1. Delete, highest rows first so earlier positions stay valid.
  for (const [s, e] of runs(diff.del).reverse()) {
    reqs.push({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: s + 1, endIndex: e + 1 } } });
  }
  newGrid -= diff.del.length;

  // 2. Insert, lowest rows first; every row above an insert is already in its final place.
  for (const [s, e] of runs(diff.ins)) {
    let from = s;
    while (from < e) {
      let to = from;
      let size = 0;
      const rowSize = (i) => JSON.stringify(apiRows([table.rows[i]], types)).length;
      while (to < e && (to === from || size + rowSize(to) < MAX_BATCH_CHARS * 0.8)) {
        size += rowSize(to);
        to++;
      }
      reqs.push({ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: from + 1, endIndex: to + 1 }, inheritFromBefore: false } });
      reqs.push({
        updateCells: {
          start: { sheetId, rowIndex: from + 1, columnIndex: 0 },
          rows: apiRows(table.rows.slice(from, to), types),
          fields: 'userEnteredValue',
        },
      });
      from = to;
    }
  }
  newGrid += diff.ins.length;

  return { action, requests: reqs, newGrid, newHashes, deleted: diff.del.length, inserted: diff.ins.length };
}

// Split requests into calls of bounded size, keeping their order.
function batches(reqs) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const r of reqs) {
    const len = JSON.stringify(r).length;
    if (cur.length && size + len > MAX_BATCH_CHARS) { out.push(cur); cur = []; size = 0; }
    cur.push(r);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ───────────────────────────── the Checks tab ─────────────────────────────────

// One row per tab: [tab, =row count, =text characters, =sum of numbers, =count of TRUE]
// Whole-column references (A:A) rather than A2:A, because an insert at row 2 would shift A2:A down past the new row.
function checksFormulas() {
  const rows = PIPELINE_TABS.map((tab) => {
    const q = `'${tab.name}'`;
    const col = (i) => `${q}!${colLetter(i)}:${colLetter(i)}`;
    const idx = (t) => tab.columns.map((c, i) => (c[1] === t ? i : -1)).filter((i) => i >= 0);
    const join = (list, f) => (list.length ? '=' + list.map(f).join('+') : '=0');
    return [
      tab.name,
      `=COUNTA(${col(tab.key)})-1`,
      join(idx(S), (i) => `SUMPRODUCT(LEN(${col(i)}))`),
      join(idx(N), (i) => `SUM(${col(i)})`),
      join(idx(B), (i) => `COUNTIF(${col(i)},TRUE)`),
    ];
  });
  return [['tab', 'rows', 'text_chars', 'num_sum', 'true_count'], ...rows];
}

// Accepts the get_values reply ({values}) or a bare array of rows; returns { tab: {rows,textChars,numSum,trueCount} }.
function parseObservedChecks(input) {
  const values = Array.isArray(input) ? input : input.values || [];
  const out = {};
  for (const r of values) {
    if (!r || !r[0] || r[0] === 'tab') continue;
    const num = (x) => Number(String(x === undefined || x === '' ? 0 : x).replace(/,/g, ''));
    out[r[0]] = { rows: num(r[1]), textChars: num(r[2]), numSum: num(r[3]), trueCount: num(r[4]) };
  }
  return out;
}

function checksMatch(exp, obs) {
  if (!obs) return false;
  const near = (a, b) => Math.abs(a - b) <= NUM_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b)) + 1e-6;
  return exp.rows === obs.rows && exp.textChars === obs.textChars && exp.trueCount === obs.trueCount && near(exp.numSum, obs.numSum);
}

// ───────────────────────────── notes ──────────────────────────────────────────

// The Notes tab is typed by people (and by the Monday summary task). Summaries written into the local caches
// are copied across here the first time, as new rows; a row that is already in the sheet is never touched,
// so a correction made in the sheet is not overwritten by the older text in the cache.
// existingKeys: the "key" column of Notes (request ids and week starts) as read from the sheet.
function notesToAdd(requestCache, slackCache, existingKeys) {
  const have = new Set((existingKeys || []).map(String));
  const rows = [];
  Object.entries((requestCache && requestCache.requests) || {}).forEach(([gid, r]) => {
    if (have.has(gid) || !(r.summary || r.cause)) return;
    rows.push(['request', gid, r.code || '', r.summary || '', r.cause || '', r.causedAt || '']);
  });
  (Array.isArray(slackCache) ? slackCache : []).forEach((w) => {
    if (have.has(w.weekStart) || !w.executiveSummary) return;
    rows.push(['week', w.weekStart, w.weekLabel || '', w.executiveSummary, '', '']);
  });
  return rows;
}

// Tabs another writer owns (for example a Glean agent) are left out of the plan entirely: not written, not
// checked. Ownership goes back by running the plan without them, after which the sync rewrites them once.
function dropTabs(tables, skip) {
  const out = { ...tables };
  for (const name of skip) {
    if (!out[name]) throw new Error(`--skip names "${name}", which is not a tab the sync writes`);
    delete out[name];
    console.log(`${name.padEnd(22)} not managed here (--skip)`);
  }
  return out;
}

// ───────────────────────────── state ──────────────────────────────────────────

function loadState(file = STATE_PATH) {
  if (!fs.existsSync(file)) return { version: 1, spreadsheetId: DEFAULT_SPREADSHEET_ID, sheets: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const saveState = (state, file = STATE_PATH) => fs.writeFileSync(file, JSON.stringify(state, null, 1));

// Plan every tab. `observed` (from Checks) is optional; a tab whose observed numbers disagree with what
// we last wrote is treated as unknown and rewritten.
//
// A tab is left exactly as it is (its last good rows stay in the sheet) when
//   - the dataset it comes from could not be built this run (opts.failures), or
//   - it would lose more than half its rows, which is almost always a bad fetch rather than a real change
//     (opts.forceShrink names the tabs where it is real).
function planAll(tables, state, observed, opts = {}) {
  const failures = new Set(opts.failures || []);
  const forceShrink = new Set(opts.forceShrink || []);
  const plans = {};
  for (const name of Object.keys(tables)) {
    const table = tables[name];
    const st = state.sheets[name];
    if (!st || !st.sheetId) throw new Error(`No sheetId for tab "${name}". Run: node src/sheetSync.js meta <get_spreadsheet output>`);

    const before = st.hashes ? st.hashes.length : 0;
    let skip = null;
    if (failures.has(table.source)) skip = `${table.source} could not be built this run; the sheet keeps its last good rows`;
    else if (before >= SHRINK_GUARD_MIN_ROWS && table.rows.length < before * 0.5 && !forceShrink.has(name)) {
      skip = `would drop from ${before} to ${table.rows.length} rows; if that is real, plan again with --force-shrink ${name}`;
    }
    if (skip && st.hashes && st.expected) {
      plans[name] = { action: 'skipped', reason: skip, requests: [], newGrid: st.grid || 1000, newHashes: st.hashes, expected: st.expected, note: '' };
      continue;
    }

    let oldHashes = st.hashes && !st.dirty ? st.hashes : null;
    let observedRows = observed && observed[name] ? observed[name].rows : before;
    if (observed && oldHashes) {
      if (!checksMatch(st.expected, observed[name])) { oldHashes = null; observedRows = observed[name] ? observed[name].rows : 0; }
    }
    const plan = planTab(table, st.sheetId, st.grid || 1000, oldHashes, observedRows);
    plans[name] = { ...plan, expected: expectedChecks(table), note: oldHashes ? '' : 'sheet state unknown, rewritten' };
  }
  return plans;
}

// The build calls this once it has all its datasets, so `plan` can run without asking Asana again.
function saveData(payload) {
  const { nztStamp } = require('./report');
  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `xcf-data-${new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...payload, generatedAt: nztStamp() }));
  return file;
}

// ───────────────────────────── CLI ────────────────────────────────────────────

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const nztDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });

// Learn tab ids and grid sizes from a get_spreadsheet reply. Tabs that no longer exist are forgotten;
// what we know about the rows of the ones that remain is kept.
function cmdMeta(file) {
  const meta = readJson(file);
  const state = loadState();
  state.spreadsheetId = meta.spreadsheetId || state.spreadsheetId;
  const next = {};
  for (const sh of meta.sheets || []) {
    const p = sh.properties;
    const old = Object.values(state.sheets).find((s) => s.sheetId === p.sheetId) || state.sheets[p.title] || {};
    next[p.title] = { ...old, sheetId: p.sheetId, grid: p.gridProperties.rowCount };
  }
  state.sheets = next;
  saveState(state);
  console.log(`State knows ${Object.keys(state.sheets).length} tabs.`);
}

// One-off: remember what the sheet holds now, from rows read back out of it.
// file: { Tab: [[...cells in order...], ...] } with cells already in the build's types.
function cmdInitState(file) {
  const observed = readJson(file);
  const state = loadState();
  const tables = buildTables({});
  for (const name of Object.keys(tables)) {
    const types = tables[name].types;
    const rows = (observed[name] || []).map((r) => r.map((v, i) => require('./sheetSchema').normaliseCell(v, types[i])));
    const t = { ...tables[name], rows };
    state.sheets[name] = {
      ...(state.sheets[name] || {}),
      hashes: rows.map(hashRow),
      expected: expectedChecks(t),
      dirty: false,
    };
  }
  saveState(state);
  console.log('State initialised from observed rows.');
}

function cmdSetup() {
  const state = loadState();
  fs.mkdirSync(path.join(OUT_DIR, 'setup'), { recursive: true });
  const formulas = checksFormulas();
  fs.writeFileSync(path.join(OUT_DIR, 'setup', 'checks-formulas.json'), JSON.stringify(formulas));
  console.log(`Checks tab: write ${formulas.length} rows x 5 columns from A1 with update_formulas.`);
  console.log('File:', path.join(OUT_DIR, 'setup', 'checks-formulas.json'));
  return state;
}

function cmdPlan() {
  const dataFile = arg('--data') || path.join(ROOT, 'reports', `xcf-data-${nztDate()}.json`);
  const data = readJson(dataFile);
  const state = loadState();
  const observed = arg('--checks') ? parseObservedChecks(readJson(arg('--checks'))) : null;
  const tables = dropTabs(buildTables(data), (arg('--skip') || '').split(',').filter(Boolean));
  const forceShrink = (arg('--force-shrink') || '').split(',').filter(Boolean);
  const plans = planAll(tables, state, observed, { failures: data.failures || [], forceShrink });

  fs.rmSync(path.join(OUT_DIR, 'ops'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'ops'), { recursive: true });

  const pending = { generatedAt: data.generatedAt || null, planned: nztDate(), tabs: {}, skipped: {} };
  const files = [];
  let n = 0;
  for (const name of Object.keys(plans)) {
    const p = plans[name];
    const st = state.sheets[name];
    pending.tabs[name] = { hashes: p.newHashes, expected: p.expected, grid: p.newGrid };
    if (p.action === 'skipped') {
      pending.skipped[name] = p.reason;
      console.log(`${name.padEnd(22)} SKIPPED: ${p.reason}`);
      continue;
    }
    if (p.action === 'none') {
      console.log(`${name.padEnd(22)} no change (${p.newHashes.length} rows)`);
      continue;
    }
    for (const [k, reqs] of batches(p.requests).entries()) {
      n++;
      const file = path.join(OUT_DIR, 'ops', `${String(n).padStart(2, '0')}-${name}-${k + 1}.json`);
      fs.writeFileSync(file, JSON.stringify({ spreadsheetId: state.spreadsheetId, requests: reqs }));
      files.push(file);
    }
    console.log(`${name.padEnd(22)} ${p.action}: -${p.deleted} rows, +${p.inserted} rows${p.note ? ` (${p.note})` : ''}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'pending.json'), JSON.stringify(pending));
  console.log(files.length ? `\n${files.length} call(s) to apply, in order:\n${files.join('\n')}` : '\nNothing to write.');
}

function cmdVerify(file) {
  const state = loadState();
  const pending = readJson(path.join(OUT_DIR, 'pending.json'));
  const observed = parseObservedChecks(readJson(file));
  let bad = 0;
  for (const [name, p] of Object.entries(pending.tabs)) {
    const ok = checksMatch(p.expected, observed[name]);
    const st = state.sheets[name];
    if (ok) {
      state.sheets[name] = { ...st, hashes: p.hashes, expected: p.expected, grid: p.grid, dirty: false };
    } else {
      bad++;
      state.sheets[name] = { ...st, dirty: true, grid: p.grid };
      console.log(`MISMATCH ${name}: expected ${JSON.stringify(p.expected)}, sheet has ${JSON.stringify(observed[name])}`);
    }
  }
  state.syncedAt = bad ? state.syncedAt : new Date().toISOString();
  state.generatedAt = bad ? state.generatedAt : pending.generatedAt;
  saveState(state);
  if (!bad && state.sheets.Sync_Log && state.sheets.Sync_Log.sheetId) {
    const total = Object.values(pending.tabs).reduce((a, t) => a + t.expected.rows, 0);
    const skipped = Object.keys(pending.skipped || {});
    const rows = [['status', skipped.length ? 'partial' : 'ok'], ['synced_at', state.syncedAt], ['generated_at', pending.generatedAt || ''],
      ['tabs', String(Object.keys(pending.tabs).length)], ['rows', String(total)], ['skipped', skipped.join(', ')]];
    const req = { updateCells: { start: { sheetId: state.sheets.Sync_Log.sheetId, rowIndex: 1, columnIndex: 0 }, rows: apiRows(rows, ['s', 's']), fields: 'userEnteredValue' } };
    fs.writeFileSync(path.join(OUT_DIR, 'sync-log.json'), JSON.stringify({ spreadsheetId: state.spreadsheetId, requests: [req] }));
    console.log('Write the Sync_Log row(s): sheet-sync/sync-log.json');
  }
  console.log(bad ? `${bad} tab(s) did not match and will be rewritten next run.` : `All ${Object.keys(pending.tabs).length} tabs match. State saved.`);
  process.exitCode = bad ? 1 : 0;
}

function cmdNotes(keysFile) {
  const state = loadState();
  const st = state.sheets.Notes;
  if (!st || !st.sheetId) throw new Error('No sheetId for tab "Notes". Run: node src/sheetSync.js meta <get_spreadsheet output>');
  const raw = readJson(keysFile);
  const keys = (Array.isArray(raw) ? raw : raw.values || []).map((r) => (Array.isArray(r) ? r[0] : r)).filter(Boolean);
  const requestCache = readJson(path.join(ROOT, 'request-timing-cache.json'));
  const slackCache = readJson(path.join(ROOT, 'slack-pm-updates-cache.json'));
  const rows = notesToAdd(requestCache, slackCache, keys);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'notes-append.json');
  fs.rmSync(file, { force: true });
  if (!rows.length) { console.log('Notes already has every summary in the caches.'); return; }
  const req = { appendCells: { sheetId: st.sheetId, rows: apiRows(rows, ['s', 's', 's', 's', 's', 's']), fields: 'userEnteredValue' } };
  fs.writeFileSync(file, JSON.stringify({ spreadsheetId: state.spreadsheetId, requests: [req] }));
  console.log(`${rows.length} summary row(s) to add to Notes: ${file}`);
}

function cmdStatus() {
  const state = loadState();
  for (const [name, s] of Object.entries(state.sheets)) {
    console.log(`${name.padEnd(22)} id ${String(s.sheetId).padEnd(11)} rows ${String(s.hashes ? s.hashes.length : '?').padEnd(5)} grid ${s.grid}${s.dirty ? '  DIRTY' : ''}`);
  }
  console.log('last sync:', state.syncedAt || 'never');
}

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'plan') cmdPlan();
    else if (cmd === 'verify') cmdVerify(process.argv[3]);
    else if (cmd === 'setup') cmdSetup();
    else if (cmd === 'meta') cmdMeta(process.argv[3]);
    else if (cmd === 'init-state') cmdInitState(process.argv[3]);
    else if (cmd === 'notes') cmdNotes(process.argv[3]);
    else if (cmd === 'status') cmdStatus();
    else console.log('Usage: node src/sheetSync.js plan | verify <checks> | setup | meta <file> | notes <keys> | init-state <file> | status');
  } catch (err) {
    console.error('sheetSync:', err.message);
    process.exit(1);
  }
}

module.exports = { dropTabs, notesToAdd, saveData, hashRow, diffRows, runs, planTab, planAll, batches, expectedChecks, checksFormulas, parseObservedChecks, checksMatch, apiRows, colLetter, MIN_TRAILING_BLANK_ROWS };
