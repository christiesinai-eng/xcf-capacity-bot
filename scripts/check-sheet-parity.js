'use strict';
// Proves the Google Sheet route gives the dashboard the same data as the build does.
//
//   node scripts/check-sheet-parity.js [--data reports/xcf-data-YYYY-MM-DD.json] [--today YYYY-MM-DD] [--humans tabs.json]
//
// Takes the datasets from a build, writes them out the way the sheet sync would, reads them back the way
// the page would (SheetAdapter), and compares with what the build puts straight into the template.

const fs = require('fs');
const path = require('path');
const { templateDatasets } = require('../src/report');
const SheetAdapter = require('../src/sheetAdapter');
const { apiResponse } = require('../test/helpers/sheetFixture');

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const dataFile = arg('--data') || path.join(__dirname, '..', 'reports', `xcf-data-${new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })}.json`);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const today = arg('--today') || new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });

// Empty, null and missing all mean "nothing"; numbers are compared to 6 places.
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach((k) => { const x = norm(v[k]); if (x !== null && x !== undefined && x !== '') o[k] = x; });
    return o;
  }
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  return v === '' ? null : v;
}

const expected = templateDatasets(data);
// --humans file.json: the hand-edited tabs exactly as the real sheet holds them ({ Tab: [[header...], [row...]] }).
const humans = arg('--humans') ? JSON.parse(fs.readFileSync(arg('--humans'), 'utf8')) : undefined;
const resp = apiResponse(data, humans);
const tabs = SheetAdapter.parseSheetResponse(resp);
const got = SheetAdapter.buildDatasets(tabs, today);

let bad = 0;
function compare(label, a, b, { unordered } = {}) {
  const A = norm(a);
  const B = norm(b);
  let same = JSON.stringify(A) === JSON.stringify(B);
  let note = '';
  if (!same && unordered) {
    const key = (x) => JSON.stringify(x);
    same = JSON.stringify(A.map(key).sort()) === JSON.stringify(B.map(key).sort());
    if (same) note = ' (same content, different order)';
  }
  if (!same) {
    bad++;
    console.log(`DIFFERENT  ${label}`);
    const sa = JSON.stringify(A);
    const sb = JSON.stringify(B);
    let i = 0;
    while (sa[i] === sb[i]) i++;
    console.log('   sheet :', sa.slice(Math.max(0, i - 100), i + 160));
    console.log('   build :', sb.slice(Math.max(0, i - 100), i + 160));
  } else console.log(`same       ${label}${note}`);
}

const byName = (arr) => arr.slice().sort((x, y) => x.name.localeCompare(y.name));
compare('MEMBERS', byName(got.MEMBERS), byName(expected.MEMBERS));
compare('MISSING_TASKS', got.MISSING_TASKS, expected.MISSING_TASKS);
compare('OVERDUE_TASKS', got.OVERDUE_TASKS, expected.OVERDUE_TASKS);
compare('PM_DATA', got.PM_DATA, expected.PM_DATA);
compare('SCOPE_CREEP_DATA', got.SCOPE_CREEP_DATA, expected.SCOPE_CREEP_DATA);
compare('OOO_DATA', got.OOO_DATA, expected.OOO_DATA, { unordered: true });
compare('PM_UPDATES_DATA', got.PM_UPDATES_DATA, expected.PM_UPDATES_DATA);
compare('RT_RAW_TASKS', got.RT_RAW_TASKS, expected.RT_RAW_TASKS);
compare('REQUESTS_DATA', got.REQUESTS_DATA, expected.REQUESTS_DATA);
compare('REGIONAL_DATA', got.REGIONAL_DATA, expected.REGIONAL_DATA);
console.log(`\n${bad ? bad + ' dataset(s) differ' : 'Every dataset the page uses is identical'} (today = ${today}, ${dataFile})`);
process.exit(bad ? 1 : 0);
