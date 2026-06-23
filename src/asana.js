const axios = require('axios');

const BASE_URL = 'https://app.asana.com/api/1.0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function asanaClient() {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}` },
  });

  // Automatically retry on 429 (rate limit) up to 3 times, honouring Retry-After
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

// Run async tasks in batches to avoid hitting Asana's burst rate limit
async function batchedMap(items, fn, batchSize = 5, delayMs = 500) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

async function getWorkspaceMembers() {
  const client = asanaClient();
  const users = [];
  let offset = null;

  do {
    const params = { opt_fields: 'name,email,gid', limit: 100 };
    if (offset) params.offset = offset;
    const resp = await client.get(`/teams/${process.env.ASANA_TEAM_GID}/users`, { params });
    users.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  return users;
}

// Fetches all incomplete tasks assigned to a user across the entire workspace.
// No project filter — new projects are picked up automatically.
async function getTasksForUser(userGid) {
  const client = asanaClient();
  const optFields = [
    'gid',
    'name',
    'completed',
    'due_on',
    'start_on',
    'created_by.name',
    'created_by.gid',
    'memberships.project.name',
    'memberships.project.gid',
    'custom_fields.gid',
    'custom_fields.name',
    'custom_fields.number_value',
    'custom_fields.enum_value.name',
    'custom_fields.display_value',
  ].join(',');

  const allTasks = [];
  let offset = null;

  do {
    const params = {
      assignee: userGid,
      workspace: process.env.ASANA_WORKSPACE_GID,
      completed_since: 'now', // incomplete tasks only
      opt_fields: optFields,
      limit: 100,
    };
    if (offset) params.offset = offset;
    const resp = await client.get('/tasks', { params });
    allTasks.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  return allTasks;
}

function getCustomFieldNumber(task, fieldGid) {
  if (!fieldGid || !task.custom_fields) return null;
  const field = task.custom_fields.find((f) => f.gid === fieldGid);
  if (!field) return null;
  return field.number_value ?? null;
}

function getCustomFieldText(task, fieldGid) {
  if (!fieldGid || !task.custom_fields) return null;
  const field = task.custom_fields.find((f) => f.gid === fieldGid);
  if (!field) return null;
  return field.enum_value?.name ?? field.display_value ?? null;
}

// Count Mon–Fri working days between two YYYY-MM-DD strings, inclusive
function workingDaysBetween(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (start > end) return 1;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(count, 1);
}

// Hours this task contributes on a single calendar date.
// Uses even-spread: estimatedHours ÷ working days from effective start to due.
// Tasks starting on or after the next working day contribute 0 for the target day.
function hoursOnDate(estimatedHours, startDate, dueDate, targetStr) {
  if (!estimatedHours || !dueDate) return 0;

  const target = new Date(targetStr + 'T00:00:00');
  const due = new Date(dueDate + 'T00:00:00');

  if (target > due) return 0;
  if (target.getDay() === 0 || target.getDay() === 6) return 0;

  if (!startDate) {
    // No start date: all hours fall on the due date
    return due.toDateString() === target.toDateString() ? estimatedHours : 0;
  }

  const start = new Date(startDate + 'T00:00:00');

  // Tasks starting on or after the next working day contribute 0 for today
  if (start > target) {
    const nextWorkingDay = new Date(target);
    do {
      nextWorkingDay.setDate(nextWorkingDay.getDate() + 1);
    } while (nextWorkingDay.getDay() === 0 || nextWorkingDay.getDay() === 6);

    if (start >= nextWorkingDay) return 0;
  }

  // Use original date strings (not toISOString) to avoid NZT→UTC timezone shift
  const effectiveStartStr = start > target ? targetStr : startDate;
  return estimatedHours / workingDaysBetween(effectiveStartStr, dueDate);
}

// Sum of daily hours for a task over a date range [fromStr, toStr] inclusive
function sumHoursOverRange(estimatedHours, startDate, dueDate, fromStr, toStr) {
  let total = 0;
  const cur = new Date(fromStr + 'T00:00:00');
  const end = new Date(toStr + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      total += hoursOnDate(estimatedHours, startDate, dueDate, cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return total;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

const EXCLUDED_MEMBERS = [
  'Gabrielle George',
  'Christie Sinai',
  'Sha Edalati',
  'Chris Larcombe',
  'Pete Montgomery',
  'Nadim Malvat',
  'Ben Smith',
  'Ali Berg',
  'Quincey Brinker',
];

// These members appear on the capacity tab but are excluded from the missing fields tab
const MISSING_EXCLUDED_MEMBERS = [
  'Logen Stent',
  'Quincey Brinker',
  'Tom Gregson',
  'Christie Sinai',
  'Becky Sharp',
  'Naomi Lawson',
  'Sherry Choe',
  'Sandeep Garcha',
];

const EXCLUDED_PROJECTS = [
  'XCF: Leave calendar (NOW USE THE NEW WAY)!',
  'XCF: AI Usage (Roadmap Projects & Micro/BAU tasks',
  'XCF: Cost per asset + Asset counter (Roadmap Projects & Micro/BAU tasks)',
];

async function buildMemberData() {
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;
  const podMap = process.env.ASANA_POD_MAP ? JSON.parse(process.env.ASANA_POD_MAP) : {};
  // Hide overdue tasks older than this many days (stale subtasks from closed projects)
  const maxOverdueDays = parseInt(process.env.ASANA_OVERDUE_CUTOFF_DAYS ?? '30', 10);

  // Use NZT (Auckland) date so OOO/due-date logic matches the team's timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const in7 = addDays(today, 7);
  const in21 = addDays(today, 21);

  const workspaceMembers = await getWorkspaceMembers();
  // Set of team member GIDs — used to filter out tasks created by people outside the team
  const teamGids = new Set(workspaceMembers.map(m => m.gid));

  const members = [];
  const allMissingTasks = [];
  const allOverdueTasks = [];
  let totalTaskCount = 0;

  for (const member of workspaceMembers) {
    if (EXCLUDED_MEMBERS.includes(member.name)) continue;

    // getTasksForUser queries by assignee+workspace — covers all projects automatically
    const incomplete = await getTasksForUser(member.gid);
    totalTaskCount += incomplete.length;

    const pod = podMap[member.name] || 'Unknown';

    const memberTasks = [];
    let missingCount = 0;
    let overdueCount = 0;
    let isOoo = false;
    const seenGids = new Set();

    for (const t of incomplete) {
      // Deduplicate — skip if we've already processed this task GID
      if (seenGids.has(t.gid)) continue;
      seenGids.add(t.gid);

      // Skip completed tasks (belt-and-suspenders on top of completed_since:now)
      if (t.completed === true) continue;

      const estMinutes = getCustomFieldNumber(t, estGid);
      const estimatedHours = estMinutes ? estMinutes / 60 : null;
      const startDate = t.start_on || null;
      const dueDate = t.due_on || null;

      // All project names across all memberships (task may be multihomed)
      const allProjectNames = t.memberships?.map(m => m.project?.name).filter(Boolean) ?? [];

      // Detect OOO: check ALL memberships for the leave calendar
      if (allProjectNames.includes('XCF: Leave calendar (NOW USE THE NEW WAY)!') &&
          t.name && t.name.toUpperCase().includes('OOO') && dueDate) {
        const oooStart = new Date((startDate || dueDate) + 'T00:00:00');
        const oooEnd = new Date(dueDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        if (todayDate >= oooStart && todayDate <= oooEnd) isOoo = true;
      }

      // Find qualifying projects: starts with X/8/9 and not in the excluded list
      // A multihomed task (e.g. in "Brand Refresh" + "XCF: POD Boards") will qualify
      // via its secondary membership and display under the qualifying project name.
      const qualifyingProjects = allProjectNames.filter(p =>
        /^[X89]/i.test(p) && !EXCLUDED_PROJECTS.some(ex => p.startsWith(ex))
      );

      // Skip only if the task has explicit memberships but none qualify
      // (Tasks with no memberships are subtasks — always include them)
      if (allProjectNames.length > 0 && qualifyingProjects.length === 0) continue;

      // Use first qualifying project as the display name
      const projectName = qualifyingProjects[0] ?? '';

      const isMissingFields = !estimatedHours || !dueDate;
      const isOverdue =
        !isMissingFields &&
        new Date(dueDate + 'T00:00:00') < new Date(today + 'T00:00:00');

      if (isMissingFields) {
        // Skip noise tasks that are never actionable in this report
        const skipNames = ['Production', 'In Market'];
        if (skipNames.includes(t.name?.trim())) continue;

        // Skip members excluded from the missing fields tab
        if (MISSING_EXCLUDED_MEMBERS.includes(member.name)) continue;

        // Skip tasks created by someone outside the Creative Foundry team
        const creatorGid = t.created_by?.gid;
        if (creatorGid && !teamGids.has(creatorGid)) continue;

        // Skip tasks with On Hold or Backlog status (checks the "Status" custom field)
        const SKIP_STATUSES = ['on hold', 'backlog'];
        const statusField = t.custom_fields?.find(f => f.name?.toLowerCase().includes('status'));
        const statusValue = (statusField?.enum_value?.name ?? statusField?.display_value ?? '').toLowerCase();
        if (SKIP_STATUSES.includes(statusValue)) continue;

        missingCount++;
        allMissingTasks.push({
          name: t.name,
          gid: t.gid,
          proj: projectName,
          assignee: member.name,
          createdBy: t.created_by?.name ?? '—',
          pod,
          missing: !estimatedHours ? 'No estimate' : 'No due date',
        });
        continue;
      }

      if (isOverdue) {
        // Skip tasks overdue beyond the cutoff — stale subtasks from old/closed projects
        const daysOverdue = Math.floor(
          (new Date(today + 'T00:00:00') - new Date(dueDate + 'T00:00:00')) / 86400000
        );
        if (daysOverdue > maxOverdueDays) continue;

        overdueCount++;
        allOverdueTasks.push({
          name: t.name,
          gid: t.gid,
          proj: projectName,
          assignee: member.name,
          pod,
          due: dueDate,
        });
        // Still include in the member task list so the expand panel shows it
        memberTasks.push({
          name: t.name,
          due: dueDate,
          est: estimatedHours,
          proj: projectName,
          th: 0,
          wh: 0,
          overdue: true,
        });
        continue;
      }

      // Qualifying, non-overdue task — compute per-task hour contributions
      const th = round2(hoursOnDate(estimatedHours, startDate, dueDate, today));
      const wh = round2(sumHoursOverRange(estimatedHours, startDate, dueDate, today, in7));

      memberTasks.push({
        name: t.name,
        start: startDate,
        due: dueDate,
        est: estimatedHours,
        proj: projectName,
        th,
        wh,
      });
    }

    // Aggregate totals from non-overdue tasks — zero out hours if member is OOO
    const activeTasks = memberTasks.filter((t) => !t.overdue);
    const hoursToday = isOoo ? 0 : round1(activeTasks.reduce((s, t) => s + t.th, 0));
    const hours7Days = isOoo ? 0 : round1(activeTasks.reduce((s, t) => s + t.wh, 0));
    const hours21Days = isOoo ? 0 : round1(
      activeTasks.reduce((s, t) => s + sumHoursOverRange(t.est, t.start, t.due, today, in21), 0)
    );

    members.push({
      name: member.name,
      pod,
      ooo: isOoo,
      today: hoursToday,
      week: hours7Days,
      month: hours21Days,
      qualifying: activeTasks.length,
      missing: missingCount,
      overdue: overdueCount,
      tasks: memberTasks,
    });
  }

  return { members, missingTasks: allMissingTasks, overdueTasks: allOverdueTasks, totalTaskCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// PM TEAM DATA
// ─────────────────────────────────────────────────────────────────────────────
const PM_PORTFOLIO_GID = '1212248393751048';

const PM_EXCLUDED_OWNERS = [
  'Christie Sinai', 'Ben Hobbs', 'Domenic Iaria',
  'Nadim Malvat', 'Sandeep Garcha', 'Will Rich', 'Ali Berg',
];

// Projects to hide from specific PMs (substring match on project name)
const PM_PROJECT_EXCLUSIONS = {
  'Quincey Brinker': ['XCF: 2027 Goals', 'XCF Creative Development'],
  'Logen Stent':     ['Design BAU Board', 'Design Studio BAU Board'],
};

async function buildPMData() {
  const client = asanaClient();
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const in7   = addDays(today, 7);
  const in21  = addDays(today, 21);
  const cutoffDate = addDays(today, -60);

  const teamMembers = await getWorkspaceMembers();
  const memberByGid = {};
  teamMembers.forEach(m => { memberByGid[m.gid] = m.name; });
  const excludedGids = new Set(
    teamMembers.filter(m => PM_EXCLUDED_OWNERS.includes(m.name)).map(m => m.gid)
  );

  // Fetch all portfolio items with completed flag (paginated)
  const allProjects = [];
  let offset = null;
  do {
    const params = {
      opt_fields: 'name,gid,completed,owner.gid,owner.name,start_on,due_on,permalink_url',
      limit: 100,
    };
    if (offset) params.offset = offset;
    const resp = await client.get(`/portfolios/${PM_PORTFOLIO_GID}/items`, { params });
    allProjects.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  // Filter: starts with X/8/9, non-excluded owner, NOT completed
  const qualifying = allProjects.filter(p =>
    p.name && /^[X89]/i.test(p.name) &&
    p.owner?.gid && !excludedGids.has(p.owner.gid) &&
    !p.completed
  );

  // Fetch task completion counts in batches to avoid Asana 429 rate limits
  // (Asana REST API has no summary field — count tasks directly)
  const taskCountResults = await batchedMap(
    qualifying,
    p =>
      client.get('/tasks', {
        params: { project: p.gid, opt_fields: 'gid,completed', limit: 100 },
      })
        .then(r => {
          const tasks = r.data.data;
          return { gid: p.gid, done: tasks.filter(t => t.completed).length, total: tasks.length };
        })
        .catch(() => ({ gid: p.gid, done: 0, total: 0 })),
    5,   // 5 requests at a time
    500  // 500ms between batches
  );
  const taskCounts = {};
  taskCountResults.forEach(r => { taskCounts[r.gid] = r; });

  // Group by PM owner, applying per-PM project exclusions
  const pmMap = {};
  for (const p of qualifying) {
    const ownerGid  = p.owner.gid;
    const ownerName = memberByGid[ownerGid] || p.owner.name || 'Unknown';

    // Per-PM project name exclusions
    const exclusions = PM_PROJECT_EXCLUSIONS[ownerName] || [];
    if (exclusions.some(ex => p.name.includes(ex))) continue;

    if (!pmMap[ownerGid]) {
      pmMap[ownerGid] = { name: ownerName, gid: ownerGid, projects: [], tasks: [] };
    }

    const { done, total } = taskCounts[p.gid] || { done: 0, total: 0 };
    pmMap[ownerGid].projects.push({
      gid:   p.gid,
      name:  p.name,
      url:   p.permalink_url,
      start: p.start_on || null,
      due:   p.due_on   || null,
      completedTasks: done,
      totalTasks:     total,
      pct:   total > 0 ? Math.round((done / total) * 100) : null,
      pmTasks: [], // PM Time Tracking tasks live here (nested under project)
    });
  }

  // Sort each PM's projects by due date
  for (const pm of Object.values(pmMap)) {
    pm.projects.sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  }

  // Fetch PM Time Tracking tasks for active projects, nested under each project
  for (const pm of Object.values(pmMap)) {
    const activeProjects = pm.projects.filter(p => !p.due || p.due >= cutoffDate);

    for (const project of activeProjects) {
      const sectResp = await client.get(`/projects/${project.gid}/sections`, {
        params: { opt_fields: 'name,gid' },
      }).catch(() => ({ data: { data: [] } }));

      const pmSection = sectResp.data.data.find(s =>
        s.name.toLowerCase().includes('pm time tracking')
      );
      if (!pmSection) continue;

      const taskResp = await client.get(`/sections/${pmSection.gid}/tasks`, {
        params: {
          opt_fields: 'gid,name,completed,due_on,start_on,assignee.gid,custom_fields.gid,custom_fields.number_value',
          limit: 100,
        },
      }).catch(() => ({ data: { data: [] } }));

      for (const t of taskResp.data.data) {
        if (t.completed) continue;
        if (t.assignee?.gid !== pm.gid) continue;

        const estMins = t.custom_fields?.find(f => f.gid === estGid)?.number_value;
        const est = estMins ? estMins / 60 : null;
        if (!est || !t.due_on) continue;
        if (new Date(t.due_on + 'T00:00:00') < new Date(today + 'T00:00:00')) continue;

        const startDate = t.start_on || null;
        const th = round2(hoursOnDate(est, startDate, t.due_on, today));
        const wh = round2(sumHoursOverRange(est, startDate, t.due_on, today, in7));
        const mh = round2(sumHoursOverRange(est, startDate, t.due_on, today, in21));

        // Nest task under the project
        project.pmTasks.push({ name: t.name, start: startDate, due: t.due_on, est, th, wh, mh });
        // Also keep flat list for PM-level totals
        pm.tasks.push({ th, wh, mh });
      }
    }

    pm.today = round1(pm.tasks.reduce((s, t) => s + t.th, 0));
    pm.week  = round1(pm.tasks.reduce((s, t) => s + t.wh, 0));
    pm.month = round1(pm.tasks.reduce((s, t) => s + t.mh, 0));
  }

  return Object.values(pmMap).sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE CREEP & FAA DATA
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_FIELD_GID = '1211986892220398';
const SCOPE_FAA_STATUSES = ['FAA', 'Completed FAA', 'Scope Creep', 'Completed Scope Creep'];

async function buildScopeCreepData() {
  const client = asanaClient();
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;

  const optFields = [
    'gid', 'name', 'completed', 'permalink_url',
    'assignee.name',
    'memberships.project.name', 'memberships.project.gid',
    'parent.name', 'parent.gid', 'parent.permalink_url',
    'custom_fields.gid', 'custom_fields.number_value',
    'custom_fields.enum_value.name',
  ].join(',');

  const teamMembers = await getWorkspaceMembers();
  const seenGids = new Set();
  const results = [];

  // Iterate through every team member — this catches subtasks which the
  // workspace search API misses (subtasks are not indexed in Asana search)
  for (const member of teamMembers) {
    const memberTasks = [];
    let offset = null;
    do {
      const params = {
        assignee: member.gid,
        workspace: process.env.ASANA_WORKSPACE_GID,
        completed_since: 'now', // incomplete tasks only
        opt_fields: optFields,
        limit: 100,
      };
      if (offset) params.offset = offset;
      const resp = await client.get('/tasks', { params }).catch(() => null);
      if (!resp) break;
      memberTasks.push(...resp.data.data);
      offset = resp.data.next_page?.offset ?? null;
    } while (offset);

    for (const t of memberTasks) {
      if (seenGids.has(t.gid)) continue;

      const statusField = t.custom_fields?.find(f => f.gid === STATUS_FIELD_GID);
      const status = statusField?.enum_value?.name;
      if (!status || !SCOPE_FAA_STATUSES.includes(status)) continue;

      seenGids.add(t.gid);

      const estMins = t.custom_fields?.find(f => f.gid === estGid)?.number_value;
      const xcfProj = t.memberships?.find(m => m.project?.name && /^[X89]/i.test(m.project.name));
      const proj = xcfProj?.project;

      results.push({
        name: t.name,
        url: t.permalink_url,
        status,
        estHours: estMins ? round2(estMins / 60) : null,
        assignee: t.assignee?.name ?? member.name,
        completed: false,
        project: proj?.name ?? null,
        projectUrl: proj?.gid ? `https://app.asana.com/0/${proj.gid}/list` : null,
        parent: t.parent?.name ?? null,
        parentUrl: t.parent?.permalink_url ?? null,
      });
    }
  }

  return results;
}

module.exports = { buildMemberData, buildPMData, buildScopeCreepData };
