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
    const params = { opt_fields: 'name,email,gid,vacation_dates', limit: 100 };
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
    'parent.gid',
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

// Manual POD assignments for members excluded from the capacity tab
const MANUAL_POD = {
  'Christie Sinai': 'Campaign Ops',
  'Pete Montgomery': 'Design',
  'Ben Smith': 'Campaign',
  'James Blow': 'Campaign',
};

// Manual OOO overrides — for members whose OOO can't be set in Asana (e.g. long leave)
const MANUAL_OOO = [
  { name: 'Aniqah', start: '2026-07-01', end: '2027-07-31' },
  { name: 'Steph Gardner', start: '2026-07-20', end: '2026-08-09' },
  { name: 'Christie Sinai', start: '2026-09-16', end: '2026-10-04' },
];

const EXCLUDED_MEMBERS = [
  'Gabrielle George',
  'Gabrielle GeorgeTo', // typo'd duplicate account in Asana
  'Natalie Wei Jia Lee',
  'Brad Holland',
  'Christie Sinai',
  'Sha Edalati',
  'Chris Larcombe',
  'Pete Montgomery',
  'Nadim Malvat',
  'Ben Smith',
  'Ali Berg',
  'Chiko Kurniawan',
];

// Hidden from the OOO tab entirely — both booked leave and the no-leave stub row.
// Deliberately separate from EXCLUDED_MEMBERS: someone can be off the workload tabs
// but still need their leave visible (e.g. Christie, Pete), so excluding a member
// from capacity must not silently hide when they're away.
const OOO_EXCLUDED = new Set([
  'Gabrielle George',
  'Gabrielle GeorgeTo',
  'Natalie Wei Jia Lee',
  'Brad Holland',
  'mikeohall@me.com',
]);

// These members appear on the capacity tab but are excluded from the missing fields tab
const MISSING_EXCLUDED_MEMBERS = [
  'Logen Stent',
  'Quincey Brinker',
  'Tom Gregson',
  'Christie Sinai',
  'Becky Sharp',
  'Sherry Choe',
  'Sandeep Garcha',
  'mikeohall@me.com',
  'James Blow',
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

    // For subtasks with no estimate, fetch parent task data to support rollup logic:
    // - If parent has estimate: suppress subtask from missing fields; report parent if it lacks a due date
    // - If parent has no estimate: show subtask in missing fields normally
    const parentGidsNeeded = new Set(
      incomplete.filter(t => !getCustomFieldNumber(t, estGid) && t.parent?.gid).map(t => t.parent.gid)
    );
    const parentData = {}; // gid → { name, due, est }
    if (parentGidsNeeded.size > 0) {
      const parentClient = asanaClient();
      await batchedMap([...parentGidsNeeded], async (gid) => {
        try {
          const resp = await parentClient.get(`/tasks/${gid}`, {
            params: { opt_fields: 'name,due_on,custom_fields.gid,custom_fields.number_value' },
          });
          const pt = resp.data.data;
          const mins = getCustomFieldNumber(pt, estGid);
          parentData[gid] = { name: pt.name, due: pt.due_on || null, est: mins ? mins / 60 : null };
        } catch (_) {}
      }, 5, 500);
    }
    const reportedParentGids = new Set();

    const pod = podMap[member.name] || 'Unknown';

    const memberTasks = [];
    let missingCount = 0;
    let overdueCount = 0;
    // Check Asana's native vacation/away status
    const todayDate = new Date(today + 'T00:00:00');
    let isOoo = (() => {
      const vd = member.vacation_dates;
      if (!vd?.start_on || !vd?.end_on) return false;
      const start = new Date(vd.start_on + 'T00:00:00');
      const end = new Date(vd.end_on + 'T00:00:00');
      return todayDate >= start && todayDate <= end;
    })();
    // Manual OOO overrides (for long leave not set in Asana)
    if (!isOoo) {
      isOoo = MANUAL_OOO.some(o =>
        member.name.startsWith(o.name) &&
        todayDate >= new Date(o.start + 'T00:00:00') &&
        todayDate <= new Date(o.end + 'T00:00:00')
      );
    }
    const seenGids = new Set();

    for (const t of incomplete) {
      // Deduplicate — skip if we've already processed this task GID
      if (seenGids.has(t.gid)) continue;
      seenGids.add(t.gid);

      // Skip completed tasks (belt-and-suspenders on top of completed_since:now)
      if (t.completed === true) continue;

      // Skip placeholder capacity tasks — they represent unbooked time, not actual work
      if (/placeholder/i.test(t.name)) continue;

      const estMinutes = getCustomFieldNumber(t, estGid);
      const estimatedHours = estMinutes ? estMinutes / 60 : null;
      const parentInfo = t.parent?.gid ? (parentData[t.parent.gid] ?? null) : null;
      const startDate = t.start_on || null;
      const dueDate = t.due_on || null;

      // All project names across all memberships (task may be multihomed)
      const allProjectNames = t.memberships?.map(m => m.project?.name).filter(Boolean) ?? [];

      // Detect OOO: check ALL memberships for the leave calendar
      if (allProjectNames.includes('XCF: Leave calendar (NOW USE THE NEW WAY)!') &&
          t.name && t.name.toUpperCase().includes('OOO') && dueDate) {
        const oooStart = new Date((startDate || dueDate) + 'T00:00:00');
        const oooEnd = new Date(dueDate + 'T00:00:00');
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

      // Subtask whose estimate rolls up to its parent — report the parent instead of the subtask
      if (!estimatedHours && parentInfo?.est) {
        // If parent is missing a due date, report the parent in missing fields (once per parent)
        if (!parentInfo.due &&
            !MISSING_EXCLUDED_MEMBERS.includes(member.name) &&
            !reportedParentGids.has(t.parent.gid)) {
          const skipNames = ['Production', 'In Market'];
          if (!skipNames.includes(parentInfo.name?.trim())) {
            reportedParentGids.add(t.parent.gid);
            missingCount++;
            allMissingTasks.push({
              name: parentInfo.name,
              gid: t.parent.gid,
              proj: projectName,
              assignee: member.name,
              createdBy: '—',
              pod,
              missing: 'No due date',
            });
          }
        }
        continue; // Subtask covered by parent estimate — exclude from capacity & missing fields
      }

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
const PM_PORTFOLIO_GID = '1217210785824637'; // XCF | Projects (migrated from XCF: PM Dashboard Sep 2026)
const PROJECT_TYPE_FIELD_GID = '1217575429570978'; // Project type (XCF): Roadmap | Micro (BAU) | XCF initiative

// Only these PMs appear on the PM Team tab
const PM_ALLOWED_MEMBERS = [
  'Quincey Brinker',
  'Sherry Choe',
  'Deepak Aujla',
  'Logen Stent',
  'Naomi Lawson',
  'Becky Sharp',
  'Tom Gregson',
];

// PMs who should always appear on the PM tab even if they own no portfolio projects yet
const MANUAL_PM_MEMBERS = [
  'Deepak Aujla',
];

// Projects to hide from specific PMs (substring match on project name)
const PM_PROJECT_EXCLUSIONS = {
  'Quincey Brinker': ['XCF: 2027 Goals', 'XCF Creative Development'],
  'Logen Stent':     ['Design BAU Board'],
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
  const allowedGids = new Set(
    teamMembers.filter(m => PM_ALLOWED_MEMBERS.includes(m.name)).map(m => m.gid)
  );

  // Fetch all portfolio items with completed flag (paginated)
  const allProjects = [];
  let offset = null;
  do {
    const params = {
      opt_fields: 'name,gid,completed,archived,owner.gid,owner.name,start_on,due_on,permalink_url,custom_fields.gid,custom_fields.enum_value.name',
      limit: 100,
    };
    if (offset) params.offset = offset;
    const resp = await client.get(`/portfolios/${PM_PORTFOLIO_GID}/items`, { params });
    allProjects.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  // Filter: starts with X/8/9, non-excluded owner, NOT completed or archived
  const qualifying = allProjects.filter(p =>
    p.name && /^[X89]/i.test(p.name) &&
    p.owner?.gid && allowedGids.has(p.owner.gid) &&
    !p.completed &&
    !p.archived
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
      projectType: p.custom_fields?.find(f => f.gid === PROJECT_TYPE_FIELD_GID)?.enum_value?.name || null,
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

  // Ensure all allowed PM members always appear on the tab even with no portfolio projects
  const existingNames = new Set(Object.values(pmMap).map(p => p.name));
  for (const name of PM_ALLOWED_MEMBERS) {
    if (existingNames.has(name)) continue;
    const member = teamMembers.find(m => m.name === name);
    if (!member) continue;
    pmMap[member.gid] = { name, gid: member.gid, projects: [], tasks: [], today: 0, week: 0, month: 0 };
  }

  return Object.values(pmMap).sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE CREEP & FAA DATA
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_FIELD_GID = '1211986892220398';
const SCOPE_FAA_STATUSES = ['FAA', 'Completed FAA', 'Scope Creep', 'Completed Scope Creep'];
const SC_EXCLUDED_CREATORS = ['Christie Sinai'];
const SC_EXCLUDED_PROJECTS = [
  'XCF: Cost per asset + Asset counter (Roadmap Projects & Micro/BAU tasks)',
];

async function buildScopeCreepData() {
  const client = asanaClient();
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;

  const optFields = [
    'gid', 'name', 'completed', 'permalink_url',
    'assignee.name',
    'created_by.name',
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

      // Skip tasks created by excluded creators
      if (SC_EXCLUDED_CREATORS.includes(t.created_by?.name)) continue;

      // Find qualifying projects (XCF-relevant, not reporting-only)
      const allProjNames = t.memberships?.map(m => m.project?.name).filter(Boolean) ?? [];
      const qualifyingProjs = t.memberships?.filter(m =>
        m.project?.name &&
        /^[X89]/i.test(m.project.name) &&
        !SC_EXCLUDED_PROJECTS.some(ex => m.project.name.startsWith(ex))
      ) ?? [];
      // Skip if task only lives in excluded projects
      if (allProjNames.length > 0 && qualifyingProjs.length === 0) continue;

      seenGids.add(t.gid);

      const estMins = t.custom_fields?.find(f => f.gid === estGid)?.number_value;
      const proj = qualifyingProjs[0]?.project ?? null;

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

// ─────────────────────────────────────────────────────────────────────────────
// OOO DATA
// ─────────────────────────────────────────────────────────────────────────────
const LEAVE_PROJECT_GID = '1212867822525791';

async function buildOOOData() {
  const client = asanaClient();
  const podMap = process.env.ASANA_POD_MAP ? JSON.parse(process.env.ASANA_POD_MAP) : {};

  const workspaceMembers = await getWorkspaceMembers();
  const memberByName = {};
  workspaceMembers.forEach(m => { memberByName[m.name] = m; });

  const entries = [];
  const seen = new Set();

  function addEntry(name, pod, start, end, source) {
    if (OOO_EXCLUDED.has(name)) return;
    if (!start || !end || start > end) return;
    const key = `${name}|${start}|${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, pod, start, end, source });
  }

  const manualOooNames = new Set(MANUAL_OOO.map(e => e.name));

  // 1. Asana vacation_dates set by each user (skip anyone with a manual override)
  for (const member of workspaceMembers) {
    if (manualOooNames.has(member.name)) continue;
    const vd = member.vacation_dates;
    if (vd?.start_on && vd?.end_on) {
      const pod = MANUAL_POD[member.name] || podMap[member.gid] || 'Unknown';
      addEntry(member.name, pod, vd.start_on, vd.end_on, 'asana');
    }
  }

  // 2. MANUAL_OOO entries (take priority over Asana vacation_dates)
  for (const entry of MANUAL_OOO) {
    const member = workspaceMembers.find(m => m.name.startsWith(entry.name));
    if (!member) continue;
    const pod = MANUAL_POD[member.name] || podMap[member.gid] || 'Unknown';
    addEntry(member.name, pod, entry.start, entry.end, 'manual');
  }

  // 3. Leave backup project tasks (all assignees, no exclusions)
  try {
    let offset = null;
    const leaveTasks = [];
    do {
      const params = {
        project: LEAVE_PROJECT_GID,
        opt_fields: 'name,assignee.name,assignee.gid,start_on,due_on,completed',
        limit: 100,
      };
      if (offset) params.offset = offset;
      const resp = await client.get('/tasks', { params });
      leaveTasks.push(...resp.data.data);
      offset = resp.data.next_page?.offset ?? null;
    } while (offset);

    for (const task of leaveTasks) {
      if (task.completed || !task.due_on) continue;
      const name = task.assignee?.name;
      if (!name) continue;
      if (manualOooNames.has(name)) continue; // manual entry takes priority
      const member = memberByName[name];
      const pod = MANUAL_POD[name] || (member ? (podMap[member.gid] || 'Unknown') : 'Unknown');
      addEntry(name, pod, task.start_on || task.due_on, task.due_on, 'project');
    }
  } catch (err) {
    console.warn('[OOO] Failed to fetch leave project:', err.message);
  }

  // Ensure every workspace member appears on the OOO tab, even with no OOO entries.
  // These stub entries have no start/end and are skipped when rendering bars.
  const seenNames = new Set(entries.map(e => e.name));
  for (const member of workspaceMembers) {
    if (seenNames.has(member.name)) continue;
    if (OOO_EXCLUDED.has(member.name)) continue;
    const pod = MANUAL_POD[member.name] || podMap[member.name] || 'Unknown';
    entries.push({ name: member.name, pod, stub: true });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROADMAP / FORECASTER DATA  (driven by PM Dashboard portfolio)
// ─────────────────────────────────────────────────────────────────────────────
const BAR_TYPE_FIELD_GID    = '1213575237986690'; // Bar type (XCF): Production / In Market / Project Brief Due
const APPL_REGIONS_FIELD_GID = '1212086752729219'; // Applicable Regions (Mktg Planning)
const PRIORITY_FIELD_GID     = '1213031863971472'; // Priority (XCF): High / Medium / Low

async function buildRoadmapData() {
  const client = asanaClient();

  // 1. Fetch all PM portfolio items (with regions)
  const portfolioItems = [];
  let offset = null;
  do {
    const params = {
      opt_fields: [
        'name,gid,completed',
        'custom_fields.gid,custom_fields.multi_enum_values.name,custom_fields.enum_value.name',
      ].join(','),
      limit: 100,
    };
    if (offset) params.offset = offset;
    const resp = await client.get(`/portfolios/${PM_PORTFOLIO_GID}/items`, { params });
    portfolioItems.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  // 1b. Batch-fetch each project's current status update — the portfolio items endpoint
  //     doesn't populate current_status_update, so we fetch it per-project.
  const projectStatuses = {};
  await batchedMap(portfolioItems, async (item) => {
    try {
      const resp = await client.get(`/projects/${item.gid}`, {
        params: { opt_fields: 'gid,current_status_update.status_type,current_status_update.title' },
      });
      const su = resp.data.data.current_status_update;
      projectStatuses[item.gid] = { statusType: su?.status_type || null, title: su?.title || null };
    } catch (_) {
      projectStatuses[item.gid] = { statusType: null, title: null };
    }
  }, 5, 300);

  // 2. For each portfolio project, fetch its bar-type tasks (Production / In Market / Brief)
  // Also match by task name for projects that don't have the Bar type field set
  const BAR_NAME_FALLBACKS = new Map([
    ['production', 'Production'],
    ['in market', 'In Market'],
    ['project brief due', 'Project Brief Due'],
  ]);
  const barTasksMap = {};
  await batchedMap(portfolioItems, async (item) => {
    try {
      const resp = await client.get('/tasks', {
        params: {
          project: item.gid,
          opt_fields: 'name,start_on,due_on,custom_fields.gid,custom_fields.enum_value.name',
          limit: 100,
        },
      });
      barTasksMap[item.gid] = resp.data.data.filter(t => {
        const bt = t.custom_fields?.find(f => f.gid === BAR_TYPE_FIELD_GID)?.enum_value?.name;
        if (bt && bt !== 'Parent task') return true;
        return BAR_NAME_FALLBACKS.has((t.name || '').trim().toLowerCase());
      });
    } catch (_) {
      barTasksMap[item.gid] = [];
    }
  }, 5, 300);

  // 3. Build RT_RAW_TASKS entries from portfolio
  const result = [];
  for (const item of portfolioItems) {
    // Only include Roadmap projects (Project type (XCF) custom field)
    const projectType = item.custom_fields?.find(f => f.gid === PROJECT_TYPE_FIELD_GID)?.enum_value?.name;
    if (projectType !== 'Roadmap') continue;

    const { statusType, title: statusTitle } = projectStatuses[item.gid] || {};
    const dropped = statusType === 'dropped';

    // Bar tasks → subtasks format (template matches by name: Production / In Market / Project Brief Due)
    // Deduplicate by bar type name, preferring tasks that have due_on set
    const barByType = {};
    for (const t of (barTasksMap[item.gid] || [])) {
      const barName = t.custom_fields?.find(f => f.gid === BAR_TYPE_FIELD_GID)?.enum_value?.name
        || BAR_NAME_FALLBACKS.get((t.name || '').trim().toLowerCase());
      if (!barName || barName === 'Parent task') continue;
      if (!barByType[barName] || (!barByType[barName].due_on && t.due_on)) {
        barByType[barName] = t;
      }
    }
    const subtasks = Object.entries(barByType).map(([barName, t]) => ({
      name: barName,
      start_on: t.start_on || null,
      due_on: t.due_on || null,
    }));

    const rf = item.custom_fields?.find(f => f.gid === APPL_REGIONS_FIELD_GID);
    const regions = rf?.multi_enum_values?.map(v => v.name) || [];

    result.push({
      name: item.name,
      completed: item.completed || false,
      subtasks,
      url: `https://app.asana.com/0/portfolio/${PM_PORTFOLIO_GID}/${item.gid}`,
      pmName: item.name,
      dropped,
      regions,
      projectStatus: statusType || null,
      statusTitle: statusTitle || null,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BAU BOARD DATA  (Design BAU + Performance BAU)
// ─────────────────────────────────────────────────────────────────────────────
const BAU_BOARDS = [
  { name: 'Design BAU',      gid: '1212644837995359' }, // XCF | Design BAU Board (updated Sep 2026)
  { name: 'Performance BAU', gid: '1212446476552313' },
];

async function buildBAUData() {
  const client = asanaClient();
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;

  const taskFields = [
    'gid', 'name', 'completed', 'permalink_url',
    'assignee.name',
    'start_on', 'due_on',
    'custom_fields.gid', 'custom_fields.number_value', 'custom_fields.enum_value.name',
    'subtasks.gid',
  ].join(',');

  const subtaskFields = [
    'gid', 'name', 'completed', 'permalink_url',
    'assignee.name', 'start_on', 'due_on',
    'custom_fields.gid', 'custom_fields.number_value', 'custom_fields.enum_value.name',
  ].join(',');

  function isCancelled(task) {
    const sf = task.custom_fields?.find(f => f.gid === STATUS_FIELD_GID || f.name?.toLowerCase() === 'status');
    const sv = (sf?.enum_value?.name ?? '').toLowerCase();
    return sv === 'cancelled' || sv === 'canceled';
  }

  const result = [];

  for (const board of BAU_BOARDS) {
    const allTasks = [];
    let offset = null;
    do {
      const params = { project: board.gid, opt_fields: taskFields, limit: 100 };
      if (offset) params.offset = offset;
      const resp = await client.get('/tasks', { params });
      allTasks.push(...resp.data.data);
      offset = resp.data.next_page?.offset ?? null;
    } while (offset);

    const activeTasks = allTasks.filter(t => !t.completed && !isCancelled(t) && !/canva approval/i.test(t.name));

    // Fetch subtasks for tasks that have them
    const subtaskMap = {};
    const tasksWithSubs = activeTasks.filter(t => t.subtasks?.length > 0);
    await batchedMap(tasksWithSubs, async (task) => {
      try {
        const resp = await client.get(`/tasks/${task.gid}/subtasks`, {
          params: { opt_fields: subtaskFields, limit: 100 },
        });
        subtaskMap[task.gid] = resp.data.data.filter(s => !s.completed && !isCancelled(s));
      } catch (_) {
        subtaskMap[task.gid] = [];
      }
    }, 5, 500);

    function getStatus(task) {
      const sf = task.custom_fields?.find(f => f.gid === STATUS_FIELD_GID || f.name?.toLowerCase() === 'status');
      return sf?.enum_value?.name ?? null;
    }

    function getPriority(task) {
      return task.custom_fields?.find(f => f.gid === PRIORITY_FIELD_GID)?.enum_value?.name ?? null;
    }

    const tasks = activeTasks.map(t => {
      const estMins = t.custom_fields?.find(f => f.gid === estGid)?.number_value;
      return {
        gid: t.gid,
        name: t.name,
        url: t.permalink_url,
        assignee: t.assignee?.name ?? null,
        start: t.start_on ?? null,
        due: t.due_on ?? null,
        est: estMins ? round2(estMins / 60) : null,
        status: getStatus(t),
        priority: getPriority(t),
        subtasks: (subtaskMap[t.gid] || []).map(s => {
          const sEst = s.custom_fields?.find(f => f.gid === estGid)?.number_value;
          return {
            gid: s.gid,
            name: s.name,
            url: s.permalink_url,
            assignee: s.assignee?.name ?? null,
            start: s.start_on ?? null,
            due: s.due_on ?? null,
            est: sEst ? round2(sEst / 60) : null,
            status: getStatus(s),
            priority: getPriority(s),
          };
        }),
      };
    });

    result.push({ board: board.name, gid: board.gid, tasks });
  }

  return result;
}

// ─── COSTINGS REPORT BUILDERS ───

const COST_PER_ASSET_PROJECT_NAME = 'XCF: Cost per asset + Asset counter (Roadmap Projects & Micro/BAU tasks)';
const AI_CREDITS_PROJECT_NAME = 'XCF: AI Usage (Roadmap Projects & Micro/BAU tasks)';

async function searchProjectByName(projectName) {
  const client = asanaClient();
  try {
    const params = {
      opt_fields: 'gid,name',
      limit: 100,
    };
    const resp = await client.get(`/workspaces/${process.env.ASANA_WORKSPACE_GID}/projects`, { params });
    const projects = resp.data.data || [];
    const match = projects.find(p => p.name === projectName);
    if (match) {
      console.log(`[Costings] Found project: ${projectName} (${match.gid})`);
      return match;
    }
    console.log(`[Costings] Project not found: "${projectName}". Available projects:`, projects.map(p => p.name).slice(0, 10).join(', '));
    return null;
  } catch (err) {
    console.log(`[Costings] Project search error:`, err.message);
    return null;
  }
}

async function getProjectTasks(projectGid) {
  const client = asanaClient();
  const optFields = [
    'gid',
    'name',
    'completed',
    'due_on',
    'assignee.name',
    'assignee.gid',
    'memberships.project.name',
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
      opt_fields: optFields,
      limit: 100,
    };
    if (offset) params.offset = offset;
    const resp = await client.get(`/projects/${projectGid}/tasks`, { params });
    allTasks.push(...resp.data.data.filter(t => !t.completed));
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);

  return allTasks;
}

async function getPortfolioProjects2(portfolioGid) {
  const client = asanaClient();
  const projects = [];
  let offset = null;

  do {
    const params = {
      opt_fields: 'gid,name',
      limit: 100,
    };
    if (offset) params.offset = offset;
    try {
      const resp = await client.get(`/portfolios/${portfolioGid}/portfolio_items`, { params });
      projects.push(...resp.data.data.filter(p => p.resource_type === 'project'));
      offset = resp.data.next_page?.offset ?? null;
    } catch (err) {
      console.log(`[Costings] Portfolio fetch error: ${err.message}`);
      break;
    }
  } while (offset);

  return projects;
}

async function buildCostingsData() {
  try {

    const costPerAssetData = {
      summary: { totalAssets: 0, totalCost: 0, averageCost: 0 },
      byAsset: [],
      byPerson: [],
      byProject: [],
      rawTasks: [],
    };

    const aiCreditsData = {
      summary: { totalCredits: 0, averageCreditsPerProject: 0, projectCount: 0 },
      byProject: [],
      byPerson: [],
      rawTasks: [],
    };

    // Fetch cost per asset data
    if (costProject) {
      console.log(`[Costings] Fetching Cost per asset from project ${costProject.gid}`);
      const costTasks = await getProjectTasks(costProject.gid);
      costPerAssetData.rawTasks = costTasks;

      // Group by asset and aggregate
      const assetMap = new Map();
      const personMap = new Map();
      const projectMap = new Map();

      for (const task of costTasks) {
        const assetName = task.name;
        const cost = getCustomFieldNumber(task, process.env.ASANA_FIELD_GID_COST);
        const person = task.assignee?.name || 'Unassigned';
        const project = task.memberships?.[0]?.project?.name || 'Unknown';

        // By asset
        if (!assetMap.has(assetName)) {
          assetMap.set(assetName, { name: assetName, cost: cost || 0, taskGid: task.gid });
        }

        // By person
        if (!personMap.has(person)) {
          personMap.set(person, { name: person, totalAssets: 0, totalCost: 0 });
        }
        personMap.get(person).totalAssets += 1;
        personMap.get(person).totalCost += cost || 0;

        // By project
        if (!projectMap.has(project)) {
          projectMap.set(project, { name: project, assets: 0, cost: 0 });
        }
        projectMap.get(project).assets += 1;
        projectMap.get(project).cost += cost || 0;
      }

      costPerAssetData.byAsset = Array.from(assetMap.values()).sort((a, b) => b.cost - a.cost);
      costPerAssetData.byPerson = Array.from(personMap.values()).sort((a, b) => b.totalCost - a.totalCost);
      costPerAssetData.byProject = Array.from(projectMap.values()).sort((a, b) => b.cost - a.cost);
      costPerAssetData.summary.totalAssets = costTasks.length;
      costPerAssetData.summary.totalCost = Math.round(costTasks.reduce((sum, t) => sum + (getCustomFieldNumber(t, process.env.ASANA_FIELD_GID_COST) || 0), 0) * 100) / 100;
      costPerAssetData.summary.averageCost = costPerAssetData.summary.totalAssets > 0
        ? Math.round(costPerAssetData.summary.totalCost / costPerAssetData.summary.totalAssets * 100) / 100
        : 0;
    }

    // Fetch AI credits data
    if (aiProject) {
      console.log(`[Costings] Fetching AI Credits from project ${aiProject.gid}`);
      const aiTasks = await getProjectTasks(aiProject.gid);
      aiCreditsData.rawTasks = aiTasks;

      const projectMap = new Map();
      const personMap = new Map();

      for (const task of aiTasks) {
        const credits = getCustomFieldNumber(task, process.env.ASANA_FIELD_GID_AI_CREDITS) || 0;
        const person = task.assignee?.name || 'Unassigned';
        const project = task.memberships?.[0]?.project?.name || 'Unknown';

        // By project
        if (!projectMap.has(project)) {
          projectMap.set(project, { name: project, credits: 0, taskCount: 0 });
        }
        projectMap.get(project).credits += credits;
        projectMap.get(project).taskCount += 1;

        // By person
        if (!personMap.has(person)) {
          personMap.set(person, { name: person, credits: 0, taskCount: 0 });
        }
        personMap.get(person).credits += credits;
        personMap.get(person).taskCount += 1;
      }

      aiCreditsData.byProject = Array.from(projectMap.values()).sort((a, b) => b.credits - a.credits);
      aiCreditsData.byPerson = Array.from(personMap.values()).sort((a, b) => b.credits - a.credits);
      aiCreditsData.summary.totalCredits = Math.round(aiTasks.reduce((sum, t) => sum + (getCustomFieldNumber(t, process.env.ASANA_FIELD_GID_AI_CREDITS) || 0), 0) * 100) / 100;
      aiCreditsData.summary.projectCount = projectMap.size;
      aiCreditsData.summary.averageCreditsPerProject = aiCreditsData.summary.projectCount > 0
        ? Math.round(aiCreditsData.summary.totalCredits / aiCreditsData.summary.projectCount * 100) / 100
        : 0;
    }

    return { costPerAssetData, aiCreditsData };
  } catch (err) {
    console.error('[Costings] Builder error:', err.message);
    return {
      costPerAssetData: { summary: {}, byAsset: [], byPerson: [], byProject: [], rawTasks: [] },
      aiCreditsData: { summary: {}, byProject: [], byPerson: [], rawTasks: [] },
    };
  }
}

module.exports = { buildMemberData, buildPMData, buildScopeCreepData, buildOOOData, buildRoadmapData, buildBAUData, buildCostingsData, asanaClient, batchedMap };
