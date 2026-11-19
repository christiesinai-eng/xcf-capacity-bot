# Brand layer for the Control Tower redesign

Look and layout only. Nothing here changes or recalculates data: every number on the overview page is read from the
report's own data blocks, with the same rules the detailed tabs use. Live since 17 Nov 2026: `src/report.js` inlines this layer
and `template.html` is the new design.

## How the new page works

One scrolling overview page, copied from the "XCF Lighthouse - dashboard mockup" (a claude.ai artifact): a left sidebar of
grouped links, then summary cards. Each card has a **See more** button that opens a window in the mockup's format (summary
figures, then tables and bars) built from the real data. At the foot of each window a link opens the report's original
detailed tab, whole and unchanged; those tabs are kept in the page (hidden) for that.

| File | Job |
|---|---|
| `template.html` (repo root) | The report's template, with the new page structure: sidebar, one-page overview, "See more" windows. The build reads this file. |
| `brand/workflow.js` | Draws every overview card from the report's data (capacity, pods, PMs, out of office, forecaster, tasks needing attention, scope creep, PM updates, request cycle time, platform spend). Also scroll highlighting and the "See more" window. |
| `brand/brand.css` | Colours, fonts, sidebar, header, window. Light theme by default; dark theme behind the switch. |
| `brand/mockup.scoped.css` | The mockup's card styles, prefixed `.mk` so they cannot touch the detailed tabs. **Generated** by `scripts/scope-mockup-css.js` from `brand/source/mockup.css`. |
| `brand/light.generated.css` | The light-theme version of every colour in the report's own stylesheet (used inside "See more"). **Generated** by `scripts/make-light-theme.js`. Re-run it when the CSS inside `template-brand.html` changes. |
| `src/brandAssets.js` | Inlines fonts, pictures, CSS and the script into the report (one self-contained file, nothing fetched at view time). |
| `scripts/brand-preview.js` | Builds `reports/xcf-report-brand-preview.html` from the newest real report's data, in seconds. |
| `brand/archive/` | The first version (dark, banner with charms). |

Preview: `node scripts/make-light-theme.js && node scripts/brand-preview.js`, then open `reports/xcf-report-brand-preview.html`.

## Cards with no data behind them (WIP)

The mockup has two cards the report has no data for: **Briefs in review (WIP)** and **Assets delivered this quarter (WIP)**. They show the
mockup's own sample numbers, copied exactly and labelled "Sample number(s)". When a real source exists (an Asana field, a sheet), replace
the samples in `brand/workflow.js` (`renderKpis`, `ASSETS`, `DET.assets`, `DET.briefs`).

## The "XCF Workflow" logo at the top of the sidebar

Two pictures, one per theme, because the lettering has to read on a white sidebar and on a dark one:

- `brand/assets/xcf-workflow-for-light-bg.png`: dark lettering, shown in the light theme.
- `brand/assets/xcf-workflow-for-dark-bg.png`: pale lettering, shown in the dark theme.

To change the logo, save new files under those names (about 800px wide is plenty) and rebuild. If only one picture exists it is used for
both themes, and with no picture at all the sidebar shows the plain text "XCF Workflow". `src/brandAssets.js` does the swap.

## Where the look comes from

Warm-grey page (`#F4F2ED`), white 12px cards, midnight ink (`#000856`), pill controls, and the mockup's dark palette
(`#0B1030` / `#151B4A`) behind the switch. The mockup sets its type in Barlow from Google Fonts; the report cannot load outside
fonts (a deploy with outside hosts is held for review), so it uses Special Gothic, the font the mockup itself falls back to.

## Assets (from the earlier "Brand Refresh Drop" page, copied 16 Nov 2026)

- Fonts: Special Gothic (regular, medium/bold) and Special Gothic Condensed One (headings and labels). In use.
- `xero-logo.svg`, `xcf-sticker.png`, `charm-*.svg`, `fable.svg`, `texture-hero.png`: used by the first version only.
