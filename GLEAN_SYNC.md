# Optional: a Glean agent that fills the task tabs from Asana

The daily build already writes the Google Sheet (see `SHEET_SYNC.md`). A Glean agent is a second way to fill
four of its tabs, straight from Asana, in the cloud, so they stay current even when the Mac that runs the build
is closed. It is optional, and it should earn its place before it takes over.

The four tabs: `Tasks`, `Missing_Tasks`, `Overdue_Tasks`, `OOO`. They are the ones that change every day and are
plain Asana facts. Everything else in the sheet (requests, regional, PM, roadmap) needs Asana's activity history
or Slack, which the build already does, and stays with the build.

## How to bring it in without breaking anything

1. **Shadow run.** The agent writes to four spare tabs, `Glean_Tasks`, `Glean_Missing_Tasks`,
   `Glean_Overdue_Tasks` and `Glean_OOO`, which have the same columns. The dashboard does not read them. Run it
   for a few days and have Claude compare each shadow tab with the real one (it reads both and diffs them).
   Differences point at a rule the agent read differently.
2. **Take over.** When the shadow tabs match, change the agent's prompt to write the real tab names (find and
   replace `Glean_` in the prompt), and plan the build's sync without those tabs so the two do not fight:
   `node src/sheetSync.js plan --checks sheet-sync/observed.json --skip Tasks,Missing_Tasks,Overdue_Tasks,OOO`.
   Put the same `--skip` in the scheduled refresh.
3. **Hand back.** Remove `--skip` and the build writes those tabs again. It notices the sheet differs from what it
   last wrote and rewrites them once.

Two things must be true before step 1 is worth doing:

- The Glean Google Sheets action has to be able to **clear and rewrite** a tab. Xero's Glean actions page only
  lists "add rows". If the agent can only add rows, do not use it: rows would pile up and the dashboard would
  count every day twice. The prompt tells the agent to stop and say so rather than add rows.
- The agent runs as **you**. If your Asana login in Glean expires, the schedule stops (a thread in
  #hello-glean reports this for GitHub; Asana may behave the same).

## Set up

1. Open Glean from the Okta tile, go to **Agents** and create a new agent. Choose the natural-language builder
   and paste the prompt below.
2. Open **View agent setup** and check the agent has the Asana actions (Xero's Glean actions page says Asana is
   added under **Actions > Add > MCP Server** in the Plan & Execute steps) and Google Sheets actions that can read
   a tab and write to it.
3. Click **Try agent** once. Open the four `Glean_` tabs and look.
4. On the agent card, find **When does it run?** and click **Edit**. Set the start date, **7:00 am**, the timezone
   **Auckland**, and **Repeats: Daily**. Click **Save**.
5. Tick the permissions box and click **Activate agent**. Pause it any time from **Edit** next to the schedule.

If a run is too long for Glean, split the people into two agents (for example Campaign and Campaign Ops in one,
the other pods in the second) that each write their own half. Ask Claude to adjust the prompt.

## The prompt

```
You fill four tabs of the Google Sheet "XCF Lighthouse - Dashboard Data"
(https://docs.google.com/spreadsheets/d/1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U/edit) from Asana, once a
day. The XCF capacity dashboard reads these tabs, so the rules and column layout below matter more than speed.
Write only to the four tabs named Glean_Tasks, Glean_Missing_Tasks, Glean_Overdue_Tasks and Glean_OOO. Never
change any other tab, and never change row 1 (the headers).

If any step fails, write nothing and report the failure. A stale tab is better than a half-filled one. Never
invent data.

SET UP
- today = today's date in the Pacific/Auckland timezone, as YYYY-MM-DD.
- Read the People tab. Each row has: name, pod, on_capacity_tab (Y or N), is_pm, hidden_from_missing_tab (Y or N),
  hidden_from_ooo_tab (Y or N). capacity_members = rows with on_capacity_tab = Y.
- Read the OOO_Manual tab (name, start_date, end_date).
- Asana workspace gid 41261904390129. Asana team gid 1211868948534506. team_users = every user in that team.
- The Estimated time custom field (gid 1203387567618671) is stored in MINUTES. hours = minutes / 60. Do not round.
- A team user who is not in People at all is treated as a capacity member with pod "Unknown", and you list their
  name in your report so someone can add them to People.

STEP 1 - TASKS, MISSING, OVERDUE
For each capacity member, fetch all INCOMPLETE tasks assigned to them in the workspace, with: gid, name, due_on,
start_on, parent, created_by, every project the task belongs to, and its custom fields. Handle each task once
(de-duplicate by gid) and apply these rules in order:
1. Skip it if its name contains "placeholder" (any case) UNLESS the name also contains a request or project code
   such as XCF-12345, XCFP-123 or XCFT-123.
2. Project names = every project the task belongs to. A name qualifies if it starts with X, 8 or 9 (any case) and
   does not start with any of: "XCF: Leave calendar (NOW USE THE NEW WAY)!",
   "XCF: AI Usage (Roadmap Projects & Micro/BAU tasks",
   "XCF: Cost per asset + Asset counter (Roadmap Projects & Micro/BAU tasks)".
   If the task belongs to at least one project but none qualify, skip it. project = the first qualifying name, or
   blank when the task belongs to no project (a subtask).
3. est_hours = the Estimated time value / 60, or blank if empty or 0. If est_hours is blank and the task has a
   parent, read the parent (name, due_on, Estimated time). If the parent HAS an estimate, skip this subtask. In
   that case, if the parent has no due_on, the member is not hidden_from_missing_tab, the parent's name (trimmed)
   is not "Production" or "In Market", and this parent has not already been reported in this run, add the parent
   to Glean_Missing_Tasks with missing_reason "No due date" and created_by "—" (task_gid = the parent's gid,
   project = the project from rule 2).
4. The task is "missing" if est_hours is blank OR due_on is blank. For a missing task: skip it if its name
   (trimmed) is "Production" or "In Market"; skip it if the member is hidden_from_missing_tab; skip it if
   created_by is set and is not in team_users; skip it if its Status custom field (a custom field whose name
   contains "status") is "On Hold" or "Backlog". Otherwise add it to Glean_Missing_Tasks with missing_reason
   "No estimate" (when est_hours is blank) or "No due date". Missing tasks never go in Glean_Tasks.
5. If due_on is before today, the task is overdue. If it is more than 30 days overdue, skip it completely.
   Otherwise add it to Glean_Overdue_Tasks AND to Glean_Tasks with overdue = TRUE.
6. Anything left goes in Glean_Tasks with overdue = FALSE.

Exact columns. Leave a cell blank rather than writing "null". Dates are plain text YYYY-MM-DD. Ids are text.
est_hours is a number. overdue is TRUE or FALSE.
Glean_Tasks:         assignee | pod | task | project | start_date | due_date | est_hours | overdue
Glean_Missing_Tasks: task | task_gid | project | assignee | created_by | pod | missing_reason
Glean_Overdue_Tasks: task | task_gid | project | assignee | pod | due_date
assignee is the member's name. pod comes from People.

STEP 2 - GLEAN_OOO
Build one list of leave:
a. For every user in team_users who has Asana vacation dates (a start and an end), except anyone whose full name is
   exactly a name in OOO_Manual: name, start, end, source "asana".
b. Every incomplete task with a due date in the Asana leave project (gid 1212867822525791), except for anyone whose
   full name is exactly a name in OOO_Manual: name = the assignee, start = start_on or due_on, end = due_on,
   source "project".
Do NOT write rows for OOO_Manual: leave typed there is added by the dashboard itself.
Drop any row where start is after end. Drop anyone with hidden_from_ooo_tab = Y. Remove duplicates on
name + start + end. pod comes from People ("Unknown" if the person is not listed).
c. For every user in team_users who is not hidden_from_ooo_tab, has no row from a or b, and has no entry in
   OOO_Manual (by their full name, or a manual name that is the start of it), add one row with no dates, a blank
   source and no_leave_booked = TRUE.
If the Asana tool cannot return vacation dates, skip (a), say so in your report, and carry on.
Columns: name | pod | start_date | end_date | source | no_leave_booked

STEP 3 - WRITE
For each of the four Glean_ tabs: clear rows 2 and below, then write this run's rows from row 2, in the order you
found them. If you cannot clear or overwrite rows (you can only add rows), STOP. Write nothing and say so: do not
add rows below existing ones.
After writing, read the first row and the last row of each tab back and check they are what you meant to write
(dates and ids must still be text, not dates or numbers). If they are not, say so.

STEP 4 - REPORT
Reply with: the date used, the number of members processed, the number of rows written to each tab, anyone you
treated as "not in People", and anything skipped or failed (members whose tasks could not be read, rate limits,
missing vacation dates).
```

## What the agent cannot see

The prompt copies the rules in `src/asana.js`. An agent is not the script, so the shadow run exists to find where
they differ. Typical differences are the project qualification rule, subtasks that roll up to a parent, and
people who are in Asana's team but not in `People`. When a rule changes in `src/asana.js`, change it here too.
