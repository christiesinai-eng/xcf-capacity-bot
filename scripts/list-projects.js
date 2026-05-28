/**
 * Run once to list all Asana projects in your workspace.
 * Usage: node scripts/list-projects.js
 */
require('dotenv').config();
const axios = require('axios');

async function listProjects() {
  const client = axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}` },
  });

  let projects = [];
  let offset = null;

  do {
    const params = {
      workspace: process.env.ASANA_WORKSPACE_GID,
      opt_fields: 'name,gid,archived',
      limit: 100,
    };
    if (offset) params.offset = offset;

    const resp = await client.get('/projects', { params });
    projects.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  console.log(`\n── ACTIVE PROJECTS (${active.length}) ──`);
  active.forEach((p) => console.log(`${p.gid}  ${p.name}`));

  if (archived.length) {
    console.log(`\n── ARCHIVED PROJECTS (${archived.length}) ──`);
    archived.forEach((p) => console.log(`${p.gid}  ${p.name}`));
  }

  console.log('\nCopy the GIDs you want into ASANA_PROJECT_GIDS in your .env, comma-separated.');
}

listProjects().catch((err) => {
  console.error('Error:', err.response?.data?.errors?.[0]?.message ?? err.message);
  process.exit(1);
});
