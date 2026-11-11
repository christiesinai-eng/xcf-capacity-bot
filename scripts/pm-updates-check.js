'use strict';
// Checks the PM-updates agent's tabs against the Slack channel itself (read only; uses SLACK_TOKEN like the build).
//
//   node scripts/pm-updates-check.js --tabs <tabs.json>
//   node scripts/pm-updates-check.js --write <expected.json> [--tabs <tabs.json>]   (also saves the live rows)
//
// The tabs file maps tab name to rows (header first): Glean_PM_Updates_Raw (ts, author, text) and Glean_PM_Updates
// (week_start, week_label, pm_name, posted_at, text), the second made by formulas from the first.
//
//  1. RAW    every Slack message of the last 12 weeks is in the raw tab once: same time (ts), same author, and text that
//            is the same, or the same words (the agent's Slack action may show emoji, links and @-names differently).
//  2. FORMULA the formula tab equals the build's rules (src/slackUpdates.js) applied to the sheet's raw rows, in the
//            build's order: weeks newest first, messages inside a week oldest first.
//  3. WHOLE  the formula tab equals those rules applied to Slack's own text, message by message.

const fs = require('fs');
require('../src/loadEnv.js');
const { WebClient } = require('@slack/web-api');
const { pmUpdateRow } = require('./glean-extra-formulas');

const CHANNEL = 'C0B3YCKT0JV'; // #xcf-pm-weekly-updates
const WEEKS_BACK = 12;
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const vals = (x) => (Array.isArray(x) ? x : (x && x.values) || []);
const S = (v) => (v === undefined || v === null ? '' : String(v));
const rowsOf = (tab, w) => vals(tab).slice(1).filter((r) => r.some((c) => S(c) !== '')).map((r) => Array.from({ length: w }, (_, i) => S(r[i])));
const spaceNorm = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
// What is left once markup, links, mentions and emoji are gone: the words a reader sees.
const words = (s) => s.toLowerCase()
  .replace(/<https?:[^|>]*\|([^>]*)>/g, ' $1 ').replace(/<[@#!][^>]*>/g, ' ').replace(/\[([^\]]*)\]\(https?:[^)]*\)/g, ' $1 ')
  .replace(/https?:\/\/\S+/g, ' ').replace(/:[a-z0-9_+\-]+:/g, ' ').replace(/&amp;/g, ' and ').replace(/&gt;|&lt;/g, ' ')
  .replace(/[^\p{L}\p{N}]+/g, ' ').trim().split(' ').filter(Boolean);
function similarity(a, b) {
  const A = words(a); const B = words(b);
  if (!A.length && !B.length) return 1;
  const m = new Map(); A.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
  let common = 0; B.forEach((w) => { const n = m.get(w); if (n) { common++; m.set(w, n - 1); } });
  return (2 * common) / (A.length + B.length);
}

async function liveMessages() {
  const token = process.env.SLACK_TOKEN;
  if (!token) throw new Error('SLACK_TOKEN not set');
  const client = new WebClient(token);
  const oldest = (Date.now() / 1000 - WEEKS_BACK * 7 * 24 * 3600).toFixed(0);
  let all = []; let cursor;
  do {
    const resp = await client.conversations.history({ channel: CHANNEL, oldest, limit: 200, ...(cursor ? { cursor } : {}) });
    all = all.concat((resp.messages || []).filter((m) => !m.subtype && (!m.thread_ts || m.thread_ts === m.ts)));
    cursor = resp.response_metadata?.next_cursor;
  } while (cursor);
  const names = {};
  const nameOf = async (id) => {
    if (names[id]) return names[id];
    try { const u = (await client.users.info({ user: id })).user; names[id] = u?.profile?.real_name || u?.profile?.display_name || u?.name || id; } catch { names[id] = id; }
    return names[id];
  };
  const out = [];
  for (const m of all) {
    if (/has (joined|left) the channel/.test(m.text || '')) continue;
    out.push({ ts: m.ts, author: await nameOf(m.user), text: m.text || '' });
  }
  return { oldest: Number(oldest), rows: out.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)) };
}

(async () => {
  const { oldest, rows: live } = await liveMessages();
  console.log(`Slack: ${live.length} messages in the last ${WEEKS_BACK} weeks (top level, no join/leave notices)`);
  if (arg('--write')) {
    fs.writeFileSync(arg('--write'), JSON.stringify({ header: ['ts', 'author', 'text'], rows: live.map((m) => [m.ts, m.author, m.text]) }));
    console.log('wrote', arg('--write'));
  }
  if (!arg('--tabs')) return;
  const tabs = JSON.parse(fs.readFileSync(arg('--tabs'), 'utf8'));
  const raw = rowsOf(tabs.Glean_PM_Updates_Raw, 3);
  const sheet = rowsOf(tabs.Glean_PM_Updates, 5);
  const liveBy = new Map(live.map((m) => [m.ts, m]));
  let bad = 0;
  const show = (label, list) => { if (list.length) { bad += list.length; console.log(`  ${label}: ${list.length}`); list.slice(0, 6).forEach((x) => console.log('    ' + x)); } };
  const edge = oldest + 86400; // a message this close to the start of the window may or may not be in it, depending on when each side ran

  // 1. RAW
  const seen = new Set(); const dupes = []; const extra = []; const authorBad = [];
  let exact = 0; let spaced = 0; let same = 0; const differ = [];
  for (const r of raw) {
    if (seen.has(r[0])) dupes.push(r[0]); seen.add(r[0]);
    const m = liveBy.get(r[0]);
    if (!m) { if (parseFloat(r[0]) > edge) extra.push(`${r[0]} (${r[1]}): not in Slack's last 12 weeks`); continue; }
    if (r[1] !== m.author) authorBad.push(`${r[0]}: author "${r[1]}" vs "${m.author}"`);
    if (r[2] === m.text) exact++;
    else if (spaceNorm(r[2]) === spaceNorm(m.text)) spaced++;
    else { const s = similarity(r[2], m.text); if (s >= 0.97) same++; else differ.push(`${r[0]} ${m.author}: only ${(s * 100).toFixed(0)}% of the words agree (sheet ${r[2].length} chars, Slack ${m.text.length})`); }
  }
  const missing = live.filter((m) => !seen.has(m.ts) && parseFloat(m.ts) > edge).map((m) => `${m.ts} (${m.author}): in Slack, not in the sheet`);
  console.log(`\nRaw tab: ${raw.length} messages | formula tab: ${sheet.length} rows`);
  console.log(`1. RAW: text identical ${exact}, same apart from spacing ${spaced}, same words but shown differently ${same}, different ${differ.length}`);
  show('repeated messages', dupes); show('missing', missing); show('not in Slack', extra); show('wrong author', authorBad); show('text differs', differ);
  if (same) console.log('  (the "shown differently" rows are fine for reading; ask for the plain Slack text if exact copies matter)');

  // 2. FORMULA vs rules on the sheet's own raw rows
  const want = raw.map((r) => pmUpdateRow(r[0], r[1], r[2]))
    .sort((a, b) => (a[0] === b[0] ? (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0) : a[0] < b[0] ? 1 : -1));
  const fBad = [];
  for (let i = 0; i < Math.max(want.length, sheet.length); i++) {
    const w = want[i]; const s = sheet[i];
    if (!w || !s) { fBad.push(`row ${i + 2}: ${!w ? 'extra row in formula tab' : 'row missing from formula tab'}`); continue; }
    const col = ['week_start', 'week_label', 'pm_name', 'posted_at', 'text'].filter((_, c) => w[c] !== s[c]);
    if (col.length) fBad.push(`row ${i + 2} (${w[3]}): ${col.join(', ')} differ${col.includes('text') ? '' : `: sheet "${s[0]}|${s[1]}|${s[3]}" vs rules "${w[0]}|${w[1]}|${w[3]}"`}`);
  }
  console.log(`\n2. FORMULA: ${sheet.length - fBad.length}/${Math.max(want.length, sheet.length)} rows equal the build's rules applied to the raw tab, in the build's order`);
  show('formula tab differs from the rules', fBad);

  // 3. WHOLE vs rules on Slack's own text
  const wBad = []; let wOk = 0;
  for (const s of sheet) {
    const ts = raw.find((r) => r[2] !== undefined && pmUpdateRow(r[0], r[1], r[2])[3] === s[3])?.[0];
    const m = ts && liveBy.get(ts);
    if (!m) continue;
    const w = pmUpdateRow(m.ts, m.author, m.text);
    if (w.every((v, c) => v === s[c])) wOk++;
    else if (w.slice(0, 4).every((v, c) => v === s[c])) { const sim = similarity(w[4], s[4]); if (sim >= 0.97) wOk++; else wBad.push(`${w[3]} ${m.author}: text ${(sim * 100).toFixed(0)}% alike`); }
    else wBad.push(`${w[3]}: week/time/author differ`);
  }
  console.log(`\n3. WHOLE: ${wOk}/${sheet.length} dashboard rows equal what the build would show for the same Slack message (text counted equal at 97% of words)`);
  show('differs from what the build shows', wBad);

  console.log(bad ? `\n${bad} problem(s) found above.` : '\nAll checks pass.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('failed:', e.data?.error || e.message); process.exit(2); });
