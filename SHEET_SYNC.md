# The Google Sheet data layer

The dashboard reads its numbers from one Google Sheet, **XCF Lighthouse - Dashboard Data**
(`1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U`, in the shared drive folder next to this project).
The daily build writes the sheet. People edit a few tabs by hand. The page reads the sheet live, so a data
change needs no deploy and no Okta approval. Only a change to the page itself (a new tab, chart or column)
needs a deploy.

```
Asana, Slack --> node src/index.js --> reports/xcf-data-DATE.json --> sheetSync plan --> sheet (via the Sheets connector)
                         |                                                                       |
                         +--> reports/xcf-report-DATE.html (built-in copy of the data)           v
                                                                      page: GET /api/sheet --> SheetAdapter --> the same datasets
```

If the sheet cannot be read, the page shows the data built into it and says so in the header ("Data: built
into this page (the sheet could not be read)"). Opening the page with `?data=embedded` forces that.

## What is where

| Tab | Written by | The page uses it for |
|---|---|---|
| `Tasks`, `Missing_Tasks`, `Overdue_Tasks`, `OOO` | the build sync | capacity, missing fields, OOO |
| `PM_Projects`, `PM_Tasks`, `Scope_Creep`, `PM_Updates` | the build sync | PM Team, Scope Creep, PM updates |
| `Roadmap`, `Roadmap_Subtasks` | the build sync | Project Forecaster |
| `Requests`, `Request_Comments` | the build sync | Request Cycle Time |
| `Regional`, `Regional_Panels`, `Regional_Unrecognised`, `Regional_Meta` | the build sync | Regional Requests (counts only; shares are worked out on the page) |
| `People` | people | pod, who is on the capacity tab, who is a PM, who is hidden from Missing and OOO |
| `OOO_Manual` | people | leave that cannot be set in Asana. A name that starts a full name matches it ("Aniqah"). |
| `Notes` | people and the Monday summary task | `kind = request`: summary, cause and date for a request. `kind = week`: a PM updates executive summary. Markdown. |
| `Sync_Log` | the build sync | status, when it last synced, the build's own timestamp, tabs it skipped |
| `Checks` | formulas | row count, text length, number sum and TRUE count of every synced tab. Proves a write landed. |
| `README` | people | what the sheet is |

The page reads exactly 20 tabs (the platform's limit): the list is `TABS` in `src/sheetAdapter.js`, and it
must be the `ranges` passed to `deploy_app`.

**Never write into a "build sync" tab by hand.** The next sync will notice and rewrite the tab. Edit the blue
tabs (`People`, `OOO_Manual`, `Notes`) instead.

## Capacity rules (agreed 29 Oct 2026)

- **Today**: hours falling on today (New Zealand date).
- **Week**: the next 5 working days, starting today (or Monday if today is a weekend).
- **Month**: today up to the day before the same date next month. The capacity it is compared with is the
  number of working days in that span (20 to 23), so it differs from month to month.
- A working day is Monday to Friday. Public holidays are not taken off.
- A task's estimate is spread evenly over the working days from its start to its due date. With no start
  date all of it falls on the due date.

All of this is `src/capacityMath.js`, used by the build and by the page, so they cannot disagree. It does
its sums on whole day numbers, so the answer does not depend on which machine or time zone runs it.
(Before 29 Oct the build used local dates, which shifted the week and month totals by a day on a machine
ahead of UTC. Week totals were about 30% low.)

## Daily refresh

This is what the scheduled Claude task does. It needs the Google Sheets connector enabled.

1. **Read the sheet's checks.** `get_values` on `Checks!A1:E18` of the spreadsheet above. Save the reply as
   `sheet-sync/observed.json` (the whole reply, or just its `values`).
2. **Build.** `node src/index.js --once`. This writes the report and `reports/xcf-data-DATE.json`. If Asana
   fails for a dataset the build records it in `failures`; the sync then leaves those tabs alone.
3. **Plan.** `node src/sheetSync.js plan --checks sheet-sync/observed.json`. It prints one line per tab and lists
   the request files to apply, in order. Add `--skip Tab,Tab` for tabs another writer owns (see `GLEAN_SYNC.md`). A tab whose checks do not match what the last sync wrote is treated as
   changed by someone and is rewritten. A tab that would lose more than half its rows is held back
   (`SKIPPED`); add `--force-shrink Tab` if that is real.
4. **Apply.** For each listed file in order, read it and send its `requests` to `update_spreadsheet` for the
   `spreadsheetId` in the file, copied exactly. Stop at the first error. Do not retry a half-applied tab by
   hand; go to step 6.
5. **Verify.** `get_values` on `Checks!A1:E18` again, save as `sheet-sync/observed-after.json`, then
   `node src/sheetSync.js verify sheet-sync/observed-after.json`. When every tab matches it saves the new
   state and writes `sheet-sync/sync-log.json`; send that file's request with `update_spreadsheet` too.
6. **If a tab does not match.** `verify` marks it dirty. Run steps 3 to 5 once more; a dirty tab is cleared and
   rewritten. If it still does not match, stop and report which tab and what the sheet holds.
7. **Report** the headline numbers and any `SKIPPED` tab to the user.

A normal day changes a few rows per tab, so the files are a few KB. Rewriting a tab from nothing costs far more
(Requests is about 200 KB), which is why the planner works out the smallest change.

`sheet-sync-state.json` (row hashes only) and `sheet-sync/` are working files and are git-ignored.

### Monday summaries

The Monday task still writes request summaries and causes into `request-timing-cache.json`, and executive
summaries into `slack-pm-updates-cache.json`. To put new ones in the sheet:

1. `get_values` on `Notes!B2:B` and save it as `sheet-sync/notes-keys.json`.
2. `node src/sheetSync.js notes sheet-sync/notes-keys.json`
3. If it writes `sheet-sync/notes-append.json`, send its `requests` to `update_spreadsheet`.

Only rows that are not in `Notes` yet are added, so a correction typed into the sheet is never overwritten.

## When something is wrong

| Symptom | Cause and fix |
|---|---|
| `verify` reports a MISMATCH | Someone edited a build-sync tab, or a write was cut short. The tab is marked dirty and rewritten on the next run. |
| `plan` says `SKIPPED: ... could not be built` | Asana failed for that dataset. The sheet keeps yesterday's rows and `Sync_Log` says `partial`. Run the build again. |
| `plan` says `SKIPPED: would drop from N to M rows` | Looks like a bad fetch. If the drop is real, plan again with `--force-shrink Tab`. |
| `No sheetId for tab` | A tab was added or renamed. Run `get_spreadsheet` with `fields: ["spreadsheetId","sheets.properties.sheetId","sheets.properties.title","sheets.properties.gridProperties.rowCount"]`, save it, and `node src/sheetSync.js meta <file>`. |
| `sheet-sync-state.json` is lost | Run `meta` as above, then `plan --checks`. Tabs with no saved state are cleared and rewritten (large, but correct). |
| The page header says the sheet could not be read | See the tooltip on that label. `/api/sheet` failed, or a tab the page needs was missing. The page is still showing built-in data. If the reason is `needs_reconnect`, run `connect_sheet` again. |
| The header is amber and says "sheet last synced N days ago" | The refresh has not run. The page is showing the last synced data. |

## Changing the sheet's structure

A new column or tab is a structural change: it needs a deploy.

1. `src/sheetSchema.js`: add the column or tab (header, type, and where its value comes from).
2. `src/sheetAdapter.js`: read it, and add the tab to `TABS` (keep it at 20 or fewer).
3. `template.html` if the page should show it.
4. Add the column to the sheet by hand (headers must match), run `plan`, and update `Checks` with
   `node src/sheetSync.js setup` (it writes `sheet-sync/setup/checks-formulas.json`; send it with `update_formulas`).
5. `node --test test/*.test.js`, `node scripts/check-sheet-parity.js`, `node scripts/check-page-parity.js`.
6. Deploy with the new `ranges`.

Things that went wrong while building this and are worth not repeating:

- `update_values` and `update_formulas` parse text like the Sheets UI: an ISO date becomes a date and a 16-digit
  Asana id loses digits. The sync sends typed `stringValue` cells through `update_spreadsheet` instead.
- A formula over `A2:A` stops counting a row inserted at row 2. The `Checks` formulas read whole columns.
- Store counts, not percentages. A derived column that changes whenever one row is added makes every row in the
  panel change (the Regional tab went from 26 KB to 2 KB per change when shares moved to the page).
- A fetch that fails quietly must not turn into an empty tab. `requestTiming.js` now throws, and the sync holds
  back a dataset that failed.

## Switching the dashboard to the sheet (one-off)

Done once, after the owner agrees. The page already contains the loader; this is only the deploy.

1. Merge the `sheet-data-layer` branch into the shared folder's copy. Run the tests and both parity checks.
2. `node src/index.js --once`, then the daily refresh above, so the sheet is current.
3. `deploy_app` (with the `dashboard-accelerator@2.14` skill, as for any deploy) with
   `sheets: { sheet_url: "https://docs.google.com/spreadsheets/d/1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U/edit", ranges: <TABS from src/sheetAdapter.js> }`.
   Declaring a sheet defaults the app to `auth: allowlist`, which changes who can open it. Check before you
   deploy, and pass `auth_mode` deliberately.
4. `connect_sheet` for the app, approve Google's read-only consent as someone who can open the sheet, then
   `sheet_status` until `connected: true`.
5. Open the page: the header should read "Data: live from the Google Sheet". Compare a few numbers with the
   previous version.
6. Change the daily scheduled task from "build and deploy" to the refresh above. Deploy only when the page
   itself changes.

## Checks you can run

```bash
node --test test/*.test.js                       # unit tests, including a model of how Sheets applies the requests
node scripts/check-sheet-parity.js --today YYYY-MM-DD [--humans tabs.json]
                                                 # sheet rows -> adapter gives the same datasets as the build
node scripts/check-page-parity.js --today YYYY-MM-DD [--humans tabs.json] [--tamper | --down]
                                                 # loads the page twice (built-in data, sheet data) and compares every tab
```
