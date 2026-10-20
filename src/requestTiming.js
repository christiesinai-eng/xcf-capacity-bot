const fs = require('fs');
const path = require('path');
const { asanaClient, batchedMap } = require('./asana');

const REQUESTS_PROJECT_GID = '1215906401561993'; // XCF | Requests
const PM_PORTFOLIO_GID = '1217210785824637';     // XCF | Projects
const STATUS_FIELD_GID = '1211986892220398';     // Status (XCF)
const XCF_CODE_FIELD_GID = '1213726159416934';   // "XCF" text field, e.g. XCF-18696
const PODS_FIELD_GID = '1211165589636938';       // PODS (XCF)
const REQUESTER_FIELD_GID = '1218344624492289';  // Requester (XCF)
const PROJECT_TYPE_FIELD_GID = '1217575429570978'; // Project type (XCF)

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

const WINDOW_DAYS = 90;
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

async function fetchProjectOnTrack(client, projectGid) {
  const ups = await paginate(client, `/projects/${projectGid}/project_statuses`, {
    opt_fields: 'gid,created_at,color,title',
  });
  // Oldest-last from Asana, so walk ascending to find the FIRST time it went green.
  const asc = ups.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const green = asc.find(u => u.color === ON_TRACK_COLOR);
  return {
    firstOnTrackAt: green ? green.created_at : null,
    firstStatusAt: asc.length ? asc[0].created_at : null,
    statusCount: asc.length,
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
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

  let requests, projects;
  try {
    [requests, projects] = await Promise.all([
      paginate(client, '/tasks', {
        project: REQUESTS_PROJECT_GID,
        opt_fields: [
          'gid,name,created_at,completed,permalink_url',
          'custom_fields.gid,custom_fields.enum_value.name',
          'custom_fields.text_value,custom_fields.people_value.name',
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

  requests = requests.filter(t => t.created_at && t.created_at >= since);

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
    `[Requests] ${requests.length} requests in last ${WINDOW_DAYS}d | ` +
    `${projects.length} projects (${Object.keys(projectByCode).length} with XCF-#### codes) | ` +
    `${matched.length} matched`
  );

  // A project's first green never changes once set, so only look up ones we haven't resolved.
  const projectsToFetch = matched
    .map(m => m.project)
    .filter((p, i, arr) => arr.findIndex(x => x.gid === p.gid) === i)
    .filter(p => !cache.projects[p.gid]?.firstOnTrackAt);

  const projectTiming = {};
  let pFail = 0;
  await batchedMap(projectsToFetch, async (p) => {
    try { projectTiming[p.gid] = await fetchProjectOnTrack(client, p.gid); }
    catch (err) { pFail++; }
  }, 5, 300);
  if (pFail) console.warn(`[Requests] ${pFail} project status lookups failed`);

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

    const submittedAt = r.created_at;
    const onTrackAt = timing.firstOnTrackAt || null;
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
      requestStatus: enumValue(r, STATUS_FIELD_GID),
      quarter: fiscalQuarter(r.created_at),
      // Requests usually carry the type; fall back to the converted project's value.
      projectType: enumValue(r, PROJECT_TYPE_FIELD_GID)
        || (m ? enumValue(m.project, PROJECT_TYPE_FIELD_GID) : null)
        || 'Unset',
      matched: !!m,
      projectName: m ? m.project.name : null,
      projectUrl: m ? m.project.permalink_url : null,
      projectStatus: m ? enumValue(m.project, STATUS_FIELD_GID) : null,
      submittedAt,
      onTrackAt,
      durationHours,
      commentCount: comments.length,
      comments,
      summary: priorReq.summary || null,
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
    };
  }
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(nextCache, null, 2)); }
  catch (err) { console.warn('[Requests] Could not write cache:', err.message); }

  const resolved = rows.filter(r => r.durationHours !== null);
  if (resolved.length) {
    const sorted = resolved.map(r => r.durationHours).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`[Requests] ${rows.length} rows | ${resolved.length} with a cycle time | median ${(median / 24).toFixed(1)}d`);
  } else {
    console.log(`[Requests] ${rows.length} rows | none with a measurable cycle time yet`);
  }

  return rows;
}

module.exports = { buildRequestsData };
