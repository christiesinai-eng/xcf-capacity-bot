'use strict';
// Loads the generated report in a simulated browser twice, once with the data built into the page and once
// with data read from the (stand-in) Google Sheet, then compares what every tab shows.
//
//   node scripts/check-page-parity.js [--report reports/xcf-report-YYYY-MM-DD.html] [--data reports/xcf-data-YYYY-MM-DD.json]
//                                     [--humans tabs.json] [--today YYYY-MM-DD] [--api reply.json] [--tamper | --down]
//
// The simulated browser runs on the NZ date passed with --today (default: today) and answers /api/sheet with
// the rows the sheet sync would have written for the same build data.

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { apiResponse } = require('../test/helpers/sheetFixture');

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const nz = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
const reportFile = arg('--report') || path.join(__dirname, '..', 'reports', `xcf-report-${nz}.html`);
const dataFile = arg('--data') || path.join(__dirname, '..', 'reports', `xcf-data-${nz}.json`);
const today = arg('--today') || nz;
const html = fs.readFileSync(reportFile, 'utf8');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const humans = arg('--humans') ? JSON.parse(fs.readFileSync(arg('--humans'), 'utf8')) : undefined;
// --api file.json: use a real /api/sheet reply (for example one made from the live sheet) instead of the stand-in.
const resp = arg('--api') ? JSON.parse(fs.readFileSync(arg('--api'), 'utf8')) : apiResponse(data, humans);
// --tamper: change one number in the stand-in sheet, to prove this check notices.
if (process.argv.includes('--tamper')) resp.ranges.find((r) => r.range.startsWith('Tasks')).values[5][6] = '99';
const sheetJson = JSON.stringify(resp);

// Make "now" the chosen NZ date at 09:30 NZ time, so the page's own clock agrees with the build.
const FIXED_NOW = new Date(`${today}T09:30:00+13:00`).getTime();

function load({ sheet, down }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 300)));
  vc.on('error', (e) => errors.push(String(e).slice(0, 300)));
  const dom = new JSDOM(html, {
    url: `https://xcf-capacity-report.example/report.html${sheet ? '' : '?data=embedded'}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const RealDate = w.Date;
      class FixedDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(FIXED_NOW); else super(...a); }
        static now() { return FIXED_NOW; }
      }
      w.Date = FixedDate;
      w.XMLHttpRequest = class {
        open(_m, url) { this.url = url; }
        send() {
          if (this.url === '/api/sheet' && sheet && down) { this.status = 503; this.responseText = 'unavailable'; }
          else if (this.url === '/api/sheet' && sheet) { this.status = 200; this.responseText = sheetJson; }
          else { this.status = 404; this.responseText = ''; }
        }
      };
      w.requestAnimationFrame = (f) => setTimeout(f, 0);
      w.HTMLElement.prototype.scrollTo = () => {};
      w.scrollTo = () => {};
    },
  });
  return { dom, errors };
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const VIEWS = ['capacity', 'podsummary', 'missing', 'pmteam', 'scopecreep', 'forecaster', 'ooo', 'pmupdates', 'requests', 'regional'];

function capture({ dom, errors }) {
  const w = dom.window;
  const doc = w.document;
  const out = {};
  const click = (sel) => doc.querySelector(sel);
  for (const v of VIEWS) {
    const btn = click(`.nav-btn[onclick*="'${v}'"]`);
    try {
      w.showView(v, btn);
      if (v === 'capacity') {
        ['today', 'week', 'month'].forEach((t, i) => {
          w.setTab(t, doc.querySelectorAll('.time-tab')[i]);
          out[`capacity/${t}`] = clean(doc.getElementById('view-capacity').textContent);
        });
      } else {
        out[v] = clean(doc.getElementById(`view-${v}`).textContent);
      }
    } catch (e) {
      out[v] = `ERROR ${e.message}`;
    }
  }
  // The "Updated" stamp is the moment the page was generated; here the page is generated a little after the build.
  out.header = clean(doc.querySelector('.top-meta').textContent.replace(/Updated:.*?NZT/, '').replace(/Data:[^·]*(·[^·]*)?$/, ''));
  out.tabs = clean(doc.querySelector('.time-tabs').textContent);
  return { text: out, source: doc.getElementById('data-source').textContent, usedSheet: !!w.__SHEET__, sheetError: w.__SHEET_ERROR__, errors };
}

// --down: the sheet endpoint is unavailable. The page must still show the built-in data, and say so.
if (process.argv.includes('--down')) {
  const e = capture(load({ sheet: false }));
  const d = capture(load({ sheet: true, down: true }));
  const same = JSON.stringify(e.text) === JSON.stringify(d.text);
  console.log(`Sheet unavailable: page used sheet = ${d.usedSheet}; reason = "${d.sheetError}"; label = "${d.source}"`);
  console.log(same ? 'The page still shows exactly the built-in data.' : 'DIFFERENT: the page changed when the sheet was unavailable.');
  process.exit(!d.usedSheet && same && /could not be read/.test(d.source) ? 0 : 1);
}

const a = capture(load({ sheet: false }));
const b = capture(load({ sheet: true }));
const c = capture(load({ sheet: false })); // a second embedded load: shows the page is repeatable

let bad = 0;
console.log(`Embedded data  : used sheet = ${a.usedSheet}; "${a.source}"`);
console.log(`Sheet data     : used sheet = ${b.usedSheet}${b.sheetError ? ' (' + b.sheetError + ')' : ''}; "${b.source}"`);
if (!b.usedSheet) { console.log('The page did not use the sheet, so there is nothing to compare.'); process.exit(1); }
for (const k of Object.keys(a.text)) {
  const x = a.text[k];
  const y = b.text[k];
  if (x === y) { console.log(`same       ${k.padEnd(18)} (${x.length} characters)`); continue; }
  bad++;
  let i = 0;
  while (x[i] === y[i]) i++;
  console.log(`DIFFERENT  ${k}`);
  console.log('   built-in:', x.slice(Math.max(0, i - 80), i + 140));
  console.log('   sheet   :', y.slice(Math.max(0, i - 80), i + 140));
}
if (JSON.stringify(a.text) !== JSON.stringify(c.text)) { bad++; console.log('DIFFERENT  two embedded loads of the same page disagree (the page is not repeatable)'); }
const errs = [...new Set([...a.errors, ...b.errors])];
if (errs.length) { console.log('\nPage errors:'); errs.slice(0, 8).forEach((e) => console.log('  ', e)); }
console.log(`\n${bad ? bad + ' view(s) differ' : 'Every tab shows exactly the same text from the sheet as from the built-in data'}`);
process.exit(bad ? 1 : 0);
