'use strict';
// Platform spend and usage tab.
//
// Source: the "XCF Platform spend and usage tracker" Google Sheet. The build has no Google login, so the sheet is
// copied into platform-spend-data.json by scripts/platform-spend-from-sheet.js (ask Claude to "sync the platform
// spend data"). This file only reads that snapshot, adds the totals and month-on-month changes the tab shows, and
// hands one object to the template (PLATFORM_DATA).
//
// Figures are ANNUAL cost in NZD as recorded for each month, not what was paid in that month. The tab says so.

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'platform-spend-data.json');
const MAX_AGE_DAYS = 35; // the sheet gets a new month about once a month; older than this and the tab says so

// A tool renamed in the sheet between months. Key = the old name, value = the current name. Without this a rename
// reads as one tool dropped and another added, instead of one tool whose cost changed.
const TOOL_ALIASES = { 'Chat GPT': 'Open AI' };

const USAGE_ORDER = ['High', 'Medium', 'Low', 'New tool'];

const cents = (n) => Math.round(n * 100);
const money = (n) => Math.round(n * 100) / 100;
const canonical = (name) => TOOL_ALIASES[String(name).trim()] || String(name).trim();

// What the page shows must not carry links (any external host sends the deploy to manual review) or a vendor
// contact's email address. The snapshot file keeps the sheet's words exactly; this only affects the page.
function cleanText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s*\(?[\w.+-]+@[\w-]+(\.[\w-]+)+\)?/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildPlatformData() {
  if (!fs.existsSync(DATA_PATH)) {
    console.warn('[Platform] platform-spend-data.json not found: the tab will say there is no data. Ask Claude to sync the platform spend data.');
    return null;
  }
  const snap = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const howTo = new Map((snap.usageHowTo || []).map((h) => [h.tool.trim().toLowerCase(), cleanText(h.how)]));

  const ageDays = Math.floor((Date.now() - new Date(snap.syncedAt).getTime()) / 86400000);
  if (ageDays > MAX_AGE_DAYS) {
    console.warn(`[Platform] snapshot is ${ageDays} days old (synced ${snap.syncedAt}). Ask Claude to sync the platform spend data.`);
  }

  const renamed = [];
  const months = (snap.months || []).map((m) => ({
    key: m.key,
    label: m.label,
    rows: m.rows.map((r) => {
      const key = canonical(r.tool);
      if (key !== r.tool.trim() && !renamed.some((x) => x.from === r.tool.trim())) renamed.push({ from: r.tool.trim(), to: key });
      return {
        tool: r.tool, toolKey: key, scope: r.scope, category: r.category, seats: r.seats, seatCount: r.seatCount,
        annual: r.annual, usage: r.usage, inTotal: r.inTotal, notes: cleanText(r.notes),
        howToCheck: howTo.get(key.toLowerCase()) || howTo.get(r.tool.trim().toLowerCase()) || '',
      };
    }),
  }));

  months.forEach((m, i) => {
    const included = m.rows.filter((r) => r.inTotal);
    const sum = (rows) => money(rows.reduce((s, r) => s + r.annual, 0));
    m.totals = {
      shared: sum(included.filter((r) => r.scope === 'Shared')),
      xcf: sum(included.filter((r) => r.scope === 'XCF only')),
      total: sum(included),
      toolCount: included.length,
      notInTotal: sum(m.rows.filter((r) => !r.inTotal)),
      notInTotalCount: m.rows.length - included.length,
    };

    // Cost by how much each tool is used (tools in the total only)
    m.byUsage = USAGE_ORDER.map((level) => {
      const rows = included.filter((r) => r.usage === level);
      return { level, total: sum(rows), count: rows.length, tools: rows.slice().sort((a, b) => b.annual - a.annual).map((r) => r.tool) };
    });

    // Change against the month before: per tool, and as a list that adds up to the change in the total
    const prev = months[i - 1];
    m.prevLabel = prev ? prev.label : null;
    const prevByKey = new Map((prev ? prev.rows : []).map((r) => [r.toolKey, r]));
    m.rows.forEach((r) => {
      const p = prevByKey.get(r.toolKey);
      r.change = !prev ? null
        : !p ? { kind: 'new', delta: r.annual, prev: null, prevName: null }
        : {
          kind: cents(r.annual) === cents(p.annual) ? 'same' : r.annual > p.annual ? 'up' : 'down',
          delta: money(r.annual - p.annual), prev: p.annual, prevName: p.tool !== r.tool ? p.tool : null,
        };
    });

    if (prev) {
      const items = [];
      const thisByKey = new Map(m.rows.map((r) => [r.toolKey, r]));
      const counted = (row) => (row && row.inTotal ? row.annual : 0);
      new Set([...thisByKey.keys(), ...prevByKey.keys()]).forEach((key) => {
        const now = thisByKey.get(key);
        const before = prevByKey.get(key);
        const delta = money(counted(now) - counted(before));
        if (cents(delta) === 0) return;
        items.push({
          tool: (now || before).tool, scope: (now || before).scope, from: money(counted(before)), to: money(counted(now)), delta,
          kind: !counted(before) ? 'new' : !counted(now) ? 'dropped' : delta > 0 ? 'up' : 'down',
        });
      });
      items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const prevTotal = prev.totals.total;
      m.changes = {
        items,
        delta: money(m.totals.total - prevTotal),
        pct: prevTotal ? Math.round(((m.totals.total - prevTotal) / prevTotal) * 1000) / 10 : null,
        sharedDelta: money(m.totals.shared - prev.totals.shared),
        xcfDelta: money(m.totals.xcf - prev.totals.xcf),
      };
    } else {
      m.changes = null;
    }
  });

  // Second guard (the sync script already refuses a sheet whose rows do not add up to its own Summary tab)
  const mismatches = [];
  (snap.sheetSummary || []).forEach((s) => {
    const m = months.find((x) => x.key === s.key);
    if (m && (cents(m.totals.total) !== cents(s.total) || cents(m.totals.shared) !== cents(s.shared) || cents(m.totals.xcf) !== cents(s.xcf))) {
      mismatches.push(`${s.label}: the tab adds up to ${m.totals.total.toFixed(2)}, the sheet's Summary says ${s.total.toFixed(2)}`);
    }
  });
  mismatches.forEach((x) => console.warn('[Platform] ' + x));

  console.log(`[Platform] ${months.length} months, latest ${months.length ? months[months.length - 1].label : 'none'}; snapshot ${ageDays} day${ageDays === 1 ? '' : 's'} old`);

  return {
    sourceTitle: snap.source && snap.source.title,
    syncedAt: snap.syncedAt,
    ageDays,
    stale: ageDays > MAX_AGE_DAYS,
    months,
    renamed,
    usageKey: snap.usageKey || [],
    usageHowTo: (snap.usageHowTo || []).map((h) => ({ tool: h.tool, how: cleanText(h.how) })),
    mismatches,
  };
}

module.exports = { buildPlatformData };
