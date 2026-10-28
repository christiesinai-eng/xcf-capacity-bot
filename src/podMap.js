const fs = require('fs');
const path = require('path');

const POD_MAP_FILE = path.join(__dirname, '..', 'config', 'pod-map.json');

// Who belongs to which POD. This is a plain lookup of names to team names — not a secret —
// so it lives in config/pod-map.json where anyone maintaining the dashboard can edit it,
// and every build (including the scheduled one) sees the same answer. It used to sit in a
// private .env variable, which meant a person added by one maintainer showed as "Unknown"
// on everyone else's build.
//
// The ASANA_POD_MAP env var is only a fallback for when the file is missing.
function loadPodMap() {
  if (fs.existsSync(POD_MAP_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(POD_MAP_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`config/pod-map.json is not valid JSON: ${err.message}`);
    }
  }
  return process.env.ASANA_POD_MAP ? JSON.parse(process.env.ASANA_POD_MAP) : {};
}

module.exports = { loadPodMap, POD_MAP_FILE };
