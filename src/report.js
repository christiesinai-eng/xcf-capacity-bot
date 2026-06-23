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
  const replacement = `const ${name} = ${JSON.stringify(data, null, 2)};`;
  const updated = html.replace(regex, replacement);
  if (updated === html) {
    throw new Error(`Could not find "const ${name} = [...];" in template.html`);
  }
  return updated;
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

function generateReport({ members, missingTasks, overdueTasks, pmData, scopeCreepData }) {
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
