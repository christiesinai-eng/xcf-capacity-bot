const { asanaClient } = require('./asana');

const REQUESTS_PROJECT_GID = '1215906401561993'; // XCF | Requests
const F = {
  type:       '1217575429570978', // Project type (XCF)
  status:     '1211986892220398', // Status (XCF)
  regMicro:   '1213486033990545', // Regions (XCF)          — Micro BAU
  regRoadmap: '1212086752729219', // Applicable Regions     — Roadmap
  bg:         '1211914438576356', // Business Group (XCF)
  cc:         '1213093222630048', // SH Cost centre (XCF)   — free text
};

const QUARTERS = ['FY27 Q2', 'FY27 Q3'];
const WORKSPACE = () => process.env.ASANA_WORKSPACE_GID || '41261904390129';

// Xero FY starts 1 April: FY27 Q1 = Apr-Jun 2026.
function fiscalQuarter(iso) {
  const d = new Date(iso);
  const m = d.getUTCMonth();
  const q = Math.floor(((m + 9) % 12) / 3) + 1;
  const fy = (m >= 3 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()) % 100;
  return `FY${fy} Q${q}`;
}

const enumV = (t, g) => t.custom_fields?.find(f => f.gid === g)?.enum_value?.name || null;
const textV = (t, g) => t.custom_fields?.find(f => f.gid === g)?.text_value || null;
const multiV = (t, g) => (t.custom_fields?.find(f => f.gid === g)?.multi_enum_values || []).map(v => v.name);

// Cost centre is typed by hand, so the same centre appears as "3071",
// "3071 Digital Customer Engagement" and occasionally as free prose. Collapse on
// the leading numeric code; anything without one is surfaced for correction
// rather than dropped, which is why the raw value and task link are kept.
function costCentreCode(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{3,4})\b/);
  return m ? m[1] : null;
}

function tally(rows, valueFn) {
  const counts = {};
  let withValue = 0;
  for (const r of rows) {
    const vs = valueFn(r);
    const list = (Array.isArray(vs) ? vs : [vs]).filter(v => v != null && v !== '');
    if (list.length) withValue++;
    for (const v of list) counts[String(v).trim()] = (counts[String(v).trim()] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return {
    rows: entries.map(([label, count]) => ({ label, count, pct: total ? Math.round(count / total * 1000) / 10 : 0 })),
    total,
    withValue,
    missing: rows.length - withValue,
    requests: rows.length,
  };
}

async function buildRegionalData() {
  if (!process.env.ASANA_TOKEN) {
    console.warn('[Regional] No ASANA_TOKEN — skipping');
    return null;
  }
  const client = asanaClient();

  const tasks = [];
  let offset = null;
  try {
    do {
      const params = {
        project: REQUESTS_PROJECT_GID,
        opt_fields: [
          'gid,name,created_at,permalink_url',
          'custom_fields.gid,custom_fields.enum_value.name',
          'custom_fields.multi_enum_values.name,custom_fields.text_value',
        ].join(','),
        limit: 100,
      };
      if (offset) params.offset = offset;
      const resp = await client.get('/tasks', { params });
      tasks.push(...resp.data.data);
      offset = resp.data.next_page?.offset ?? null;
    } while (offset);
  } catch (err) {
    console.warn('[Regional] Fetch failed:', err.message);
    return null;
  }

  const live = tasks.filter(t =>
    t.created_at &&
    QUARTERS.includes(fiscalQuarter(t.created_at)) &&
    enumV(t, F.status) !== 'Cancelled'
  );

  const out = { quarters: QUARTERS, sections: [], unrecognised: [], meta: {} };

  const TYPES = [
    { key: 'Roadmap', regionField: F.regRoadmap, regionLabel: 'Applicable Regions' },
    { key: 'Micro (BAU)', regionField: F.regMicro, regionLabel: 'Regions (XCF)' },
  ];

  for (const t of TYPES) {
    for (const dim of ['Region', 'Business Group', 'Cost Centre']) {
      const panels = QUARTERS.map(q => {
        const rows = live.filter(x => fiscalQuarter(x.created_at) === q && enumV(x, F.type) === t.key);
        if (dim === 'Region') return { quarter: q, ...tally(rows, r => multiV(r, t.regionField)) };
        if (dim === 'Business Group') return { quarter: q, ...tally(rows, r => enumV(r, F.bg)) };
        return { quarter: q, ...tally(rows, r => costCentreCode(textV(r, F.cc))) };
      });
      out.sections.push({
        type: t.key,
        dimension: dim,
        source: dim === 'Region' ? t.regionLabel : dim === 'Business Group' ? 'Business Group (XCF)' : 'SH Cost centre (XCF)',
        panels,
        // Flagged when the field is effectively unused for this project type, so the
        // tab can say "not captured" rather than render a near-empty chart.
        notCaptured: panels.every(p => p.withValue <= 1),
      });
    }
  }

  // Cost-centre values that carry no leading code: listed with links so they can
  // be opened and corrected at source.
  for (const x of live) {
    const raw = textV(x, F.cc);
    if (!raw || costCentreCode(raw)) continue;
    out.unrecognised.push({
      gid: x.gid,
      name: (x.name || '').replace(/^\[Converted to project\]\s*/, ''),
      raw: String(raw).trim().slice(0, 80),
      quarter: fiscalQuarter(x.created_at),
      type: enumV(x, F.type) || 'Unset',
      url: `https://app.asana.com/1/${WORKSPACE()}/project/${REQUESTS_PROJECT_GID}/task/${x.gid}`,
    });
  }
  out.unrecognised.sort((a, b) => a.raw.localeCompare(b.raw));

  // Project type was made mandatory at intake in Sep 2026, so the unset rows are a
  // historical backlog rather than an ongoing gap. Tracking completion by month lets
  // the tab say that from the data instead of hardcoding the claim.
  const byMonth = {};
  for (const x of live) {
    const k = x.created_at.slice(0, 7);
    byMonth[k] = byMonth[k] || { n: 0, set: 0 };
    byMonth[k].n++;
    if (enumV(x, F.type)) byMonth[k].set++;
  }
  const typeCompletion = Object.keys(byMonth).sort().map(month => ({
    month,
    n: byMonth[month].n,
    pct: Math.round(byMonth[month].set / byMonth[month].n * 100),
  }));

  out.meta = {
    typeCompletion,
    totalInWindow: live.length,
    cancelledExcluded: tasks.filter(t =>
      t.created_at && QUARTERS.includes(fiscalQuarter(t.created_at)) && enumV(t, F.status) === 'Cancelled').length,
    byQuarter: QUARTERS.map(q => ({ quarter: q, count: live.filter(x => fiscalQuarter(x.created_at) === q).length })),
    typeUnset: live.filter(x => !enumV(x, F.type)).length,
    unrecognisedCount: out.unrecognised.length,
  };

  console.log(
    `[Regional] ${live.length} requests across ${QUARTERS.join(' + ')} ` +
    `(${out.meta.cancelledExcluded} cancelled excluded, ${out.meta.typeUnset} with no project type) | ` +
    `${out.unrecognised.length} unrecognised cost centres`
  );

  return out;
}

module.exports = { buildRegionalData };
