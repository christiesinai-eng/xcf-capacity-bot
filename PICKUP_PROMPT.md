# Pick-up prompt for new maintainers

Open this folder in Claude Code (or Cowork), then paste everything inside the box as your
first message. Fill in the last line with what you want to change.

```
You're helping me maintain the XCF Lighthouse dashboard: the daily capacity and delivery
dashboard for The Creative Foundry at Xero. It is live at
https://xcf-capacity-report.dashboard.xero.dev (Xero VPN needed). This folder is the project.

Before doing anything:
1. Read CLAUDE.md, then AGENTS.md, then RUNBOOK.md, then SHEET_SYNC.md (the Google Sheet the page reads). The xcf-control-tower skill covers
   every tab, the Asana field ids and the mistakes already made. Use it.
2. Check my credentials exist at ~/.xcf-lighthouse.env. Never create credentials inside
   this folder, because the whole team can read it. If the file is missing, walk me
   through copying .env.example there and filling in my own Asana token. The Slack token
   is shared, so tell me to ask Christie for it privately.
3. Run `node src/index.js --once` to confirm a build works, and tell me the headline counts.

How to work here:
- This is a shared folder. Ask me whether anyone else is mid-change before you edit code.
  Quote paths in shell commands: they contain spaces and an @.
- Make the change, rebuild, then verify by inspecting the generated report in reports/
  (read the data out of the HTML). Don't assume it worked.
- People changes: a joiner goes in config/pod-map.json; a leaver goes in EXCLUDED_MEMBERS
  and OOO_EXCLUDED in src/asana.js; leave dates go in MANUAL_OOO. Names must match the
  Asana display name exactly.
- Never delete request-timing-cache.json or slack-pm-updates-cache.json. They hold
  hand-written summaries that cannot be regenerated.
- Never put a token in this folder, in git, or in anything you print.
- Show me what changed and the resulting numbers before deploying. Deploying needs me to be
  a maintainer of the app and to approve an Okta prompt, so ask first.
- After each change, commit and push to GitHub, so there is always a version to roll back to.
- If something looks wrong, test the assumption against the data before changing code. The
  "Lessons worth not relearning" section of the skill lists mistakes already made.

What I want to do today: <describe the change>
```

## Things people commonly ask for

- Add a new team member, or remove someone who has left
- Add or correct someone's leave on the OOO tab
- Write summaries for newly measured requests on Request Cycle Time
- Change which Asana portfolio, project or field a tab reads from
- Add a new tab

## Before your first deploy

Ask Christie to add you as a maintainer of the `xcf-capacity-report` app. Deploys are refused
for anyone who isn't one.
