require('./loadEnv');
const cron = require('node-cron');
const { buildMemberData, buildPMData, buildScopeCreepData, buildOOOData, buildRoadmapData, buildBAUData } = require('./asana');
const { saveReport } = require('./report');
const { saveData } = require('./sheetSync');
const { buildPMUpdatesData } = require('./slackUpdates');
const { buildRequestsData } = require('./requestTiming');
const { buildRegionalData } = require('./regionalRequests');
const { buildAssetsData } = require('./assetsProjects');
const { buildPlatformData } = require('./platformSpend');

async function runReport() {
  console.log(`[${new Date().toISOString()}] Running XCF capacity report...`);
  const failures = []; // datasets that could not be built; the sheet sync keeps their last good rows

  const [capacityData, pmData, scopeCreepData, oooData, roadmapData, bauData, pmUpdatesData, requestsData, regionalData, assetsData] = await Promise.all([
    buildMemberData(),
    buildPMData(),
    buildScopeCreepData(),
    buildOOOData(),
    buildRoadmapData(),
    buildBAUData(),
    buildPMUpdatesData(),
    buildRequestsData().catch((err) => {
      console.warn('[Requests] builder failed, tab will be empty:', err.message);
      failures.push('requestsData');
      return [];
    }),
    buildRegionalData().catch((err) => {
      console.warn('[Regional] builder failed, tab will be empty:', err.message);
      failures.push('regionalData');
      return null;
    }),
    buildAssetsData().catch((err) => {
      console.warn('[Assets] builder failed, view will be empty:', err.message);
      failures.push('assetsData');
      return null;
    }),
  ]);

  // Platform spend and usage: read from platform-spend-data.json (a copy of the Google Sheet), so no network call
  let platformData = null;
  try {
    platformData = buildPlatformData();
  } catch (err) {
    console.warn('[Platform] builder failed, tab will be empty:', err.message);
  }

  const report = { ...capacityData, pmData, scopeCreepData, oooData, pmUpdatesData, roadmapData, bauData, requestsData, regionalData, assetsData, platformData };
  saveReport(report);
  // The same datasets, kept so the Google Sheet sync can run without asking Asana again.
  console.log(`Data saved: ${saveData({ ...report, failures })}`);

  console.log(`[${new Date().toISOString()}] Done.`);
}

// --once flag: run immediately then exit (useful for manual testing)
if (process.argv.includes('--once')) {
  runReport().catch((err) => {
    console.error('Report failed:', err.message);
    process.exit(1);
  });
} else {
  const schedule = '0 17 * * *';
  console.log(`XCF capacity bot started. Scheduled at: ${schedule} UTC (5:00am NZST)`);
  cron.schedule(schedule, () => {
    runReport().catch((err) => {
      console.error('Scheduled report failed:', err.message);
    });
  });
}
