const axios = require('axios');
require('dotenv').config({ path: `${__dirname}/../.env` });

const BASE_URL = 'https://app.asana.com/api/1.0';
const PM_PORTFOLIO_GID = '1217210785824637'; // XCF | Projects

function asanaClient() {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}` },
  });

  client.interceptors.response.use(null, async (err) => {
    const config = err.config;
    if (!config) return Promise.reject(err);
    config.__retryCount = config.__retryCount || 0;
    if (err.response?.status === 429 && config.__retryCount < 3) {
      config.__retryCount++;
      const retryAfter = parseInt(err.response.headers['retry-after'] || '10', 10);
      console.log(`[Asana] 429 rate limit — waiting ${retryAfter}s before retry ${config.__retryCount}/3`);
      await sleep(retryAfter * 1000);
      return client(config);
    }
    return Promise.reject(err);
  });

  return client;
}

// Google Drive parent folder ID for XCF Projects
const GOOGLE_DRIVE_PARENT_FOLDER_ID = '1fMBca9-VrGOVytlvBNG3Sy4PJiuqQcXz';

// Nested folder structure to create
const FOLDER_STRUCTURE = [
  '01_Briefs',
  '02_Working_Files',
  '02_Working_Files/2.1_In Progress',
  '02_Working_Files/2.2_Final',
  '02_Working_Files/2.3_Flora backup',
  '03_Assets',
  '04_Reviews',
  '04_Reviews/4.1_R1',
  '04_Reviews/4.2_R2',
  '04_Reviews/4.3_R3',
  '05_FINAL_DELIVERY',
  '06_Admin_Paperwork',
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch all portfolio items from the XCF | Projects portfolio
async function getPortfolioItems() {
  const client = asanaClient();
  const allProjects = [];
  let offset = null;

  do {
    const params = {
      opt_fields: 'name,gid,completed,archived,html_notes,permalink_url',
      limit: 100,
    };
    if (offset) params.offset = offset;

    const resp = await client.get(`/portfolios/${PM_PORTFOLIO_GID}/items`, { params });
    allProjects.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  return allProjects;
}

// Check if a project name matches the XCF-XXXX | Name pattern
function extractProjectCode(name) {
  const match = name.match(/^(XCF-\d+)\s*\|\s*(.+)$/);
  if (match) {
    return { code: match[1], name: match[2].trim() };
  }
  return null;
}

// Check if project already has a G Drive link in html_notes
function hasGDriveLink(htmlNotes) {
  if (!htmlNotes) return false;
  return /drive\.google\.com|docs\.google\.com.*folder/.test(htmlNotes);
}

// Format HTML note with G Drive link
function createGDriveLinkHTML(folderId, folderName) {
  return `<body><a href="https://drive.google.com/drive/folders/${folderId}">📁 ${folderName} (G Drive)</a></body>`;
}

// Update project with G Drive link in html_notes
async function updateProjectWithGDriveLink(projectGid, folderId, folderName) {
  const client = asanaClient();
  const linkHTML = createGDriveLinkHTML(folderId, folderName);

  try {
    await client.put(`/projects/${projectGid}`, {
      data: {
        html_notes: linkHTML,
      },
    });
    return true;
  } catch (err) {
    console.error(`Failed to update project ${projectGid}:`, err.message);
    return false;
  }
}

// Main automation function
async function checkAndCreateProjectFolders() {
  console.log(`[${new Date().toISOString()}] Starting project folder automation...`);

  try {
    // Fetch all portfolio items
    console.log('Fetching portfolio items...');
    const projects = await getPortfolioItems();
    console.log(`Found ${projects.length} total portfolio items`);

    // Filter and process
    const newProjects = [];
    const processedProjects = [];
    const skippedProjects = [];

    for (const project of projects) {
      // Skip completed or archived
      if (project.completed || project.archived) {
        skippedProjects.push({ name: project.name, reason: 'completed/archived' });
        continue;
      }

      // Extract project code (XCF-XXXX | Name format)
      const parsed = extractProjectCode(project.name);
      if (!parsed) {
        skippedProjects.push({ name: project.name, reason: 'invalid name format' });
        continue;
      }

      // Check if already has G Drive link
      if (hasGDriveLink(project.html_notes)) {
        processedProjects.push({ code: parsed.code, name: parsed.name, status: 'already_linked' });
        continue;
      }

      // This is a new project needing folder creation
      newProjects.push({
        gid: project.gid,
        code: parsed.code,
        name: parsed.name,
        fullName: project.name,
        permalink: project.permalink_url,
      });
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   New projects (needs folders): ${newProjects.length}`);
    console.log(`   Already linked: ${processedProjects.length}`);
    console.log(`   Skipped (completed/archived/invalid): ${skippedProjects.length}`);

    // Report new projects
    if (newProjects.length > 0) {
      console.log(`\n🆕 NEW PROJECTS FOUND:`);
      for (const proj of newProjects) {
        console.log(`   ${proj.code} | ${proj.name}`);
        console.log(`     GID: ${proj.gid}`);
        console.log(`     Link: ${proj.permalink}`);
      }
    }

    return {
      newProjects,
      processedProjects,
      skippedProjects,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error during automation:', err.message);
    throw err;
  }
}

module.exports = { checkAndCreateProjectFolders, updateProjectWithGDriveLink };

// Run if called directly
if (require.main === module) {
  checkAndCreateProjectFolders()
    .then(result => {
      console.log('\n✅ Automation complete');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Automation failed:', err);
      process.exit(1);
    });
}
