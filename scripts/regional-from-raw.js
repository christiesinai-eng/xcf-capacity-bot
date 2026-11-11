'use strict';
// Works out the four Regional tabs from the Glean_Regional_Raw rows, with the same rules src/regionalRequests.js
// uses on live Asana data. It is the reference the sheet's formulas are checked against.
//
//   node scripts/regional-from-raw.js --check
//       fetches Asana, builds the Regional data the build way AND from raw rows, and says whether they agree
//   node scripts/regional-from-raw.js --raw sheet-sync/x.json --out sheet-sync/regional-ref.json
//       reads {header, rows} (as written by regional-raw-check.js --write) and saves the four tabs' rows

const fs = require('fs');
require('../src/loadEnv.js');
const { PIPELINE_TABS } = require('../src/sheetSchema');

const QUARTERS = ['FY27 Q2', 'FY27 Q3'];
const REQUESTS_PROJECT_GID = '1215906401561993';
const WORKSPACE = '41261904390129';
const REGIONAL_TABS = ['Regional', 'Regional_Panels', 'Regional_Unrecognised', 'Regional_Meta'];

// Same as fiscalQuarter() in regionalRequests.js, from a YYYY-MM-DD date. Xero's year starts 1 April.
function quarterOf(isoDate) {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7)) - 1;
  const q = Math.floor(((m + 9) % 12) / 3) + 1;
  const fy = (m >= 3 ? y + 1 : y) % 100;
  return `FY${fy} Q${q}`;
}

const costCentreCode = (raw) => {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{3,4})\b/);
  return m ? m[1] : null;
};

function tally(rows, valueFn) {
  const counts = {};
  let withValue = 0;
  for (const r of rows) {
    const vs = valueFn(r);
    const list = (Array.isArray(vs) ? vs : [vs]).filter((v) => v != null && v !== '');
    if (list.length) withValue++;
    for (const v of list) counts[String(v).trim()] = (counts[String(v).trim()] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    rows: entries.map(([label, count]) => ({ label, count })),
    total: entries.reduce((s, [, n]) => s + n, 0),
    withValue,
    missing: rows.length - withValue,
    requests: rows.length,
  };
}

// raw rows: [gid, name, created_on, status, project_type, regions_roadmap, regions_micro, business_group, cost_centre]
function regionalFromRaw(rawRows) {
  const reqs = rawRows.map((r) => ({
    gid: r[0], name: r[1], on: r[2], quarter: quarterOf(r[2]), status: r[3], type: r[4],
    regRoadmap: r[5] ? r[5].split('; ') : [], regMicro: r[6] ? r[6].split('; ') : [], bg: r[7], cc: r[8],
  }));
  const inWindow = reqs.filter((x) => QUARTERS.includes(x.quarter));
  const live = inWindow.filter((x) => x.status !== 'Cancelled');
  const out = { quarters: QUARTERS, sections: [], unrecognised: [], meta: {} };
  const TYPES = [
    { key: 'Roadmap', regionOf: (x) => x.regRoadmap, label: 'Applicable Regions' },
    { key: 'Micro (BAU)', regionOf: (x) => x.regMicro, label: 'Regions (XCF)' },
  ];
  for (const t of TYPES) {
    for (const dim of ['Region', 'Business Group', 'Cost Centre']) {
      const panels = QUARTERS.map((q) => {
        const rows = live.filter((x) => x.quarter === q && x.type === t.key);
        if (dim === 'Region') return { quarter: q, ...tally(rows, t.regionOf) };
        if (dim === 'Business Group') return { quarter: q, ...tally(rows, (x) => x.bg) };
        return { quarter: q, ...tally(rows, (x) => costCentreCode(x.cc)) };
      });
      out.sections.push({
        type: t.key, dimension: dim,
        source: dim === 'Region' ? t.label : dim === 'Business Group' ? 'Business Group (XCF)' : 'SH Cost centre (XCF)',
        panels, notCaptured: panels.every((p) => p.withValue <= 1),
      });
    }
  }
  for (const x of live) {
    if (!x.cc || costCentreCode(x.cc)) continue;
    out.unrecognised.push({
      gid: x.gid, name: x.name, raw: String(x.cc).trim().slice(0, 80), quarter: x.quarter, type: x.type || 'Unset',
      url: `https://app.asana.com/1/${WORKSPACE}/project/${REQUESTS_PROJECT_GID}/task/${x.gid}`,
    });
  }
  out.unrecognised.sort((a, b) => a.raw.localeCompare(b.raw));
  const byMonth = {};
  for (const x of live) {
    const k = x.on.slice(0, 7);
    byMonth[k] = byMonth[k] || { n: 0, set: 0 };
    byMonth[k].n++;
    if (x.type) byMonth[k].set++;
  }
  out.meta = {
    typeCompletion: Object.keys(byMonth).sort().map((month) => ({ month, n: byMonth[month].n, pct: Math.round(byMonth[month].set / byMonth[month].n * 100) })),
    totalInWindow: live.length,
    cancelledExcluded: inWindow.length - live.length,
    byQuarter: QUARTERS.map((q) => ({ quarter: q, count: live.filter((x) => x.quarter === q).length })),
    typeUnset: live.filter((x) => !x.type).length,
    unrecognisedCount: out.unrecognised.length,
  };
  return out;
}

// The rows each tab would hold, in the order the build writes them.
function tabRows(regionalData) {
  const out = {};
  for (const name of REGIONAL_TABS) out[name] = PIPELINE_TABS.find((t) => t.name === name).rows({ regionalData });
  return out;
}

module.exports = { regionalFromRaw, tabRows, quarterOf, REGIONAL_TABS };

if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  (async () => {
    if (process.argv.includes('--check')) {
      const { buildRegionalData } = require('../src/regionalRequests');
      const { execFileSync } = require('child_process');
      const tmp = __dirname + '/../sheet-sync/regional-raw-check.json';
      execFileSync('node', [__dirname + '/regional-raw-check.js', '--write', tmp], { stdio: 'inherit' });
      const raw = JSON.parse(fs.readFileSync(tmp, 'utf8')).rows;
      const built = tabRows(await buildRegionalData());
      const fromRaw = tabRows(regionalFromRaw(raw));
      let all = true;
      for (const name of REGIONAL_TABS) {
        const b = built[name].map((r) => JSON.stringify(r));
        const g = fromRaw[name].map((r) => JSON.stringify(r));
        const bs = new Set(b);
        const same = g.filter((x) => bs.has(x)).length;
        const ordered = b.length === g.length && b.every((x, i) => x === g[i]);
        console.log(`${name}: build ${b.length} rows, from raw ${g.length}, identical ${same}, same order ${ordered}`);
        if (same !== b.length || b.length !== g.length) {
          all = false;
          b.filter((x) => !g.includes(x)).slice(0, 3).forEach((x) => console.log('  only in build:', x));
          g.filter((x) => !bs.has(x)).slice(0, 3).forEach((x) => console.log('  only from raw:', x));
        }
      }
      console.log(all ? 'The raw rows carry everything the Regional tabs need.' : 'MISMATCH');
      process.exit(all ? 0 : 1);
    }
    const rawPath = arg('--raw');
    if (!rawPath) { console.error('usage: --check | --raw file [--out file]'); process.exit(2); }
    const tabs = tabRows(regionalFromRaw(JSON.parse(fs.readFileSync(rawPath, 'utf8')).rows));
    const out = arg('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(tabs));
    for (const n of REGIONAL_TABS) console.log(n, tabs[n].length, 'rows');
  })().catch((e) => { console.error('failed:', e.response?.status, e.message); process.exit(2); });
}
