'use strict';
// Brand layer for the report. The report is ONE self-contained HTML file (nothing is fetched when it is opened), so the
// brand fonts, wordmark and charms are inlined as data URIs at build time.
//
//   {{BRAND_CSS}}        -> the contents of brand/brand.css
//   {{asset:file.ext}}   -> a data: URI for brand/assets/file.ext (fonts, svg, png)
//
// Only look-and-feel lives here. No data is read or changed.

const fs = require('fs');
const path = require('path');

const BRAND_DIR = path.join(__dirname, '..', 'brand');
const MIME = { '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const cache = new Map();

function dataUri(file) {
  if (!cache.has(file)) {
    const full = path.join(BRAND_DIR, 'assets', file);
    if (!fs.existsSync(full)) throw new Error(`brand asset not found: brand/assets/${file}`);
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`brand asset has an unknown type: ${file}`);
    cache.set(file, `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`);
  }
  return cache.get(file);
}

// The name at the top of the sidebar. Until a picture is added it is plain text ("XCF Workflow"). Two pictures are used, one for each
// theme, because the lettering has to read on a white sidebar and on a dark one:
//   brand/assets/xcf-workflow-for-light-bg.png   (dark lettering, shown in the light theme)
//   brand/assets/xcf-workflow-for-dark-bg.png    (pale lettering, shown in the dark theme)
// If only one picture exists it is used for both themes (xcf-workflow.jpg / .png / .svg / .webp also work as that single picture).
function brandLogo() {
  const has = (f) => fs.existsSync(path.join(BRAND_DIR, 'assets', f));
  const any = ['xcf-workflow.png', 'xcf-workflow.jpg', 'xcf-workflow.jpeg', 'xcf-workflow.svg', 'xcf-workflow.webp'].find(has);
  const light = has('xcf-workflow-for-light-bg.png') ? 'xcf-workflow-for-light-bg.png' : any;
  const dark = has('xcf-workflow-for-dark-bg.png') ? 'xcf-workflow-for-dark-bg.png' : any;
  if (!light && !dark) return '<span class="wm">XCF Workflow</span>';
  const img = (file, cls) => `<img class="${cls}" src="${dataUri(file)}" alt="XCF Workflow" width="200">`;
  if (light && dark && light !== dark) return img(light, 'logo-light') + img(dark, 'logo-dark');
  return img(light || dark, 'logo-any');
}

function inlineBrand(html) {
  let css = fs.readFileSync(path.join(BRAND_DIR, 'brand.css'), 'utf8');
  // the light theme is generated from the report's own stylesheet (scripts/make-light-theme.js)
  const genFile = path.join(BRAND_DIR, 'light.generated.css');
  css = css.replace('/*__LIGHT_GENERATED__*/', () => (fs.existsSync(genFile) ? fs.readFileSync(genFile, 'utf8') : ''));
  // the mockup's card styles, scoped to the overview page (scripts/scope-mockup-css.js)
  const mkFile = path.join(BRAND_DIR, 'mockup.scoped.css');
  css = css.replace('/*__MOCKUP_SCOPED__*/', () => (fs.existsSync(mkFile) ? fs.readFileSync(mkFile, 'utf8') : ''));
  // functions as the replacement, so "$" in the css or in a data URI is never read as a replace pattern
  const js = fs.readFileSync(path.join(BRAND_DIR, 'workflow.js'), 'utf8');
  let out = html.replace('{{BRAND_CSS}}', () => css).replace('{{BRAND_LOGO}}', () => brandLogo()).replace('{{BRAND_JS}}', () => js);
  out = out.replace(/\{\{asset:([A-Za-z0-9._-]+)\}\}/g, (_, file) => dataUri(file));
  if (/\{\{(asset:|BRAND_CSS|BRAND_LOGO|BRAND_JS)/.test(out)) throw new Error('an unresolved brand placeholder is left in the report');
  return out;
}

module.exports = { inlineBrand };
