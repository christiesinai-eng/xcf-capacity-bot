#!/usr/bin/env node
'use strict';
// Compares what the Glean agent wrote to the Glean_* tabs with what the build produces from the same Asana data.
//
//   node scripts/compare-glean.js --data reports/xcf-data-YYYY-MM-DD.json --tabs sheet-sync/glean-tabs.json
//
// The tabs file maps a build tab name to the reply of get_values on the matching Glean_ tab, for example
//   { "Tasks": { "values": [[header...], [row...]] }, "Missing_Tasks": {...}, "Overdue_Tasks": {...}, "OOO": {...} }
// (a bare array of rows is accepted too). Run the build and read the tabs in the same hour: both move during the day.
// Rows are compared as a set: order does not matter. A task has no id in the Tasks tab, so a row is the whole row.

const fs = require('fs');
const path = require('path');
const { PIPELINE_TABS } = require('../src/sheetSchema');

const TABS = ['Tasks', 'Missing_Tasks', 'Overdue_Tasks', 'OOO'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

// One cell as the sheet would hand it back, so build values and sheet values meet in the middle.
function norm(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'b') return String(v).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  if (type === 'n') return v === '' ? '' : String(Math.round(Number(v) * 10000) / 10000);
  return String(v).trim();
}

function normRow(row, columns) {
  return columns.map(([, type], i) => norm(row[i], type)).join('\u0001');
}

function counts(rows) {
  const m = new Map();
  rows.forEach((r) => m.set(r, (m.get(r) || 0) + 1));
  return m;
}

function show(key) {
  return key.split('\u0001').map((c) => c || '·').join(' | ');
}

function main() {
  const dataPath = arg('--data');
  const tabsPath = arg('--tabs');
  if (!dataPath || !tabsPath) {
    console.error('usage: node scripts/compare-glean.js --data reports/xcf-data-DATE.json --tabs glean-tabs.json');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const tabs = JSON.parse(fs.readFileSync(tabsPath, 'utf8'));
  const failed = new Set((data.failures || []).map((f) => (typeof f === 'string' ? f : f.dataset || f.name)));
  let allMatch = true;

  // Compare whichever tabs the file holds, so one tab group can be checked at a time.
  const names = Object.keys(tabs).filter((n) => PIPELINE_TABS.some((t) => t.name === n));
  if (!names.length) { console.error('The tabs file holds no tab the build knows.'); process.exit(2); }

  for (const name of names) {
    const def = PIPELINE_TABS.find((t) => t.name === name);
    const reply = tabs[name];
    if (!reply) { console.log(`${name}: not provided`); allMatch = false; continue; }
    const values = Array.isArray(reply) ? reply : reply.values || [];
    const header = (values[0] || []).map((h) => String(h).trim());
    const want = def.columns.map((c) => c[0]);
    if (header.join('|') !== want.join('|')) {
      console.log(`${name}: HEADER differs. Sheet has [${header.join(', ')}], expected [${want.join(', ')}]`);
      allMatch = false;
      continue;
    }
    if (failed.has(def.source)) console.log(`${name}: note, the build could not fetch ${def.source}, so there is nothing to compare with`);
    const built = counts(def.rows(data).map((r) => normRow(r, def.columns)));
    const glean = counts(values.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => normRow(r, def.columns)));
    const builtTotal = [...built.values()].reduce((a, b) => a + b, 0);
    const gleanTotal = [...glean.values()].reduce((a, b) => a + b, 0);
    const onlyBuild = [];
    const onlyGlean = [];
    for (const [k, n] of built) for (let i = 0; i < n - (glean.get(k) || 0); i++) onlyBuild.push(k);
    for (const [k, n] of glean) for (let i = 0; i < n - (built.get(k) || 0); i++) onlyGlean.push(k);
    const same = builtTotal - onlyBuild.length;
    const ok = onlyBuild.length === 0 && onlyGlean.length === 0;
    allMatch = allMatch && ok;
    console.log(`${name}: build ${builtTotal} rows, Glean ${gleanTotal} rows, identical ${same}, only in build ${onlyBuild.length}, only in Glean ${onlyGlean.length}${ok ? '  MATCH' : ''}`);
    onlyBuild.slice(0, 8).forEach((k) => console.log(`   only in build: ${show(k)}`));
    onlyGlean.slice(0, 8).forEach((k) => console.log(`   only in Glean: ${show(k)}`));
    if (name === 'Tasks') {
      const per = (m) => { const o = {}; for (const [k, n] of m) { const who = k.split('\u0001')[0]; o[who] = (o[who] || 0) + n; } return o; };
      const b = per(built);
      const g = per(glean);
      const diff = [...new Set([...Object.keys(b), ...Object.keys(g)])].filter((w) => (b[w] || 0) !== (g[w] || 0));
      if (diff.length) console.log('   rows per person that differ (build / Glean): ' + diff.map((w) => `${w} ${b[w] || 0}/${g[w] || 0}`).join(', '));
    }
  }
  console.log(allMatch ? `\nAll ${names.length} tabs match the build.` : '\nThe tabs differ from the build. Differences are listed above.');
  process.exit(allMatch ? 0 : 1);
}

main();
