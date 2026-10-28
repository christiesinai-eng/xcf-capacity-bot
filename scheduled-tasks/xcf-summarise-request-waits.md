---
name: xcf-summarise-request-waits
description: Monday 8am NZT: write summaries and delay causes for any newly-measured requests, then add them to the sheet's Notes tab
---

Write summaries for any requests on the XCF Lighthouse "Request Cycle Time" tab that have a measured wait and comments, but no written explanation yet, and put them in the Google Sheet the dashboard reads.

Project folder (the shared Drive copy):

`/Users/christie.sinai/Library/CloudStorage/GoogleDrive-christie.sinai@xero.com/Shared drives/XCF @ Xero/Platforms Licences/Claude/xcf-capacity-bot`

The path contains spaces and an `@`, so it must be quoted. Start every shell command with `cd "<that path>" &&`. Do NOT use the older copy under `~/Documents/xcf-capacity-bot`.

Credentials are read automatically from `~/.xcf-lighthouse.env` (never from the shared folder). If a build prints `No ASANA_TOKEN found`, stop and report it.

The sheet is "XCF Lighthouse - Dashboard Data", spreadsheet id `1O_NgLKn_0TaYDc6YvkMvfdvejg-p3T-IKClazq6Hk9U`. **This task is asked to add rows to its Notes tab**, by sending the request file `node src/sheetSync.js notes` produces to `update_spreadsheet` exactly as written, and to read with `get_values`. Make no other change to the sheet.

## Background

The tab measures how long each request waited between being submitted in Asana (XCF | Requests) and work starting on it. Each measured request can carry a hand-written one-or-two-sentence explanation of *why* it waited that long, plus a category. These live in `request-timing-cache.json` under `requests[<gid>].summary`, `.cause` and `.causedAt`, and the build preserves them across rebuilds. The sheet's Notes tab holds the same text for the dashboard; rows already there are never overwritten, so a correction made in the sheet stays.

## 1. Build first, so you are working from current data

```
cd "<project folder>" && node src/index.js --once
```

Takes about 3-5 minutes. Note the output path, `reports/xcf-report-YYYY-MM-DD.html`; the same build wrote `reports/xcf-data-YYYY-MM-DD.json`.

## 2. Find what needs a summary

```
cd "<project folder>" && node -e "
const data=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const need=(data.requestsData||[]).filter(r=>r.durationHours!==null&&r.commentCount>0&&!r.summary).sort((a,b)=>b.durationHours-a.durationHours);
console.log('needing a summary: '+need.length);
need.forEach(r=>{
  console.log('');
  console.log('### '+(r.code||'?')+'  '+(r.durationHours/24).toFixed(1)+'d  via '+r.startedBy+'  POD='+(r.pod||'?'));
  console.log('    '+(r.name||'').slice(0,70));
  (r.comments||[]).slice(0,8).forEach(c=>console.log('     ['+c.author.split(' ')[0]+' '+c.at.slice(5,10)+'] '+(c.text||'').replace(/\s+/g,' ').slice(0,160)));
  if(r.commentCount>8)console.log('     ... +'+(r.commentCount-8)+' more');
});
" <full path to today's reports/xcf-data-YYYY-MM-DD.json>
```

**If it reports 0, still do step 5** (a week summary or an earlier request may be waiting to be copied into the sheet), then finish.

## 3. Write the summaries

Read each request's comments and write one or two sentences explaining why it waited as long as it did. Lead with the cause in bold, then the specifics. Examples of the existing style:

- `**Waiting on access, not capacity.** Assigned on day one, but the source sheet was never shared.`
- `**Not an XCF delay.** Deliberately put On Hold because Product & Engineering pushed the underlying release.`
- `**Incomplete brief.** Four rounds of questions over three weeks to establish which team owned it.`

**Be honest.** Some requests only have automated duplicate-detection comments and no human discussion — say exactly that rather than inventing a narrative. Some long waits are the requester not replying, which is worth naming plainly. Some fast ones genuinely had no blocker.

Also assign each one a `cause` from this fixed list — do not invent new ones:

`Access & permissions`, `Brief & scoping`, `Capacity queue`, `Approval cycle`, `Requester-side`, `Creative iteration`, `Misrouted`, `Dropped`, `No blocker`, `Unexplained`

Guidance: *Capacity queue* means explicitly held behind other work. *Creative iteration* means active design rounds, not idle waiting — keep it separate from the delay causes. *Dropped* means XCF lost track of it, distinct from being queued. *Unexplained* means the thread genuinely does not account for the wait.

## 4. Write them to the cache

Write a small Node script to a temp file and run it — do not try to inline a long script with `node -e`, the quoting breaks. It should load `request-timing-cache.json` from the project folder, map each XCF code to its gid via `cache.requests[gid].code`, then set `.summary`, `.cause` and `.causedAt` (today's date as `YYYY-MM-DD`) on each. Save with `JSON.stringify(cache, null, 2)`.

Verify afterwards that the count of entries with a summary went up by the number you wrote, and that no existing summaries were lost.

## 5. Put them in the sheet

1. Call `get_values` for `Notes!B2:B` and write the whole reply, unchanged, to `sheet-sync/notes-keys.json` in the project folder.
2. Run `cd "<project folder>" && node src/sheetSync.js notes sheet-sync/notes-keys.json`.
3. If it writes `sheet-sync/notes-append.json`, call `update_spreadsheet` with that file's `spreadsheetId` and `requests`, exactly as written. If it says Notes already has everything, there is nothing to send.

Then call `get_values` for `Notes!A1:D3` and check the new rows are there (kind, key, label, summary).

The dashboard reads the Notes tab live, so there is no deploy and no Okta approval.

## 6. Report

Keep it short: how many you summarised, the spread of causes you assigned, how many rows were added to the sheet, and anything notable — a recurring blocker, a request that has been waiting a very long time, or a pattern worth Christie's attention. If a particular cause is dominating, say so.

## Rules

- Never modify source files. Only `request-timing-cache.json` and the files under `sheet-sync/` change.
- Do not commit or push. Christie reviews and pushes the cache herself.
- Never overwrite an existing summary — only fill in missing ones.
- Do not deploy.
