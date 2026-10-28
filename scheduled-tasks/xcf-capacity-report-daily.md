---
name: xcf-capacity-report-daily
description: Daily 8am NZT: rebuild from Asana + Slack and write the XCF Lighthouse Google Sheet. The dashboard reads the sheet live, so there is no deploy.
---

Refresh the Google Sheet that the XCF Lighthouse dashboard reads, from Asana and Slack. The dashboard reads the sheet
live, so this task does NOT deploy anything and needs no Okta approval.

Project folder (the shared Drive copy):

`/Users/christie.sinai/Library/CloudStorage/GoogleDrive-christie.sinai@xero.com/Shared drives/XCF @ Xero/Platforms Licences/Claude/xcf-capacity-bot`

The path contains spaces and an `@`, so it must be quoted. Start every shell command with `cd "<that path>" &&`.
Do NOT use the older copy under `~/Documents/xcf-capacity-bot`.

The sheet is "XCF Lighthouse - Dashboard Data", spreadsheet id `1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U`.

**This task is asked to write to that sheet**, and only in two ways: sending the request files that
`node src/sheetSync.js` produces to the Google Sheets `update_spreadsheet` tool exactly as they are written, and
reading with `get_values`. Make no other change to the sheet. The full procedure and the reasons are in
`SHEET_SYNC.md` in the project folder; read it if anything below is unclear.

## 1. Read what the sheet holds

Call `get_values` for `Checks!A1:E17`. Write the whole reply, unchanged, to `sheet-sync/observed.json` in the project
folder (create the folder if needed; use a small Node script or the Write tool).

## 2. Build

```
cd "<project folder>" && node src/index.js --once
```

About 3-5 minutes. It writes the report and `reports/xcf-data-YYYY-MM-DD.json`. Credentials come from
`~/.xcf-lighthouse.env`; if the output says `No ASANA_TOKEN found`, stop and report it. If the script fails, stop and
report the error. Do not write anything to the sheet after a failed build.

Sanity-check the data file: `members` should be about 28 to 30 and `requestsData` in the hundreds. The file also lists
`failures`, the datasets Asana could not provide this run. A non-empty `failures` is not a reason to stop: the sync
leaves those tabs as they are. Name them in your report.

## 3. Plan

```
cd "<project folder>" && node src/sheetSync.js plan --checks sheet-sync/observed.json
```

It prints one line per tab, then the request files to apply in order. Read the output. A line starting `SKIPPED`
means the sync deliberately left a tab alone (a dataset failed, or the tab would lose more than half its rows). Do not
override it with `--force-shrink`; report it.

## 4. Apply

For each listed file, in order: read it, and call `update_spreadsheet` with the file's `spreadsheetId` and its
`requests` array copied exactly. Do not edit, reorder or merge them. If a call fails, stop: do not carry on to the next
file and do not retry by hand. Go to step 5 anyway, because it will say what state the sheet is in.

## 5. Verify

Call `get_values` for `Checks!A1:E17` again. Write the whole reply to `sheet-sync/observed-after.json`. Run:

```
cd "<project folder>" && node src/sheetSync.js verify sheet-sync/observed-after.json
```

- All tabs match: it saves its state and writes `sheet-sync/sync-log.json`. Call `update_spreadsheet` with that file's
  `spreadsheetId` and `requests` to update the Sync_Log tab.
- Some tab does not match: it marks that tab to be rewritten. Repeat steps 3 to 5 once. If it still does not match,
  stop and report which tab and what the sheet holds. Do not try to repair it by hand.

## 6. Report

Keep it short: when the build ran, the headline counts (members, tasks, requests), how many rows changed per tab,
any `SKIPPED` tab and why, anyone shown under an Unknown POD (new joiners who need a row in the sheet's `People` tab),
and whether the sheet now says `ok` in Sync_Log.

## Rules

- Never modify source files. Do not commit or push.
- Do not deploy. A deploy is only needed when `template.html` or the code changes, and the owner does that.
- Do not use the Slack or Asana MCP tools for the data; the script does it.
