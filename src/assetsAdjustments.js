'use strict';
// The hand-kept adjustments to the Assets delivered counts (see assetsMath.js for what each action does). The sheet tab
// Assets_Adjustments is the copy the dashboard page reads; this file is the copy the build reads and the seed for that tab.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'assets-adjustments.json');

// [{ match, action, asset_count, reason }]
function loadAdjustments(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file || FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[Assets] No adjustments file read (' + err.message + '), counting with none');
    return [];
  }
}

module.exports = { loadAdjustments, FILE };
