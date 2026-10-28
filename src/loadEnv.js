const fs = require('fs');
const os = require('os');
const path = require('path');

// Credentials (ASANA_TOKEN, SLACK_TOKEN, SLACK_WEBHOOK_URL) must not live in the shared
// Drive folder, because everyone with access to the folder could read them. Each person
// keeps their own file on their own machine. dotenv never overwrites a variable that is
// already set, so the first file that defines a variable wins.
const candidates = [
  process.env.XCF_ENV_FILE,                              // explicit override
  path.join(os.homedir(), '.xcf-lighthouse.env'),        // the normal place
  path.join(__dirname, '..', '.env'),                    // legacy: a .env beside the code
].filter(Boolean);

const loaded = [];
for (const file of candidates) {
  if (fs.existsSync(file)) {
    require('dotenv').config({ path: file });
    loaded.push(file);
  }
}

if (!process.env.ASANA_TOKEN) {
  console.warn(
    'No ASANA_TOKEN found. Create ~/.xcf-lighthouse.env from .env.example and add your own tokens ' +
    '(searched: ' + candidates.join(', ') + ')'
  );
}

module.exports = { loaded };
