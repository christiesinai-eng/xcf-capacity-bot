'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SheetAdapter = require('../src/sheetAdapter');
const { toValues } = require('./helpers/sheetFixture');

const TODAY = '2026-10-29'; // a Thursday: the week is Thu 29 Oct to Wed 4 Nov, the month to Sat 28 Nov (22 working days)

// Build a sheet reply from simple { Tab: [headers, ...rows] } input, in declared order.
function reply(tabs) {
  return {
    ranges: SheetAdapter.TABS.map((name) => {
      const t = tabs[name] || [[]];
      return { range: `${name}!A1:Z${t.length}`, values: toValues(t[0], t.slice(1)) };
    }),
  };
}
const datasets = (tabs) => SheetAdapter.buildDatasets(SheetAdapter.parseSheetResponse(reply(tabs)), TODAY);

const PEOPLE = ['name', 'pod', 'on_capacity_tab', 'is_pm', 'hidden_from_missing_tab', 'hidden_from_ooo_tab', 'asana_user_gid', 'note'];
const TASKS = ['assignee', 'pod', 'task', 'project', 'start_date', 'due_date', 'est_hours', 'overdue'];
const OOO = ['name', 'pod', 'start_date', 'end_date', 'source', 'no_leave_booked'];

test('reading the reply: ragged rows, quoted tab names and empty rows', () => {
  const tabs = SheetAdapter.parseSheetResponse({
    ranges: [
      { range: "'People'!A1:H3", values: [['name', 'pod', 'on_capacity_tab'], ['Ada', 'Design'], ['', '', ''], ['Bo', 'Campaign', 'Y']] },
      { range: 'Tasks', values: [['assignee', 'task']] },
    ],
  }, ['People', 'Tasks']);
  assert.deepEqual(tabs.People, [{ name: 'Ada', pod: 'Design', on_capacity_tab: '' }, { name: 'Bo', pod: 'Campaign', on_capacity_tab: 'Y' }]);
  assert.deepEqual(tabs.Tasks, []);
  assert.equal(SheetAdapter.tabNameOf("'Q4 Data'!A:C"), 'Q4 Data');
  assert.equal(SheetAdapter.tabNameOf("'Owner''s tab'!A1"), "Owner's tab");
  assert.equal(SheetAdapter.tabNameOf('Tasks!A1:H5'), 'Tasks');
  assert.equal(SheetAdapter.tabNameOf('Tasks'), 'Tasks');
});

test('twenty tabs, the most the platform allows', () => {
  assert.equal(SheetAdapter.TABS.length, 20);
  assert.equal(new Set(SheetAdapter.TABS).size, 20);
});

test('hours are worked out from the dates and estimate, for today, the next 5 working days and the month', () => {
  const d = datasets({
    People: [PEOPLE, ['Ada', 'Design', 'Y', 'N', 'N', 'N', '', '']],
    Tasks: [TASKS,
      ['Ada', 'Design', 'Even spread', 'XCF-1', '2026-10-26', '2026-10-30', 10, false], // 5 working days, 2h a day
      ['Ada', 'Design', 'All on the due date', 'XCF-2', '', '2026-11-03', 6, false],
      ['Ada', 'Design', 'Late', 'XCF-3', '', '2026-10-01', 4, true]],
    Missing_Tasks: [['task', 'task_gid', 'project', 'assignee', 'created_by', 'pod', 'missing_reason'], ['No estimate', '1', 'XCF-4', 'Ada', 'Bo', 'Design', 'No estimate']],
  });
  const ada = d.MEMBERS[0];
  assert.equal(ada.today, 2);
  assert.equal(ada.week, 10); // 2 days of the first task (4h) + all 6h of the second, which falls inside the week
  assert.equal(ada.month, 10);
  assert.equal(ada.qualifying, 2);
  assert.equal(ada.overdue, 1);
  assert.equal(ada.missing, 1);
  assert.deepEqual(ada.tasks[2], { name: 'Late', due: '2026-10-01', est: 4, proj: 'XCF-3', th: 0, wh: 0, overdue: true });
  assert.deepEqual(d.windows, { today: TODAY, weekFrom: TODAY, weekTo: '2026-11-04', weekWorkdays: 5, monthFrom: TODAY, monthTo: '2026-11-28', monthWorkdays: 22 });
});

test('someone on leave today shows no hours; leave typed in OOO_Manual counts and replaces the same person\'s Asana leave', () => {
  const d = datasets({
    People: [PEOPLE, ['Ada', 'Design', 'Y', 'N', 'N', 'N', '', ''], ['Bo', 'Campaign', 'Y', 'N', 'N', 'N', '', ''], ['Cy', 'Design', 'Y', 'N', 'N', 'N', '', '']],
    Tasks: [TASKS, ['Ada', 'Design', 'T', 'P', '', '2026-10-29', 5, false], ['Bo', 'Campaign', 'T', 'P', '', '2026-10-29', 5, false], ['Cy', 'Design', 'T', 'P', '', '2026-10-29', 5, false]],
    OOO: [OOO,
      ['Ada', 'Design', '2026-10-28', '2026-10-30', 'asana', false],
      ['Bo', 'Campaign', '2026-12-01', '2026-12-05', 'asana', false],   // replaced by the manual entry below
      ['Bo', 'Campaign', '', '', '', true],
      ['Cy', 'Design', '', '', '', true]],
    OOO_Manual: [['name', 'start_date', 'end_date', 'note'], ['Bo', '2026-10-20', '2026-11-20', 'long leave']],
  });
  const by = Object.fromEntries(d.MEMBERS.map((m) => [m.name, m]));
  assert.equal(by.Ada.ooo, true);
  assert.equal(by.Ada.today, 0);
  assert.equal(by.Bo.ooo, true, 'manual leave covers today');
  assert.equal(by.Cy.ooo, false);
  assert.equal(by.Cy.today, 5);
  const bo = d.OOO_DATA.filter((o) => o.name === 'Bo');
  assert.deepEqual(bo, [{ name: 'Bo', pod: 'Campaign', start: '2026-10-20', end: '2026-11-20', source: 'manual' }]);
  assert.deepEqual(d.OOO_DATA.find((o) => o.name === 'Cy'), { name: 'Cy', pod: 'Design', stub: true });
});

test('a manual leave name that is the start of a full name finds the person', () => {
  const d = datasets({
    People: [PEOPLE, ['Aniqah Mitha', 'Performance', 'Y', 'N', 'N', 'N', '', '']],
    OOO_Manual: [['name', 'start_date', 'end_date', 'note'], ['Aniqah', '2026-07-01', '2027-07-31', '']],
    OOO: [OOO, ['Aniqah Mitha', 'Performance', '', '', '', true]],
  });
  assert.deepEqual(d.OOO_DATA, [{ name: 'Aniqah Mitha', pod: 'Performance', start: '2026-07-01', end: '2027-07-31', source: 'manual' }]);
});

test('People controls who is on the capacity tab; a joiner with tasks still shows, as Unknown', () => {
  const d = datasets({
    People: [PEOPLE, ['Ada', 'Design', 'Y', 'N', 'N', 'N', '', ''], ['Gone', 'Design', 'N', 'N', 'N', 'N', '', '']],
    Tasks: [TASKS, ['Ada', 'Design', 'T', 'P', '', '2026-10-29', 1, false], ['New Joiner', 'Unknown', 'T', 'P', '', '2026-10-29', 3, false]],
  });
  assert.deepEqual(d.MEMBERS.map((m) => [m.name, m.pod]), [['Ada', 'Design'], ['New Joiner', 'Unknown']]);
});

test('PM totals come from their own time bookings', () => {
  const d = datasets({
    People: [PEOPLE, ['Pat', 'Campaign Ops', 'Y', 'Y', 'N', 'N', '999', '']],
    PM_Projects: [['pm_name', 'pm_gid', 'project_gid', 'project', 'url', 'start_date', 'due_date', 'completed_tasks', 'total_tasks', 'pct_complete', 'project_type'],
      ['Pat', '999', '10', 'XCFP-1 | Launch', 'https://app.asana.com/p/10', '', '2026-12-04', 3, 12, 25, 'Roadmap']],
    PM_Tasks: [['pm_name', 'project_gid', 'task', 'start_date', 'due_date', 'est_hours'], ['Pat', '10', '1. Project Management', '2026-10-26', '2026-10-30', 10]],
  });
  const pat = d.PM_DATA[0];
  assert.equal(pat.gid, '999');
  assert.equal(pat.projects[0].pmTasks[0].th, 2);
  assert.equal(pat.projects[0].pmTasks[0].wh, 4);
  assert.deepEqual(pat.tasks, [{ th: 2, wh: 4, mh: 4 }]);
  assert.deepEqual([pat.today, pat.week, pat.month], [2, 4, 4]);
  assert.equal(pat.projects[0].start, null);
});

test('requests: comments and the hand-written note are joined on the request id, and the summary is rendered', () => {
  const d = datasets({
    People: [PEOPLE],
    Requests: [['gid', 'code', 'name', 'url', 'pod', 'requester', 'assignee', 'request_status', 'quarter', 'project_type', 'regions', 'matched', 'project_name', 'project_url', 'project_status', 'submitted_at', 'on_track_at', 'started_by', 'is_real_start', 'duration_hours', 'comment_count'],
      ['1219962096154488', 'XCF-1', 'XCF-1 | A', 'u', 'Design', 'R', 'A', 'New Request', 'FY27 Q3', 'Micro (BAU)', 'MY; RoAsia (ID, PH, HK)', true, 'XCF-1 | A', 'pu', 'In Progress', '2026-10-27T23:07:48.435Z', '', 'On Track', true, 7.7, 1]],
    Request_Comments: [['request_gid', 'code', 'author', 'posted_at', 'text'], ['1219962096154488', 'XCF-1', 'Kim', '2026-10-28T00:00:00.000Z', 'Looks good\nthanks']],
    Notes: [['kind', 'key', 'label', 'summary_markdown', 'cause', 'cause_date'], ['request', '1219962096154488', 'XCF-1', '**Waited** on feedback.', 'Awaiting feedback', '2026-10-28']],
  });
  const r = d.REQUESTS_DATA[0];
  assert.equal(r.gid, '1219962096154488', 'ids stay whole');
  assert.deepEqual(r.regions, ['MY', 'RoAsia (ID, PH, HK)']);
  assert.equal(r.durationHours, 7.7);
  assert.equal(r.matched, true);
  assert.deepEqual(r.comments, [{ author: 'Kim', at: '2026-10-28T00:00:00.000Z', text: 'Looks good\nthanks' }]);
  assert.equal(r.cause, 'Awaiting feedback');
  assert.equal(r.causedAt, '2026-10-28');
  assert.equal(r.summaryHtml, '<p class="exec-p"><strong>Waited</strong> on feedback.</p>');
});

test('PM updates: weeks newest first, with the executive summary rendered when one exists', () => {
  const d = datasets({
    People: [PEOPLE],
    PM_Updates: [['week_start', 'week_label', 'pm_name', 'posted_at', 'text'], ['2026-10-19', '23 Oct', 'Pat', '2026-10-23T03:00:00.000Z', 'hello'], ['2026-10-12', '16 Oct', 'Pat', '2026-10-16T03:00:00.000Z', 'earlier']],
    Notes: [['kind', 'key', 'label', 'summary_markdown', 'cause', 'cause_date'], ['week', '2026-10-12', '16 Oct', '## Week summary', '', ''], ['week', '2026-10-19', '23 Oct', '', '', '']],
  });
  assert.deepEqual(d.PM_UPDATES_DATA.map((w) => w.weekStart), ['2026-10-19', '2026-10-12']);
  assert.equal(d.PM_UPDATES_DATA[0].executiveSummaryHtml, null);
  assert.equal(d.PM_UPDATES_DATA[1].executiveSummaryHtml, '<h2 class="exec-h2">Week summary</h2>');
  assert.equal(d.PM_UPDATES_DATA[1].messages[0].text, 'earlier');
});

test('regional: shares are worked out from the counts and the panel total', () => {
  const d = datasets({
    People: [PEOPLE],
    Regional_Panels: [['request_type', 'dimension', 'source_field', 'quarter', 'total', 'with_value', 'missing', 'requests', 'not_captured'], ['Micro (BAU)', 'Region', 'Regions (XCF)', 'FY27 Q3', 85, 65, 0, 65, false]],
    Regional: [['request_type', 'dimension', 'source_field', 'quarter', 'label', 'count'], ['Micro (BAU)', 'Region', 'Regions (XCF)', 'FY27 Q3', 'Global', 19], ['Micro (BAU)', 'Region', 'Regions (XCF)', 'FY27 Q3', 'UK', 16]],
    Regional_Meta: [['group', 'key', 'value', 'pct'], ['quarter', 'FY27 Q3', '', ''], ['type_completion', '2026-10', 71, 97], ['by_quarter', 'FY27 Q3', 71, ''], ['total', 'totalInWindow', 509, '']],
    Regional_Unrecognised: [['gid', 'name', 'raw_value', 'quarter', 'request_type', 'url'], ['5', 'XCF-2', 'Global education', 'FY27 Q3', 'Micro (BAU)', 'u']],
  });
  const g = d.REGIONAL_DATA;
  assert.deepEqual(g.quarters, ['FY27 Q3']);
  assert.deepEqual(g.sections[0].panels[0].rows, [{ label: 'Global', count: 19, pct: 22.4 }, { label: 'UK', count: 16, pct: 18.8 }]);
  assert.equal(g.sections[0].panels[0].total, 85);
  assert.equal(g.meta.totalInWindow, 509);
  assert.deepEqual(g.meta.typeCompletion, [{ month: '2026-10', n: 71, pct: 97 }]);
  assert.equal(g.unrecognised[0].raw, 'Global education');
});

test('the sync log says how fresh the sheet is', () => {
  const d = datasets({
    People: [PEOPLE],
    Sync_Log: [['key', 'value'], ['status', 'partial'], ['synced_at', '2026-10-29T00:00:00.000Z'], ['generated_at', '29 Oct 2026, 08:32 am NZT'], ['skipped', 'Requests, Request_Comments']],
  });
  assert.equal(d.GENERATED_AT, '29 Oct 2026, 08:32 am NZT');
  assert.deepEqual(d.sync, { status: 'partial', syncedAt: '2026-10-29T00:00:00.000Z', generatedAt: '29 Oct 2026, 08:32 am NZT', skipped: 'Requests, Request_Comments' });
});

test('a reply missing a tab the page needs is not used', () => {
  const full = SheetAdapter.parseSheetResponse(reply({ People: [PEOPLE] }));
  assert.equal(SheetAdapter.isUsable(full), true);
  const partial = SheetAdapter.parseSheetResponse({ ranges: [{ range: 'People!A1:B2', values: [['name'], ['Ada']] }] }, ['People']);
  assert.equal(SheetAdapter.isUsable(partial), false);
});
