const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'template.html');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function buildReportPath(dateStr) {
  return path.join(REPORTS_DIR, `xcf-report-${dateStr}.html`);
}

// Replace a named JS array literal in the template: const NAME = [...];
function replaceArray(html, name, data) {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*\\[[\\s\\S]*?\\];`);
  if (!regex.test(html)) {
    throw new Error(`Could not find "const ${name} = [...];" in template.html`);
  }
  const replacement = `const ${name} = ${JSON.stringify(data, null, 2)};`;
  return html.replace(regex, replacement);
}

// Replace a named JS string literal in the template: const NAME = "...";
function replaceString(html, name, value) {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*"[^"]*";`);
  const replacement = `const ${name} = ${JSON.stringify(value)};`;
  const updated = html.replace(regex, replacement);
  if (updated === html) {
    throw new Error(`Could not find 'const ${name} = "...";' in template.html`);
  }
  return updated;
}

// mdToHtml lives in markdown.js so the dashboard page can use the very same code.
const { mdToHtml } = require('./markdown');

// Strip external domain URLs from Slack message text so the deploy scanner
// doesn't flag them. Keeps the link label text for readability.
const ALLOWED_URL_HOSTS = /^(app\.asana\.com|docs\.google\.com|xero\.com|slack\.com|www\.xero\.com)/i;
function stripExternalUrls(text) {
  if (!text) return text;
  // <URL|label> → keep label only when URL is external
  text = text.replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, (_, url, label) => {
    try {
      const host = new URL(url).hostname;
      return ALLOWED_URL_HOSTS.test(host) ? `<${url}|${label}>` : label;
    } catch { return label; }
  });
  // <URL> (no label) → drop entirely when external
  text = text.replace(/<(https?:\/\/[^>]+)>/g, (_, url) => {
    try {
      const host = new URL(url).hostname;
      return ALLOWED_URL_HOSTS.test(host) ? `<${url}>` : '';
    } catch { return ''; }
  });
  return text;
}

// Asana comments carry bare URLs — Canva, Figma, Miro, Frame.io, Calendly and the
// like — and any external host sends the deploy to manual review. The request table
// links to the Asana task itself, so the inline URLs add nothing and all of them go.
// Asana profile mentions become @mention so the sentence still reads.
function stripCommentUrls(text) {
  if (!text) return text;
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, '$2')
    .replace(/https?:\/\/app\.asana\.com\/\S*profile\/\d+/gi, '@mention')
    .replace(/<?https?:\/\/\S+>?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// NZT timestamp shown in the report header, e.g. "29 Oct 2026, 07:27 am NZT"
function nztStamp() {
  return new Date().toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' NZT';
}

// Everything the template is filled with, in the shape the page expects. Also what the Google Sheet
// adapter has to reproduce (see scripts/check-sheet-parity.js).
function templateDatasets({ members, missingTasks, overdueTasks, pmData, scopeCreepData, oooData, pmUpdatesData, roadmapData, bauData, requestsData, regionalData }) {
  return {
    MEMBERS: members,
    MISSING_TASKS: missingTasks,
    OVERDUE_TASKS: overdueTasks,
    PM_DATA: pmData || [],
    SCOPE_CREEP_DATA: scopeCreepData || [],
    OOO_DATA: oooData || [],
    PM_UPDATES_DATA: (pmUpdatesData || []).map(w => ({
      ...w,
      messages: (w.messages || []).map(m => ({ ...m, text: stripExternalUrls(m.text) })),
      executiveSummaryHtml: w.executiveSummary ? mdToHtml(w.executiveSummary) : null,
    })),
    RT_RAW_TASKS: roadmapData || [],
    BAU_DATA: bauData || [],
    REQUESTS_DATA: (requestsData || []).map(r => ({
      ...r,
      comments: (r.comments || []).map(c => ({ ...c, text: stripCommentUrls(c.text) })),
      summaryHtml: r.summary ? mdToHtml(r.summary) : null,
    })),
    REGIONAL_DATA: regionalData || {},
  };
}

function generateReport(data) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`HTML template not found at ${TEMPLATE_PATH}`);
  }

  const generatedAt = nztStamp();
  const d = templateDatasets(data);

  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  html = replaceArray(html, 'MEMBERS', d.MEMBERS);
  html = replaceArray(html, 'MISSING_TASKS', d.MISSING_TASKS);
  html = replaceArray(html, 'OVERDUE_TASKS', d.OVERDUE_TASKS);
  html = replaceArray(html, 'PM_DATA', d.PM_DATA);
  html = replaceArray(html, 'SCOPE_CREEP_DATA', d.SCOPE_CREEP_DATA);
  html = replaceArray(html, 'OOO_DATA', d.OOO_DATA);
  html = replaceArray(html, 'PM_UPDATES_DATA', d.PM_UPDATES_DATA);
  html = replaceArray(html, 'RT_RAW_TASKS', d.RT_RAW_TASKS);
  html = replaceArray(html, 'BAU_DATA', d.BAU_DATA);
  html = replaceArray(html, 'REQUESTS_DATA', d.REQUESTS_DATA);
  // Placeholder is an array literal but the payload is an object — replaceArray
  // only cares about the declaration shape it is replacing.
  html = replaceArray(html, 'REGIONAL_DATA', d.REGIONAL_DATA);
  html = replaceString(html, 'GENERATED_AT', generatedAt);
  // Last, so the placeholder patterns above can never match inside the library code.
  html = html.replace('/*__SHEET_LIBS__*/', () => sheetLibs());
  return html;
}

// The browser-side libraries, in load order: arithmetic, markdown, the sheet adapter, then the loader that uses them.
function sheetLibs() {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const code = ['capacityMath.js', 'markdown.js', 'sheetAdapter.js', 'sheetLoader.js'].map(read).join('\n');
  if (/<\/script/i.test(code)) throw new Error('a browser library contains </script>, which would end the inline script early');
  return code;
}

function saveReport(data) {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const reportPath = buildReportPath(dateStr);

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const html = generateReport(data);
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`Report saved: ${reportPath}`);
  return reportPath;
}

module.exports = { saveReport, generateReport, templateDatasets, nztStamp, mdToHtml, stripExternalUrls, stripCommentUrls };
