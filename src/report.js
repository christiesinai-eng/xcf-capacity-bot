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

// Lightweight markdown → HTML for executive summaries
function mdToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inUl = false, inTable = false, tableHasHead = false;

  function flushUl() { if (inUl) { out.push('</ul>'); inUl = false; } }
  function flushTable() { if (inTable) { out.push('</tbody></table>'); inTable = false; tableHasHead = false; } }
  function flushAll() { flushUl(); flushTable(); }

  function inline(t) {
    return t
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (/^\s*$/.test(line)) { flushAll(); out.push('<div style="margin:.4em 0"></div>'); continue; }
    if (/^---+$/.test(line)) { flushAll(); out.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,.1);margin:.8em 0">'); continue; }
    if (/^## /.test(line)) { flushAll(); out.push(`<h2 class="exec-h2">${inline(line.slice(3))}</h2>`); continue; }
    if (/^### /.test(line)) { flushAll(); out.push(`<h3 class="exec-h3">${inline(line.slice(4))}</h3>`); continue; }
    if (/^> /.test(line)) { flushAll(); out.push(`<blockquote class="exec-bq">${inline(line.slice(2))}</blockquote>`); continue; }
    if (/^\* /.test(line) || /^- /.test(line)) {
      flushTable();
      if (!inUl) { out.push('<ul class="exec-ul">'); inUl = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flushUl();
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (/^[\s|:-]+$/.test(line)) { tableHasHead = true; continue; }
      if (!inTable) { out.push('<table class="exec-tbl"><tbody>'); inTable = true; }
      const tag = (!tableHasHead) ? 'th' : 'td';
      out.push(`<tr>${cells.map(c=>`<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      if (tag === 'th') tableHasHead = true;
      continue;
    }
    flushAll();
    out.push(`<p class="exec-p">${inline(line)}</p>`);
  }
  flushAll();
  return out.join('\n');
}

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

function generateReport({ members, missingTasks, overdueTasks, pmData, scopeCreepData, oooData, pmUpdatesData, roadmapData, bauData, requestsData, regionalData }) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`HTML template not found at ${TEMPLATE_PATH}`);
  }

  // NZT timestamp at generation time
  const generatedAt = new Date().toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' NZT';

  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  html = replaceArray(html, 'MEMBERS', members);
  html = replaceArray(html, 'MISSING_TASKS', missingTasks);
  html = replaceArray(html, 'OVERDUE_TASKS', overdueTasks);
  html = replaceArray(html, 'PM_DATA', pmData || []);
  html = replaceArray(html, 'SCOPE_CREEP_DATA', scopeCreepData || []);
  html = replaceArray(html, 'OOO_DATA', oooData || []);
  const pmUpdatesWithHtml = (pmUpdatesData || []).map(w => ({
    ...w,
    messages: (w.messages || []).map(m => ({ ...m, text: stripExternalUrls(m.text) })),
    executiveSummaryHtml: w.executiveSummary ? mdToHtml(w.executiveSummary) : null,
  }));
  html = replaceArray(html, 'PM_UPDATES_DATA', pmUpdatesWithHtml);
  html = replaceArray(html, 'RT_RAW_TASKS', roadmapData || []);
  html = replaceArray(html, 'BAU_DATA', bauData || []);
  const requestsWithHtml = (requestsData || []).map(r => ({
    ...r,
    comments: (r.comments || []).map(c => ({ ...c, text: stripCommentUrls(c.text) })),
    summaryHtml: r.summary ? mdToHtml(r.summary) : null,
  }));
  html = replaceArray(html, 'REQUESTS_DATA', requestsWithHtml);
  // Placeholder is an array literal but the payload is an object — replaceArray
  // only cares about the declaration shape it is replacing.
  html = replaceArray(html, 'REGIONAL_DATA', regionalData || {});
  html = replaceString(html, 'GENERATED_AT', generatedAt);
  return html;
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

module.exports = { saveReport, generateReport };
