# Optional: Glean agents that fill the sheet from Asana, without the Mac

The daily build already writes the Google Sheet (see `SHEET_SYNC.md`). Glean agents are a second way to fill its
tabs straight from Asana, in the cloud, so they stay current even when the Mac that runs the build is closed. They
are optional, and each one should earn its place (a week of matching the build) before it takes over.

There is one agent per tab group, each with its own prompt file. Paste a file's contents into its agent. Each agent
writes only `Glean_` copies of its tabs until it is switched over.

| Agent | Prompt | Writes (shadow tabs) | Status on 3 Nov 2026 |
|---|---|---|---|
| Tasks | `GLEAN_PROMPT.txt` | `Glean_Tasks`, `Glean_Missing_Tasks`, `Glean_Overdue_Tasks`, `Glean_OOO`, `Glean_Parent_Cache` | matches the build exactly |
| Roadmap | `GLEAN_PROMPT_ROADMAP.txt` | `Glean_Roadmap`, `Glean_Roadmap_Subtasks` | 4 Nov real run (18:12 NZ) wrote both tabs and matched a build run 25 minutes earlier exactly (66 / 186 rows, every row identical). Its report still lacks the per-page counts and the `RI` / `ST` / `ITEM` lines, so the agent may not yet hold the hardened prompt (per-page `RI` lines, `ST` status lines, full report on failure); repeat runs on other days still to do |
| PM | `GLEAN_PROMPT_PM.txt` | `Glean_PM_Projects`, `Glean_PM_Tasks`, `Glean_Scope_Creep` | 4 Nov: first fully COMPLETE run, all three tabs written. Against a build 28 minutes later: PM tasks (39) and scope creep (1) identical, projects 158 of 160 identical; the two differences were a project completed in Asana 20 minutes after the run, and a "-" written into one empty project_type cell (prompt now says a dash is an empty cell). Earlier (3 Nov) runs counted 86, 147 and 22 projects and stopped on guards, so one good run is not yet "repeatable"; Phase 5 now reads everything in the one per-user `Get Tasks` call, with no `Get Task` needed. 5 Nov (run about 07:00 NZ, build 07:23): second clean run on a different day, 159 projects / 37 tasks / 1 scope creep; tasks and scope creep identical, projects 158 of 159 identical, the one difference a task in XCFP-18118 completed in Asana 75 seconds after the run wrote. No stray "-" this time. Its report wording drifted from the prompt (no per-tab first/last/count), so check the agent holds the current prompt text |
| Regional | `GLEAN_PROMPT_REGIONAL.txt` | `Glean_Regional_Raw` (agent), then `Glean_Regional`, `Glean_Regional_Panels`, `Glean_Regional_Unrecognised`, `Glean_Regional_Meta` (formulas) | 5 Nov: first run read only page 1 and tried to write early (and used Shell), so the prompt gained per-page `PAGE` lines, a "no Sheets action until READ = EXPECTED" rule and a stricter no-Shell line. The next run (about 08:05 NZ) was COMPLETE: 37 pages, 1,480 tasks read = expected, 535 rows written. `Glean_Regional_Raw` matched Asana exactly (535 of 535, nothing missing or extra) and the four formula tabs match what the rules give from those rows (Regional 165 rows, Panels, Meta identical; Unrecognised has the same 12 rows, with the four "TBA" / "tba" rows in a different order because the sheet sorts without regard to case). Repeat runs on other days still to do |

| Requests | `GLEAN_PROMPT_REQUESTS.txt` | `Glean_Requests` (columns A to S; T `duration_hours` and U `comment_count` are formulas), `Glean_Request_Timing_Cache` (memory: projects whose start date is known) | written 5 Nov, never run in Glean. Glean's "Get Task Stories" accepts a project gid and returns the project's history (tested: In Progress at 2026-09-06T11:14:06.473Z for project 1213702136901618), but Asana's actions give only the LATEST status update, not the list, so the first On Track date cannot be read. The timing cache was therefore pre-filled from the build's `request-timing-cache.json` for the 150 matched projects that already had a start (42 of those start from On Track; for 30 of them In Progress is within 6 minutes of On Track, for 9 it is later, 7 by more than a day). Phase 0 stops with FAILED and lists the actions if the history cannot be read. First real run (5 Nov, about 20:05 UTC): COMPLETE reading, PARTIAL result; 37 pages, 1,480 of 1,480 tasks, 515 REQ lines (matches the build's rules exactly), 20 skipped, 202 projects, 60 looked up, 0 failures, nothing written to `Glean_Requests` yet. Its 7 lookups of already-seeded projects reproduced the build's In Progress / Stakeholder Review / Complete dates 7 of 7; the only differences (2 of 7) are projects where On Track came days before In Progress, the known limit. It appended duplicate cache rows because my seed write had turned gids ending in 0 into numbers (it could not match `1.21967E+15`); fixed by formatting column A as text on the three new tabs, rewriting the seed gids and removing the duplicates, and the prompt now says to save each project once. Second run (COMPLETE, 515 rows written): against a fresh build, 508 of 515 identical. Seven differences: 3 requests where Asana stores a region as "Global (All Markets) " with a trailing space (the build trims, the agent copied; prompt now says to trim) and 4 rows whose start dates were wrong because the agent attached other projects' cached dates to the last four cache rows (it also overwrote those four rows' dates in the cache, which I restored from the seed). To remove that class of error the start date is now looked up by sheet formulas: `Glean_Requests` columns Q to U (on_track_at, started_by, is_real_start, duration_hours, comment_count) are formulas keyed on the project gid in column N, and the agent writes columns A to P only. With that and the restored cache, 512 of 515 identical; the last 3 are the trailing-space regions, fixed in the prompt and awaiting the next run. The agent's 55 lookups found no start for any uncached project, which agrees with the build (54 unstarted). Third run (5 Nov, about 09:47 NZ, COMPLETE, 515 rows) with the updated prompt: `Glean_Requests` matched a build run 5 minutes earlier on all 515 rows (comment_count excluded, no comments agent yet) and the cache was untouched (150 rows, identical to the seed). Still to prove: the agent re-deriving In Progress / Review / Complete dates itself for projects that are not in the cache, and repeat runs on other days. At most 60 projects looked up per run, so the first runs report PARTIAL. The request rules, applied literally to live Asana data, reproduce the build's 514 requests exactly (all non-timing columns). Comment count will read 0 until the comments agent exists |

Still to do: Request_Comments (`Glean_Request_Comments` exists, empty), PM_Updates (Slack). People, OOO_Manual and Notes stay hand-edited.

The rest of this page describes the Tasks agent, the first one built; its lessons apply to all of them.

## Regional: the agent copies, the sheet counts

The Regional tabs are counts over about 520 requests (regions, business groups and cost centres by quarter). Asking
an agent to count that many rows is the kind of work it gets wrong quietly, so it does not count. The agent writes
one row per request to `Glean_Regional_Raw` (a copy job it can be checked on), and the other four tabs are formulas
over that tab, via `Glean_Regional_Calc`. The quarters counted are two cells there (`I1`, `I2`); change them when the
quarter rolls over. The formulas come from `scripts/regional-formulas.js`, which reads the same rules as
`src/regionalRequests.js`. The raw tab and the calc tab cover 2,000 rows, which lasts until about mid 2027.

Checks, none of which need the agent:

```bash
node scripts/regional-from-raw.js --check          # raw rows -> the four tabs, against the build's own numbers
node scripts/regional-raw-check.js --tabs sheet-sync/glean-regional-raw.json   # what the agent wrote, against Asana
```

## Where the first attempts got to (2 Nov 2026)

The run log (Glean chat "Autonomous Agent Compiler") shows the agent was not wrong about the data. Its later runs
fetched 525 incomplete tasks and computed 229 task rows, 10 missing, 73 overdue and 32 OOO rows; the build, run the
same day, gives 231, 10, 73 and 34. What failed was the run itself:

- It fetched hundreds of parent tasks one at a time (279 to 357 lookups), kept everything in its own head, and ran
  out of room before the write step. No run ever cleared or wrote a tab.
- It tried to do the arithmetic in the code sandbox, which hit a per-command limit and returned "Sandbox unreachable
  ... /uploadfiles" timeouts. That is a platform problem Glean support has to look at.
- It saved its progress in a sandbox folder that does not survive between runs, so every run started again.
- It reported "Asana did not return vacation dates" (the build gets 10 leave rows from them). The dates are only
  returned when asked for by name (`opt_fields=vacation_dates`).
- The builder chat then changed the agent to "run every 60 seconds, fetch only changed tasks, merge them into the
  previous state". That cannot work: with no durable state, changed tasks alone cannot rebuild the full list.

## What the prompt does differently

1. **Every run is a full refresh.** No "changed since" logic, no saved state, no merge.
2. **Cheap fetch.** One `Get Tasks` call per page per person with `completed_since = now`, which returns incomplete
   tasks only (the build does the same). `Search Tasks` is not used: it stops at 100 results and cannot page.
3. **The sheet is the memory.** The parent lookups are saved in a new tab, `Glean_Parent_Cache` (parent id, name, due
   date, estimate, date fetched). Each run uses the cache, looks up only parents it has not seen, and refreshes the
   oldest ones with what is left of a budget of 150 lookups. A run that has more than 150 new parents saves its
   progress, reports `PARTIAL` and stops without touching the output tabs, so the first few runs fill the cache and
   after that a run is mostly reads.
4. **Write early, one tab at a time.** Write all rows in one call (RAW, so dates and ids stay text), then clear the
   rows below, then read back and count. Never clear first. The cache is saved before the rest of the rules run.
5. **No code sandbox, no file uploads.**
6. **Guards.** It will not write if `Glean_Tasks` would have under 100 rows or fewer than 15 people have tasks, or if
   a tab would lose more than half its rows. It will not write `Glean_OOO` at all unless it got the vacation dates.
7. **A fixed report**, including incomplete tasks per person, so a wrong fetch is visible at a glance.
8. **Paging is checked, not assumed.** On 3 Nov the PM agent stopped after 3 of 5 portfolio pages (300 of 454 items) and
   counted 86 of the 160 projects. Its rules were right; its list was short, and only a size guard on another tab
   stopped the write. Portfolio prompts now say a page of exactly 100 items means another page exists, and the report
   lists the items per page.

## What it will not do: update every 60 seconds

The platform reads the sheet again about every 60 seconds; that is not a rate at which anything has to write it. A
full refresh is hundreds of Asana calls (the build takes about 3 minutes with a script doing the arithmetic) and the
agent also has to reason through every rule, so a run takes many minutes. Runs every minute would overlap, and the
Glean docs found so far only show daily and weekly schedules. Plan for **daily at 08:00 first**, then try hourly once a
run finishes comfortably. Ask Glean support for the shortest schedule and the longest run time before going below that.

## Set up

1. In Glean, open the agent and replace its instructions with `GLEAN_PROMPT.txt`. Do not ask the builder chat to
   "improve" it afterwards; it changed the schedule and design last time.
2. Check the schedule. It must be **08:00 Auckland, daily**, and the agent must not be activated until step 5.
3. Run it by hand (**Try agent**). Its report starts with a `STATUS:` line. `PARTIAL` is expected for the first runs while
   the parent cache fills; run it again until it says `COMPLETE`. `FAILED` names the phase.
4. Compare with the build (next section). Differences point at a rule the agent read differently.
5. When it is `COMPLETE` and matches, activate the schedule.

If the sandbox error comes back, the cause is on the platform side. Send Glean support the trace ids from the run log.

## Comparing with the build

The build and the agent should be run within the same hour: both move during the day.

```bash
node src/index.js --once                        # writes reports/xcf-data-DATE.json
# read each Glean_ tab with get_values (A:H, A:G, A:F, A:F) and save the replies as
# sheet-sync/glean-tabs.json: { "Tasks": {...}, "Missing_Tasks": {...}, "Overdue_Tasks": {...}, "OOO": {...} }
node scripts/compare-glean.js --data reports/xcf-data-DATE.json --tabs sheet-sync/glean-tabs.json
```

It prints, per tab, the row counts, how many rows are identical, and the first differences, plus rows per person
for `Tasks`. Ask Claude to do the reading and the comparison.

## How to bring it in without breaking anything

1. **Shadow run.** The agent writes `Glean_Tasks`, `Glean_Missing_Tasks`, `Glean_Overdue_Tasks`, `Glean_OOO` (same
   columns as the real tabs) and `Glean_Parent_Cache`. The dashboard reads none of them. Run it for a few days and
   compare each day.
2. **Take over.** When the shadow tabs match, replace `Glean_` with nothing in the prompt's tab names (the cache tab
   keeps its name) and plan the build's sync without those tabs so the two do not fight:
   `node src/sheetSync.js plan --checks sheet-sync/observed.json --skip Tasks,Missing_Tasks,Overdue_Tasks,OOO`.
   Put the same `--skip` in the scheduled refresh. Leave `OOO` with the build if the agent cannot get vacation dates.
3. **Hand back.** Remove `--skip` and the build writes those tabs again. It notices the sheet differs from what it
   last wrote and rewrites them once.

The agent runs as **you**. If your Asana login in Glean expires, the schedule stops.

## What the agent cannot see

The prompt copies the rules in `src/asana.js`. An agent is not the script. Typical differences are the project
qualification rule, subtasks that roll up to a parent, and people who are in Asana's team but not in `People`.
When a rule changes in `src/asana.js`, change `GLEAN_PROMPT.txt` too.
