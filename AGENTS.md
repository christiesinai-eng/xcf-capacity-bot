# XCF Capacity Control Tower

A daily capacity and delivery dashboard for The Creative Foundry (XCF), Xero's in-house
creative team. It pulls live data from Asana and Slack, injects it into a single
self-contained HTML file, and that file gets deployed to an internal Xero URL.

- **Live dashboard:** https://xcf-capacity-report.dashboard.xero.dev (Xero VPN required)
- **Audience:** XCF producers, PMs, and the creative leadership team
- **Owner:** Christie Sinai

New to the project and just need to run and deploy it? Read `RUNBOOK.md` instead.

## What it does

Ten tabs, each answering a different planning question:

| Tab | Question it answers |
|---|---|
| Capacity report | How booked is each person today / next 7 days / next month? |
| POD summary | Which PODs are over or under capacity? |
| Missing fields | Which tasks are missing an estimate or due date? |
| PM Team | What is each PM carrying, split by Roadmap / Micro BAU / XCF Initiative? |
| Scope Creep & FAA | Which tasks have drifted past their original scope? |
| Project Forecaster | Gantt view of Roadmap projects — production, in-market, brief due |
| OOO | Who is away, and when? |
| PM Project Updates | Weekly PM updates from Slack, with executive summaries |
| Request Cycle Time | How long requests wait before work starts, and why |
| Regional Requests | Requests by region, business group and cost centre |

## Architecture

No framework, no build step, no bundler, no tests. Plain CommonJS Node.js writing a
static HTML file.

```
src/index.js          Orchestrator. Runs 7 data builders in Promise.all, calls saveReport.
src/asana.js          All Asana API access — 6 builders, ~1000 lines. The heart of the app.
src/slackUpdates.js   Slack PM updates builder, with cache fallback.
src/report.js         Injects data into template.html, writes the dated report file.
template.html         The entire dashboard — all CSS and JS inline, self-rendering.
slack-pm-updates-cache.json   Slack history + hand-written executive summaries.
reports/              Generated output (gitignored).
```

### Data flow

```
Asana REST API ─┐
                ├─→ builders ─→ saveReport() ─→ regex injection ─→ reports/xcf-report-YYYY-MM-DD.html
Slack Web API ──┘                                into template.html              ↓
                                                                          manual deploy
```

`src/report.js` does **string replacement, not templating**. It finds declarations like
`const MEMBERS=[...];` in `template.html` and swaps the array literal for real JSON.
The placeholder declarations live around lines 719–752 of `template.html` (plus
`RT_RAW_TASKS` at ~1694). If you reformat those lines — add a space, change the
quoting, split across lines differently — the regex stops matching and the build
throws. Keep their exact shape.

`template.html` is fully self-rendering: it ships with empty arrays and renders from
whatever data is injected. You can open it directly in a browser to see the shell.

## Running it

```bash
node src/index.js --once     # build once and exit — this is what you almost always want
```

Output lands at `reports/xcf-report-YYYY-MM-DD.html` (NZT date).

```bash
node src/index.js            # long-running: node-cron at 0 17 * * * UTC (5am NZST)
```

The cron mode is legacy — the scheduled runs now happen in GitHub Actions
(`.github/workflows/daily-report.yml`, three attempts at 4/5/6am NZT on weekdays).
Those runs **generate and upload an artifact only — they do not deploy.** Deploying
is a deliberate manual step.

### Environment

Secrets live in **`~/.xcf-lighthouse.env`** — in each person's own home folder, never in
the shared Drive folder — and in GitHub Actions secrets for CI. `src/loadEnv.js` reads
`$XCF_ENV_FILE`, then `~/.xcf-lighthouse.env`, then a legacy `.env` beside the code. See
`.env.example` for the shape. Only three values are actually secret (`ASANA_TOKEN`,
`SLACK_TOKEN`, `SLACK_WEBHOOK_URL`); the rest are ids.

| Variable | Notes |
|---|---|
| `ASANA_TOKEN` | Personal access token |
| `ASANA_WORKSPACE_GID` | Xero workspace |
| `ASANA_TEAM_GID` | The Creative Foundry team |
| `ASANA_FIELD_GID_ESTIMATED_TIME` | **Stores minutes, not hours** |
| `SLACK_TOKEN` | Bot token; needs `groups:history` + `users:read` |

### Who is in which POD

`config/pod-map.json` — member display name → POD name. It is a plain lookup, not a secret,
so it lives in the shared folder where every maintainer and the scheduled build see the
same answer. (It used to be an `ASANA_POD_MAP` variable in a private `.env`, so a person
added by one maintainer showed as "Unknown" on everyone else's build. The env variable is
now only a fallback if the file is missing.) A new joiner needs an entry here.

## Configuration lives in code, not config files

Almost all tuning happens through constants near the top of `src/asana.js`. This is
deliberate — the values are small, they change rarely, and keeping them in version
control means every change has an author and a date.

| Constant | Effect |
|---|---|
| `EXCLUDED_MEMBERS` | Removes a person from **every** tab. Use when someone leaves. |
| `MISSING_EXCLUDED_MEMBERS` | Hides a person from the Missing Fields tab only. |
| `PM_ALLOWED_MEMBERS` | Allowlist for the PM Team tab. |
| `PM_PROJECT_EXCLUSIONS` | Per-PM project suppressions. |
| `MANUAL_OOO` | Hand-entered leave. Highest priority — see below. |
| `MANUAL_POD` | POD assignment override. |
| `EXCLUDED_PROJECTS` | Projects to ignore in capacity maths. |
| `PM_PORTFOLIO_GID` | `1217210785824637` — XCF \| Projects. Feeds PM Team + Forecaster. |
| `PROJECT_TYPE_FIELD_GID` | `1217575429570978` — Roadmap / Micro (BAU) / XCF initiative. |
| `BAU_BOARDS` | Design BAU + Performance BAU board GIDs. |
| `LEAVE_PROJECT_GID` | `1212867822525791` — leave backup project. |

## Things that will bite you

**Estimated time is stored in minutes.** Every read of that custom field needs
`/ 60`. This is the single most common source of "the numbers look wrong".

**OOO comes from three sources and they fight.** Priority order is `MANUAL_OOO` →
Asana `vacation_dates` → leave project tasks. For a manual entry to actually win,
`buildOOOData()` skips that person in *both* of the other two loops. If you only
suppress one, the person shows up twice with different dates.

**Never hardcode today's date in `template.html`.** There was a bug where `rtTODAY`
was pinned to a literal date string, which quietly made the Project Forecaster's
"In Market" counter read 0 once that date passed. Use
`(()=>{const d=new Date();d.setHours(0,0,0,0);return d;})()`.

**Placeholder tasks inflate capacity.** Tasks whose name matches `/placeholder/i` are
filtered out in `buildMemberData()`. Removing that filter makes everyone look
overbooked.

**Don't delete `slack-pm-updates-cache.json`.** It holds the hand-written
`executiveSummary` for each week, keyed by `weekStart` (the Monday date). The Slack
builder merges those summaries back in on every run so they survive refreshes. The
file is also the fallback when the Slack token is missing or scoped wrong.

**External URLs get stripped before deploy.** `stripExternalUrls()` in `src/report.js`
keeps link text but drops hrefs for any host outside an allowlist
(`app.asana.com`, `docs.google.com`, `xero.com`, `slack.com`). The deploy scanner
flags external links, so this is load-bearing.

**Week labels are offset.** Weeks are keyed by Monday but *labelled* by the Friday of
that week. A cache entry with `weekStart: "2026-09-07"` displays as "11 Sep".

**Add files to the shared Drive folder by copying them in on your Mac, never by uploading
through the Drive website or API.** Those paths convert `.html` and `.md` into Google Docs
pointer stubs: the 15 Sep copy had `template.html` reduced from 130 KB to a 178-byte link and
`src/` and `.git` missing. Copying through the folder is byte-for-byte (tested 28 Oct 2026).
This file previously blamed Drive itself; that was wrong, and untested.

**Never put credentials in the shared folder.** It is readable by the whole team. Tokens go
in `~/.xcf-lighthouse.env`.

## Known dead code

- `src/slack.js` — from when this posted to Slack instead of deploying. Not imported anywhere.
- `renderBAU()` in `template.html` is only reachable via `showView('bau')`, and the BAU
  nav button was removed. `buildBAUData()` still runs on every build and still costs
  Asana calls, and `BAU_DATA` is still injected — the render path just never fires.

Both are harmless but neither is load-bearing. Removing them is safe.

## Common maintenance

**Someone leaves the business** — add their exact Asana display name to
`EXCLUDED_MEMBERS`, and remove them from any other list that names them
(`PM_ALLOWED_MEMBERS`, `MANUAL_POD`, `CAPACITY_GAP_MEMBERS` in `template.html`).

**Correct someone's leave dates** — add or edit an entry in `MANUAL_OOO`:
`{ name: 'First Last', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }`. Inclusive of both ends.

**Add an executive summary for a PM updates week** — find the week in
`slack-pm-updates-cache.json` by its `weekStart` Monday date, add an
`executiveSummary` field containing markdown, rebuild. `mdToHtml()` in `src/report.js`
supports headings, lists, tables, blockquotes, bold, italic, and links.

**Repoint a tab at a different Asana portfolio or field** — change the relevant GID
constant in `src/asana.js`. GIDs are visible in Asana URLs.

**Change capacity maths** — `hoursOnDate()` and `sumHoursOverRange()` in `src/asana.js`
spread a task's estimate evenly across its working days (weekends excluded).
