const axios = require('axios');

const BASE_URL = 'https://app.asana.com/api/1.0';

function asanaClient() {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}` },
  });
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
    'name',
    'completed',
    'due_on',
    'start_on',
    'memberships.project.name',
    'memberships.project.gid',
    'custom_fields.gid',
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
// Tasks starting within 1 working day of target are clamped to target so they
// appear in today's load (matches Asana Workload "starting tomorrow" behaviour).
// Tasks starting further in the future contribute 0 for target.
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

  // Only clamp if start is within 1 working day of target (i.e. tomorrow)
  if (start > target) {
    const nextWorkingDay = new Date(target);
    do {
      nextWorkingDay.setDate(nextWorkingDay.getDate() + 1);
    } while (nextWorkingDay.getDay() === 0 || nextWorkingDay.getDay() === 6);

    if (start > nextWorkingDay) return 0; // starts too far in future
  }

  const effectiveStart = start > target ? target : start;
  const effectiveStartStr = effectiveStart.toISOString().slice(0, 10);
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

const EXCLUDED_PROJECTS = [
  'XCF: Leave calendar (NOW USE THE NEW WAY)!',
  'XCF: AI Usage (Roadmap Projects & Micro/BAU tasks',
  'XCF: Cost per asset + Asset counter (Roadmap Projects & Micro/BAU tasks)',
];

async function buildMemberData() {
  const estGid = process.env.ASANA_FIELD_GID_ESTIMATED_TIME;
  const podMap = process.env.ASANA_POD_MAP ? JSON.parse(process.env.ASANA_POD_MAP) : {};

  const today = new Date().toISOString().slice(0, 10);
  const in7 = addDays(today, 7);
  const in21 = addDays(today, 21);

  const workspaceMembers = await getWorkspaceMembers();

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

    for (const t of incomplete) {
      const estMinutes = getCustomFieldNumber(t, estGid);
      const estimatedHours = estMinutes ? estMinutes / 60 : null;
      const startDate = t.start_on || null;
      const dueDate = t.due_on || null;

      // Use the first project membership as the display project name
      const projectName = t.memberships?.[0]?.project?.name ?? '';

      // Detect OOO: leave calendar task with "OOO" in name that covers today
      if (projectName === 'XCF: Leave calendar (NOW USE THE NEW WAY)!' &&
          t.name && t.name.toUpperCase().includes('OOO') && dueDate) {
        const oooStart = new Date((startDate || dueDate) + 'T00:00:00');
        const oooEnd = new Date(dueDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        if (todayDate >= oooStart && todayDate <= oooEnd) isOoo = true;
      }

      // Skip tasks from excluded projects
      if (EXCLUDED_PROJECTS.some(p => projectName.startsWith(p))) continue;

      const isMissingFields = !estimatedHours || !dueDate;
      const isOverdue =
        !isMissingFields &&
        new Date(dueDate + 'T00:00:00') < new Date(today + 'T00:00:00');

      if (isMissingFields) {
        missingCount++;
        allMissingTasks.push({
          name: t.name,
          proj: projectName,
          assignee: member.name,
          pod,
          missing: !estimatedHours ? 'No estimate' : 'No due date',
        });
        continue;
      }

      if (isOverdue) {
        overdueCount++;
        allOverdueTasks.push({
          name: t.name,
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
        due: dueDate,
        est: estimatedHours,
        proj: projectName,
        th,
        wh,
      });
    }

    // Aggregate totals from non-overdue tasks
    const activeTasks = memberTasks.filter((t) => !t.overdue);
    const hoursToday = round1(activeTasks.reduce((s, t) => s + t.th, 0));
    const hours7Days = round1(activeTasks.reduce((s, t) => s + t.wh, 0));
    const hours21Days = round1(
      activeTasks.reduce((s, t) => s + sumHoursOverRange(t.est, null, t.due, today, in21), 0)
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

module.exports = { buildMemberData };
