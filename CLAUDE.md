# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first — it covers what this app is, how it's built, the
configuration constants, and the gotchas. This file adds the Claude-specific workflow.

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
| Capacity arithmetic | `src/asana.js` — `hoursOnDate`, `sumHoursOverRange`, `workingDaysBetween` |
| Which Asana portfolio or field feeds a tab | `src/asana.js` — the `*_GID` constants |
| How data reaches the HTML | `src/report.js` — `replaceArray`, `replaceString` |
| Markdown rendering for exec summaries | `src/report.js` — `mdToHtml` |
| Slack fetching and week grouping | `src/slackUpdates.js` |
| Everything visual | `template.html` |
