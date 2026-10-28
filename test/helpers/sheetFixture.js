'use strict';
// Helpers that stand in for the Google Sheet in tests: turn build data into the rows /api/sheet would
// return, and write the hand-edited tabs (People, Notes ...) a person would have typed into the sheet.

const { buildTables } = require('../../src/sheetSchema');
const { TABS } = require('../../src/sheetAdapter');

// What Sheets returns for a cell: a string, with TRUE / FALSE for booleans and nothing for an empty cell.
const show = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

function toValues(headers, rows) {
  const out = [headers.slice()];
  for (const r of rows) {
    const cells = r.map(show);
    while (cells.length && cells[cells.length - 1] === '') cells.pop(); // trailing empty cells are dropped
    out.push(cells);
  }
  return out;
}

// The tabs a person edits by hand, written from the same build data so the two always agree.
function humanTabs(data) {
  const pmGid = Object.fromEntries((data.pmData || []).map((p) => [p.name, p.gid]));
  const people = (data.members || []).map((m) => [m.name, m.pod, 'Y', pmGid[m.name] ? 'Y' : 'N', 'N', 'N', pmGid[m.name] || '', '']);
  // People who are not on the capacity tab but still have leave (the sheet lists them with on_capacity_tab = N).
  const listed = new Set(people.map((p) => p[0]));
  (data.oooData || []).forEach((o) => { if (!listed.has(o.name)) { listed.add(o.name); people.push([o.name, o.pod, 'N', 'N', 'N', 'N', '', '']); } });
  const manual = (data.oooData || []).filter((o) => o.source === 'manual').map((o) => [o.name, o.start, o.end, '']);
  const notes = [];
  (data.pmUpdatesData || []).forEach((w) => { if (w.executiveSummary) notes.push(['week', w.weekStart, w.weekLabel, w.executiveSummary, '', '']); });
  (data.requestsData || []).forEach((r) => { if (r.summary || r.cause) notes.push(['request', r.gid, r.code, r.summary || '', r.cause || '', r.causedAt || '']); });
  const log = [['status', 'ok'], ['synced_at', '2026-10-29T00:00:00.000Z'], ['generated_at', data.generatedAt || ''], ['tabs', '17'], ['rows', '0'], ['skipped', '']];
  return {
    Sync_Log: toValues(['key', 'value'], log),
    People: toValues(['name', 'pod', 'on_capacity_tab', 'is_pm', 'hidden_from_missing_tab', 'hidden_from_ooo_tab', 'asana_user_gid', 'note'], people),
    OOO_Manual: toValues(['name', 'start_date', 'end_date', 'note'], manual),
    Notes: toValues(['kind', 'key', 'label', 'summary_markdown', 'cause', 'cause_date'], notes),
  };
}

// The /api/sheet reply for this build data: one entry per declared tab, in declared order.
function apiResponse(data, overrides) {
  const tables = buildTables(data);
  const human = { ...humanTabs(data), ...(overrides || {}) };
  const ranges = TABS.map((name) => {
    const values = human[name] || toValues(tables[name].headers, tables[name].rows);
    return { range: `${name}!A1:Z${values.length}`, values };
  });
  return { ranges };
}

module.exports = { show, toValues, humanTabs, apiResponse };
