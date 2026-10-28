require('./loadEnv');
const { buildCostingsData } = require('./costings-data');
const { saveCostingsReport } = require('./costings-report');

async function buildCostingsReport() {
  console.log(`[${new Date().toISOString()}] Building XCF Costings Report...`);

  try {
    const costingsData = await buildCostingsData();
    saveCostingsReport(costingsData);
    console.log(`[${new Date().toISOString()}] Costings report complete.`);
  } catch (err) {
    console.error('Costings report failed:', err.message);
    process.exit(1);
  }
}

// Support --once flag for manual builds
if (process.argv.includes('--once')) {
  buildCostingsReport();
} else {
  // For scheduled runs, just exit (used by manual deploy)
  buildCostingsReport();
}
