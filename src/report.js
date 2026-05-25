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

function generateReport({ members, missingTasks, overdueTasks }) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`HTML template not found at ${TEMPLATE_PATH}`);
  }
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  html = replaceArray(html, 'MEMBERS', members);
  html = replaceArray(html, 'MISSING_TASKS', missingTasks);
  html = replaceArray(html, 'OVERDUE_TASKS', overdueTasks);
  return html;
}

function saveReport(data) {
  const dateStr = new Date().toISOString().slice(0, 10);
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
