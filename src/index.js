require('dotenv').config();
const cron = require('node-cron');
const { buildMemberData, buildPMData, buildScopeCreepData } = require('./asana');
const { saveReport } = require('./report');

async function runReport() {
  console.log(`[${new Date().toISOString()}] Running XCF capacity report...`);

  const [capacityData, pmData, scopeCreepData] = await Promise.all([
    buildMemberData(),
    buildPMData(),
    buildScopeCreepData(),
  ]);

  saveReport({ ...capacityData, pmData, scopeCreepData });

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
