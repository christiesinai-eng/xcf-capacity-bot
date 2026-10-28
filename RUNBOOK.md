# XCF Capacity Control Tower — Team Runbook

For anyone picking up maintenance of the XCF capacity dashboard.

- **Dashboard:** https://xcf-capacity-report.dashboard.xero.dev (Xero VPN required)
- **Code:** https://github.com/christiesinai-eng/xcf-capacity-bot
- **Owner:** Christie Sinai

> **Data in a Google Sheet.** The page can read its numbers from a Google Sheet that the daily build keeps
> current, so data changes need no deploy. Joiners, leavers, manual leave and hand-written summaries are edited
> in the sheet (the `People`, `OOO_Manual` and `Notes` tabs). See `SHEET_SYNC.md`.

## Start here: where the app lives

The working copy lives in the shared Drive folder:

`Shared drives/XCF @ Xero/Platforms Licences/Claude/xcf-capacity-bot`

Open that folder in Claude Code (or Cowork) and the project instructions and the
`xcf-control-tower` skill load automatically. GitHub
(`christiesinai-eng/xcf-capacity-bot`) holds the version history and is the backup.
There is also a ready-made kick-off prompt in `PICKUP_PROMPT.md` in that folder.

Four rules make a shared folder safe to work in:

1. **Credentials never go in the folder.** Each person keeps their own
   `~/.xcf-lighthouse.env` in their home directory. The folder is readable by the whole
   team.
2. **One person edits at a time.** Say so in the team channel before changing code. Two
   machines saving the same file creates `file (1).js` conflict copies.
3. **Commit and push to GitHub after every change**, so there is always a version you can
   roll back to.
4. **Add files by copying them in through the folder on your Mac.** Uploading through the
   Drive website converts `.html` and `.md` into Google Docs pointer stubs. A copy made
   that way on 15 Sep left `template.html` as a 178-byte link. Copying through the
   folder keeps files byte-for-byte (tested 28 Oct).

## What the app does

It reads task data from Asana and weekly updates from Slack, calculates capacity per
person, and writes a single self-contained HTML file. That file is then deployed to the
Xero dashboard platform. There is no database, no server, and no build step — just a
Node script that produces an HTML file.

Ten tabs: Capacity report, POD summary, Missing fields, PM Team, Scope Creep & FAA,
Project Forecaster, OOO, PM Project Updates, Request Cycle Time, and Regional Requests.

## One-time setup

**1. Install Node.js 20 or newer.** Check with `node --version`.

**2. Open the shared folder** (path above) in Claude Code. There is nothing to clone, and
`node_modules/` is already in the folder, so there is no `npm install` either.

**3. Create your private credentials file.** Copy `.env.example` to `~/.xcf-lighthouse.env`
(your home folder, **not** the shared folder) and fill in the three secrets:

```bash
cp .env.example ~/.xcf-lighthouse.env
chmod 600 ~/.xcf-lighthouse.env
```

| Variable | What it is |
|---|---|
| `ASANA_TOKEN` | **Your own** Asana personal access token (Settings → Apps → Developer console). Using someone else's puts their name on every API call. |
| `SLACK_TOKEN` | The shared Slack bot token (needs `groups:history` and `users:read`). Ask Christie for it privately. |
| `SLACK_WEBHOOK_URL` | Optional, legacy. |

The other values in `.env.example` are ids, not secrets, and are already filled in.
**Who is in which POD is not set here any more** — see `config/pod-map.json` below.

**4. Get added as a maintainer** of the dashboard app, so you can deploy. Ask Christie —
she adds you with `set_maintainers`. You also need Okta access to the `creative-foundry`
team.

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

**A new person joins.** Add them to `config/pod-map.json` using their exact Asana display
name and one of the seven POD names (`Performance`, `Design`, `Design Studio`, `Campaign`,
`AI & Media`, `Campaign Ops`, `GM Creative`):

```json
"Max Bengtsson": "Campaign",
```

Rebuild and check nobody shows as POD "Unknown". They then appear on the Capacity, POD
summary and OOO tabs automatically. This file is shared, so everyone's builds — including
the 8am scheduled one — agree. Only add them to `PM_ALLOWED_MEMBERS` in `src/asana.js` if
they are a PM.

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
Second, generic tasks named "placeholder" (such as "Placeholder studio hours") are
deliberately left out, because counting them makes the studio look overbooked. A placeholder
that names a request, like "[Placeholder] AIM - XCF-17305 ...", is counted, as it is in Asana.

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
