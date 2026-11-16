#!/usr/bin/env node
'use strict';
// Writes brand/light.generated.css: the light-theme version of every colour in the report's own stylesheet.
//
//   node scripts/make-light-theme.js            (writes brand/light.generated.css)
//   node scripts/make-light-theme.js --report   (also prints what it changed, rule by rule)
//
// The report's stylesheet was written for a dark page: white text, white-at-low-opacity panels, bright accent text.
// Rather than hand-edit each of its rules, this reads them and writes a second set that only applies on a light
// page (`:root:not([data-theme="dark"])`). It changes colours and nothing else: no sizes, no text, no data.
//
// The rules (kept deliberately simple, so a person can read them):
//   white text                       -> ink (the dark navy), unless the same rule paints a solid brand-coloured background
//   white at low opacity (panels)    -> a faint navy tint, or the "soft" surface
//   white at low opacity (borders)   -> the line colour
//   near-black backgrounds           -> the "soft" surface (or a pale tint when they were dark green / purple / gold / blue)
//   bright accent text               -> the darker "ink" version of the same colour, so it can be read on white
// Backgrounds, bars and chart fills in accent colours are left bright: only TEXT is darkened.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'template.html');
const OUT = path.join(ROOT, 'brand', 'light.generated.css');
const REPORT = process.argv.includes('--report');
// :where() adds no specificity, so each generated rule ranks exactly like the report rule it came from (a state rule such
// as .active still beats its base rule) and wins over it only by coming later in the file
const LIGHT = ':where(:root:not([data-theme="dark"]))';

// ── colour helpers ─────────────────────────────────────────────────────────────────────────────────────────
function hexToRgb(h) {
  let x = h.replace('#', '').toLowerCase();
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  if (x.length === 8) x = x.slice(0, 6);
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum([r, g, b]) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}

// the colour a bright accent has when it is TEXT on a light page
const INK = {
  blue: 'var(--blue-ink)', mint: 'var(--mint-ink)', coral: 'var(--coral-ink)', gold: 'var(--gold-ink)', purple: 'var(--purple-ink)', muted: 'var(--muted)',
};
const VAR_TEXT = {
  '--sky': INK.blue, '--blue': INK.blue,
  '--green': INK.mint, '--mint': INK.mint,
  '--red': INK.coral,
  '--amber': INK.gold, '--yellow': INK.gold,
  '--purple': INK.purple, '--ops': INK.purple,
  '--mid-grey': INK.muted, '--warm-grey': INK.muted,
};
// the replacement for a dark background: opaque white for navy / grey panels (so a sticky column never shows what
// scrolls under it), a pale tint for the dark green / gold / purple ones
const TINT_FOR_HUE = (h, s) => {
  if (s < 0.22) return 'var(--card)';
  if (h >= 75 && h < 175) return 'var(--mint-bg)';
  if (h >= 30 && h < 75) return 'var(--gold-bg)';
  if (h >= 175 && h < 255) return 'var(--card)';
  if (h >= 255 && h < 335) return 'var(--purple-bg)';
  return 'var(--coral-bg)';
};
const INK_FOR_HUE = (h, s) => {
  if (s < 0.22) return INK.muted;
  if (h >= 75 && h < 175) return INK.mint;
  if (h >= 30 && h < 75) return INK.gold;
  if (h >= 175 && h < 255) return INK.blue;
  if (h >= 255 && h < 335) return INK.purple;
  return INK.coral;
};

// a text colour (hex) that is bright / light, and what to use for it on a light page
function textHex(hex) {
  const rgb = hexToRgb(hex);
  const L = lum(rgb);
  if (L > 0.93) return 'var(--ink)'; // white and near-white
  const { h, s, l } = hsl(rgb);
  if (L < 0.35) return null; // already dark enough to read on white
  if (s < 0.2) return INK.muted; // greys
  return INK_FOR_HUE(h, s) && l > 0.4 ? INK_FOR_HUE(h, s) : null;
}

// ── a very small CSS reader: rules, nested @media, declarations ────────────────────────────────────────────
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

function parseBlock(css, i, end) {
  const nodes = [];
  while (i < end) {
    while (i < end && /\s/.test(css[i])) i++;
    if (i >= end) break;
    const open = css.indexOf('{', i);
    if (open < 0 || open >= end) break;
    const head = css.slice(i, open).trim();
    // find the matching close brace
    let depth = 1, j = open + 1;
    while (j < end && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@')) {
      if (/^@(media|supports)/i.test(head)) nodes.push({ at: head, children: parseBlock(body, 0, body.length) });
      // @keyframes / @font-face / @import: ignored
    } else {
      nodes.push({ selector: head, decls: parseDecls(body) });
    }
    i = j;
  }
  return nodes;
}
function parseDecls(body) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((d) => {
    const k = d.indexOf(':');
    if (k < 0) return null;
    return { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() };
  }).filter(Boolean);
}

// ── turn one declaration into its light version (or null when nothing changes) ─────────────────────────────
const WHITE_ALPHA = /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*([0-9.]+)\s*)?\)/gi;
const BLACK_ALPHA = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*([0-9.]+)\s*)?\)/gi;
const MIDNIGHT_ALPHA = /rgba\(\s*0\s*,\s*8\s*,\s*86\s*,\s*([0-9.]+)\s*\)/gi;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function solidBackground(decls) {
  // the colour of a plain (non-translucent, non-gradient) background, if the rule sets one
  const bg = decls.find((d) => d.prop === 'background' || d.prop === 'background-color');
  if (!bg) return null;
  const v = bg.value.replace(/\s*!important/i, '').trim();
  if (/gradient|url\(|rgba|transparent|none/i.test(v)) return null;
  if (/^var\(--(blue|mid|red|green|purple|amber|yellow|sky|ops|mint)\)$/i.test(v)) return { token: v };
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return { hex: v };
  return null;
}

function transform(decl, ctx) {
  const { prop } = decl;
  let v = decl.value;
  const imp = /!important/i.test(v) ? ' !important' : '';
  v = v.replace(/\s*!important/i, '');
  const orig = v;

  const isText = prop === 'color';
  const isBg = prop === 'background' || prop === 'background-color';
  const isBorder = /^(border|outline)/.test(prop);
  const keepWhiteText = ctx.keepLightText;

  if (isText) {
    if (keepWhiteText) return null;
    let m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (m && VAR_TEXT[m[1]]) return `${prop}:${VAR_TEXT[m[1]]}${imp}`;
    m = v.match(/^(#[0-9a-fA-F]{3,8}|white)$/i);
    if (m) { const t = textHex(m[1].toLowerCase() === 'white' ? '#ffffff' : m[1]); return t ? `${prop}:${t}${imp}` : null; }
    m = v.match(WHITE_ALPHA); if (m) { const a = parseFloat(RegExp.$1 || '1'); return `${prop}:${a >= 0.75 ? 'var(--ink)' : 'var(--muted)'}${imp}`; }
    return null;
  }

  // white-alpha / black-alpha / midnight-alpha anywhere in a background, border, shadow or outline value
  let out = v;
  if (isBg) {
    out = out.replace(WHITE_ALPHA, (_, a) => {
      const al = parseFloat(a || '1');
      if (al >= 0.9) return '#fff';
      return al >= 0.07 ? 'var(--soft)' : `rgba(0,8,86,${Math.max(0.025, +(al * 0.7).toFixed(3))})`;
    });
    out = out.replace(MIDNIGHT_ALPHA, (_, a) => (parseFloat(a) >= 0.85 ? 'rgba(255,255,255,.97)' : `rgba(0,8,86,${a})`));
    out = out.replace(HEX, (hx) => {
      const rgb = hexToRgb(hx); const L = lum(rgb);
      if (L > 0.35) return hx; // light enough already
      const { h, s } = hsl(rgb);
      if (ctx.keepBrandBg && ctx.keepBrandBg === hx.toLowerCase()) return hx;
      return TINT_FOR_HUE(h, s);
    });
    out = out.replace(/var\(--mid\)/g, 'var(--mid)');
  } else if (isBorder) {
    out = out.replace(WHITE_ALPHA, 'var(--line)');
    out = out.replace(HEX, (hx) => { const rgb = hexToRgb(hx); return lum(rgb) < 0.3 && hsl(rgb).s < 0.6 ? 'var(--line)' : hx; });
  } else if (prop === 'box-shadow' || prop === 'text-shadow' || prop === 'filter') {
    out = out.replace(BLACK_ALPHA, (_, a) => `rgba(0,8,86,${Math.min(0.16, parseFloat(a || '0.2') * 0.35).toFixed(2)})`);
  } else if (prop === 'fill' || prop === 'stroke') {
    const m = v.match(/^(#[0-9a-fA-F]{3,8})$/); if (m && lum(hexToRgb(m[1])) > 0.93) out = 'var(--ink)';
  } else {
    return null;
  }
  return out !== orig ? `${prop}:${out}${imp}` : null;
}

function ruleContext(decls) {
  const sb = solidBackground(decls);
  let keepLightText = false;
  let keepBrandBg = null;
  if (sb && sb.token) keepLightText = true; // var(--blue), var(--mid), a coloured token
  if (sb && sb.hex) {
    const rgb = hexToRgb(sb.hex); const { s } = hsl(rgb); const L = lum(rgb);
    // a saturated, medium-dark colour is a brand fill (keep it, keep its white text); near-black is a dark panel (flip it)
    if (s >= 0.35 && L >= 0.1 && L < 0.6) { keepLightText = true; keepBrandBg = sb.hex.toLowerCase(); }
  }
  return { keepLightText, keepBrandBg };
}

function prefix(selector) {
  return selector.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    // html/body/:root selectors must not be double-prefixed
    if (/^(html|body|:root)\b/.test(s)) return `${LIGHT}${s.replace(/^(html|:root)/, '')}`.replace(/^(.*)$/, (x) => x);
    return `${LIGHT} ${s}`;
  }).join(',');
}

// rules the layout layer (brand/brand.css) owns outright: the sidebar, page header, footer and body
const OWNED = /^(\.ct-|\.top-|\.xcf-badge|\.nav-|\.footer|body\b|html\b|:root\b|\*)/;
const changed = [];
function emit(nodes, indent = '') {
  let css = '';
  for (const n of nodes) {
    if (n.children) {
      const inner = emit(n.children, indent + '  ');
      if (inner.trim()) css += `${indent}${n.at}{\n${inner}${indent}}\n`;
      continue;
    }
    if (/^(from|to|\d+%)/.test(n.selector)) continue; // keyframe steps
    if (n.selector.split(',').every((x) => OWNED.test(x.trim()))) continue;
    const ctx = ruleContext(n.decls);
    const outs = [];
    for (const d of n.decls) {
      const t = transform(d, ctx);
      if (t) outs.push(t);
    }
    if (outs.length) {
      css += `${indent}${prefix(n.selector)}{${outs.join(';')}}\n`;
      if (REPORT) changed.push(`${n.selector.slice(0, 70).padEnd(70)} ${outs.join('; ').slice(0, 150)}`);
    }
  }
  return css;
}

// Colours the report's script writes straight into style="..." attributes (bright accents that were chosen for a dark page).
// On a light page the TEXT version of each is swapped for the darker ink of the same hue; fills and bars stay bright.
const INLINE_INK = {
  'var(--gold-ink)': ['#FDCC08', '#F5A623', '#d97706', 'var(--amber)', 'var(--yellow)'],
  'var(--coral-ink)': ['#FF719B', '#d55181', 'var(--red)'],
  'var(--mint-ink)': ['#6AEAAA', '#4CAF8A', '#16a34a', 'var(--green)', 'var(--mint)'],
  'var(--blue-ink)': ['#3eccff', '#6C8EF5', '#60a5fa', '#3987e5', '#4a86b0', 'var(--sky)'],
  'var(--purple-ink)': ['#CF89FE', '#a78bfa', 'var(--purple)', 'var(--ops)'],
  'var(--muted)': ['#8b9abf', '#cbcac9'],
};
function inlineOverrides() {
  const root = ':root:not([data-theme="dark"])';
  let css = '/* colours written inline by the report script */\n';
  for (const [ink, list] of Object.entries(INLINE_INK)) {
    const sels = [];
    for (const x of list) {
      for (const sp of ['', ' ']) {
        sels.push(`${root} [style^="color:${sp}${x}" i]`, `${root} [style*=";color:${sp}${x}" i]`, `${root} [style*="; color:${sp}${x}" i]`);
      }
    }
    css += `${sels.join(',\n')}{color:${ink}!important}\n`;
    // the Platform tab's scope chips take their colour from a custom property
    css += `${list.map((x) => `${root} [style*="--sc:${x}" i]`).join(',\n')}{--sc:${ink}!important}\n`;
  }
  return css;
}

function main() {
  const html = fs.readFileSync(SRC, 'utf8');
  const style = html.slice(0, html.indexOf('<body>')).match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  const nodes = parseBlock(stripComments(style), 0, stripComments(style).length);
  const css = emit(nodes) + inlineOverrides();
  const head = `/* GENERATED by scripts/make-light-theme.js from the report's own stylesheet. Do not edit by hand: change the script and re-run it.\n   Light theme only (applies unless data-theme="dark"). Colours only: no sizes, no text, no data. */\n`;
  fs.writeFileSync(OUT, head + css, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, OUT)}  (${css.split('\n').filter(Boolean).length} rules, ${(css.length / 1024).toFixed(1)} KB)`);
  if (REPORT) console.log(changed.join('\n'));
}

main();
