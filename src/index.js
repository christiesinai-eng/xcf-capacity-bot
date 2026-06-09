require('dotenv').config();
const cron = require('node-cron');
const { buildMemberData } = require('./asana');
const { saveReport } = require('./report');
const { postReport } = require('./slack');

async function runReport() {
  console.log(`[${new Date().toISOString()}] Running XCF capacity report...`);

  const data = await buildMemberData();
  const reportPath = saveReport(data);

  console.log(`[${new Date().toISOString()}] Done.`);
}

// --once flag: run immediately then exit (useful for manual testing)
if (process.argv.includes('--once')) {
  runReport().catch((err) => {
    console.error('Report failed:', err.message);
    process.exit(1);
  });
} else {
  // 5:00am NZT daily = 17:00 UTC
  // NZT is UTC+12 (NZST) or UTC+13 (NZDT in summer).
  // The cron expression 0 17 * * * fires at 17:00 UTC = 05:00 NZST.
  // During daylight saving (NZDT, UTC+13) it fires at 06:00 NZT — adjust to
  // 0 16 * * * (04:00 NZST / 05:00 NZDT) if you want strict 5am year-round.
  const schedule = '0 17 * * *';

  console.log(`XCF capacity bot started. Scheduled at: ${schedule} UTC (5:00am NZST)`);

  cron.schedule(schedule, () => {
    runReport().catch((err) => {
      console.error('Scheduled report failed:', err.message);
    });
  });
}
