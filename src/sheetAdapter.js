'use strict';
// Turns the rows of the Google Sheet "XCF Lighthouse - Dashboard Data" back into the datasets the
// dashboard page renders from (MEMBERS, PM_DATA, REQUESTS_DATA ...). Runs in the browser, and in Node
// for the tests. Needs CapacityMath and MarkdownLite (loaded before it on the page).
//
// The sheet holds facts (a task, its dates, its estimate). The numbers derived from them (hours today,
// this week, this month, per person) are worked out here from today's date in New Zealand, so they are
// right on any day without the build having to run first.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./capacityMath'), require('./markdown'));
  } else {
    root.SheetAdapter = factory(root.CapacityMath, root.MarkdownLite);
  }
}(typeof self !== 'undefined' ? self : this, function (CM, MD) {
  // The tabs the page reads, in the order declared to the platform (it allows at most 20).
  const TABS = ['People', 'Tasks', 'Missing_Tasks', 'Overdue_Tasks', 'OOO', 'OOO_Manual', 'PM_Projects', 'PM_Tasks',
    'Roadmap', 'Roadmap_Subtasks', 'Scope_Creep', 'PM_Updates', 'Requests', 'Request_Comments', 'Notes',
    'Regional', 'Regional_Panels', 'Regional_Unrecognised', 'Regional_Meta', 'Sync_Log'];
  const WEEK_WORKING_DAYS = 5;

  // Tabs the dashboard cannot draw anything useful without. If one is missing the page keeps its embedded data.
  const REQUIRED = ['People', 'Tasks', 'Missing_Tasks', 'Overdue_Tasks', 'OOO', 'PM_Projects', 'PM_Tasks', 'Requests'];

  const LIST_SEP = '; ';

  // ── reading cells ──────────────────────────────────────────────────────────
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const nul = (v) => (str(v) === '' ? null : str(v));
  const num = (v) => (str(v) === '' ? null : Number(str(v).replace(/,/g, '')));
  const bool = (v) => str(v).toUpperCase() === 'TRUE';
  const list = (v) => (str(v) === '' ? [] : str(v).split(LIST_SEP));
  const dateOnly = (v) => (str(v) === '' ? null : str(v).slice(0, 10));

  // "'Request_Comments'!A1:E752" -> Request_Comments
  function tabNameOf(range) {
    const m = String(range).match(/^'((?:[^']|'')+)'!|^([^!]+)!/);
    if (m) return (m[1] ? m[1].replace(/''/g, "'") : m[2]);
    return String(range).replace(/^'|'$/g, '');
  }

  // /api/sheet reply -> { Tab: [ {header: value, ...}, ... ] }. Rows may be shorter than the header
  // (Sheets drops trailing empty cells), so missing cells read as ''.
  function parseSheetResponse(resp, declared) {
    const names = declared || TABS;
    const tabs = {};
    (resp.ranges || []).forEach((r, i) => {
      const name = names[i] && (!r.range || tabNameOf(r.range) === names[i]) ? names[i] : tabNameOf(r.range);
      const values = r.values || [];
      const headers = (values[0] || []).map(str);
      tabs[name] = values.slice(1)
        .filter((row) => row.some((c) => str(c) !== ''))
        .map((row) => {
          const o = {};
          headers.forEach((h, k) => { o[h] = row[k] === undefined ? '' : row[k]; });
          return o;
        });
    });
    return tabs;
  }

  const groupBy = (rows, key) => {
    const m = new Map();
    rows.forEach((r) => { const k = str(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  };

  // ── OOO ────────────────────────────────────────────────────────────────────
  // Leave from Asana (tab OOO) plus leave typed into OOO_Manual. A manual entry replaces whatever Asana says
  // for that person. Order: Asana, manual, the leave project, then people with nothing booked.
  function buildOoo(tabs, roster) {
    const rows = (tabs.OOO || []).map((o) => ({
      name: str(o.name), pod: str(o.pod), start: nul(o.start_date), end: nul(o.end_date), source: str(o.source), stub: bool(o.no_leave_booked),
    }));
    const podOf = new Map(roster.map((p) => [p.name, p.pod]));
    const manual = [];
    const typedNames = new Set();
    (tabs.OOO_Manual || []).forEach((m) => {
      const prefix = str(m.name).trim();
      const start = nul(m.start_date);
      const end = nul(m.end_date);
      if (!prefix || !start || !end || start > end) return;
      const person = roster.find((p) => p.name === prefix) || roster.find((p) => p.name.startsWith(prefix));
      const name = person ? person.name : prefix;
      typedNames.add(prefix);
      manual.push({ name, pod: podOf.get(name) || 'Unknown', start, end, source: 'manual', stub: false });
    });
    // As in the build, Asana leave is only hidden for a person whose name was typed in full: a manual entry for
    // "Aniqah" does not hide the leave-project entry for "Aniqah Mitha".
    const asana = rows.filter((o) => !o.stub && o.source === 'asana' && !typedNames.has(o.name));
    const project = rows.filter((o) => !o.stub && o.source !== 'asana' && o.source !== 'manual' && !typedNames.has(o.name));
    const booked = [...asana, ...manual, ...project];
    const bookedNames = new Set(booked.map((o) => o.name));
    const stubs = rows.filter((o) => o.stub && !bookedNames.has(o.name));
    const seen = new Set();
    const out = [];
    [...booked, ...stubs].forEach((o) => {
      const key = o.stub ? `stub|${o.name}` : `${o.name}|${o.start}|${o.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(o.stub ? { name: o.name, pod: o.pod, stub: true } : { name: o.name, pod: o.pod, start: o.start, end: o.end, source: o.source });
    });
    return out;
  }

  // ── people ─────────────────────────────────────────────────────────────────
  function buildRoster(tabs) {
    const people = (tabs.People || []).map((p) => ({
      name: str(p.name), pod: str(p.pod) || 'Unknown', onCapacity: str(p.on_capacity_tab).toUpperCase() === 'Y',
      isPm: str(p.is_pm).toUpperCase() === 'Y', gid: nul(p.asana_user_gid),
    }));
    const known = new Set(people.map((p) => p.name));
    // Someone with tasks who has not been added to People yet still shows, under "Unknown", as the build does.
    const extra = [];
    [...(tabs.Tasks || []).map((t) => t.assignee), ...(tabs.Missing_Tasks || []).map((t) => t.assignee), ...(tabs.Overdue_Tasks || []).map((t) => t.assignee)]
      .map(str).filter(Boolean).forEach((n) => {
        if (!known.has(n)) { known.add(n); extra.push({ name: n, pod: 'Unknown', onCapacity: true, isPm: false, gid: null }); }
      });
    return [...people, ...extra];
  }

  // ── the datasets ───────────────────────────────────────────────────────────
  // today: 'YYYY-MM-DD' in NZ. Returns the datasets plus { windows, meta }.
  function buildDatasets(tabs, today, options) {
    const opts = options || {};
    const log = {};
    (tabs.Sync_Log || []).forEach((r) => { log[str(r.key)] = str(r.value); });
    const win = CM.windows(today, WEEK_WORKING_DAYS);
    const roster = buildRoster(tabs);
    const ooo = buildOoo(tabs, roster);

    const onLeaveToday = (name) => ooo.some((o) => !o.stub && o.name === name && o.start <= today && today <= o.end);

    // MEMBERS
    const tasksBy = groupBy(tabs.Tasks || [], 'assignee');
    const missingBy = groupBy(tabs.Missing_Tasks || [], 'assignee');
    const MEMBERS = roster.filter((p) => p.onCapacity).map((p) => {
      const ts = (tasksBy.get(p.name) || []).map((t) => {
        const est = num(t.est_hours);
        const start = nul(t.start_date);
        const due = nul(t.due_date);
        const overdue = bool(t.overdue);
        if (overdue) return { name: str(t.task), due, est, proj: str(t.project), th: 0, wh: 0, overdue: true, _mh: 0 };
        return {
          name: str(t.task), start, due, est, proj: str(t.project),
          th: CM.round2(CM.hoursOnDate(est, start, due, today)),
          wh: CM.round2(CM.sumHoursOverRange(est, start, due, win.weekFrom, win.weekTo)),
          _mh: CM.sumHoursOverRange(est, start, due, win.monthFrom, win.monthTo),
        };
      });
      const active = ts.filter((t) => !t.overdue);
      const away = onLeaveToday(p.name);
      const sum = (f) => active.reduce((s, t) => s + f(t), 0);
      const member = {
        name: p.name, pod: p.pod, ooo: away,
        today: away ? 0 : CM.round1(sum((t) => t.th)),
        week: away ? 0 : CM.round1(sum((t) => t.wh)),
        month: away ? 0 : CM.round1(sum((t) => t._mh)),
        qualifying: active.length,
        missing: (missingBy.get(p.name) || []).length,
        overdue: ts.length - active.length,
        tasks: ts.map(({ _mh, ...t }) => t),
      };
      return member;
    });

    // MISSING_TASKS, OVERDUE_TASKS
    const MISSING_TASKS = (tabs.Missing_Tasks || []).map((t) => ({
      name: str(t.task), gid: str(t.task_gid), proj: str(t.project), assignee: str(t.assignee), createdBy: str(t.created_by), pod: str(t.pod), missing: str(t.missing_reason),
    }));
    const OVERDUE_TASKS = (tabs.Overdue_Tasks || []).map((t) => ({
      name: str(t.task), gid: str(t.task_gid), proj: str(t.project), assignee: str(t.assignee), pod: str(t.pod), due: nul(t.due_date),
    }));

    // PM_DATA
    const projBy = groupBy(tabs.PM_Projects || [], 'pm_name');
    const pmTasksBy = groupBy(tabs.PM_Tasks || [], 'project_gid');
    const PM_DATA = roster.filter((p) => p.isPm).map((p) => {
      const projects = (projBy.get(p.name) || []).map((r) => ({
        gid: str(r.project_gid), name: str(r.project), url: str(r.url), start: nul(r.start_date), due: nul(r.due_date),
        completedTasks: num(r.completed_tasks), totalTasks: num(r.total_tasks), pct: num(r.pct_complete), projectType: str(r.project_type),
        pmTasks: (pmTasksBy.get(str(r.project_gid)) || []).filter((t) => str(t.pm_name) === p.name).map((t) => {
          const est = num(t.est_hours);
          const start = nul(t.start_date);
          const due = nul(t.due_date);
          return {
            name: str(t.task), start, due, est,
            th: CM.round2(CM.hoursOnDate(est, start, due, today)),
            wh: CM.round2(CM.sumHoursOverRange(est, start, due, win.weekFrom, win.weekTo)),
            mh: CM.round2(CM.sumHoursOverRange(est, start, due, win.monthFrom, win.monthTo)),
          };
        }),
      }));
      const tasks = projects.flatMap((pr) => pr.pmTasks.map((t) => ({ th: t.th, wh: t.wh, mh: t.mh })));
      const total = (k) => CM.round1(tasks.reduce((s, t) => s + t[k], 0));
      return { name: p.name, gid: p.gid || (projBy.get(p.name) && str(projBy.get(p.name)[0].pm_gid)) || null, projects, tasks, today: total('th'), week: total('wh'), month: total('mh') };
    });

    const SCOPE_CREEP_DATA = (tabs.Scope_Creep || []).map((s) => ({
      name: str(s.name), url: str(s.url), status: str(s.status), estHours: num(s.est_hours), assignee: str(s.assignee), completed: bool(s.completed),
      project: str(s.project), projectUrl: str(s.project_url), parent: str(s.parent), parentUrl: str(s.parent_url),
    }));

    // Roadmap
    const subsBy = groupBy(tabs.Roadmap_Subtasks || [], 'roadmap_url');
    const RT_RAW_TASKS = (tabs.Roadmap || []).map((t) => ({
      name: str(t.name), completed: bool(t.completed),
      subtasks: (subsBy.get(str(t.url)) || []).map((s) => ({ name: str(s.subtask), start_on: nul(s.start_date), due_on: nul(s.due_date) })),
      url: str(t.url), pmName: nul(t.pm_name), dropped: bool(t.dropped), regions: list(t.regions),
      projectStatus: nul(t.project_status), statusTitle: nul(t.status_title),
    }));

    // Notes: summaries typed by people. kind = week | request.
    const weekNotes = new Map();
    const requestNotes = new Map();
    (tabs.Notes || []).forEach((n) => {
      if (str(n.kind) === 'week') weekNotes.set(str(n.key), n);
      else if (str(n.kind) === 'request') requestNotes.set(str(n.key), n);
    });

    // PM updates, newest week first, with the executive summary where one has been written.
    const updatesBy = groupBy(tabs.PM_Updates || [], 'week_start');
    const weekLabels = new Map();
    (tabs.PM_Updates || []).forEach((u) => weekLabels.set(str(u.week_start), str(u.week_label)));
    weekNotes.forEach((n, k) => { if (!weekLabels.has(k)) weekLabels.set(k, str(n.label)); });
    const PM_UPDATES_DATA = [...weekLabels.keys()].sort().reverse().map((weekStart) => {
      const note = weekNotes.get(weekStart);
      const md = note ? str(note.summary_markdown) : '';
      return {
        weekStart, weekLabel: weekLabels.get(weekStart),
        messages: (updatesBy.get(weekStart) || []).map((m) => ({ name: str(m.pm_name), timestamp: str(m.posted_at), text: str(m.text) })),
        executiveSummary: md || null,
        executiveSummaryHtml: md ? MD.mdToHtml(md) : null,
      };
    });

    // Requests
    const commentsBy = groupBy(tabs.Request_Comments || [], 'request_gid');
    const REQUESTS_DATA = (tabs.Requests || []).map((r) => {
      const gid = str(r.gid);
      const note = requestNotes.get(gid);
      const summary = note ? nul(note.summary_markdown) : null;
      return {
        gid, code: str(r.code), name: str(r.name), url: str(r.url), pod: str(r.pod), requester: str(r.requester), assignee: str(r.assignee),
        requestStatus: str(r.request_status), quarter: str(r.quarter), projectType: str(r.project_type), regions: list(r.regions),
        matched: bool(r.matched), projectName: nul(r.project_name), projectUrl: nul(r.project_url), projectStatus: nul(r.project_status),
        submittedAt: str(r.submitted_at), onTrackAt: nul(r.on_track_at), startedBy: nul(r.started_by), isRealStart: bool(r.is_real_start),
        durationHours: num(r.duration_hours), commentCount: num(r.comment_count),
        comments: (commentsBy.get(gid) || []).map((c) => ({ author: str(c.author), at: str(c.posted_at), text: str(c.text) })),
        summary, cause: note ? nul(note.cause) : null, causedAt: note ? nul(note.cause_date) : null,
        summaryHtml: summary ? MD.mdToHtml(summary) : null,
      };
    });

    // Regional: counts and panel totals are stored; the share is count / panel total.
    const REGIONAL_DATA = buildRegional(tabs);

    // How fresh the sheet says it is (written by the build sync into Sync_Log).
    const sync = { status: log.status || null, syncedAt: log.synced_at || null, generatedAt: log.generated_at || null, skipped: log.skipped || '' };

    return {
      MEMBERS, MISSING_TASKS, OVERDUE_TASKS, PM_DATA, SCOPE_CREEP_DATA, OOO_DATA: ooo, PM_UPDATES_DATA, RT_RAW_TASKS, REQUESTS_DATA, REGIONAL_DATA,
      GENERATED_AT: sync.generatedAt, windows: win, sync,
    };
  }

  function buildRegional(tabs) {
    const sections = [];
    const find = (type, dimension, source) => sections.find((s) => s.type === type && s.dimension === dimension && s.source === source);
    (tabs.Regional_Panels || []).forEach((p) => {
      const type = str(p.request_type);
      const dimension = str(p.dimension);
      const source = str(p.source_field);
      let s = find(type, dimension, source);
      if (!s) { s = { type, dimension, source, panels: [], notCaptured: bool(p.not_captured) }; sections.push(s); }
      s.panels.push({ quarter: str(p.quarter), rows: [], total: num(p.total), withValue: num(p.with_value), missing: num(p.missing), requests: num(p.requests) });
    });
    (tabs.Regional || []).forEach((r) => {
      const s = find(str(r.request_type), str(r.dimension), str(r.source_field));
      const panel = s && s.panels.find((p) => p.quarter === str(r.quarter));
      if (!panel) return;
      const count = num(r.count);
      panel.rows.push({ label: str(r.label), count, pct: panel.total ? Math.round((count / panel.total) * 1000) / 10 : 0 });
    });
    const meta = { typeCompletion: [], byQuarter: [] };
    const quarters = [];
    (tabs.Regional_Meta || []).forEach((r) => {
      const g = str(r.group);
      if (g === 'quarter') quarters.push(str(r.key));
      else if (g === 'type_completion') meta.typeCompletion.push({ month: str(r.key), n: num(r.value), pct: num(r.pct) });
      else if (g === 'by_quarter') meta.byQuarter.push({ quarter: str(r.key), count: num(r.value) });
      else if (g === 'total') meta[str(r.key)] = num(r.value);
    });
    const unrecognised = (tabs.Regional_Unrecognised || []).map((u) => ({
      gid: str(u.gid), name: str(u.name), raw: str(u.raw_value), quarter: str(u.quarter), type: str(u.request_type), url: str(u.url),
    }));
    return { quarters, sections, unrecognised, meta };
  }

  // True when every tab the page cannot do without came back with data.
  function isUsable(tabs) {
    return REQUIRED.every((n) => Array.isArray(tabs[n]));
  }

  return { TABS, REQUIRED, parseSheetResponse, buildDatasets, isUsable, tabNameOf };
}));
