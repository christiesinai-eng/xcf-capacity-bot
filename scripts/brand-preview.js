#!/usr/bin/env node
'use strict';
// Builds a PREVIEW of the branded report in seconds, from the newest real report.
//
//   node scripts/brand-preview.js [--from reports/xcf-report-YYYY-MM-DD.html] [--out reports/xcf-report-brand-preview.html]
//
// It copies every data block out of an existing report VERBATIM (the same text, byte for byte) and pours them into
// template.html, so the preview shows the real numbers with the new look. Nothing is fetched and nothing is
// recalculated. It never touches template.html, so the live report is unaffected.

const fs = require('fs');
const path = require('path');
const { inlineBrand } = require('../src/brandAssets');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };

// The data blocks report.js injects (src/report.js), plus the timestamp string.
const BLOCKS = ['MEMBERS', 'MISSING_TASKS', 'OVERDUE_TASKS', 'PM_DATA', 'SCOPE_CREEP_DATA', 'OOO_DATA', 'PM_UPDATES_DATA',
  'RT_RAW_TASKS', 'BAU_DATA', 'REQUESTS_DATA', 'REGIONAL_DATA', 'PLATFORM_DATA'];

function newestReport() {
  const files = fs.readdirSync(REPORTS).filter((f) => /^xcf-report-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
  if (!files.length) throw new Error('no xcf-report-YYYY-MM-DD.html found in reports/');
  return path.join(REPORTS, files[files.length - 1]);
}

// The value text of `const NAME = <value>;` as report.js wrote it (JSON with 2-space indent, so a top-level closing
// bracket sits at the start of a line).
function readBlock(html, name) {
  const head = `const ${name} = `;
  const start = html.indexOf(head);
  if (start < 0) throw new Error(`"${head}" not found in the source report`);
  const v = start + head.length;
  if (html.startsWith('[];', v) || html.startsWith('{};', v)) return html.slice(v, v + 2);
  if (html[v] === '"') return html.slice(v, html.indexOf('";', v) + 1);
  const closer = html[v] === '[' ? '\n];' : '\n};';
  const end = html.indexOf(closer, v);
  if (end < 0) throw new Error(`end of "${name}" not found`);
  return html.slice(v, end + closer.length - 1);
}

function main() {
  const from = arg('--from') ? path.resolve(arg('--from')) : newestReport();
  const out = arg('--out') ? path.resolve(arg('--out')) : path.join(REPORTS, 'xcf-report-brand-preview.html');
  const source = fs.readFileSync(from, 'utf8');
  let html = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');

  for (const name of BLOCKS) {
    const value = readBlock(source, name);
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[[\\s\\S]*?\\];`);
    if (!re.test(html)) throw new Error(`placeholder for ${name} not found in template.html`);
    html = html.replace(re, () => `const ${name} = ${value};`);
  }
  const stamp = readBlock(source, 'GENERATED_AT');
  const reStamp = /const\s+GENERATED_AT\s*=\s*"[^"]*";/;
  if (!reStamp.test(html)) throw new Error('placeholder for GENERATED_AT not found in template.html');
  html = html.replace(reStamp, () => `const GENERATED_AT = ${stamp};`);

  html = inlineBrand(html);
  fs.writeFileSync(out, html, 'utf8');
  console.log(`Preview written: ${path.relative(ROOT, out)}  (${(html.length / 1048576).toFixed(2)} MB)`);
  console.log(`  data copied from: ${path.relative(ROOT, from)}`);
}

main();
