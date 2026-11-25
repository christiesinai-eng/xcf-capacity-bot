'use strict';
// "Assets delivered": the arithmetic behind the Assets delivered view, shared by the build (Node) and the
// dashboard page (browser) so both always give the same numbers.
//
// Rules, agreed 23 Nov 2026 (first drafted on requests, moved to projects the same day):
//   Delivered : a project in XCF | Projects that has been COMPLETED (closed in Asana, with a completed date). Assets are
//               counted when the project completes. The quarter it belongs to is the day it was completed (completed_at, as
//               an Auckland date), not the day it started.
//   Cancelled : a completed project whose Status (XCF) is Cancelled, or whose last status update is Dropped, was closed
//               without being delivered. It is left out of every number (and said so in the notes).
//   Quarters  : FY27 Q2 (1 Jul to 30 Sep 2026) and FY27 Q3 (1 Oct to 31 Dec 2026) only. "Overall" is the two together.
//   Which     : Project type Micro (BAU), Roadmap or XCF initiative. Projects with no Project type are not counted.
//   Assets    : the number in Asset count (XCF) on the project. A delivered project with no count adds no assets; it is
//               still counted as a delivered project and listed, so the gap is visible and can be chased.
//   Region    : Micro (BAU) and XCF initiative use Regions (XCF); Roadmap uses Applicable Regions. When that field is empty the
//               other one is used (24 Nov: a Micro project with Applicable Regions filled in was left under No region).
//               Grouped as US, UK, AU, NZ, IM (every other named region), Global (a Global tag) and No region. (AU and NZ were one
//               group, ANZ, until 25 Nov. A tag literally called ANZ counts for both AU and NZ.)
//   Several   : a project tagged to more than one region GROUP (for example AU and NZ, or US and UK) is counted once, under 'Multiple regions',
//               so the regions always add up to the total. Which regions it covers is shown beside it.
//   Adjusted  : a short list kept by hand in the sheet tab Assets_Adjustments, applied after the rules above:
//                 exclude         the project is not counted at all (it made no assets, or is not an asset project)
//                 ignore_missing  the project is not listed as missing a count (old work); any count it has still counts
//                 ignore_region   the project is not listed as missing a region and not shown under No region (sprints have none); it still counts in the totals
//                 set_count       the count to use instead of what Asana holds (asset_count)
//               A line matches a project by its XCF code (XCFP-386) or, when it is not a code, by words in its name.
//
// A row is { gid, name, type, completedAt, assets, regMicro: [names], regRoadmap: [names], status, update, owner }.

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
  const GROUPS = ['US', 'UK', 'AU', 'NZ', 'IM', 'Global', 'Multiple', 'No region'];
  const GROUP_LABEL = { US: 'US', UK: 'UK', AU: 'AU', NZ: 'NZ', IM: 'IM', Global: 'Global-tagged', Multiple: 'Multiple regions', 'No region': 'No region' };

  const str = (v) => (v === undefined || v === null ? '' : String(v));

  // A region name as typed in Asana ("Global (All Markets) ", "RoAsia (ID, PH, HK)") -> its group.
  function regionGroup(tag) {
    const t = str(tag).trim();
    if (!t) return null;
    if (/^global/i.test(t)) return 'Global';
    if (t === 'US') return 'US';
    if (t === 'UK') return 'UK';
    if (t === 'AU') return 'AU';
    if (t === 'NZ') return 'NZ';
    if (t === 'ANZ') return 'AU'; // see regionGroups: a tag called ANZ counts for both
    return 'IM';
  }

  // A tag's group or groups: one, except a tag literally called ANZ, which stands for both Australia and New Zealand.
  function regionGroups(tag) {
    if (str(tag).trim() === 'ANZ') return ['AU', 'NZ'];
    const g = regionGroup(tag);
    return g ? [g] : [];
  }

  // The region tags that count for this request, by its Project type.
  function regionTags(row) {
    const micro = (row.regMicro || []).filter((x) => str(x).trim());
    const road = (row.regRoadmap || []).filter((x) => str(x).trim());
    if (row.type === 'Roadmap') return road.length ? road : micro;
    return micro.length ? micro : road; // Micro (BAU) and XCF initiative
  }

  // The distinct groups a request counts in (never empty: a request with no region is in 'No region').
  function groupsOf(row) {
    const seen = [];
    regionTags(row).forEach((tag) => regionGroups(tag).forEach((g) => { if (seen.indexOf(g) < 0) seen.push(g); }));
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

  // The one bucket a project's assets are shown under, so every asset is counted once: its region group when it has just one,
  // 'Multiple' when it is tagged to more than one group (for example AU and NZ), 'No region' when it has none.
  function bucketOf(row) {
    const gs = groupsOf(row);
    return gs.length > 1 ? 'Multiple' : gs[0];
  }

  function inTypes(row) { return TYPES.indexOf(row.type) >= 0; }

  // Closed in Asana without being delivered: Status (XCF) Cancelled, or a last status update of Dropped.
  function isCancelled(row) {
    return str(row.status).trim().toLowerCase() === 'cancelled' || str(row.update).trim().toLowerCase() === 'dropped';
  }

  const assetsOf = (row) => (typeof row.assets === 'number' && isFinite(row.assets) && row.assets > 0 ? row.assets : 0);
  const hasCount = (row) => assetsOf(row) > 0;

  // ---- the hand-kept adjustments --------------------------------------------------------------------------------------
  const ACTIONS = ['exclude', 'ignore_missing', 'ignore_region', 'set_count'];
  const isCode = (m) => /^XCF[TP]?-\d+$/i.test(m);
  // A line matches a project by its XCF code anywhere in the name ("XCFP-386 | Multi-Product Strategy", "XCF-5 Sprint"), where
  // XCF-5 must not match XCF-50 or XCFP-5; otherwise by the words, any case.
  function adjusts(adj, row) {
    const m = str(adj.match).trim();
    if (!m) return false;
    const name = str(row.name);
    if (isCode(m)) {
      const at = name.toUpperCase().split(m.toUpperCase());
      if (at.length < 2) return false;
      let pos = 0;
      for (let i = 0; i < at.length - 1; i++) {
        pos += at[i].length;
        const before = name.charAt(pos - 1), after = name.charAt(pos + m.length);
        if (!/[A-Za-z0-9]/.test(before) && !/[0-9]/.test(after)) return true;
        pos += m.length;
      }
      return false;
    }
    return name.toLowerCase().indexOf(m.toLowerCase()) >= 0;
  }
  function cleanAdjustments(list) {
    return (list || []).map((a) => ({
      match: str(a && a.match).trim(), action: str(a && a.action).trim().toLowerCase().replace(/[\s-]+/g, '_'),
      assets: a && a.asset_count !== undefined && a.asset_count !== null && str(a.asset_count) !== '' ? Number(str(a.asset_count).replace(/,/g, '')) : null,
      reason: str(a && a.reason).trim(),
    })).filter((a) => a.match && ACTIONS.indexOf(a.action) >= 0);
  }

  function viewOf(spec, rows) {
    const mine = rows.filter((r) => r.date >= spec.from && r.date <= spec.to);
    const total = mine.reduce((a, r) => a + assetsOf(r), 0);
    const tally = {};
    GROUPS.forEach((g) => { tally[g] = { group: g, label: GROUP_LABEL[g], assets: 0, projects: 0 }; });
    // A project kept off the no-region list by hand (a sprint) has no region and never will, so it is not shown under No region
    // either; it still counts in the totals.
    mine.forEach((r) => { const g = bucketOf(r); if (g === 'No region' && r.regionIgnored) return; tally[g].assets += assetsOf(r); tally[g].projects += 1; });
    const groups = GROUPS.map((g) => tally[g])
      .filter((g) => g.assets > 0 || g.projects > 0)
      .map((g) => Object.assign({}, g, { share: total > 0 ? Math.round(g.assets / total * 1000) / 10 : 0 }));
    const ranked = groups.filter((g) => g.assets > 0 && g.group !== 'Multiple').slice().sort((a, b) => b.assets - a.assets || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    const types = TYPES.map((t) => {
      const of = mine.filter((r) => r.type === t);
      return { type: t, projects: of.length, assets: of.reduce((a, r) => a + assetsOf(r), 0) };
    });
    return {
      key: spec.key, label: spec.label || spec.key, from: spec.from, to: spec.to,
      assets: total, projects: mine.length, withCount: mine.filter(hasCount).length, noRegion: mine.filter((r) => groupsOf(r)[0] === 'No region' && !r.regionIgnored).length, // no region, and still expected to have one
      noCount: mine.filter((r) => !hasCount(r) && !r.ignored).length,   // no count, and still expected to have one
      ignored: mine.filter((r) => !hasCount(r) && r.ignored).length,    // no count, marked as old work: not chased
      groups, types, top: ranked.length ? { group: ranked[0].group, label: ranked[0].label, share: total > 0 ? Math.round(ranked[0].assets / total * 1000) / 10 : 0 } : null,
    };
  }

  // rows -> { order: ['overall', 'FY27 Q2', 'FY27 Q3'], views: { key: view }, rows: [the projects that count, newest first],
  //           meta: { cancelled, excluded, adjusted } }
  function summarise(allRows, adjustments) {
    const adj = cleanAdjustments(adjustments);
    const seen = {};
    const rows = [];
    const meta = { cancelled: 0, excluded: 0, adjusted: 0 };
    (allRows || []).forEach((r) => {
      if (!r || !inTypes(r)) return;
      const date = aucklandDate(r.completedAt);
      if (!date || date < OVERALL.from || date > OVERALL.to) return;
      const key = str(r.gid) || (str(r.name) + '|' + str(r.completedAt));
      if (seen[key]) return;
      seen[key] = true;
      if (isCancelled(r)) { meta.cancelled += 1; return; }
      const mine = adj.filter((a) => adjusts(a, r));
      if (mine.some((a) => a.action === 'exclude')) { meta.excluded += 1; return; }
      const row = Object.assign({}, r, { date, ignored: false, regionIgnored: false });
      mine.forEach((a) => {
        if (a.action === 'ignore_missing') row.ignored = true;
        if (a.action === 'ignore_region') row.regionIgnored = true;
        if (a.action === 'set_count' && a.assets !== null && isFinite(a.assets)) row.assets = a.assets;
      });
      if (mine.length) meta.adjusted += 1;
      rows.push(row);
    });
    const specs = [OVERALL].concat(QUARTERS.map((q) => ({ key: q.key, label: q.key, from: q.from, to: q.to })));
    const views = {};
    specs.forEach((s) => { views[s.key] = viewOf(s, rows); });
    return { order: specs.map((s) => s.key), views, meta, rows: rows.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) };
  }

  // The biggest deliveries in a view, for the detail panel (one project can be most of a quarter).
  function biggest(summary, viewKey, n) {
    const v = summary.views[viewKey];
    if (!v) return [];
    return summary.rows
      .filter((r) => r.date >= v.from && r.date <= v.to && hasCount(r))
      .sort((a, b) => assetsOf(b) - assetsOf(a) || (a.date < b.date ? 1 : -1))
      .slice(0, n || 5)
      .map((r) => ({ gid: r.gid, name: r.name, type: r.type, date: r.date, assets: assetsOf(r), groups: groupsOf(r) }));
  }

  // The delivered projects in a view that have no Asset count and are still expected to, newest first, with the quarter each
  // belongs to and who owns it.
  function withoutCount(summary, viewKey) {
    const v = summary.views[viewKey];
    if (!v) return [];
    return summary.rows
      .filter((r) => r.date >= v.from && r.date <= v.to && !hasCount(r) && !r.ignored)
      .map((r) => {
        const q = QUARTERS.filter((x) => r.date >= x.from && r.date <= x.to)[0];
        return { gid: r.gid, name: r.name, type: r.type, date: r.date, quarter: q ? q.key : '', owner: str(r.owner), groups: groupsOf(r) };
      });
  }

  // The projects in a view that are tagged to more than one region group, biggest first, with the regions they cover. Worked out
  // from the region tags the projects already have, so nobody has to fill in anything extra.
  function multiRegion(summary, viewKey) {
    const v = summary.views[viewKey];
    if (!v) return [];
    return summary.rows
      .filter((r) => r.date >= v.from && r.date <= v.to && bucketOf(r) === 'Multiple')
      .map((r) => {
        const q = QUARTERS.filter((x) => r.date >= x.from && r.date <= x.to)[0];
        const gs = groupsOf(r).slice().sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b));
        return { gid: r.gid, name: r.name, type: r.type, date: r.date, quarter: q ? q.key : '', owner: str(r.owner), assets: assetsOf(r), groups: gs, combo: gs.map((g) => GROUP_LABEL[g]).join(' + ') };
      })
      .sort((a, b) => b.assets - a.assets || (a.date < b.date ? 1 : -1));
  }

  // The delivered projects in a view that have no region on them (so they sit under "No region"), newest first, with the
  // field to fill in: Applicable Regions for a Roadmap project, Regions (XCF) for the rest.
  function withoutRegion(summary, viewKey) {
    const v = summary.views[viewKey];
    if (!v) return [];
    return summary.rows
      .filter((r) => r.date >= v.from && r.date <= v.to && groupsOf(r)[0] === 'No region' && !r.regionIgnored)
      .map((r) => {
        const q = QUARTERS.filter((x) => r.date >= x.from && r.date <= x.to)[0];
        return { gid: r.gid, name: r.name, type: r.type, date: r.date, quarter: q ? q.key : '', owner: str(r.owner), assets: assetsOf(r), field: r.type === 'Roadmap' ? 'Applicable Regions' : 'Regions (XCF)' };
      });
  }

  return { QUARTERS, OVERALL, TYPES, GROUPS, GROUP_LABEL, ACTIONS, regionGroup, regionGroups, regionTags, groupsOf, aucklandDate, isCancelled, adjusts, cleanAdjustments, summarise, biggest, withoutCount, withoutRegion, multiRegion, bucketOf };
}));
