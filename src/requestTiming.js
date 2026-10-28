const fs = require('fs');
const path = require('path');
const { asanaClient, batchedMap } = require('./asana');

const REQUESTS_PROJECT_GID = '1215906401561993'; // XCF | Requests
const PM_PORTFOLIO_GID = '1217210785824637';     // XCF | Projects
const STATUS_FIELD_GID = '1211986892220398';     // Status (XCF)
const IN_PROGRESS_GID = '1211986892220400';      // Status (XCF) → "In Progress"
const STAKEHOLDER_REVIEW_GID = '1213322493108394'; // Status (XCF) → "SR - Stakeholder Review"
const COMPLETE_GID = '1211986892220404';         // Status (XCF) → "Complete"

// Internal projects that should not be counted in cycle time at all — they are not
// business requests, so they distort both coverage and the median.
const EXCLUDED_CODES = new Set(['XCF-11710']); // Canva XCF approvals — internal

// Weekly planning buckets named like "Sprint | 7th - 11th Sep". They are containers for a
// week's work, not requests, and they were being counted as measured (created and set to In
// Progress straight away), which made the XCF initiative figures meaningless — 9 of its 10
// measured rows were sprint buckets. Matches "Sprint |" followed by a date, so a genuine
// request that merely mentions the word is not caught. "Studio BAU - Sprints and project
// management" hours buckets are excluded as well, by their own pattern (added once Christie
// confirmed they are buckets too).
const EXCLUDED_NAME_PATTERNS = [
  /(^|\|)\s*sprint\s*\|\s*\d/i,        // "Sprint | 7th - 11th Sep"
  /studio bau\s*[-\u2013\u2014]\s*sprints/i, // "Studio BAU - Sprints and project management" (hyphen or en dash)
];
const isExcludedName = (name) => EXCLUDED_NAME_PATTERNS.some(rx => rx.test(name || ''));
const XCF_CODE_FIELD_GID = '1213726159416934';   // "XCF" text field, e.g. XCF-18696
const PODS_FIELD_GID = '1211165589636938';       // PODS (XCF)
const REQUESTER_FIELD_GID = '1218344624492289';  // Requester (XCF)
const PROJECT_TYPE_FIELD_GID = '1217575429570978'; // Project type (XCF)
const REGIONS_ROADMAP_FIELD_GID = '1212086752729219'; // "Applicable Regions" — used for Roadmap
const REGIONS_XCF_FIELD_GID = '1213486033990545';     // "Regions (XCF)" — used for Micro (BAU) and XCF initiative

// Xero's financial year starts 1 April, so FY27 Q1 is Apr-Jun 2026. Matches the
// "FY27 Q2" labels used by the Quarter (Mkt Planning) field in Asana.
function fiscalQuarter(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const m = d.getUTCMonth(); // 0 = Jan
  const q = Math.floor(((m + 9) % 12) / 3) + 1;
  const fy = (m >= 3 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()) % 100;
  return `FY${fy} Q${q}`;
}

// Fixed start at the top of FY27 Q2 rather than a rolling 90-day window, so the
// coverage figure is comparable week to week instead of silently dropping older
// requests off the back as it slides. Matches the Regional Requests tab's window.
const WINDOW_START = '2026-07-01T00:00:00.000Z';
const CACHE_PATH = path.join(__dirname, '..', 'request-timing-cache.json');

// Asana exposes no change history for a PROJECT's custom fields, and the audit-log
// API needs a service-account token we don't have. So "work started" is taken from
// the project's first green status update — the On Track moment — which is the only
// dated signal available. See AGENTS.md for the full reasoning.
const ON_TRACK_COLOR = 'green';

// Requests are numbered XCF-#### and so are some projects; others use XCFP-/XCFT-
// or no code at all, and Asana keeps no link once a task becomes a project. Name
// matching is therefore the only join available, and it cannot cover everything.
function extractCode(str) {
  const m = (str || '').toUpperCase().match(/\bXCF-(\d+)\b/);
  return m ? `XCF-${m[1]}` : null;
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return { projects: {}, requests: {} };
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    return { projects: c.projects || {}, requests: c.requests || {} };
  } catch (err) {
    console.warn('[Requests] Cache unreadable, starting fresh:', err.message);
    return { projects: {}, requests: {} };
  }
}

// A request task belongs to several projects, and Asana's permalink_url points at
// whichever one it picks — usually "Cost per asset", not the intake board. Build the
// URL against XCF | Requests so the link opens the task in the context people expect.
function requestUrl(taskGid) {
  const ws = process.env.ASANA_WORKSPACE_GID || '41261904390129';
  return `https://app.asana.com/1/${ws}/project/${REQUESTS_PROJECT_GID}/task/${taskGid}`;
}

function enumValue(t, gid) { return t.custom_fields?.find(f => f.gid === gid)?.enum_value?.name || null; }
function textValue(t, gid) { return t.custom_fields?.find(f => f.gid === gid)?.text_value || null; }
function multiValues(t, gid) {
  return (t.custom_fields?.find(f => f.gid === gid)?.multi_enum_values || [])
    .map(v => (v.name || '').trim())
    .filter(Boolean);
}

// Which region field applies depends on the project type, because Roadmap requests use a
// different field from everything else. A request with no project type yet (older ones)
// takes whichever field is filled in, preferring Regions (XCF).
function regionsFor(t, projectType) {
  if (projectType === 'Roadmap') return multiValues(t, REGIONS_ROADMAP_FIELD_GID);
  if (projectType === 'Micro (BAU)' || projectType === 'XCF initiative') return multiValues(t, REGIONS_XCF_FIELD_GID);
  const x = multiValues(t, REGIONS_XCF_FIELD_GID);
  return x.length ? x : multiValues(t, REGIONS_ROADMAP_FIELD_GID);
}

function peopleValue(t, gid) { return t.custom_fields?.find(f => f.gid === gid)?.people_value?.[0]?.name || null; }

async function paginate(client, url, params) {
  const out = [];
  let offset = null;
  do {
    const p = { ...params, limit: 100 };
    if (offset) p.offset = offset;
    const resp = await client.get(url, { params: p });
    out.push(...resp.data.data);
    offset = resp.data.next_page?.offset ?? null;
  } while (offset);
  return out;
}

// "Work started" has two independent signals and either can come first:
//   1. the project posting an On Track (green) status update
//   2. the project's Status (XCF) field being set to In Progress
// Projects do expose an activity log at /projects/{gid}/stories — which records
// custom-field changes with timestamps — so both are datable and we take the earlier.
async function fetchProjectStart(client, projectGid) {
  const [ups, stories] = await Promise.all([
    paginate(client, `/projects/${projectGid}/project_statuses`, {
      opt_fields: 'gid,created_at,color,title',
    }).catch(() => []),
    paginate(client, `/projects/${projectGid}/stories`, {
      opt_fields: 'created_at,resource_subtype,custom_field.gid,new_enum_value.gid',
      sort_ascending: true,
    }).catch(() => []),
  ]);

  const asc = ups.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const green = asc.find(u => u.color === ON_TRACK_COLOR);
  const firstOnTrackAt = green ? green.created_at : null;

  const ip = stories.find(s =>
    s.resource_subtype === 'enum_custom_field_changed' &&
    s.custom_field?.gid === STATUS_FIELD_GID &&
    s.new_enum_value?.gid === IN_PROGRESS_GID
  );
  const firstInProgressAt = ip ? ip.created_at : null;

  // Fallbacks in descending order of how well they approximate "work started".
  // Stakeholder Review and Complete both prove work happened but date it later than
  // it began, so they are labelled distinctly rather than passed off as a clean start.
  const srStory = stories.find(s =>
    s.resource_subtype === 'enum_custom_field_changed' &&
    s.custom_field?.gid === STATUS_FIELD_GID &&
    s.new_enum_value?.gid === STAKEHOLDER_REVIEW_GID
  );
  const firstReviewAt = srStory ? srStory.created_at : null;

  // Match on gid, not name — the stories fetch only requests new_enum_value.gid, so
  // a name comparison here silently never matched and lost every completed project.
  const compStory = stories.find(s =>
    s.resource_subtype === 'enum_custom_field_changed' &&
    s.custom_field?.gid === STATUS_FIELD_GID &&
    s.new_enum_value?.gid === COMPLETE_GID
  );
  const compUpdate = asc.find(u => u.color === 'complete');
  const firstCompleteAt = [compStory?.created_at, compUpdate?.created_at].filter(Boolean).sort()[0] || null;

  const realStart = [firstOnTrackAt, firstInProgressAt].filter(Boolean).sort()[0] || null;
  const startedAt = realStart || firstReviewAt || firstCompleteAt;

  return {
    firstOnTrackAt,
    firstInProgressAt,
    firstReviewAt,
    firstCompleteAt,
    startedAt,
    startedBy: !startedAt ? null
      : realStart ? (realStart === firstInProgressAt ? 'In Progress' : 'On Track')
      : startedAt === firstReviewAt ? 'Stakeholder Review'
      : 'Skipped In Progress',
    isRealStart: !!realStart,
    firstStatusAt: asc.length ? asc[0].created_at : null,
  };
}

// People paste shared passwords into request comments (brand portals, review links).
// These get cached and committed, so scrub them at the point of capture rather than
// relying on anyone noticing later.
function redactSecrets(text) {
  return (text || '').replace(
    /((?:pass\s?word|passcode|pin|login|credential)s?\s*(?:is|are|:|=)?\s*)(\S{3,})/gi,
    '$1[redacted]'
  );
}

async function fetchComments(client, taskGid) {
  const stories = await paginate(client, `/tasks/${taskGid}/stories`, {
    opt_fields: 'created_at,resource_subtype,text,created_by.name',
    sort_ascending: true,
  });
  return stories
    .filter(s => s.resource_subtype === 'comment_added' && s.text)
    .map(s => ({
      author: s.created_by?.name || 'Unknown',
      at: s.created_at,
      text: redactSecrets(s.text).slice(0, 1200),
    }));
}

async function buildRequestsData() {
  if (!process.env.ASANA_TOKEN) {
    console.warn('[Requests] No ASANA_TOKEN — skipping');
    return [];
  }
  const client = asanaClient();
  const since = WINDOW_START;

  let requests, projects;
  try {
    [requests, projects] = await Promise.all([
      paginate(client, '/tasks', {
        project: REQUESTS_PROJECT_GID,
        opt_fields: [
          'gid,name,created_at,completed,permalink_url,assignee.name',
          'custom_fields.gid,custom_fields.enum_value.name',
          'custom_fields.text_value,custom_fields.people_value.name',
          'custom_fields.multi_enum_values.name',
        ].join(','),
      }),
      paginate(client, `/portfolios/${PM_PORTFOLIO_GID}/items`, {
        opt_fields: 'gid,name,permalink_url,custom_fields.gid,custom_fields.enum_value.name',
      }),
    ]);
  } catch (err) {
    console.warn('[Requests] Fetch failed:', err.message);
    return [];
  }

  requests = requests.filter(t => t.created_at && t.created_at >= since)
    .filter(t => !EXCLUDED_CODES.has(extractCode(textValue(t, XCF_CODE_FIELD_GID) || t.name)))
    .filter(t => !isExcludedName(t.name));

  const projectByCode = {};
  for (const p of projects) {
    const code = extractCode(p.name);
    if (code && !projectByCode[code]) projectByCode[code] = p;
  }

  const cache = loadCache();

  const matched = [];
  for (const r of requests) {
    const code = extractCode(textValue(r, XCF_CODE_FIELD_GID) || r.name);
    const project = code ? projectByCode[code] : null;
    if (project) matched.push({ request: r, project, code });
  }

  console.log(
    `[Requests] ${requests.length} requests since ${WINDOW_START.slice(0, 10)} | ` +
    `${projects.length} projects (${Object.keys(projectByCode).length} with XCF-#### codes) | ` +
    `${matched.length} matched`
  );

  // Cache a project only once it HAS a start date — that value never changes.
  // A project with no start yet must be re-checked every build, because the whole
  // point is that coverage climbs as the team sets statuses. Caching the absence
  // froze the answer and made newly-started projects invisible forever.
  const projectsToFetch = matched
    .map(m => m.project)
    .filter((p, i, arr) => arr.findIndex(x => x.gid === p.gid) === i)
    .filter(p => !cache.projects[p.gid]?.startedAt || cache.projects[p.gid]?.firstReviewAt === undefined);

  const projectTiming = {};
  const pErrs = {};
  // Two endpoints per project, so this is the heaviest part of the build. Smaller
  // batches with a longer gap keep it under Asana's burst limit; a failure here must
  // stay uncached so the next run retries rather than freezing in a wrong answer.
  await batchedMap(projectsToFetch, async (p) => {
    try { projectTiming[p.gid] = await fetchProjectStart(client, p.gid); }
    catch (err) {
      const key = `${err.response?.status || 'ERR'} ${err.response?.data?.errors?.[0]?.message || err.message}`.slice(0, 80);
      pErrs[key] = (pErrs[key] || 0) + 1;
    }
  }, 3, 600);
  const pFail = Object.values(pErrs).reduce((a, b) => a + b, 0);
  if (pFail) {
    console.warn(`[Requests] ${pFail}/${projectsToFetch.length} project lookups failed:`);
    Object.entries(pErrs).forEach(([k, v]) => console.warn(`           x${v}  ${k}`));
  }

  // Comments are only worth fetching for rows that have a measurable cycle.
  const commentsToFetch = matched.filter(m => !cache.requests[m.request.gid]?.comments);
  const freshComments = {};
  let cFail = 0;
  await batchedMap(commentsToFetch, async (m) => {
    try { freshComments[m.request.gid] = await fetchComments(client, m.request.gid); }
    catch (err) { cFail++; }
  }, 5, 300);
  if (cFail) console.warn(`[Requests] ${cFail} comment fetches failed`);

  const matchedByGid = {};
  matched.forEach(m => { matchedByGid[m.request.gid] = m; });

  const rows = requests.map((r) => {
    const m = matchedByGid[r.gid];
    const priorReq = cache.requests[r.gid] || {};
    const timing = m ? (projectTiming[m.project.gid] || cache.projects[m.project.gid] || {}) : {};
    const comments = freshComments[r.gid] || priorReq.comments || [];

    // Requests usually carry the type; fall back to the converted project's value.
    const projectType = enumValue(r, PROJECT_TYPE_FIELD_GID)
      || (m ? enumValue(m.project, PROJECT_TYPE_FIELD_GID) : null)
      || 'Unset';

    const submittedAt = r.created_at;
    const onTrackAt = timing.startedAt || null;
    const durationHours = onTrackAt
      ? Math.round(((new Date(onTrackAt) - new Date(submittedAt)) / 3600000) * 10) / 10
      : null;

    return {
      gid: r.gid,
      code: extractCode(textValue(r, XCF_CODE_FIELD_GID) || r.name),
      name: (r.name || '').replace(/^\[Converted to project\]\s*/, ''),
      url: requestUrl(r.gid),
      pod: enumValue(r, PODS_FIELD_GID),
      requester: peopleValue(r, REQUESTER_FIELD_GID),
      assignee: r.assignee?.name || null,
      requestStatus: enumValue(r, STATUS_FIELD_GID),
      quarter: fiscalQuarter(r.created_at),
      projectType,
      regions: regionsFor(r, projectType),
      matched: !!m,
      projectName: m ? m.project.name : null,
      projectUrl: m ? m.project.permalink_url : null,
      projectStatus: m ? enumValue(m.project, STATUS_FIELD_GID) : null,
      submittedAt,
      onTrackAt,
      startedBy: timing.startedBy || null,
      isRealStart: timing.isRealStart === undefined ? !!onTrackAt : timing.isRealStart,
      durationHours,
      commentCount: comments.length,
      comments,
      summary: priorReq.summary || null,
      // Hand-assigned delay cause; see the skill for the taxonomy.
      cause: priorReq.cause || null,
      causedAt: priorReq.causedAt || null,
    };
  });

  rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  const nextCache = { projects: { ...cache.projects }, requests: { ...cache.requests } };
  for (const [gid, t] of Object.entries(projectTiming)) nextCache.projects[gid] = t;
  for (const r of rows) {
    if (!r.matched) continue;
    nextCache.requests[r.gid] = {
      code: r.code,
      name: r.name,
      comments: r.comments,
      summary: r.summary,
      cause: r.cause,
      causedAt: r.causedAt,
    };
  }
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(nextCache, null, 2)); }
  catch (err) { console.warn('[Requests] Could not write cache:', err.message); }

  const resolved = rows.filter(r => r.durationHours !== null && r.isRealStart);
  const viaComplete = rows.filter(r => r.durationHours !== null && !r.isRealStart);
  if (resolved.length) {
    const sorted = resolved.map(r => r.durationHours).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`[Requests] ${rows.length} rows | ${resolved.length} real-start (median ${(median / 24).toFixed(1)}d) + ${viaComplete.length} completion-only = ${resolved.length + viaComplete.length} tracked`);
  } else {
    console.log(`[Requests] ${rows.length} rows | none with a measurable cycle time yet`);
  }

  return rows;
}

module.exports = { buildRequestsData };
