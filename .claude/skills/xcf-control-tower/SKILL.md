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
**Working copy:** the shared Drive folder `Shared drives/XCF @ Xero/Platforms Licences/Claude/xcf-capacity-bot`
(absolute prefix differs per person: `/Users/<you>/Library/CloudStorage/GoogleDrive-<email>/`;
quote the path — it has spaces and an `@`). **History/backup:** GitHub
`christiesinai-eng/xcf-capacity-bot` (private, internal). A kick-off prompt for new
maintainers is in `PICKUP_PROMPT.md`.
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
src/requestTiming.js   — Request Cycle Time builder + timing/summary cache
src/regionalRequests.js— Regional Requests builder
src/report.js          — injects data arrays into template.html, writes reports/xcf-report-YYYY-MM-DD.html
template.html          — self-rendering single-file dashboard (all JS/CSS inline)
slack-pm-updates-cache.json — persists Slack data + manually-added executive summaries
request-timing-cache.json   — project start dates + hand-written summaries and causes
                              COMMIT THIS. The summaries are not reproducible.
reports/               — generated daily HTML files
```

**Data flow:** `src/index.js` calls 7 async builders in parallel → `src/report.js` injects
them into `template.html` as named JS arrays (`MEMBERS`, `PM_DATA`, `OOO_DATA`, etc.) →
writes `reports/xcf-report-YYYY-MM-DD.html` → deploy that file.

**Key env vars (in `~/.xcf-lighthouse.env` — private, NEVER in the shared folder):**
- `ASANA_WORKSPACE_GID=41261904390129`
- `ASANA_TEAM_GID=1211868948534506` — "The Creative Foundry" (34 members)
- `ASANA_FIELD_GID_ESTIMATED_TIME=1203387567618671` — stored in **minutes**, divide by 60
- `SLACK_TOKEN=xoxb-...` — needs `groups:history` + `users:read` scopes
- POD membership is **not** an env var any more: it is `config/pod-map.json` in the shared folder (name → POD). A new joiner needs an entry there.

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
| Status (XCF) → In Progress | `1211986892220400` |
| Status (XCF) → SR - Stakeholder Review | `1213322493108394` |
| Status (XCF) → Complete | `1211986892220404` |
| Applicable Regions (Roadmap) | `1212086752729219` |
| Regions (XCF) (Micro BAU) | `1213486033990545` |
| Business Group (XCF) | `1211914438576356` |
| SH Cost centre (XCF) | `1213093222630048` |
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
**Window:** fixed start of **1 Jul 2026** (top of FY27 Q2), not a rolling window. A rolling
window made coverage incomparable week to week — older requests fell off the back, so the
number could drop while adoption improved. Set by `WINDOW_START`.

**Measures:** Request `created_at` → the earliest of four signals on the linked project,
in descending order of how well each approximates "work started":

| Signal | Where | Label shown |
|---|---|---|
| `Status (XCF)` → In Progress | project stories | `In Progress` |
| First **On Track** status update (`color: green`) | `project_statuses` | `On Track` |
| `Status (XCF)` → SR - Stakeholder Review | project stories | `Stakeholder Review` |
| `Status (XCF)` → Complete | project stories / `color: complete` | `Skipped In Progress` |

The last two date work *later* than it began, so they are labelled distinctly rather than
passed off as clean starts. `isRealStart` is true only for the first two.

**Shows:** a four-state coverage panel, a **distribution** of wait lengths, breakdowns by
quarter / project type / delay cause, a filterable sortable table with a written
explanation per row, and a worklist of projects with no start date.

**There is no median on this tab, deliberately.** The spread is almost flat — roughly 28
same-day, 10, 21, 25, 34, 23 over a month — with the two largest groups at opposite ends.
A median implied a typical request that does not exist and hid the shape of the data. The
breakdown panels say "mid-point wait" rather than "median" for the same reason: they are
for comparing groups against each other, not for describing a typical case.

**Coverage is four states, not one percentage.** Reporting a single figure made a normal
pipeline look like a tracking failure:

| State | Meaning |
|---|---|
| **Measured** | A start date was captured |
| **Awaiting In Progress** | Live project not yet marked — measures itself once the status flips. Statuses: New Request, Additional Information, On Hold, Backlog |
| **Missed** | Moved past In Progress without it being set; no truthful date recoverable |
| **Cancelled** | Excluded from the denominator entirely |

**The denominator is projects, not requests.** Of ~507 requests, ~315 never became projects —
BAU finished straight off the request, where cycle time does not apply. Counting them made
coverage read 23% when it was 61% of trackable work. The funnel is shown on the tab so the
315 stay visible rather than looking trimmed away.

**Projects DO have an activity log — don't repeat this mistake.** An earlier version of
this skill claimed a project's custom-field history was unobtainable, reasoning from
`/workspaces/{gid}/audit_log_events` returning `403 — Auth token must belong to service
account`. That inference was wrong and the endpoint was never tested. **`/projects/{gid}/stories`
exists** and records `enum_custom_field_changed` with timestamps, exactly like tasks:

```
/projects/1213702136901618/stories
  → 2026-09-06T11:14  enum_custom_field_changed  Status (XCF)  →  In Progress
```

Adding that signal took coverage from 48 to 94. In Progress is the **strongest** signal,
dating ~77 requests against On Track's ~35. When reaching for project history, test
`/projects/{gid}/stories` before concluding anything is unavailable.

**Match story enum values on `gid`, never on `name`.** The stories fetch requests
`new_enum_value.gid` in its `opt_fields`, so `s.new_enum_value?.name === 'Complete'`
silently never matches and loses every completed project. This cost 9 projects before it
was spotted. If a signal mysteriously finds nothing, check the opt_fields first.

**`Status (XCF) = In Progress` is a PROJECT value, not a request one.** On request tasks it
is never used — 0 of 100 sampled. Requests only ever move New Request → Hero Awareness /
Additional Information / Cancelled / Complete. Read it off the project.

**Request → project linking is name-based and lossy.** Asana keeps no relationship once a
task is converted to a project. The join is the `XCF-####` code appearing in both names.
Of 428 projects: 254 use `XCF-####` (matchable), 94 use `XCFP-###`, 49 use `XCFT-###`,
31 have no code. Roughly 40% can never be matched.

**CACHING — the rule that matters.** Cache a project only once it **has** a start date;
that value never changes. A project with no start yet must be re-checked on **every**
build.

An earlier version cached the *absence* of a start (`startedAt === undefined`), which froze
coverage permanently — once a project was recorded as unstarted it was never looked at
again, so projects the team had since marked In Progress stayed invisible and the number
could never climb. That defeats the entire purpose of the tab. Thirteen projects were
hidden this way; measured went 117 → 130 the moment it was fixed. The check is now:

```js
.filter(p => !cache.projects[p.gid]?.startedAt)
```

If you add or change a start signal, also clear `cache.projects` so every project is
re-evaluated — but keep `cache.requests`, which holds the hand-written summaries.

**Internal projects** are excluded via `EXCLUDED_CODES` in `src/requestTiming.js`
(currently `XCF-11710`, Canva XCF approvals). They are not business requests and distort
both coverage and the distribution.

**Sprint buckets are excluded too**, by name, via `EXCLUDED_NAME_PATTERNS` — anything shaped
like `Sprint | 7th - 11th Sep`. They are weekly planning containers, not requests; they were
created and set to In Progress immediately, so they counted as measured and made the XCF
initiative figures meaningless (9 of its 10 measured rows). The pattern needs `Sprint |`
followed by a date, so it deliberately does **not** catch `Studio BAU - Sprints and project
management` (a different set of tasks, handled directly with no project). Excluding items
is Christie's call — it changes the headline numbers — so ask before adding more.

**Region columns.** Both tables show a Region. Which Asana field supplies it depends on the
project type: **Roadmap → `Applicable Regions`** (`1212086752729219`); **Micro (BAU) and XCF
initiative → `Regions (XCF)`** (`1213486033990545`). A request with no project type yet takes
whichever field is filled. The project type itself comes from the request, falling back to the
linked project. This is deliberately strict: a Micro request with its region typed into the
Roadmap field shows no region, which is how a wrongly-filled field gets noticed.

**The bottom lists (awaiting / missed / cancelled) have a filter bar** — Region and Project
type — plus Type and Region columns. The bar is built once so a chosen filter survives the tab
being redrawn; only the lists underneath are rebuilt on change.

**Comment summaries and delay causes** live in `request-timing-cache.json` under
`requests[gid].summary`, `.cause` and `.causedAt`. Hand-written — see "Regenerate the
request cycle-time summaries" below. The builder preserves them across rebuilds, and a
scheduled task tops up new ones weekly.

**The cause taxonomy** is fixed — do not invent new values:
`Access & permissions`, `Brief & scoping`, `Capacity queue`, `Approval cycle`,
`Requester-side`, `Creative iteration`, `Misrouted`, `Dropped`, `No blocker`, `Unexplained`.

Keep *Creative iteration* separate from the delay causes — those days are active design
rounds, not waiting, and lumping them in overstates the problem. Tags carry a `causedAt`
date shown on the tab, because they are a point-in-time read and go stale.

**What the causes show** (92 classified, as of 20 Oct 2026): clean briefs resolve in
~2.4 days against ~26.9 for *Brief & scoping* — an eleven-fold gap, and the largest
actionable category. *Capacity queue* is only 7 of 92, which is useful evidence that the
bottleneck sits upstream of the team rather than within it.

### 10. Regional Requests Tab
**Data builder:** `buildRegionalData()` in `src/regionalRequests.js`
**Source:** XCF | Requests, FY27 Q2 + Q3, **cancelled requests excluded**
**Shows:** six sections — Region / Business Group / Cost Centre, each split Roadmap vs
Micro (BAU), with FY27 Q2 and Q3 side by side.

**Fields differ by project type:** Roadmap region comes from `Applicable Regions`
(`1212086752729219`), Micro BAU from `Regions (XCF)` (`1213486033990545`). Both are
multi-enum, so a request tagged with several regions counts once per region and region
totals exceed the request count.

**Horizontal bars, not pie charts.** The original ask was pies. The palette validator
fails all-pairs colour separation past **three** slices — worst pair ΔE 10.6 for normal
vision (below the 15 floor) and 1.6 under deuteranopia — so six regions encoded by colour
alone would be indistinguishable, including for full-colour readers. Bars label each row
directly, need no legend, and read identically at 6 or 20 categories. Run
`scripts/validate_palette.js` from the `dataviz` skill before reaching for colour-coded
categories anywhere.

**Two breakdowns have no data and say so.** Business Group and Cost Centre are set on
**1 of 59** Roadmap requests. Those sections render an explicit "not captured" panel naming
the gap and pointing at intake, rather than a one-slice chart or a silent omission. The
`notCaptured` flag fires when every panel has `withValue <= 1`.

**Cost centre is free text.** Values are collapsed on their leading numeric code, since the
same centre appears as `3071` and `3071 Digital Customer Engagement`. Anything without a
code is listed with Asana links so it can be corrected at source. That list went from 79 to
0 in a day once it was clickable — the same pattern works for any data-quality gap.

### 11. BAU Tab (Design + Performance) — orphaned
**Data builder:** `buildBAUData()` in `src/asana.js`
**Source:** Design BAU board + Performance BAU board
**Note:** `buildBAUData()` still runs and `BAU_DATA` is still injected, but the nav button
was removed, so `renderBAU()` is unreachable. Harmless; safe to delete.

---

## Scheduled tasks

Two live tasks in `~/.claude/scheduled-tasks/`:

| Task | When | Does |
|---|---|---|
| `xcf-capacity-report-daily` | 8am NZT daily | Build, sanity-check, deploy |
| `xcf-summarise-request-waits` | 8am NZT Mondays | Summarise anything unsummarised, rebuild, deploy |

`xcf-capacity-report-friday` is **paused** — it duplicated the daily and ran at 11pm when
nobody could approve Okta.

**8am is deliberate.** Deploys need an interactive Okta device-code approval, so an
unattended 2am run could only ever build. Both tasks now report the `verification_uri` and
`user_code` and stop cleanly if Okta is needed, rather than failing.

**Both prompts were rewritten in Oct 2026.** The originals still described the pre-August
manual Slack workflow — reading the channel via MCP, grouping into weeks, injecting with
Python — and looked for a `PM_UPDATES_DATA = []` placeholder the build had already filled,
so they errored. Runs took 35–95 minutes for what is a 3–5 minute job. If you ever see a
scheduled task doing manual Slack work, it is stale: `node src/index.js --once` does all
of it.

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

**Request Cycle Time coverage never moves, even though statuses are being set:**
- The caching bug. Only projects *with* a start date may be cached; see the caching
  section above. If the staleness check caches the absence of a start, coverage freezes.

**A start signal finds nothing / a whole status disappears:**
- Check the `opt_fields` on the stories fetch. Matching `new_enum_value.name` when only
  `.gid` was requested fails silently and returns nothing. Match on gid.

**Deploy refused with `load_skill_first`:**
- Pass `skill: "dashboard-accelerator@2.14"` on `deploy_app`. Required since Oct 2026.

**Deploy returns `needs_external_confirmation`:**
- Something in the page references an external domain. Request comments are the usual
  culprit — people paste Canva, Figma, Miro and Frame.io links. `stripCommentUrls()` in
  `src/report.js` removes them. Do **not** pass `allow_external_review` to get past it.

**Scheduled task runs for 35+ minutes or reports "nothing was deployed":**
- Its prompt is stale and still doing the pre-August manual Slack injection. Rewrite it to
  build → sanity-check → deploy. See the Scheduled tasks section.

## Lessons worth not relearning

Things that cost real time in this codebase:

- **Test the endpoint before declaring data unavailable.** Project custom-field history was
  recorded here as unobtainable, inferred from an audit-log 403. `/projects/{gid}/stories`
  had it all along. That wrong note sat in this skill and shaped a whole design.
- **Check the premise against the data before building.** "Measure to Status (XCF) = In
  Progress" was specified against request tasks, where 0 of 100 ever used it. It is a
  *project* value. Sampling first would have caught it in minutes.
- **Silent failure counters hide the cause.** A `catch { fails++ }` reported 171 failures
  that looked like rate limiting; logging the actual error showed `IN_PROGRESS_GID is not
  defined` in one run.
- **Check the denominator before redesigning the presentation.** A coverage figure of 23%
  looked alarming and was really 61% — the denominator included 315 requests the metric
  does not apply to.
- **A statistic can be the wrong shape entirely.** The median described a typical request
  that does not exist; the distribution is almost flat. Look at the spread before choosing
  a summary statistic.
- **Clickable fix lists get fixed.** 79 bad cost centres went to zero in a day once they
  were a list with links. Prefer a worklist over a statistic whenever the gap is
  actionable.
