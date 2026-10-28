# Scheduled task prompts for the Google Sheet layer

These are the prompts the Claude scheduled tasks run **after** the dashboard has been switched over to read the
sheet (see "Switching the dashboard to the sheet" in `SHEET_SYNC.md`). Until then the existing tasks, which
build and deploy, stay as they are: if the daily task stopped deploying before the page reads the sheet, the
live dashboard would go stale.

| File | Replaces the prompt of | Runs |
|---|---|---|
| `xcf-capacity-report-daily.md` | `xcf-capacity-report-daily` | every day, 8am NZT: build, then write the sheet. No deploy. |
| `xcf-summarise-request-waits.md` | `xcf-summarise-request-waits` | Mondays, 8am NZT: write new summaries, then put them in the sheet's Notes tab. No deploy. |

To apply one, give `update_scheduled_task` the file's text (without the front matter) as `prompt`. Keep the
task ids, so the schedule and the tool approvals stay.

**Approve the sheet tools once.** A scheduled run can only use tools that have been approved for that task. After
changing the prompt, open the task in the desktop app and click **Run now** once, and approve the Google Sheets
tools (`get_values`, `update_spreadsheet`) when asked. Reads were not held up in a test; the writes are what to
approve.

A scheduled run only takes actions the task file asks for by name. These prompts say plainly that writing to the
sheet is wanted, and nothing else is.
