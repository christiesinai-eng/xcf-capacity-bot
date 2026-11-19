#!/usr/bin/env node
'use strict';
// Turns the "XCF Platform spend and usage tracker" Google Sheet into platform-spend-data.json,
// the snapshot the "Platform spend and usage" tab is built from.
//
//   node scripts/platform-spend-from-sheet.js <raw.json> [--out platform-spend-data.json]
//
// The build has no Google login, so the sheet is read by Claude through the Google Sheets connector
// ("sync the platform spend data"). Claude saves what the connector returns for three ranges and runs this:
//
//   { "spreadsheetId": "...", "title": "...",
//     "platforms": {"values": [...]}   // Platforms!A1:Z200
//     "summary":   {"values": [...]}   // Summary!A1:Z100
//     "howto":     {"values": [...]} } // 'How to view usage'!A1:Z100
//
// It checks the sheet before it writes anything, and refuses (exit 1, file untouched) when something is off:
//   - the headers are what it expects, every cost is a number, scope / usage / in-total use known words
//   - no month lists the same tool twice
//   - the totals it works out from the rows (only rows with "In total" = Yes) equal the sheet's own Summary tab,
//     month by month, to the cent. A typo in a cost or a row left out of the total shows up here.

const fs = require('fs');
const path = require('path');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLATFORM_HEADERS = ['Month', 'Scope', 'Tool name', 'Category', 'Seats', 'Annual cost (NZD)', 'Usage', 'In total'];
const SCOPES = ['Shared', 'XCF only'];
const USAGE = { High: 'High', Med: 'Medium', Medium: 'Medium', Low: 'Low', 'New tool': 'New tool' };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

const rowsOf = (tab) => (Array.isArray(tab) ? tab : (tab && tab.values) || []);
const cell = (r, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i]).trim());
const cents = (n) => Math.round(n * 100);

function money(text, where, problems) {
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  if (text === '' || !Number.isFinite(n) || n < 0) {
    problems.push(`${where}: "${text}" is not a cost`);
    return null;
  }
  return n;
}

function monthKey(label, where, problems) {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label);
  const idx = m ? MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) : -1;
  if (idx < 0) {
    problems.push(`${where}: month "${label}" is not like "Sep 2026"`);
    return null;
  }
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

function build(raw) {
  const problems = [];
  const pRows = rowsOf(raw.platforms);
  const sRows = rowsOf(raw.summary);
  const hRows = rowsOf(raw.howto);

  // ── Platforms ──
  if (!pRows.length) problems.push('Platforms tab is empty');
  PLATFORM_HEADERS.forEach((h, i) => {
    if (cell(pRows[0] || [], i) !== h) problems.push(`Platforms header ${i + 1} is "${cell(pRows[0] || [], i)}", expected "${h}"`);
  });

  const byMonth = new Map();
  pRows.slice(1).forEach((r, i) => {
    if (!r.some((c) => String(c).trim() !== '')) return;
    const where = `Platforms row ${i + 2}`;
    const label = cell(r, 0);
    const key = monthKey(label, where, problems);
    const scope = cell(r, 1);
    const tool = cell(r, 2);
    if (!SCOPES.includes(scope)) problems.push(`${where} (${tool}): scope "${scope}" is not Shared or XCF only`);
    if (!tool) problems.push(`${where}: no tool name`);
    const annual = money(cell(r, 5), `${where} (${tool}) annual cost`, problems);
    const usage = USAGE[cell(r, 6)];
    if (!usage) problems.push(`${where} (${tool}): usage "${cell(r, 6)}" is not High, Med, Low or New tool`);
    const inTotalText = cell(r, 7);
    if (!['Yes', 'No'].includes(inTotalText)) problems.push(`${where} (${tool}): In total "${inTotalText}" is not Yes or No`);
    if (!key) return;
    const seats = cell(r, 4);
    const seatMatch = /^(\d+)\s*x\b/i.exec(seats);
    if (!byMonth.has(key)) byMonth.set(key, { key, label, rows: [] });
    const month = byMonth.get(key);
    if (month.rows.some((x) => x.tool.toLowerCase() === tool.toLowerCase())) {
      problems.push(`${where}: ${tool} is listed twice in ${label}`);
    }
    month.rows.push({
      tool, scope, category: cell(r, 3), seats, seatCount: seatMatch ? Number(seatMatch[1]) : null,
      annual, usage, inTotal: inTotalText === 'Yes', notes: cell(r, 8),
    });
  });

  // ── Summary: the sheet's own totals ──
  const sheetSummary = [];
  sRows.slice(1).forEach((r, i) => {
    if (!r.some((c) => String(c).trim() !== '')) return;
    const where = `Summary row ${i + 2}`;
    const key = monthKey(cell(r, 0), where, problems);
    const shared = money(cell(r, 1), `${where} shared`, problems);
    const xcf = money(cell(r, 2), `${where} XCF only`, problems);
    const total = money(cell(r, 3), `${where} total`, problems);
    if (key) sheetSummary.push({ key, label: cell(r, 0), shared, xcf, total });
  });

  const months = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
  months.forEach((m) => {
    const sum = (scope) => m.rows.filter((x) => x.inTotal && x.scope === scope).reduce((s, x) => s + (x.annual || 0), 0);
    const mine = { shared: sum('Shared'), xcf: sum('XCF only') };
    mine.total = mine.shared + mine.xcf;
    const theirs = sheetSummary.find((s) => s.key === m.key);
    if (!theirs) { problems.push(`${m.label}: the Summary tab has no row for this month`); return; }
    for (const [field, name] of [['shared', 'Shared'], ['xcf', 'XCF only'], ['total', 'Total']]) {
      if (cents(mine[field]) !== cents(theirs[field])) {
        problems.push(`${m.label} ${name}: rows add up to ${mine[field].toFixed(2)} but the Summary tab says ${theirs[field].toFixed(2)}`);
      }
    }
  });
  sheetSummary.forEach((s) => {
    if (!byMonth.has(s.key)) problems.push(`${s.label}: the Summary tab has a row but the Platforms tab has no rows for it`);
  });

  // ── How to view usage ──
  const usageHowTo = [];
  let usageKey = [];
  hRows.slice(1).forEach((r) => {
    const tool = cell(r, 0);
    const how = cell(r, 1);
    if (!tool && !how) return;
    if (tool.toLowerCase() === 'usage codes') {
      usageKey = how.split(',').map((part) => {
        const [level, meaning] = part.split('=').map((s) => s.trim());
        return level && meaning ? { level: USAGE[level] || level, meaning } : null;
      }).filter(Boolean);
    } else {
      usageHowTo.push({ tool, how });
    }
  });

  return {
    problems,
    data: {
      source: {
        title: raw.title || 'XCF Platform spend and usage tracker',
        spreadsheetId: raw.spreadsheetId || '',
        tabs: ['Platforms', 'Summary', 'How to view usage'],
      },
      syncedAt: new Date().toISOString(),
      months,
      sheetSummary,
      usageHowTo,
      usageKey,
    },
  };
}

function main() {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('Usage: node scripts/platform-spend-from-sheet.js <raw.json> [--out platform-spend-data.json]');
    process.exit(2);
  }
  const out = arg('--out') || path.join(__dirname, '..', 'platform-spend-data.json');
  const { problems, data } = build(JSON.parse(fs.readFileSync(input, 'utf8')));
  if (problems.length) {
    console.error(`Not written: ${problems.length} problem${problems.length === 1 ? '' : 's'} in the sheet`);
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${out}`);
  data.months.forEach((m) => {
    const inTotal = m.rows.filter((r) => r.inTotal);
    const total = inTotal.reduce((s, r) => s + r.annual, 0);
    console.log(`  ${m.label}: ${m.rows.length} tools (${inTotal.length} in the total), total ${total.toFixed(2)} = the Summary tab`);
  });
  console.log(`  ${data.usageHowTo.length} how-to-view-usage entries, usage key: ${data.usageKey.map((k) => `${k.level} = ${k.meaning}`).join(', ')}`);
}

if (require.main === module) main();
module.exports = { build };
