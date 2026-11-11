'use strict';
// Checks the request-comments agent's tabs against Asana itself (read only).
//
//   node scripts/request-comments-check.js --tabs <tabs.json> [--data reports/xcf-data-DATE.json]
//   node scripts/request-comments-check.js --write <expected.json> --tabs <tabs.json>   (also saves the live rows)
//
// The tabs file maps tab name to rows (header first), as read from the sheet:
//   Glean_Request_Comments_Raw, Glean_Request_Comments_Checked, Glean_Request_Comments, Requests (= Glean_Requests)
// The requests to check are the matched ones on the Requests tab (or --data's requestsData when there is no such tab).
//
// What it says:
//  1. RAW   every comment the agent copied equals the live Asana comment (author, time, text; text may be cut at 3,000).
//  2. COVER for every request the agent has checked: no live comment missing (a comment newer than the request's
//     checked_at is only "not seen yet", not a fault) and no row Asana does not have.
//  3. CLEAN the formula tab equals the rules in src/requestTiming.js applied to the sheet's own raw text (formulas right)
//     and to the live text (whole chain right), in chronological order within each request.
//  4. COUNT the comment_count column of Glean_Requests equals the rows in the clean tab for that request.

const fs = require('fs');
require('../src/loadEnv.js');
const { asanaClient, batchedMap } = require('../src/asana');
const { cleanComment } = require('./glean-extra-formulas');

const RAW_CAP = 3000;
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const vals = (x) => (Array.isArray(x) ? x : (x && x.values) || []);
const S = (v) => (v === undefined || v === null ? '' : String(v));
const rowsOf = (tab, width) => vals(tab).slice(1).filter((r) => r.some((c) => S(c) !== '')).map((r) => Array.from({ length: width }, (_, i) => S(r[i])));
const space = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const key = (g, at) => `${g}|${at}`;

async function liveComments(client, gid) {
  const out = [];
  let offset = null;
  do {
    const params = { opt_fields: 'created_at,resource_subtype,text,created_by.name', limit: 100 };
    if (offset) params.offset = offset;
    const r = await client.get(`/tasks/${gid}/stories`, { params });
    out.push(...r.data.data);
    offset = r.data.next_page?.offset ?? null;
  } while (offset);
  return out.filter((s) => s.resource_subtype === 'comment_added' && s.text)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((s) => ({ author: s.created_by?.name || 'Unknown', at: s.created_at, text: s.text }));
}

(async () => {
  const tabsPath = arg('--tabs');
  const tabs = tabsPath ? JSON.parse(fs.readFileSync(tabsPath, 'utf8')) : {};

  // The matched requests
  let matched;
  if (tabs.Requests) {
    matched = rowsOf(tabs.Requests, 21).filter((r) => r[11].toUpperCase() === 'TRUE').map((r) => ({ gid: r[0], code: r[1], status: r[7], count: r[20] }));
  } else if (arg('--data')) {
    matched = JSON.parse(fs.readFileSync(arg('--data'), 'utf8')).requestsData.filter((r) => r.matched).map((r) => ({ gid: r.gid, code: r.code, status: r.requestStatus, count: String(r.commentCount) }));
  } else { console.log('need a Requests tab in --tabs or --data'); process.exit(1); }
  console.log(`Matched requests: ${matched.length}`);

  // Live comments
  const client = asanaClient();
  const live = new Map();
  let failed = 0;
  await batchedMap(matched, async (m) => { try { live.set(m.gid, await liveComments(client, m.gid)); } catch { failed++; } }, 5, 300);
  const liveTotal = [...live.values()].reduce((s, c) => s + c.length, 0);
  console.log(`Live Asana: ${live.size} requests read${failed ? ` (${failed} failed)` : ''}, ${liveTotal} comments on ${[...live.values()].filter((c) => c.length).length} requests`);
  if (arg('--write')) {
    const rows = matched.flatMap((m) => (live.get(m.gid) || []).map((c) => [m.gid, m.code, c.author, c.at, c.text.slice(0, RAW_CAP)]));
    fs.writeFileSync(arg('--write'), JSON.stringify({ header: ['request_gid', 'code', 'author', 'posted_at', 'text'], rows }));
    console.log('wrote', arg('--write'), rows.length, 'rows');
  }
  if (!tabsPath) return;

  const raw = rowsOf(tabs.Glean_Request_Comments_Raw, 5);
  const checked = rowsOf(tabs.Glean_Request_Comments_Checked, 3);
  const clean = rowsOf(tabs.Glean_Request_Comments, 5);
  const byGid = new Map(matched.map((m) => [m.gid, m]));
  const checkedAt = new Map(checked.map((r) => [r[0], r[1]]));
  let bad = 0;
  const show = (label, list) => { if (list.length) { bad += list.length; console.log(`  ${label}: ${list.length}`); list.slice(0, 5).forEach((x) => console.log('    ' + x)); } };

  // Progress
  const dupChecked = checked.length - checkedAt.size;
  const unchecked = matched.filter((m) => !checkedAt.has(m.gid)).length;
  console.log(`\nChecked tab: ${checked.length} rows (${dupChecked} are re-checks; the last row for a request counts), ${unchecked} matched requests not checked yet,${[...checkedAt.keys()].filter((g) => !byGid.has(g)).length} not on the matched list`);
  console.log(`Raw tab: ${raw.length} rows on ${new Set(raw.map((r) => r[0])).size} requests | clean tab: ${clean.length} rows`);

  // 1. RAW
  const rawKeys = new Map();
  const dupes = [];
  const rawBad = [];
  let rawExact = 0; let rawSpace = 0;
  for (const r of raw) {
    const k = key(r[0], r[3]);
    if (rawKeys.has(k)) dupes.push(`${r[0]} ${r[3]}`);
    rawKeys.set(k, r);
    const m = byGid.get(r[0]);
    const lv = (live.get(r[0]) || []).find((c) => c.at === r[3]);
    if (!m) { rawBad.push(`${r[0]} ${r[1]}: request is not on the matched list`); continue; }
    if (!lv) { rawBad.push(`${m.code} ${r[3]}: Asana has no comment at that time`); continue; }
    const want = lv.text.slice(0, RAW_CAP);
    if (r[1] !== m.code) rawBad.push(`${m.code} ${r[3]}: code is "${r[1]}"`);
    else if (r[2] !== lv.author) rawBad.push(`${m.code} ${r[3]}: author "${r[2]}" vs "${lv.author}"`);
    else if (r[4] === want) rawExact++;
    else if (space(r[4]) === space(want)) rawSpace++;
    else rawBad.push(`${m.code} ${r[3]}: text differs (sheet ${r[4].length} chars, Asana ${want.length}): "${r[4].slice(0, 60).replace(/\n/g, ' ')}..." vs "${want.slice(0, 60).replace(/\n/g, ' ')}..."`);
  }
  console.log(`\n1. RAW: ${rawExact} identical, ${rawSpace} differ only in spacing/line breaks, ${rawBad.length + dupes.length} wrong`);
  show('repeated comment rows', dupes);
  show('wrong raw rows', rawBad);

  // 2. COVER
  const missing = []; const notSeen = []; const extra = [];
  for (const [g, at] of checkedAt) {
    const m = byGid.get(g); if (!m) continue;
    for (const c of live.get(g) || []) {
      if (rawKeys.has(key(g, c.at))) continue;
      (c.at > at ? notSeen : missing).push(`${m.code} ${c.at} (${c.author})`);
    }
  }
  for (const r of raw) if (checkedAt.has(r[0]) === false) extra.push(`${r[1]} ${r[3]}: comment rows for a request that is not in the Checked tab`);
  console.log(`\n2. COVER: ${notSeen.length} comments newer than the request's last check (fine, picked up on its next check)`);
  show('comments Asana has that the sheet lacks for a checked request', missing);
  show('rows without a Checked entry', extra);

  // 3. CLEAN
  const cleanBy = new Map(clean.map((r) => [key(r[0], r[3]), r]));
  let fOk = 0; let eOk = 0;
  const fBad = []; const eBad = [];
  for (const r of raw) {
    const c = cleanBy.get(key(r[0], r[3]));
    if (!c) { fBad.push(`${r[1]} ${r[3]}: no row in the clean tab`); continue; }
    if (c[1] !== r[1] || c[2] !== r[2]) fBad.push(`${r[1]} ${r[3]}: code/author changed`);
    else if (c[4] === cleanComment(r[4])) fOk++;
    else fBad.push(`${r[1]} ${r[3]}: formula gives "${c[4].slice(0, 70).replace(/\n/g, ' ')}" but the rules give "${cleanComment(r[4]).slice(0, 70).replace(/\n/g, ' ')}"`);
    const lv = (live.get(r[0]) || []).find((x) => x.at === r[3]);
    if (lv) { if (c[4] === cleanComment(lv.text)) eOk++; else eBad.push(`${r[1]} ${r[3]}: clean text differs from the rules applied to Asana's text`); }
  }
  const order = [];
  const seen = new Map();
  for (const c of clean) { const p = seen.get(c[0]); if (p && p > c[3]) order.push(`${c[1]}: ${c[3]} comes after ${p}`); seen.set(c[0], c[3]); }
  const interleaved = []; const closed = new Set(); let last = null;
  for (const c of clean) { if (c[0] !== last) { if (closed.has(c[0])) interleaved.push(c[1]); if (last) closed.add(last); last = c[0]; } }
  console.log(`\n3. CLEAN: formula tab = rules on the sheet's raw text for ${fOk}/${raw.length} rows; = rules on Asana's text for ${eOk}/${raw.length}`);
  show('formula differs from the rules', fBad);
  show('clean text differs from Asana-derived text', eBad);
  show('comments out of time order inside a request', order);
  show('a request whose comments are split into two blocks', interleaved);

  // 4. COUNT
  const perGid = new Map();
  clean.forEach((c) => perGid.set(c[0], (perGid.get(c[0]) || 0) + 1));
  const cnt = matched.filter((m) => S(m.count) !== String(perGid.get(m.gid) || 0)).map((m) => `${m.code}: comment_count ${m.count || '(blank)'} vs ${perGid.get(m.gid) || 0} rows`);
  console.log(`\n4. COUNT: comment_count agrees with the clean tab for ${matched.length - cnt.length}/${matched.length} requests`);
  show('comment_count differs', cnt);

  console.log(bad ? `\n${bad} problem(s) found above.` : '\nAll checks pass.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('failed:', e.response?.status, e.message); process.exit(2); });
