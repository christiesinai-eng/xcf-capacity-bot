# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first — it covers what this app is, how it's built, the
configuration constants, and the gotchas. This file adds the Claude-specific workflow.

The dashboard's data also lives in a Google Sheet that the build keeps current; the page reads it live and
falls back to the data built into it. How that works, the daily refresh procedure and the one-off switch-over
are in [SHEET_SYNC.md](SHEET_SYNC.md). Read it before touching `template.html`'s data handling, the sheet, or
the scheduled refresh.

## The skill

This repo ships a skill at `.claude/skills/xcf-control-tower/SKILL.md` covering the
dashboard end to end. It loads automatically when the work touches the report. Prefer
it over re-deriving how a tab works.

## Refresh and redeploy

"Refresh and redeploy" is the most common request in this repo. It means both steps:

```bash
node src/index.js --once
```

Then deploy the file it just wrote using the `mcp__Xero_Deploy__deploy_app` tool:

- `team`: `creative-foundry`
- `app_name`: `xcf-capacity-report`
- `index_html_path`: `reports/xcf-report-YYYY-MM-DD.html` (today's NZT date)
- `auth_mode`: `okta`

The user has to approve an Okta prompt at the URL the tool returns — surface that URL
immediately rather than waiting. After approval the scan takes roughly five to seven
minutes; poll `get_status` rather than assuming it worked.

Deploys fail intermittently with a bare `deploy_failed`. Retrying once is the right
first move — it usually succeeds. Don't start debugging the HTML until a second
attempt also fails.

## Working conventions

**Rebuild before you deploy, always.** The report file is dated. Deploying yesterday's
file silently ships stale data and nothing will warn you.

**Verify data changes by inspecting the generated file, not by reasoning about the
code.** After a build, grep the output for the thing you changed. Capacity bugs in
this codebase are usually arithmetic, and arithmetic is easier to confirm than to
argue about.

**`template.html` is one enormous self-rendering file.** Edits to it are string edits
inside inline `<script>` blocks. Two things to respect:

- The placeholder `const NAME=[...];` declarations (lines ~719–752) must keep their
  exact shape or `replaceArray()` throws at build time.
- Several constants appear more than once. `rtTODAY` appeared twice, and fixing only
  one occurrence produced a bug that looked fixed locally. Grep for every occurrence
  before editing, and use `replace_all` when the change should be uniform.

## Working in the shared folder

This project's working copy lives in the shared Drive folder
`Shared drives/XCF @ Xero/Platforms Licences/Claude/xcf-capacity-bot`
(the absolute prefix differs per person — `/Users/<you>/Library/CloudStorage/GoogleDrive-<your email>/`).
The path contains spaces and an `@`, so quote it in every shell command.

- **Credentials stay out of the folder.** They live in `~/.xcf-lighthouse.env`. If a build
  says `No ASANA_TOKEN found`, help the user create that file from `.env.example`.
- **Who is in which POD is `config/pod-map.json`**, a shared file. A new joiner needs an
  entry or they show as "Unknown".
- **Warn before editing code.** Other people use this folder; two machines saving the same
  file creates conflict copies. Ask the user whether anyone else is mid-change.
- **Commit and push after each change.** Do git operations from one machine at a time.
- **Never upload files into the folder via the Drive API or website** — it converts `.html`
  and `.md` to Google Docs stubs. Writing through the local folder is fine.
- **Deploying needs maintainer rights** on the app and an Okta approval from the user.

**Don't commit generated output or secrets.** `reports/`, `.env`, `node_modules/`, and
`logs/` are gitignored and should stay that way. `slack-pm-updates-cache.json` is
*not* ignored and *should* be committed — it carries the hand-written executive
summaries.

**Ask before deploying.** Generating a report is local and reversible. Deploying
publishes to a URL the whole team reads. Treat a request to rebuild as a request to
rebuild, and confirm before pushing it live unless the user asked for both.

## Verifying a change locally

There's no dev server for the dashboard and it doesn't need one — the generated report
is a static file. Open it directly:

```bash
open reports/xcf-report-$(TZ=Pacific/Auckland date +%F).html
```

`.claude/launch.json` defines a `roadmap-timeline` server, but that's for the separate
standalone `roadmap-timeline.html` file, not for the main report.

## Where things live

| Task | File |
|---|---|
| Who appears on which tab | `src/asana.js` — the constants block, lines ~189–232 and ~481–505 |
| Capacity arithmetic | `src/capacityMath.js` — `hoursOnDate`, `sumHoursOverRange`, `windows` (shared with the page) |
| Google Sheet tabs and columns | `src/sheetSchema.js` (write side), `src/sheetAdapter.js` (page side) — see `SHEET_SYNC.md` |
| Which Asana portfolio or field feeds a tab | `src/asana.js` — the `*_GID` constants |
| How data reaches the HTML | `src/report.js` — `replaceArray`, `replaceString` |
| Markdown rendering for exec summaries | `src/report.js` — `mdToHtml` |
| Slack fetching and week grouping | `src/slackUpdates.js` |
| Everything visual | `template.html` |
