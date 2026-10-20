require('dotenv').config();
const cron = require('node-cron');
const { buildMemberData, buildPMData, buildScopeCreepData, buildOOOData, buildRoadmapData, buildBAUData } = require('./asana');
const { saveReport } = require('./report');
const { buildPMUpdatesData } = require('./slackUpdates');
const { buildRequestsData } = require('./requestTiming');
const { buildRegionalData } = require('./regionalRequests');

async function runReport() {
  console.log(`[${new Date().toISOString()}] Running XCF capacity report...`);

  const [capacityData, pmData, scopeCreepData, oooData, roadmapData, bauData, pmUpdatesData, requestsData, regionalData] = await Promise.all([
    buildMemberData(),
    buildPMData(),
    buildScopeCreepData(),
    buildOOOData(),
    buildRoadmapData(),
    buildBAUData(),
    buildPMUpdatesData(),
    buildRequestsData().catch((err) => {
      console.warn('[Requests] builder failed, tab will be empty:', err.message);
      return [];
    }),
    buildRegionalData().catch((err) => {
      console.warn('[Regional] builder failed, tab will be empty:', err.message);
      return null;
    }),
  ]);

  saveReport({ ...capacityData, pmData, scopeCreepData, oooData, pmUpdatesData, roadmapData, bauData, requestsData, regionalData });

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
