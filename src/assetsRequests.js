'use strict';
// Delivered assets, read from XCF | Requests: the build-side copy of what the Regional Glean agent writes to the
// Glean_Assets_Raw tab. The rules (what counts, which quarter, which region) live in assetsMath.js and are applied
// on the page; this file only picks the rows that could count and puts them in the shared row shape.
//
// A row is kept when the request is Complete, has a Project type of Micro (BAU), Roadmap or XCF initiative, and its
// completed_at falls on a UTC date from 2026-06-30 to 2026-12-31 (whatever day it was created: a request raised in June
// and finished in July is a July delivery). That window is a day wider than FY27 Q2 and Q3 at each end on purpose: the
// Glean agent copies by UTC date, and assetsMath.js then keeps only the rows whose AUCKLAND day is inside a quarter.

const { asanaClient } = require('./asana');
const AssetsMath = require('./assetsMath');

const REQUESTS_PROJECT_GID = '1215906401561993'; // XCF | Requests
const F = {
  status: '1211986892220398',   // Status (XCF)
  type: '1217575429570978',     // Project type (XCF)
  assets: '1212213385632145',   // Asset count (XCF), a number
  regMicro: '1213486033990545', // Regions (XCF), used for Micro (BAU) and XCF initiative
  regRoadmap: '1212086752729219', // Applicable Regions, used for Roadmap
};

const WINDOW = { from: '2026-06-30', to: '2026-12-31' }; // UTC dates, see above

const cf = (t, gid) => (t.custom_fields || []).find((f) => f.gid === gid) || {};
const enumName = (t, gid) => (cf(t, gid).enum_value || {}).name || '';
const multi = (t, gid) => (cf(t, gid).multi_enum_values || []).map((v) => v.name);

// One Asana task -> a row, or null when it cannot count.
function rowFromTask(t) {
  if (enumName(t, F.status) !== 'Complete' || !t.completed_at) return null;
  const type = enumName(t, F.type);
  if (AssetsMath.TYPES.indexOf(type) < 0) return null;
  const day = String(t.completed_at).slice(0, 10);
  if (day < WINDOW.from || day > WINDOW.to) return null;
  const n = cf(t, F.assets).number_value;
  return {
    gid: String(t.gid),
    name: String(t.name || '').replace(/^\[Converted to project\]\s*/, '').trim(),
    type,
    completedAt: t.completed_at,
    assets: typeof n === 'number' ? n : null,
    regMicro: multi(t, F.regMicro),
    regRoadmap: multi(t, F.regRoadmap),
  };
}

// Oldest first, then by gid: the order the agent writes the tab in.
const byDate = (a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : (a.gid < b.gid ? -1 : a.gid > b.gid ? 1 : 0));

async function buildAssetsData() {
  if (!process.env.ASANA_TOKEN) {
    console.warn('[Assets] No ASANA_TOKEN, skipping');
    return null;
  }
  const client = asanaClient();
  const tasks = [];
  let offset = null;
  try {
    do {
      const params = {
        project: REQUESTS_PROJECT_GID,
        opt_fields: 'gid,name,completed_at,custom_fields.gid,custom_fields.number_value,custom_fields.enum_value.name,custom_fields.multi_enum_values.name',
        limit: 100,
      };
      if (offset) params.offset = offset;
      const resp = await client.get('/tasks', { params });
      tasks.push(...resp.data.data);
      offset = resp.data.next_page?.offset ?? null;
    } while (offset);
  } catch (err) {
    console.warn('[Assets] Fetch failed:', err.message);
    return null;
  }
  const rows = tasks.map(rowFromTask).filter(Boolean).sort(byDate);
  const s = AssetsMath.summarise(rows);
  console.log(`[Assets] ${rows.length} delivered requests in FY27 Q2 + Q3 from ${tasks.length} read | ` +
    AssetsMath.QUARTERS.map((q) => `${q.key}: ${s.views[q.key].assets} assets`).join(', '));
  return rows;
}

module.exports = { buildAssetsData, rowFromTask, F };
