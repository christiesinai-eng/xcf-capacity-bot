const fs = require('fs');
const path = require('path');

function replaceArrayInTemplate(template, varName, dataArray) {
  const pattern = `const ${varName}=[];`;
  const replacement = `const ${varName}=${JSON.stringify(dataArray)};`;
  if (!template.includes(pattern)) {
    console.warn(`[Costings] Warning: placeholder '${pattern}' not found in template`);
  }
  return template.split(pattern).join(replacement);
}

function saveCostingsReport(data) {
  const template = fs.readFileSync(path.join(__dirname, '../costings-template.html'), 'utf8');

  let output = template;
  output = replaceArrayInTemplate(output, 'COST_PER_ASSET_DATA', data.costPerAssetData);
  output = replaceArrayInTemplate(output, 'AI_CREDITS_DATA', data.aiCreditsData);

  // Update timestamp
  const nzDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const dateStr = new Date(nzDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  output = output.replace(/5 Oct 2026/g, dateStr);
  output = output.replace(/<strong id="updated-time">.*?<\/strong>/, `<strong id="updated-time">${dateStr}</strong>`);
  output = output.replace(/<title>.*?<\/title>/, `<title>XCF Costings Report · ${dateStr}</title>`);

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filename = `xcf-costings-report-${nzDate}.html`;
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, output, 'utf8');

  console.log(`[Costings] Report saved to ${filepath}`);
  return filename;
}

module.exports = { saveCostingsReport };
