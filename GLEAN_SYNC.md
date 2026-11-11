# Optional: Glean agents that fill the sheet from Asana, without the Mac

The daily build already writes the Google Sheet (see `SHEET_SYNC.md`). Glean agents are a second way to fill its
tabs straight from Asana, in the cloud, so they stay current even when the Mac that runs the build is closed. They
are optional, and each one should earn its place (a week of matching the build) before it takes over.

There is one agent per tab group, each with its own prompt file. Paste a file's contents into its agent. Each agent
writes only `Glean_` copies of its tabs until it is switched over.

## Where each agent stands (12 Nov 2026)

Nothing is scheduled in Glean yet, and the dashboard still reads none of the `Glean_` tabs. Each agent has been run by hand and compared with a build from the same hour.
All six agents and the Slack routine matched on 12 Nov. The switch-over to the real tab names, and the Glean
schedules, are the owner's decision.

| Agent | Prompt | Writes (shadow tabs) | Status on 12 Nov |
|---|---|---|---|
| Tasks | `GLEAN_PROMPT.txt` | `Glean_Tasks`, `Glean_Missing_Tasks`, `Glean_Overdue_Tasks`, `Glean_OOO`, `Glean_Parent_Cache` | Exact against a same-hour build (238 / 18 / 113 / 35 rows). It has matched since 3 Nov. On 12 Nov its first run stopped on its own read-back because Asana holds a task with an empty name; the prompt was fixed and the rerun was exact. |
| Roadmap | `GLEAN_PROMPT_ROADMAP.txt` | `Glean_Roadmap`, `Glean_Roadmap_Subtasks` | Exact (66 / 189 rows). On 11 Nov one item received another item's bars, which is why the prompt now has a duplicate check (it has not yet been triggered by a real error). |
| PM | `GLEAN_PROMPT_PM.txt` | `Glean_PM_Projects`, `Glean_PM_Tasks`, `Glean_Scope_Creep` | Exact (165 / 35 / 1 rows). |
| Regional | `GLEAN_PROMPT_REGIONAL.txt` | `Glean_Regional_Raw` (agent), then `Glean_Regional`, `Glean_Regional_Panels`, `Glean_Regional_Unrecognised`, `Glean_Regional_Meta` (formulas) | The raw tab equals Asana (547 rows; 3 differ only in trailing spaces). The four formula tabs equal the build (171 / 12 / 16 / 13 rows). |
| Requests | `GLEAN_PROMPT_REQUESTS.txt` | `Glean_Requests` (the agent writes columns A to P; Q to U are formulas), `Glean_Request_Timing_Cache` (memory: projects whose start date is known) | 527 rows, 215 matched. Every column equals the build except `comment_count`, which differs by design: the sheet counts from the comments tab and agrees with it for all 215. It looks up at most 60 projects per run. |
| Comments | `GLEAN_PROMPT_COMMENTS.txt` | `Glean_Request_Comments_Raw` and `Glean_Request_Comments_Checked` (agent), then `Glean_Request_Comments` (formula: cleans the text and removes links) | Equals Asana: 214 matched requests read, none left, 1003 of 1004 raw comments identical. The one exception is a stale row for XCF-18418, a converted request whose project no longer exists; the agent only checks matched requests and never deletes rows, so it stays. It reads at most 25 requests per run and re-reads each every 7 days. |
| PM updates (Slack) | `ROUTINE_PM_UPDATES.txt` | `Glean_PM_Updates_Raw` (the routine copies), then `Glean_PM_Updates` (formula: week, time, links removed) | Not a Glean agent: a Claude cloud routine (`trig_01TK7XNtUcNLDzJcDgKGwV55`, daily 08:31 NZ, Slack and Google Sheets connectors only). The sheet equals Slack: 69 of 69 messages. It copies at most 12 new messages per run, oldest first. A 12 Nov test run read only column A and succeeded in 15 seconds. The "Files:" line removal is unproven until a message with an attachment is posted. |

`GLEAN_PROMPT_PM_UPDATES.txt` is the earlier Glean version of the Slack copy job. It was abandoned in favour of the
routine and is kept for reference only.

People, `OOO_Manual` and Notes stay hand-edited.

## How each agent got here

Older entries describe things as they were on the day; the table above is the current state.

**Roadmap.** 4 Nov real run (18:12 NZ) wrote both tabs and matched a build run 25 minutes earlier exactly (66 / 186
rows, every row identical). Its report lacked the per-page counts and the `RI` / `ST` / `ITEM` lines, so the agent may
not yet have held the hardened prompt (per-page `RI` lines, `ST` status lines, full report on failure). 11 Nov: one
item (XCFP-84) was written with another item's bars; the next run was exact. The prompt gained a duplicate check
(look for two items with the same dates on two or more bars before writing) and a report line for it. 12 Nov: 66 / 189,
duplicate check found 0 pairs.

**PM.** 4 Nov: first fully COMPLETE run, all three tabs written. Against a build 28 minutes later: PM tasks (39) and
scope creep (1) identical, projects 158 of 160 identical; the two differences were a project completed in Asana 20
minutes after the run, and a "-" written into one empty project_type cell (prompt now says a dash is an empty cell).
Earlier (3 Nov) runs counted 86, 147 and 22 projects and stopped on guards, so one good run is not yet "repeatable";
Phase 5 now reads everything in the one per-user `Get Tasks` call, with no `Get Task` needed. 5 Nov (run about 07:00 NZ,
build 07:23): second clean run on a different day, 159 projects / 37 tasks / 1 scope creep; tasks and scope creep
identical, projects 158 of 159 identical, the one difference a task in XCFP-18118 completed in Asana 75 seconds after
the run wrote. No stray "-" this time. Its report wording drifted from the prompt (no per-tab first/last/count), so
check the agent holds the current prompt text. 12 Nov: 165 / 35 / 1, all identical.

**Regional.** 5 Nov: first run read only page 1 and tried to write early (and used Shell), so the prompt gained per-page
`PAGE` lines, a "no Sheets action until READ = EXPECTED" rule and a stricter no-Shell line. The next run (about 08:05
NZ) was COMPLETE: 37 pages, 1,480 tasks read = expected, 535 rows written. `Glean_Regional_Raw` matched Asana exactly
(535 of 535, nothing missing or extra) and the four formula tabs match what the rules give from those rows (Regional
165 rows, Panels, Meta identical; Unrecognised has the same 12 rows, with the four "TBA" / "tba" rows in a different
order because the sheet sorts without regard to case). 12 Nov: 547 raw rows equal Asana, formula tabs equal the build.
The agent's "no project type" count (221) is the build's (219) plus 2 cancelled requests, which the build excludes first.

**Requests.** Written 5 Nov, then run for the first time. Glean's "Get Task Stories" accepts a project gid and returns
the project's history (tested: In Progress at 2026-09-06T11:14:06.473Z for project 1213702136901618), but Asana's
actions give only the LATEST status update, not the list, so the first On Track date cannot be read. The timing cache
was therefore pre-filled from the build's `request-timing-cache.json` for the 150 matched projects that already had a
start (42 of those start from On Track; for 30 of them In Progress is within 6 minutes of On Track, for 9 it is later,
7 by more than a day). Phase 0 stops with FAILED and lists the actions if the history cannot be read. First real run
(5 Nov, about 20:05 UTC): COMPLETE reading, PARTIAL result; 37 pages, 1,480 of 1,480 tasks, 515 REQ lines (matches the
build's rules exactly), 20 skipped, 202 projects, 60 looked up, 0 failures, nothing written to `Glean_Requests` yet. Its
7 lookups of already-seeded projects reproduced the build's In Progress / Stakeholder Review / Complete dates 7 of 7;
the only differences (2 of 7) are projects where On Track came days before In Progress, the known limit. It appended
duplicate cache rows because my seed write had turned gids ending in 0 into numbers (it could not match `1.21967E+15`);
fixed by formatting column A as text on the three new tabs, rewriting the seed gids and removing the duplicates, and the
prompt now says to save each project once. Second run (COMPLETE, 515 rows written): against a fresh build, 508 of 515
identical. Seven differences: 3 requests where Asana stores a region as "Global (All Markets) " with a trailing space
(the build trims, the agent copied; prompt now says to trim) and 4 rows whose start dates were wrong because the agent
attached other projects' cached dates to the last four cache rows (it also overwrote those four rows' dates in the
cache, which I restored from the seed). To remove that class of error the start date is now looked up by sheet
formulas: `Glean_Requests` columns Q to U (on_track_at, started_by, is_real_start, duration_hours, comment_count) are
formulas keyed on the project gid in column N, and the agent writes columns A to P only. With that and the restored
cache, 512 of 515 identical; the last 3 are the trailing-space regions, fixed in the prompt and awaiting the next run.
The agent's 55 lookups found no start for any uncached project, which agrees with the build (54 unstarted). Third run
(5 Nov, about 09:47 NZ, COMPLETE, 515 rows) with the updated prompt: `Glean_Requests` matched a build run 5 minutes
earlier on all 515 rows (comment_count excluded, no comments agent yet) and the cache was untouched (150 rows,
identical to the seed). At most 60 projects looked up per run, so the first runs report PARTIAL. The request rules,
applied literally to live Asana data, reproduce the build's 514 requests exactly (all non-timing columns). Still to
prove at that point: the agent re-deriving In Progress / Review / Complete dates itself for projects that are not in the
cache. The comments agent now exists, so `comment_count` is filled and checked (see Comments).

**Comments.** Built after the Requests agent, because the comments are read per request and need the request list.
It copies each matched request's comments exactly, one request at a time, and the sheet's formulas clean them. 11 Nov:
two matched requests (XCF-20017 and XCF-20042) had not been read yet. 12 Nov: it read both (no comments on either) and
reported 214 matched, none left. Against live Asana: 1003 of 1004 raw comments identical, the formula tab right on the
sheet's own text for 1004 of 1004 rows, and `comment_count` agreeing with the clean tab for every request.

**Tasks, 12 Nov.** The first run stopped at its own read-back and left `Glean_Overdue_Tasks` and `Glean_OOO` unwritten.
Cause: someone had created a task in Asana with no title (XCF-20095), so its task name cell was correctly empty, and the
agent counted non-empty cells in column A (the task name) on `Glean_Missing_Tasks` and `Glean_Overdue_Tasks`. The prompt
now counts the id column (column B, `task_gid`) on those two tabs and says a task with an empty name keeps its row. The
rerun wrote all five tabs and matched the build exactly.

**PM updates routine.** Created 9 Nov. 11 Nov: caught up to 69 of 69 messages. The Slack connector adds a "Files: ..."
line to messages with attachments, which is not part of the message, so the prompt now tells the routine to leave it out
(and the five existing lines were stripped). 12 Nov: the routine now reads only column A when working out what is
already copied; the full read came back at about 245,000 characters, over the tool's limit.

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

The build and the agent should be run within the same hour: both move during the day. Asana keeps changing while you
compare, so before blaming an agent for a difference, look at the task's `modified_at` and its history (stories): an
edit made after the build explains most differences.

Export the whole workbook once (the Drive connector's `download_file_content` with `exportMimeType`
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` saves a ready `.xlsx`), then:

```bash
node src/index.js --once                        # writes reports/xcf-data-DATE.json
# one Name=Glean_Name pair per tab: the build's tab name, then the sheet tab the agent wrote
python3 -I scripts/xlsx-tabs.py book.xlsx tabs.json Tasks=Glean_Tasks Missing_Tasks=Glean_Missing_Tasks \
  Overdue_Tasks=Glean_Overdue_Tasks OOO=Glean_OOO
node scripts/compare-glean.js --data reports/xcf-data-DATE.json --tabs tabs.json
```

It prints, per tab, the row counts, how many rows are identical, and the first differences, plus rows per person
for `Tasks`. The same pattern works for the other agents: `Roadmap=Glean_Roadmap`,
`Roadmap_Subtasks=Glean_Roadmap_Subtasks`, `PM_Projects=Glean_PM_Projects`, `PM_Tasks=Glean_PM_Tasks`,
`Scope_Creep=Glean_Scope_Creep`, `Requests=Glean_Requests`, and `Regional`, `Regional_Panels`,
`Regional_Unrecognised`, `Regional_Meta` (each from its `Glean_` tab). `Requests` differs in `comment_count` by
design; check that column with the comments check below.

Three checks go to the source system instead of the build (read only). Each needs the agent's tabs in the same `tabs.json`:

```bash
node scripts/regional-raw-check.js --tabs tabs.json      # Glean_Regional_Raw against Asana
node scripts/request-comments-check.js --tabs tabs.json  # the three comment tabs, and comment_count, against Asana
node scripts/pm-updates-check.js --tabs tabs.json        # the Slack copy against the Slack channel
```

Ask Claude to do the reading and the comparison.

## Lessons from the checking week

- **A passed read-back proves little.** An agent can copy the wrong data and still count its rows correctly, so every
  agent is compared with Asana (or Slack) itself, not only with its own read-back.
- **Count a column that cannot be blank.** A read-back that counts a name column fails on a task that has no name.
  Count the id column.
- **Agents copy, the sheet applies the rules.** Where an agent had to do arithmetic or counting (Regional, the request
  start dates, comment cleaning), it got it quietly wrong, so those rules are sheet formulas over a raw copy.
- **Look-alike items get mixed up.** Roadmap items and cached projects with blank fields were the places an agent
  attached one item's values to another. The prompts work one item at a time, write a note line straight away, and
  check for duplicates before writing.
- **Read only what you need.** Reading a whole text column blew the tool's size limit. Read the id column for "what is
  already there".
- **Connectors show text differently.** The Slack connector shows `&` where the Slack API gives `&amp;`, differs on
  channel mentions and italics, and appends a "Files:" line to messages with attachments. These are display
  differences, not copying errors.
- **Never run the routine twice at once,** and treat a run as finished only when its log shows a `result:` line (a run
  with new messages takes two to three minutes; one with nothing new takes about 15 seconds).

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
