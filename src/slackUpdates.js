const { WebClient } = require('@slack/web-api');
const fs = require('fs');
const path = require('path');

const PM_UPDATES_CHANNEL = 'C0B3YCKT0JV'; // #xcf-pm-weekly-updates
const WEEKS_BACK = 12;
const CACHE_PATH = path.join(__dirname, '..', 'slack-pm-updates-cache.json');

function loadCache() {
  if (fs.existsSync(CACHE_PATH)) {
    console.log('PM updates: using cached data from', path.basename(CACHE_PATH));
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  return [];
}

// Strip external URLs from Slack text so they don't appear in the HTML source
function stripUrls(text) {
  return (text || '')
    .replace(/<https?:[^|>]+\|([^>]+)>/g, '$1') // <url|label> → label only
    .replace(/<https?:[^>]+>/g, '')              // bare <url> → remove
    .replace(/https?:\/\/\S+/g, '');             // plain URLs → remove
}

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(mondayDate) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mondayDate.getUTCDate()} ${months[mondayDate.getUTCMonth()]}`;
}

async function buildPMUpdatesData() {
  const token = process.env.SLACK_TOKEN;
  if (!token) {
    console.warn('SLACK_TOKEN not set — falling back to cache');
    return loadCache();
  }

  const client = new WebClient(token);

  try {
    const oldest = (Date.now() / 1000 - WEEKS_BACK * 7 * 24 * 3600).toFixed(0);

    // Paginate through all messages in range
    let allMessages = [];
    let cursor;
    do {
      const resp = await client.conversations.history({
        channel: PM_UPDATES_CHANNEL,
        oldest,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const msgs = (resp.messages || []).filter(
        m => !m.subtype && (!m.thread_ts || m.thread_ts === m.ts)
      );
      allMessages = allMessages.concat(msgs);
      cursor = resp.response_metadata?.next_cursor;
    } while (cursor);

    if (!allMessages.length) return loadCache();

    // Resolve user IDs → display names
    const userCache = {};
    async function getUserName(userId) {
      if (userCache[userId]) return userCache[userId];
      try {
        const resp = await client.users.info({ user: userId });
        const profile = resp.user?.profile;
        const name = profile?.real_name || profile?.display_name || resp.user?.name || userId;
        userCache[userId] = name;
        return name;
      } catch {
        userCache[userId] = userId;
        return userId;
      }
    }

    // Group by Monday of each week
    const weekMap = {};
    for (const msg of allMessages) {
      const date = new Date(parseFloat(msg.ts) * 1000);
      const monday = getMondayOf(date);
      const key = monday.toISOString().slice(0, 10);
      if (!weekMap[key]) {
        weekMap[key] = { weekStart: key, weekLabel: formatWeekLabel(monday), messages: [] };
      }
      const name = await getUserName(msg.user);
      // Skip channel join/leave notifications
      if (/has (joined|left) the channel/.test(msg.text || '')) continue;
      weekMap[key].messages.push({ name, timestamp: date.toISOString(), text: stripUrls(msg.text) });
    }

    // Sort messages within each week oldest-first; weeks newest-first
    // Label each week by its Friday (Monday + 4 days) so "14 Aug" shows instead of "10 Aug"
    const result = Object.values(weekMap)
      .filter(w => w.messages.length > 0)
      .map(w => {
        const sorted = w.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const friday = new Date(w.weekStart + 'T00:00:00Z');
        friday.setUTCDate(friday.getUTCDate() + 4);
        return { ...w, weekLabel: formatWeekLabel(friday), messages: sorted };
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    // Merge manually-added executiveSummary fields from existing cache so they aren't lost
    const existingCache = fs.existsSync(CACHE_PATH)
      ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
      : [];
    const existingSummaries = {};
    for (const w of existingCache) {
      if (w.executiveSummary) existingSummaries[w.weekStart] = w.executiveSummary;
    }
    const merged = result.map(w => existingSummaries[w.weekStart]
      ? { ...w, executiveSummary: existingSummaries[w.weekStart] }
      : w
    );

    // Update the cache for future fallback use
    fs.writeFileSync(CACHE_PATH, JSON.stringify(merged, null, 2));
    const finalResult = merged;
    console.log(`PM updates: fetched ${finalResult.reduce((s, w) => s + w.messages.length, 0)} messages across ${finalResult.length} weeks`);
    return finalResult;

  } catch (err) {
    if (err.data?.error === 'missing_scope') {
      console.warn('PM updates: bot token missing groups:history / users:read scopes — using cache');
      console.warn('Fix: add groups:history + users:read scopes at https://api.slack.com/apps and reinstall the app');
    } else {
      console.warn('PM updates fetch failed:', err.message, '— using cache');
    }
    return loadCache();
  }
}

module.exports = { buildPMUpdatesData };
