# XCF Capacity Control Tower — Team Runbook

For anyone picking up maintenance of the XCF capacity dashboard.

- **Dashboard:** https://xcf-capacity-report.dashboard.xero.dev (Xero VPN required)
- **Code:** https://github.com/christiesinai-eng/xcf-capacity-bot
- **Owner:** Christie Sinai

## Start here: the code lives on GitHub

Clone it from GitHub. Do not keep a working copy of this app in Google Drive.

Drive converts `.html` and `.md` files into Google Docs pointer stubs. An attempt to
store the app in Drive on 15 Sep left `template.html` — the 130 KB file containing the
entire dashboard UI — as a 178-byte link, and dropped the `src/` folder and git history
entirely. The app in that folder cannot build. Drive is fine for documents like this
one; it is not a filesystem.

## What the app does

It reads task data from Asana and weekly updates from Slack, calculates capacity per
person, and writes a single self-contained HTML file. That file is then deployed to the
Xero dashboard platform. There is no database, no server, and no build step — just a
Node script that produces an HTML file.

Eight tabs: Capacity report, POD summary, Missing fields, PM Team, Scope Creep & FAA,
Project Forecaster, OOO, and PM Project Updates.

## One-time setup

**1. Install Node.js 20 or newer.** Check with `node --version`.

**2. Clone the repo.**

```bash
git clone https://github.com/christiesinai-eng/xcf-capacity-bot
cd xcf-capacity-bot
```

**3. Install dependencies.**

```bash
npm install
```

**4. Create your `.env` file.** Copy `.env.example` to `.env` and fill in the values.
Ask Christie for these — they are credentials and are deliberately not in the repo.

| Variable | What it is |
|---|---|
| `ASANA_TOKEN` | Asana personal access token — create your own, don't share one |
| `ASANA_WORKSPACE_GID` | Xero workspace ID |
| `ASANA_TEAM_GID` | The Creative Foundry team ID |
| `ASANA_FIELD_GID_ESTIMATED_TIME` | Estimated time custom field ID |
| `ASANA_POD_MAP` | JSON mapping of person to POD |
| `SLACK_TOKEN` | Slack bot token, needs `groups:history` and `users:read` |

Create your own Asana token at asana.com under Settings → Apps → Developer console.
Using someone else's means their name is on every API call.

**5. Verify it works.**

```bash
node src/index.js --once
```

Success looks like a new file in `reports/` named `xcf-report-YYYY-MM-DD.html`. Open it
in a browser — it should render the full dashboard with real data.

## The main task: refresh and redeploy

This is two steps, and both are needed. Generating a fresh report does not publish it.

**Step 1 — build:**

```bash
node src/index.js --once
```

**Step 2 — deploy.** In Claude Code, ask it to deploy the report. It uses the Xero
Deploy tool with these settings:

- team: `creative-foundry`
- app name: `xcf-capacity-report`
- file: `reports/xcf-report-YYYY-MM-DD.html` (today's date)
- auth: `okta`

You'll get an Okta approval link — open it and approve. The scan then takes about five
to seven minutes before the dashboard updates.

**If the deploy fails with `deploy_failed`,** just try again. It fails intermittently
for infrastructure reasons and usually succeeds on the second attempt. Don't start
debugging the HTML until a second attempt also fails.

**Always rebuild before deploying.** Report files are dated, and deploying yesterday's
file ships stale numbers with no warning.

## Maintenance recipes

Nearly all configuration is constants near the top of `src/asana.js`. Edit, rebuild,
redeploy.

**Someone leaves the business.** Add their exact Asana display name to
`EXCLUDED_MEMBERS` in `src/asana.js`. That removes them from every tab. Also remove
them from `PM_ALLOWED_MEMBERS` and `MANUAL_POD` if they appear there, and from
`CAPACITY_GAP_MEMBERS` in `template.html`.

**Fix or add someone's leave dates.** Add an entry to `MANUAL_OOO` in `src/asana.js`:

```js
{ name: 'First Last', start: '2026-09-16', end: '2026-10-04' }
```

Both dates are inclusive. Manual entries override whatever Asana says, which is the
point — use this when Asana leave data is wrong or missing.

**Add an executive summary to a PM updates week.** Open
`slack-pm-updates-cache.json`, find the week by its `weekStart` value (always a Monday
date), and add an `executiveSummary` field containing markdown. Headings, lists,
tables, bold, italic and links all render. Rebuild and redeploy.

Note the labelling offset: weeks are keyed by Monday but displayed by that week's
Friday. `weekStart: "2026-09-07"` shows on the dashboard as "11 Sep".

**Point a tab at a different Asana portfolio or field.** Change the relevant GID
constant in `src/asana.js`. GIDs are the long numbers in Asana URLs.

| Constant | Controls |
|---|---|
| `PM_PORTFOLIO_GID` | PM Team and Project Forecaster source portfolio |
| `PROJECT_TYPE_FIELD_GID` | The Roadmap / Micro (BAU) / XCF initiative field |
| `BAU_BOARDS` | Design and Performance BAU boards |
| `LEAVE_PROJECT_GID` | Leave backup project |

**Change who shows on the PM Team tab.** Edit `PM_ALLOWED_MEMBERS` in `src/asana.js`.

## Troubleshooting

**Hours look wrong versus Asana.** Two usual causes. First, the estimated time field
stores *minutes*, so every read divides by 60 — if you touched that maths, check it.
Second, tasks named "placeholder" are deliberately filtered out; without that filter
everyone looks overbooked.

**Someone appears twice on the OOO tab with different dates.** Leave data comes from
three sources: manual entries, Asana vacation dates, and the leave project. A manual
entry must suppress the other two. If it only suppresses one, you get a duplicate.

**A count on the Project Forecaster reads zero when it shouldn't.** Check that no date
in `template.html` is hardcoded. This exact bug happened once — a pinned date string
made the "In Market" counter silently read zero after that date passed. Dates must be
computed from `new Date()`.

**PM updates are missing or stale.** The Slack token has probably lost its scopes. It
needs `groups:history` and `users:read`. The app falls back to
`slack-pm-updates-cache.json` when Slack fails, so the tab keeps working with older
data rather than breaking.

**The build hangs or fails with a connection error.** Asana calls occasionally hang.
Retry. If it fails three times running, wait and come back — it's usually a VPN or
proxy issue rather than the code.

## Important: don't delete these

**`slack-pm-updates-cache.json`** holds every hand-written executive summary, keyed by
week. The app merges them back in on each run so they survive refreshes. Delete it and
those summaries are gone permanently. It is committed to git — keep it that way.

**`.env`** is deliberately excluded from git. Never commit it, and never put it in a
shared Drive folder. Each person uses their own credentials.

## Automated runs

GitHub Actions builds the report three times each weekday morning (4am, 5am and 6am
NZT) as redundancy. Those runs **generate the file but do not deploy it** — they upload
it as a build artifact only. Publishing to the live dashboard is always a deliberate
manual step.

## Deeper reference

Two files in the repo go further than this runbook:

- `AGENTS.md` — architecture, data flow, every configuration constant, and the
  non-obvious behaviours worth knowing before changing anything
- `CLAUDE.md` — how to work on this repo with Claude Code specifically

There is also a Claude Code skill at `.claude/skills/xcf-control-tower/` that loads
automatically when you open the repo and ask about the dashboard.

## Escalation

Ask Christie Sinai. For dashboard platform or deploy problems specifically, the Xero AI
Accelerator team owns `*.dashboard.xero.dev`.
