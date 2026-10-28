'use strict';
// The Google Sheet "XCF Lighthouse - Dashboard Data": one tab per report dataset.
//
// This file is the contract between the build (which writes the tabs) and the dashboard
// (which reads them by header name). Change a header here and the dashboard adapter in
// template.html has to change with it.
//
// Only the tabs listed in PIPELINE_TABS are written by the sync. People, Config, OOO_Manual,
// Exec_Summaries and Request_Notes are edited by people in the sheet and are never touched.

const { stripExternalUrls, stripCommentUrls } = require('./report');

const S = 's'; // text, stored as text (never parsed into a date or number)
const N = 'n'; // number
const B = 'b'; // TRUE / FALSE

// Cells holding a list (regions) are joined with this.
const LIST_SEP = '; ';

const list = (v) => (Array.isArray(v) ? v.join(LIST_SEP) : v);

// Each tab: name, source (the dataset it comes from), columns [header, type], key = index of a column that is never empty
// (the sheet counts rows with it), rows(d) = array of arrays of raw cell values.
const PIPELINE_TABS = [
  {
    name: 'Tasks',
    source: 'members', // the dataset it is built from
    columns: [['assignee', S], ['pod', S], ['task', S], ['project', S], ['start_date', S], ['due_date', S], ['est_hours', N], ['overdue', B]],
    key: 0,
    rows: (d) => (d.members || []).flatMap((m) =>
      (m.tasks || []).map((t) => [m.name, m.pod, t.name, t.proj, t.start, t.due, t.est, !!t.overdue])),
  },
  {
    name: 'Missing_Tasks',
    source: 'missingTasks', // the dataset it is built from
    columns: [['task', S], ['task_gid', S], ['project', S], ['assignee', S], ['created_by', S], ['pod', S], ['missing_reason', S]],
    key: 0,
    rows: (d) => (d.missingTasks || []).map((t) => [t.name, t.gid, t.proj, t.assignee, t.createdBy, t.pod, t.missing]),
  },
  {
    name: 'Overdue_Tasks',
    source: 'overdueTasks', // the dataset it is built from
    columns: [['task', S], ['task_gid', S], ['project', S], ['assignee', S], ['pod', S], ['due_date', S]],
    key: 0,
    rows: (d) => (d.overdueTasks || []).map((t) => [t.name, t.gid, t.proj, t.assignee, t.pod, t.due]),
  },
  {
    // Manual leave lives in the OOO_Manual tab (people edit it), so it is not repeated here.
    name: 'OOO',
    source: 'oooData', // the dataset it is built from
    columns: [['name', S], ['pod', S], ['start_date', S], ['end_date', S], ['source', S], ['no_leave_booked', B]],
    key: 0,
    rows: (d) => (d.oooData || []).filter((o) => o.source !== 'manual')
      .map((o) => [o.name, o.pod, o.start, o.end, o.source, !!o.stub]),
  },
  {
    name: 'PM_Projects',
    source: 'pmData', // the dataset it is built from
    columns: [['pm_name', S], ['pm_gid', S], ['project_gid', S], ['project', S], ['url', S], ['start_date', S], ['due_date', S],
      ['completed_tasks', N], ['total_tasks', N], ['pct_complete', N], ['project_type', S]],
    key: 0,
    rows: (d) => (d.pmData || []).flatMap((p) => (p.projects || []).map((pr) =>
      [p.name, p.gid, pr.gid, pr.name, pr.url, pr.start, pr.due, pr.completedTasks, pr.totalTasks, pr.pct, pr.projectType])),
  },
  {
    name: 'PM_Tasks',
    source: 'pmData', // the dataset it is built from
    columns: [['pm_name', S], ['project_gid', S], ['task', S], ['start_date', S], ['due_date', S], ['est_hours', N]],
    key: 0,
    rows: (d) => (d.pmData || []).flatMap((p) => (p.projects || []).flatMap((pr) =>
      (pr.pmTasks || []).map((t) => [p.name, pr.gid, t.name, t.start, t.due, t.est]))),
  },
  {
    name: 'Roadmap',
    source: 'roadmapData', // the dataset it is built from
    columns: [['name', S], ['url', S], ['pm_name', S], ['completed', B], ['dropped', B], ['regions', S], ['project_status', S], ['status_title', S]],
    key: 0,
    rows: (d) => (d.roadmapData || []).map((t) =>
      [t.name, t.url, t.pmName, !!t.completed, !!t.dropped, list(t.regions || []), t.projectStatus, t.statusTitle]),
  },
  {
    name: 'Roadmap_Subtasks',
    source: 'roadmapData', // the dataset it is built from
    columns: [['roadmap_url', S], ['roadmap_name', S], ['subtask', S], ['start_date', S], ['due_date', S]],
    key: 0,
    rows: (d) => (d.roadmapData || []).flatMap((t) =>
      (t.subtasks || []).map((s) => [t.url, t.name, s.name, s.start_on, s.due_on])),
  },
  {
    name: 'Scope_Creep',
    source: 'scopeCreepData', // the dataset it is built from
    columns: [['name', S], ['url', S], ['status', S], ['est_hours', N], ['assignee', S], ['completed', B], ['project', S],
      ['project_url', S], ['parent', S], ['parent_url', S]],
    key: 0,
    rows: (d) => (d.scopeCreepData || []).map((s) =>
      [s.name, s.url, s.status, s.estHours, s.assignee, !!s.completed, s.project, s.projectUrl, s.parent, s.parentUrl]),
  },
  {
    name: 'PM_Updates',
    source: 'pmUpdatesData', // the dataset it is built from
    columns: [['week_start', S], ['week_label', S], ['pm_name', S], ['posted_at', S], ['text', S]],
    key: 0,
    rows: (d) => (d.pmUpdatesData || []).flatMap((w) => (w.messages || []).map((m) =>
      [w.weekStart, w.weekLabel, m.name, m.timestamp, stripExternalUrls(m.text)])),
  },
  {
    name: 'Requests',
    source: 'requestsData', // the dataset it is built from
    columns: [['gid', S], ['code', S], ['name', S], ['url', S], ['pod', S], ['requester', S], ['assignee', S], ['request_status', S],
      ['quarter', S], ['project_type', S], ['regions', S], ['matched', B], ['project_name', S], ['project_url', S], ['project_status', S],
      ['submitted_at', S], ['on_track_at', S], ['started_by', S], ['is_real_start', B], ['duration_hours', N], ['comment_count', N]],
    key: 0,
    rows: (d) => (d.requestsData || []).map((r) => [r.gid, r.code, r.name, r.url, r.pod, r.requester, r.assignee, r.requestStatus,
      r.quarter, r.projectType, list(r.regions || []), !!r.matched, r.projectName, r.projectUrl, r.projectStatus,
      r.submittedAt, r.onTrackAt, r.startedBy, !!r.isRealStart, r.durationHours, r.commentCount]),
  },
  {
    name: 'Request_Comments',
    source: 'requestsData', // the dataset it is built from
    columns: [['request_gid', S], ['code', S], ['author', S], ['posted_at', S], ['text', S]],
    key: 0,
    rows: (d) => (d.requestsData || []).flatMap((r) => (r.comments || []).map((c) =>
      [r.gid, r.code, c.author, c.at, stripCommentUrls(c.text)])),
  },
  {
    // Counts only. The share of a panel is count / panel total, worked out by the dashboard, so one new
    // request changes a couple of rows instead of every row in the panel.
    name: 'Regional',
    source: 'regionalData', // the dataset it is built from
    columns: [['request_type', S], ['dimension', S], ['source_field', S], ['quarter', S], ['label', S], ['count', N]],
    key: 0,
    rows: (d) => ((d.regionalData && d.regionalData.sections) || []).flatMap((s) => (s.panels || []).flatMap((p) =>
      (p.rows || []).map((r) => [s.type, s.dimension, s.source, p.quarter, r.label, r.count]))),
  },
  {
    name: 'Regional_Panels',
    source: 'regionalData', // the dataset it is built from
    columns: [['request_type', S], ['dimension', S], ['source_field', S], ['quarter', S], ['total', N], ['with_value', N],
      ['missing', N], ['requests', N], ['not_captured', B]],
    key: 0,
    rows: (d) => ((d.regionalData && d.regionalData.sections) || []).flatMap((s) => (s.panels || []).map((p) =>
      [s.type, s.dimension, s.source, p.quarter, p.total, p.withValue, p.missing, p.requests, !!s.notCaptured])),
  },
  {
    name: 'Regional_Unrecognised',
    source: 'regionalData', // the dataset it is built from
    columns: [['gid', S], ['name', S], ['raw_value', S], ['quarter', S], ['request_type', S], ['url', S]],
    key: 0,
    rows: (d) => ((d.regionalData && d.regionalData.unrecognised) || []).map((u) => [u.gid, u.name, u.raw, u.quarter, u.type, u.url]),
  },
  {
    name: 'Regional_Meta',
    source: 'regionalData', // the dataset it is built from
    columns: [['group', S], ['key', S], ['value', N], ['pct', N]],
    key: 0,
    rows: (d) => {
      const g = d.regionalData;
      if (!g) return [];
      const m = g.meta || {};
      return [
        ...(g.quarters || []).map((q) => ['quarter', q, null, null]),
        ...(m.typeCompletion || []).map((t) => ['type_completion', t.month, t.n, t.pct]),
        ...(m.byQuarter || []).map((t) => ['by_quarter', t.quarter, t.count, null]),
        ...['totalInWindow', 'cancelledExcluded', 'typeUnset', 'unrecognisedCount'].map((k) => ['total', k, m[k], null]),
      ];
    },
  },
];

// Normalise a raw value to what the sheet will hold: text stays text, '' and null both mean "empty".
function normaliseCell(v, type) {
  if (type === S) return v === null || v === undefined ? '' : String(v);
  if (type === N) return v === null || v === undefined || v === '' ? null : Number(v);
  return !!v;
}

// Build every pipeline tab from the datasets the report is built from.
// Returns { [tab]: { headers, types, rows } } with rows already normalised.
function buildTables(d) {
  const out = {};
  for (const tab of PIPELINE_TABS) {
    const types = tab.columns.map((c) => c[1]);
    const rows = tab.rows(d).map((r) => {
      if (r.length !== types.length) throw new Error(`${tab.name}: row has ${r.length} cells, expected ${types.length}`);
      return r.map((v, i) => normaliseCell(v, types[i]));
    });
    out[tab.name] = { name: tab.name, source: tab.source, headers: tab.columns.map((c) => c[0]), types, key: tab.key, rows };
  }
  return out;
}

module.exports = { PIPELINE_TABS, buildTables, normaliseCell, LIST_SEP, S, N, B };
