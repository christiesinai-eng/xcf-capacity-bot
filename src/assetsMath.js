'use strict';
// "Assets delivered": the arithmetic behind the Assets delivered view, shared by the build (Node) and the
// dashboard page (browser) so both always give the same numbers.
//
// Rules, agreed 23 Nov 2026:
//   Delivered : a request in XCF | Requests whose Status (XCF) is Complete. The quarter it belongs to is the day it was
//               completed (completed_at, as an Auckland date), not the day it was created.
//   Quarters  : FY27 Q2 (1 Jul to 30 Sep 2026) and FY27 Q3 (1 Oct to 31 Dec 2026) only. "Overall" is the two together.
//   Which     : Project type Micro (BAU), Roadmap or XCF initiative. Older requests with no Project type are not counted.
//   Assets    : the number in Asset count (XCF) on the request. A delivered request with no count adds no assets; it is
//               still counted as a delivered request and reported, so the gap is visible.
//   Region    : Micro (BAU) uses Regions (XCF); Roadmap uses Applicable Regions; XCF initiative uses Regions (XCF) and
//               falls back to Applicable Regions. Grouped as US, UK, ANZ (AU and NZ), IM (every other named region),
//               Global (a Global tag) and No region.
//   Several   : a request tagged with several regions counts in each GROUP it touches, once (AU and NZ are one ANZ).
//               So the groups can add up to more than the total.
//
// A row is { gid, name, type, completedAt, assets, regMicro: [names], regRoadmap: [names] }.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetsMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const QUARTERS = [
    { key: 'FY27 Q2', from: '2026-07-01', to: '2026-09-30' },
    { key: 'FY27 Q3', from: '2026-10-01', to: '2026-12-31' },
  ];
  const OVERALL = { key: 'overall', label: 'Overall', from: QUARTERS[0].from, to: QUARTERS[QUARTERS.length - 1].to };
  const TYPES = ['Micro (BAU)', 'Roadmap', 'XCF initiative'];
  // Display order of the groups, and what each is called on the page.
  const GROUPS = ['US', 'UK', 'ANZ', 'IM', 'Global', 'No region'];
  const GROUP_LABEL = { US: 'US', UK: 'UK', ANZ: 'ANZ', IM: 'IM', Global: 'Global-tagged', 'No region': 'No region' };

  const str = (v) => (v === undefined || v === null ? '' : String(v));

  // A region name as typed in Asana ("Global (All Markets) ", "RoAsia (ID, PH, HK)") -> its group.
  function regionGroup(tag) {
    const t = str(tag).trim();
    if (!t) return null;
    if (/^global/i.test(t)) return 'Global';
    if (t === 'US') return 'US';
    if (t === 'UK') return 'UK';
    if (t === 'AU' || t === 'NZ' || t === 'ANZ') return 'ANZ';
    return 'IM';
  }

  // The region tags that count for this request, by its Project type.
  function regionTags(row) {
    const micro = (row.regMicro || []).filter((x) => str(x).trim());
    const road = (row.regRoadmap || []).filter((x) => str(x).trim());
    if (row.type === 'Roadmap') return road;
    if (row.type === 'Micro (BAU)') return micro;
    return micro.length ? micro : road; // XCF initiative
  }

  // The distinct groups a request counts in (never empty: a request with no region is in 'No region').
  function groupsOf(row) {
    const seen = [];
    regionTags(row).forEach((tag) => { const g = regionGroup(tag); if (g && seen.indexOf(g) < 0) seen.push(g); });
    return seen.length ? seen : ['No region'];
  }

  // completed_at (an ISO time in UTC) -> the date in Auckland, 'YYYY-MM-DD'. The financial year is New Zealand's, so a
  // request finished on the morning of 1 October counts in Q3 even though it was still 30 September in UTC.
  let fmt = null;
  function aucklandDate(iso) {
    const d = new Date(iso);
    if (!str(iso) || isNaN(d.getTime())) return null;
    if (!fmt) fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(d);
  }

  function inTypes(row) { return TYPES.indexOf(row.type) >= 0; }

  const assetsOf = (row) => (typeof row.assets === 'number' && isFinite(row.assets) && row.assets > 0 ? row.assets : 0);
  const hasCount = (row) => assetsOf(row) > 0;

  function viewOf(spec, rows) {
    const mine = rows.filter((r) => r.date >= spec.from && r.date <= spec.to);
    const total = mine.reduce((a, r) => a + assetsOf(r), 0);
    const tally = {};
    GROUPS.forEach((g) => { tally[g] = { group: g, label: GROUP_LABEL[g], assets: 0, requests: 0 }; });
    mine.forEach((r) => groupsOf(r).forEach((g) => { tally[g].assets += assetsOf(r); tally[g].requests += 1; }));
    const groups = GROUPS.map((g) => tally[g])
      .filter((g) => g.assets > 0 || g.requests > 0)
      .map((g) => Object.assign({}, g, { share: total > 0 ? Math.round(g.assets / total * 1000) / 10 : 0 }));
    const ranked = groups.filter((g) => g.assets > 0).slice().sort((a, b) => b.assets - a.assets || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    const types = TYPES.map((t) => {
      const of = mine.filter((r) => r.type === t);
      return { type: t, requests: of.length, assets: of.reduce((a, r) => a + assetsOf(r), 0) };
    });
    return {
      key: spec.key, label: spec.label || spec.key, from: spec.from, to: spec.to,
      assets: total, requests: mine.length, withCount: mine.filter(hasCount).length, noCount: mine.filter((r) => !hasCount(r)).length,
      groups, types, top: ranked.length ? { group: ranked[0].group, label: ranked[0].label, share: total > 0 ? Math.round(ranked[0].assets / total * 1000) / 10 : 0 } : null,
    };
  }

  // rows -> { order: ['overall', 'FY27 Q2', 'FY27 Q3'], views: { key: view }, rows: [the rows that count, newest first] }
  function summarise(allRows) {
    const seen = {};
    const rows = [];
    (allRows || []).forEach((r) => {
      if (!r || !inTypes(r)) return;
      const date = aucklandDate(r.completedAt);
      if (!date || date < OVERALL.from || date > OVERALL.to) return;
      const key = str(r.gid) || (str(r.name) + '|' + str(r.completedAt));
      if (seen[key]) return;
      seen[key] = true;
      rows.push(Object.assign({}, r, { date }));
    });
    const specs = [OVERALL].concat(QUARTERS.map((q) => ({ key: q.key, label: q.key, from: q.from, to: q.to })));
    const views = {};
    specs.forEach((s) => { views[s.key] = viewOf(s, rows); });
    return { order: specs.map((s) => s.key), views, rows: rows.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) };
  }

  // The biggest deliveries in a view, for the detail panel (one request can be most of a quarter).
  function biggest(summary, viewKey, n) {
    const v = summary.views[viewKey];
    if (!v) return [];
    return summary.rows
      .filter((r) => r.date >= v.from && r.date <= v.to && hasCount(r))
      .sort((a, b) => assetsOf(b) - assetsOf(a) || (a.date < b.date ? 1 : -1))
      .slice(0, n || 5)
      .map((r) => ({ gid: r.gid, name: r.name, type: r.type, date: r.date, assets: assetsOf(r), groups: groupsOf(r) }));
  }

  return { QUARTERS, OVERALL, TYPES, GROUPS, GROUP_LABEL, regionGroup, regionTags, groupsOf, aucklandDate, summarise, biggest };
}));
