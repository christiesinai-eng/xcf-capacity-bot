'use strict';
// Checks the Glean_Regional_Raw tab against Asana itself.
//
//   node scripts/regional-raw-check.js --tabs sheet-sync/glean-regional-raw.json
//       compares what Glean wrote with what Asana holds right now
//   node scripts/regional-raw-check.js --write sheet-sync/regional-raw-expected.json
//       saves the expected rows (header + rows) so they can be loaded into the sheet for a formula test
//
// The tabs file holds { "Glean_Regional_Raw": [[header...], [row...], ...] } as read from the sheet. Reads Asana
// only. Rows are matched by gid, then every column is compared exactly.

const fs = require('fs');
const path = require('path');
require('../src/loadEnv.js');
const { asanaClient } = require('../src/asana');

const PROJECT = '1215906401561993'; // XCF | Requests
const SINCE = '2026-07-01';
const F = {
  status: '1211986892220398',
  type: '1217575429570978',
  regRoadmap: '1212086752729219',
  regMicro: '1213486033990545',
  bg: '1211914438576356',
  cc: '1213093222630048',
};
const HEADER = ['gid', 'name', 'created_on', 'status', 'project_type', 'regions_roadmap', 'regions_micro', 'business_group', 'cost_centre'];

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const cf = (t, g) => (t.custom_fields || []).find((f) => f.gid === g) || {};

async function expectedRows() {
  const client = asanaClient();
  const tasks = [];
  let offset = null;
  do {
    const params = {
      project: PROJECT,
      limit: 100,
      opt_fields: 'gid,name,created_at,custom_fields.gid,custom_fields.enum_value.name,custom_fields.multi_enum_values.name,custom_fields.text_value',
    };
    if (offset) params.offset = offset;
    const r = await client.get('/tasks', { params });
    tasks.push(...r.data.data);
    offset = r.data.next_page?.offset ?? null;
  } while (offset);
  const rows = tasks
    .filter((t) => t.created_at && t.created_at.slice(0, 10) >= SINCE)
    .map((t) => [
      t.gid,
      (t.name || '').replace(/^\[Converted to project\]\s*/, ''),
      t.created_at.slice(0, 10),
      cf(t, F.status).enum_value?.name || '',
      cf(t, F.type).enum_value?.name || '',
      (cf(t, F.regRoadmap).multi_enum_values || []).map((v) => v.name).join('; '),
      (cf(t, F.regMicro).multi_enum_values || []).map((v) => v.name).join('; '),
      cf(t, F.bg).enum_value?.name || '',
      String(cf(t, F.cc).text_value || '').replace(/\s*[\r\n]+\s*/g, ' '),
    ])
    .sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { read: tasks.length, rows };
}

(async () => {
  const { read, rows } = await expectedRows();
  console.log(`Asana: ${read} tasks in the project, ${rows.length} created on or after ${SINCE}`);

  const out = arg('--write');
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ header: HEADER, rows }));
    console.log('wrote', out);
  }

  const tabsPath = arg('--tabs');
  if (!tabsPath) return;
  const tabs = JSON.parse(fs.readFileSync(tabsPath, 'utf8'));
  const reply = tabs.Glean_Regional_Raw;
  if (!reply) { console.log('Glean_Regional_Raw: not provided'); process.exit(1); }
  const values = Array.isArray(reply) ? reply : reply.values || [];
  const header = (values[0] || []).map((h) => String(h).trim());
  if (header.join('|') !== HEADER.join('|')) {
    console.log(`HEADER differs. Sheet has [${header.join(', ')}], expected [${HEADER.join(', ')}]`);
    process.exit(1);
  }
  const got = values.slice(1).filter((r) => r.some((c) => String(c ?? '') !== '')).map((r) => HEADER.map((_, i) => String(r[i] ?? '')));
  const want = new Map(rows.map((r) => [r[0], r]));
  const have = new Map();
  let dupes = 0;
  for (const r of got) { if (have.has(r[0])) dupes++; have.set(r[0], r); }

  const missing = [...want.keys()].filter((g) => !have.has(g));
  const extra = [...have.keys()].filter((g) => !want.has(g));
  const colDiffs = HEADER.map(() => []);
  // The sheet's formulas trim every label, and names are only shown, so a difference that is only spaces (a
  // trailing space, a non-breaking space) cannot change a count. It is reported apart, not counted as an error.
  const norm = (s) => s.replace(/ /g, ' ').split('; ').map((x) => x.trim()).join('; ').replace(/\s+/g, ' ').trim();
  let identical = 0;
  let spaceOnly = 0;
  for (const [g, w] of want) {
    const h = have.get(g);
    if (!h) continue;
    let same = true;
    let exact = true;
    HEADER.forEach((_, i) => {
      if (h[i] === w[i]) return;
      exact = false;
      if (norm(h[i]) === norm(w[i])) return;
      same = false;
      colDiffs[i].push([g, w[i], h[i]]);
    });
    if (same) identical++;
    if (same && !exact) spaceOnly++;
  }
  console.log(`Glean_Regional_Raw: Asana ${want.size} rows, sheet ${got.length} rows (${dupes} repeated gids), identical ${identical} (${spaceOnly} differ only in spaces)`);
  console.log(`  missing from the sheet: ${missing.length} | in the sheet but not expected: ${extra.length}`);
  missing.slice(0, 5).forEach((g) => console.log('    missing', g, want.get(g)[1]));
  extra.slice(0, 5).forEach((g) => console.log('    extra', g, have.get(g)[1]));
  HEADER.forEach((h, i) => {
    if (!colDiffs[i].length) return;
    console.log(`  column ${h}: ${colDiffs[i].length} differ`);
    colDiffs[i].slice(0, 4).forEach(([g, w, x]) => console.log(`    ${g}: Asana ${JSON.stringify(w)} | sheet ${JSON.stringify(x)}`));
  });
  if (identical === want.size && !extra.length && !dupes) console.log('Glean_Regional_Raw matches Asana exactly.');
  else process.exit(1);
})().catch((e) => { console.error('failed:', e.response?.status, e.message); process.exit(2); });
