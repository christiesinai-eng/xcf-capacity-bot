const axios = require('axios');

function asanaClient() {
  return axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}` },
  });
}

function getCustomFieldNumber(task, fieldGid) {
  if (!fieldGid || !task.custom_fields) return null;
  const field = task.custom_fields.find((f) => f.gid === fieldGid);
  return field?.number_value ?? null;
}

function getCustomFieldText(task, fieldGid) {
  if (!fieldGid || !task.custom_fields) return null;
  const field = task.custom_fields.find((f) => f.gid === fieldGid);
  return field?.enum_value?.name ?? field?.display_value ?? null;
}

async function getProjectTasks(projectGid) {
  const client = asanaClient();
  const optFields = 'gid,name,completed,due_on,assignee.name,custom_fields.gid,custom_fields.number_value,custom_fields.enum_value.name,memberships.project.name';
  const allTasks = [];
  let offset = null;

  do {
    const params = {
      opt_fields: optFields,
      limit: 100,
    };
    if (offset) params.offset = offset;
    try {
      const resp = await client.get(`/projects/${projectGid}/tasks`, { params });
      allTasks.push(...(resp.data.data || []));
      offset = resp.data.next_page?.offset ?? null;
    } catch (err) {
      console.log(`[Costings] Task fetch error: ${err.message}`);
      break;
    }
  } while (offset);

  return allTasks;
}

async function getXCFProjects() {
  const client = asanaClient();
  const workspace = process.env.ASANA_WORKSPACE_GID;
  const allProjects = [];
  let offset = null;

  do {
    const params = {
      opt_fields: 'gid,name',
      limit: 100,
    };
    if (offset) params.offset = offset;
    try {
      const resp = await client.get(`/workspaces/${workspace}/projects`, { params });
      const projects = (resp.data.data || []).filter(p => p.name.startsWith('XCF'));
      allProjects.push(...projects);
      offset = resp.data.next_page?.offset ?? null;
    } catch (err) {
      console.log(`[Costings] Error fetching workspace projects: ${err.message}`);
      break;
    }
  } while (offset);

  return allProjects;
}

async function buildCostPerAssetData() {
  console.log('[Costings] Building Cost per Asset data...');

  const data = {
    summary: { totalAssets: 0, totalCost: 0, averageCost: 0 },
    byAsset: [],
    byPerson: [],
    byProject: [],
    rawTasks: [],
  };

  if (!process.env.ASANA_PROJECT_GID_COST_PER_ASSET) {
    console.log('[Costings] No cost per asset project GID configured');
    return data;
  }

  try {
    const tasks = await getProjectTasks(process.env.ASANA_PROJECT_GID_COST_PER_ASSET);

    const assetMap = new Map();
    const personMap = new Map();
    const projectMap = new Map();

    for (const task of tasks) {
      const cost = getCustomFieldNumber(task, process.env.ASANA_FIELD_GID_COST) || 0;
      const person = task.assignee?.name || 'Unassigned';
      const project = task.memberships?.[0]?.project?.name || 'Cost per Asset';
      const assetCategory = task.name.split(/[:\-–]/)[0].trim() || 'Other';

      // By asset
      if (!assetMap.has(assetCategory)) {
        assetMap.set(assetCategory, { name: assetCategory, cost: 0 });
      }
      assetMap.get(assetCategory).cost += cost;

      // By person
      if (!personMap.has(person)) {
        personMap.set(person, { name: person, totalAssets: 0, totalCost: 0 });
      }
      personMap.get(person).totalAssets += 1;
      personMap.get(person).totalCost += cost;

      // By project
      if (!projectMap.has(project)) {
        projectMap.set(project, { name: project, assets: 0, cost: 0 });
      }
      projectMap.get(project).assets += 1;
      projectMap.get(project).cost += cost;
    }

    data.byAsset = Array.from(assetMap.values()).sort((a, b) => b.cost - a.cost);
    data.byPerson = Array.from(personMap.values()).sort((a, b) => b.totalCost - a.totalCost);
    data.byProject = Array.from(projectMap.values()).sort((a, b) => b.cost - a.cost);
    data.summary.totalAssets = tasks.length;
    data.summary.totalCost = tasks.reduce((sum, t) => sum + (getCustomFieldNumber(t, process.env.ASANA_FIELD_GID_COST) || 0), 0);
    data.summary.averageCost = data.summary.totalAssets > 0 ? data.summary.totalCost / data.summary.totalAssets : 0;

    console.log(`[Costings] Cost per asset: ${data.summary.totalAssets} assets, $${data.summary.totalCost.toFixed(2)} total`);
  } catch (err) {
    console.error('[Costings] Cost per asset error:', err.message);
  }

  return data;
}

async function buildAICreditData() {
  console.log('[Costings] Building AI Credits data...');

  const data = {
    summary: { totalCredits: 0, averageCreditsPerProject: 0, projectCount: 0 },
    byProject: [],
    byPerson: [],
    rawTasks: [],
  };

  try {
    const xcfProjects = await getXCFProjects();
    console.log(`[Costings] Scanning ${xcfProjects.length} XCF projects for AI credits...`);

    const projectMap = new Map();
    const personMap = new Map();
    let projectsWithCredits = 0;

    for (const project of xcfProjects) {
      try {
        const tasks = await getProjectTasks(project.gid);

        // Only process tasks with AI credits
        const tasksWithCredits = tasks.filter(t => getCustomFieldNumber(t, process.env.ASANA_FIELD_GID_AI_CREDITS));

        if (tasksWithCredits.length > 0) {
          projectsWithCredits++;

          for (const task of tasksWithCredits) {
            const credits = getCustomFieldNumber(task, process.env.ASANA_FIELD_GID_AI_CREDITS) || 0;
            const person = task.assignee?.name || 'Unassigned';
            const projectName = project.name;

            // By project
            if (!projectMap.has(projectName)) {
              projectMap.set(projectName, { name: projectName, credits: 0, taskCount: 0 });
            }
            projectMap.get(projectName).credits += credits;
            projectMap.get(projectName).taskCount += 1;

            // By person
            if (!personMap.has(person)) {
              personMap.set(person, { name: person, credits: 0, taskCount: 0 });
            }
            personMap.get(person).credits += credits;
            personMap.get(person).taskCount += 1;
          }
        }
      } catch (err) {
        // Silently skip projects that error
      }
    }

    data.byProject = Array.from(projectMap.values()).sort((a, b) => b.credits - a.credits);
    data.byPerson = Array.from(personMap.values()).sort((a, b) => b.credits - a.credits);
    data.summary.totalCredits = Array.from(projectMap.values()).reduce((sum, p) => sum + p.credits, 0);
    data.summary.projectCount = projectMap.size;
    data.summary.averageCreditsPerProject = data.summary.projectCount > 0
      ? data.summary.totalCredits / data.summary.projectCount
      : 0;

    console.log(`[Costings] AI Credits: ${data.summary.totalCredits.toFixed(0)} total across ${projectsWithCredits} projects`);
  } catch (err) {
    console.error('[Costings] AI credits error:', err.message);
  }

  return data;
}

async function buildCostingsData() {
  const [costPerAssetData, aiCreditsData] = await Promise.all([
    buildCostPerAssetData(),
    buildAICreditData(),
  ]);

  return { costPerAssetData, aiCreditsData };
}

module.exports = { buildCostingsData };
