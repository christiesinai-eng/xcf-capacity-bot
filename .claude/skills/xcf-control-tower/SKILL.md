---
name: xcf-control-tower
description: >
  Guides Claude through building, maintaining, and extending the XCF Capacity Control Tower — 
  the XCF team's daily HTML dashboard at https://xcf-capacity-report.dashboard.xero.dev.
  Use this skill whenever someone asks to: rebuild the capacity report, add a new tab, 
  change which Asana portfolio or custom field is used, update who appears on a tab, 
  fix data discrepancies, update OOO dates, refresh and redeploy, or understand how 
  any part of the control tower works. This is the single source of truth for the entire 
  dashboard — its architecture, config values, prompts, and maintenance workflows.
---

# XCF Capacity Control Tower

The XCF Capacity Control Tower is a daily HTML dashboard for The Creative Foundry (XCF) team
at Xero. It pulls live data from Asana and Slack, injects it into a self-rendering HTML template,
and deploys to an internal Xero dashboard URL via the Xero Deploy MCP tool.

**Live URL:** https://xcf-capacity-report.dashboard.xero.dev (Xero VPN required)
**Repo:** `/Users/christie.sinai/Documents/xcf-capacity-bot/` (private, internal)
**Deploy command:**
```
node src/index.js --once
```
Then deploy the generated file via `mcp__Xero_Deploy__deploy_app`.

---

## Architecture Overview

```
src/index.js           — orchestrator: runs all data builders in parallel, calls saveReport
src/asana.js           — all Asana API calls (7 data builders)
src/slackUpdates.js    — Slack PM updates fetcher + cache
src/report.js          — injects data arrays into template.html, writes reports/xcf-report-YYYY-MM-DD.html
template.html          — self-rendering single-file dashboard (all JS/CSS inline)
slack-pm-updates-cache.json — persists Slack data + manually-added executive summaries
reports/               — generated daily HTML files
```

**Data flow:** `src/index.js` calls 7 async builders in parallel → `src/report.js` injects
them into `template.html` as named JS arrays (`MEMBERS`, `PM_DATA`, `OOO_DATA`, etc.) →
writes `reports/xcf-report-YYYY-MM-DD.html` → deploy that file.

**Key env vars (in `.env`):**
- `ASANA_WORKSPACE_GID=41261904390129`
- `ASANA_TEAM_GID=1211868948534506` — "The Creative Foundry" (34 members)
- `ASANA_FIELD_GID_ESTIMATED_TIME=1203387567618671` — stored in **minutes**, divide by 60
- `SLACK_TOKEN=xoxb-...` — needs `groups:history` + `users:read` scopes
- `ASANA_POD_MAP` — JSON string mapping member GID → POD name

---

## Key Asana GIDs (as of Sep 2026)

| Purpose | GID |
|---|---|
| PM portfolio (XCF \| Projects) | `1217210785824637` |
| Project type (XCF) custom field | `1217575429570978` |
| Estimated time field | `1203387567618671` |
| Design BAU board | `1212644837995359` |
| Performance BAU board | `1212446476552313` |
| Leave project | `LEAVE_PROJECT_GID` (in .env) |
| Slack PM updates channel | `C0B3YCKT0JV` |
| XCF \| Requests project | `1215906401561993` |
| Status (XCF) field | `1211986892220398` (In Progress = `1211986892220400`) |
| XCF code text field | `1213726159416934` |
| PODS (XCF) field | `1211165589636938` |
| Requester (XCF) field | `1218344624492289` |

**Project type values:** `Roadmap` / `Micro (BAU)` / `XCF initiative`

**Fiscal quarters:** Xero's FY starts 1 April, so FY27 Q1 = Apr–Jun 2026. Matches the
`FY27 Q2` labels on the Quarter (Mkt Planning) field.

---

## Dashboard Tabs

### 1. Capacity Tab
**Data builder:** `buildMemberData()` in `src/asana.js`
**Source:** All tasks assigned to each team member across the workspace (by user GID)
**Shows:** Hours today / 7-day / 21-day per person, POD grouping
**Key decisions:**
- Estimated time field is in minutes → divide by 60 for hours
- `EXCLUDED_MEMBERS` list keeps admin/non-creative people off the tab
- `CAPACITY_GAP_MEMBERS` set (in template.html) marks members whose Asana hours are known to gap
- Placeholder tasks excluded by name filter: `/placeholder/i`

### 2. POD Summary Tab
**Data:** Derived from the same `MEMBERS` array as Capacity
**Shows:** Rollup by POD with total hours

### 3. Missing Fields Tab
**Data:** `missingTasks` from `buildMemberData()`
**Shows:** Tasks with no estimated time or no due date
**Excluded:** Members in `MISSING_EXCLUDED_MEMBERS` (PMs and some seniors)

### 4. Scope Creep Tab
**Data builder:** `buildScopeCreepData()` in `src/asana.js`
**Source:** Tasks where actual hours significantly exceed estimated

### 5. OOO Tab
**Data builder:** `buildOOOData()` in `src/asana.js`
**Sources (in priority order):**
1. `MANUAL_OOO` entries (highest priority — overrides both other sources)
2. Asana `vacation_dates` on user profiles
3. Leave backup project tasks
**Key:** Members in `MANUAL_OOO` are skipped in both source 2 and source 3 (prevents duplicate entries)

### 6. Project Forecaster Tab
**Data builder:** `buildRoadmapData()` in `src/asana.js`
**Source:** XCF | Projects portfolio, filtered to `projectType === 'Roadmap'`
**Shows:** Gantt-style timeline with Production / In Market / Project Brief Due bars
**Key bug (fixed Sep 2026):** `rtTODAY` must be `new Date()` — never hardcode a date here

### 7. PM Team Tab
**Data builder:** `buildPMData()` in `src/asana.js`
**Source:** XCF | Projects portfolio
**Shows only:** Quincey Brinker, Sherry Choe, Deepak Aujla, Logen Stent, Naomi Lawson, Becky Sharp, Tom Gregson
**Sections:** Roadmap (blue #6C8EF5) / Micros BAU (teal #4CAF8A) / XCF Initiative (amber #F5A623)
**Each section:** Collapsible with chevron toggle; counts shown as header badges

### 8. PM Project Updates Tab
**Data builder:** `buildPMUpdatesData()` in `src/slackUpdates.js`
**Source:** `#xcf-pm-weekly-updates` Slack channel, last 12 weeks
**AI summaries:** Stored manually in `slack-pm-updates-cache.json` under `executiveSummary` key per week
**Format:** Week grouped by Monday, labelled by Friday of that week

### 9. Request Cycle Time Tab
**Data builder:** `buildRequestsData()` in `src/requestTiming.js`
**Source:** XCF | Requests (`1215906401561993`) + XCF | Projects portfolio
**Measures:** Request `created_at` → whichever of these the linked project hits first:
1. its first **On Track** status update (`project_statuses` entry with `color: green`)
2. its **`Status (XCF)` set to In Progress** (`enum_custom_field_changed` in project stories)

**Shows:** Coverage box, median wait broken down by fiscal quarter and project type,
then a filterable table (sortable by duration) with a written explanation of each wait.
The "Work started" column labels which of the two signals fired.

**Projects DO have an activity log — don't repeat this mistake.** An earlier version of
this skill claimed a project's custom-field history was unobtainable, reasoning from
`/workspaces/{gid}/audit_log_events` returning `403 — Auth token must belong to service
account`. That inference was wrong and the endpoint was never tested. **`/projects/{gid}/stories`
exists** and records `enum_custom_field_changed` with timestamps, exactly like tasks:

```
/projects/1213702136901618/stories
  → 2026-09-06T11:14  enum_custom_field_changed  Status (XCF)  →  In Progress
```

Adding that signal took coverage from 48 to 94 of 411 requests. In Progress is the
**stronger** of the two, dating 59 requests against On Track's 35. When reaching for
project history, test `/projects/{gid}/stories` before concluding anything is unavailable.

**`Status (XCF) = In Progress` is a PROJECT value, not a request one.** On request tasks it
is never used — 0 of 100 sampled. Requests only ever move New Request → Hero Awareness /
Additional Information / Cancelled / Complete. Read it off the project.

**Request → project linking is name-based and lossy.** Asana keeps no relationship once a
task is converted to a project. The join is the `XCF-####` code appearing in both names.
Of 428 projects: 254 use `XCF-####` (matchable), 94 use `XCFP-###`, 49 use `XCFT-###`,
31 have no code. Roughly 40% can never be matched.

**Coverage is deliberately prominent.** Only ~94 of ~411 requests have a measurable cycle.
The coverage box at the top of the tab states this in plain numbers, split by which signal
dated each one, so the medians are never read as covering everything. It is an adoption
metric — it rises as the team posts project status updates and sets Status (XCF).

**Caching note:** the cached project entry is keyed on `startedAt`. If you add or change a
start signal, clear `cache.projects` (keep `cache.requests` — the summaries live there) so
every project is re-evaluated. The staleness check is `startedAt === undefined`, not a
truthiness test, so a genuine "no start date" result stays cached rather than refetching
forever.

**Comment summaries** live in `request-timing-cache.json` under `requests[gid].summary`,
hand-written (see "Regenerate the request summaries" below). The builder preserves them
across rebuilds.

**Caching:** a project's first green never changes, so resolved lookups are cached
permanently. First run costs hundreds of API calls; later runs are near-free.

### 10. BAU Tab (Design + Performance) — orphaned
**Data builder:** `buildBAUData()` in `src/asana.js`
**Source:** Design BAU board + Performance BAU board
**Note:** `buildBAUData()` still runs and `BAU_DATA` is still injected, but the nav button
was removed, so `renderBAU()` is unreachable. Harmless; safe to delete.

---

## How to Deploy

1. Run the build:
   ```
   node src/index.js --once
   ```
2. Deploy via Xero Deploy MCP:
   - `team: creative-foundry`
   - `app_name: xcf-capacity-report`
   - `index_html_path: reports/xcf-report-YYYY-MM-DD.html`
   - `auth_mode: okta`
3. Approve the Okta prompt at the URL shown
4. Wait ~5-7 minutes for the scan to complete — poll `get_status` to confirm

---

## Common Maintenance Tasks

### Refresh and redeploy with today's data
```
node src/index.js --once
```
Then deploy the new `reports/xcf-report-YYYY-MM-DD.html`.

### Add/remove a person from the Capacity tab
- To **exclude** someone: add their exact Asana name to `EXCLUDED_MEMBERS` in `src/asana.js`
- To **re-include** someone: remove from `EXCLUDED_MEMBERS`

### Update who appears on the PM Team tab
Edit `PM_ALLOWED_MEMBERS` array in `src/asana.js`.

### Add or correct an OOO entry
Add to `MANUAL_OOO` in `src/asana.js`:
```js
{ name: 'First Last', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
```
This takes priority over Asana vacation_dates and leave project tasks for that person.

### Regenerate the request cycle-time summaries
The "Why" column on the Request Cycle Time tab is hand-written, not generated at build time.
1. Build, then read the rows that have a cycle time and at least one comment:
   `node -e "...REQUESTS_DATA..."` — or read `request-timing-cache.json` directly.
2. Read each request's `comments[]` and write a one-or-two sentence explanation of why that
   request waited as long as it did. Lead with the cause in bold: **Waiting on access**,
   **Requester-side delay**, **Not an XCF delay**, and so on.
3. Write them into `request-timing-cache.json` at `requests[<gid>].summary` (markdown — bold,
   italics and links all render via `mdToHtml`).
4. Rebuild. The builder preserves existing summaries, so this is additive.

Be honest in these: several requests have only automated duplicate-detection comments and no
human discussion. Say that, rather than inventing a narrative.

**Never commit `.env`, but always commit `request-timing-cache.json`** — the summaries are
hand-written and unrecoverable if lost.

### Add an AI summary for a PM updates week
1. Open `slack-pm-updates-cache.json`
2. Find the week entry by `weekStart` (Monday date, YYYY-MM-DD format)
3. Add an `executiveSummary` field with markdown content (see existing entries for format)
4. Rebuild and redeploy

### Change which Asana portfolio feeds a tab
Update the relevant `*_GID` constant in `src/asana.js`:
- PM portfolio / Project Forecaster: `PM_PORTFOLIO_GID`
- BAU boards: `BAU_BOARDS` array

### Change project type filtering on PM Team or Forecaster
The `PROJECT_TYPE_FIELD_GID` (`1217575429570978`) reads the "Project type (XCF)" custom field.
Values: `Roadmap`, `Micro (BAU)`, `XCF initiative`

---

## The Prompts That Built This

These are the exact prompts used to build and evolve each part of the dashboard.
You can use these as a starting point when making similar changes.

**Asana restructuring (point data to new portfolios):**
> "I've made some big changes in Asana. Check [tab list], refresh and deploy the report."

**Fix capacity discrepancies:**
> "Steph is showing 9.9 in the report but 3.9 in Asana. Ciaran is 8.6 vs 2.6. Can you investigate?"
> *(Root cause was placeholder tasks — fixed by filtering `/placeholder/i` task names)*

**Split PM Team tab into sections:**
> "Split the PMs work with a rollup: Roadmap Projects (heading) / Micros BAU (heading) / XCF Initiative (heading) — based on the Project type (XCF) custom field"

**Make section headings collapsible with colour:**
> "Make the headings bigger and add a colour so they stand out. Make them a dropdown so they can be rolled up. In the top squares next to today etc. add Micro, roadmap etc and how many jobs there are for that particular PM."

**Filter Project Forecaster to Roadmap only:**
> "Please update the Project Forecaster tab ONLY. Only pull projects from XCF | Projects and only include any project with Roadmap selected as the Project type."

**Fix stat box counts (hardcoded date bug):**
> "The boxes at the top say there are 0 In Market which is not true. Can you check and fix?"
> *(Fix: change `const rtTODAY=new Date('hardcoded-date')` → `const rtTODAY=(()=>{const d=new Date();d.setHours(0,0,0,0);return d;})();`)*

**Update OOO dates:**
> "Christie's out of office is now starting on the 16th [September] to the 4th October. Update the OOO tab."

**Remove a departed team member:**
> "[Name] has left the business. Please remove their name from all tabs in the report."

**Add an executive summary for a weekly update:**
> "On the PM Project updates tab please pull in the latest updates from [date]."
> *(Read the messages from the cache, generate a summary in the existing format, write it to the cache, rebuild)*

---

## Troubleshooting

**Report shows wrong hours / discrepancies with Asana:**
- Check for placeholder tasks (tasks named like "Placeholder studio hours") — these should be excluded by the `/placeholder/i` filter
- Check `EXCLUDED_MEMBERS` — someone may have been removed who shouldn't be
- Verify `ASANA_FIELD_GID_ESTIMATED_TIME` is correct and values are in minutes

**OOO tab shows duplicate entries for someone:**
- Add them to `MANUAL_OOO` — this suppresses both the Asana vacation_dates AND leave project sources

**Project Forecaster "In Market" count shows 0:**
- Check that `rtTODAY` in `template.html` is `new Date()` not a hardcoded date string

**Deploy fails (status: failed):**
- Usually transient — try deploying again
- Check file size: `ls -lh reports/xcf-report-YYYY-MM-DD.html` (should be under 1MB)

**Build hangs (ECONNRESET on Asana calls):**
- This is a known intermittent issue in `getTasksForUser` — retry the build
- If it fails 3 times in a row, wait and try again later (VPN/proxy timeout issue)
