const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

function buildSummaryBlocks(members, reportPath) {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-NZ', { weekday: 'long', timeZone: 'Pacific/Auckland' });
  const dateStr = now.toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland',
  });

  const overCapacity = members.filter((m) => m.today > 8).length;
  const available = members.filter((m) => m.today < 3).length;
  const totalOverdue = members.reduce((sum, m) => sum + m.overdue, 0);
  const totalMissing = members.reduce((sum, m) => sum + m.missing, 0);
  const filename = path.basename(reportPath);

  const text = [
    `📊 *XCF Capacity Report — ${dayName} ${dateStr}*`,
    '',
    `👥 *${members.length}* team members`,
    `🔴 *${overCapacity}* over capacity (>8h today)`,
    `🟢 *${available}* available (<3h today)`,
    `⚠️ *${totalOverdue}* overdue tasks`,
    `🟡 *${totalMissing}* missing fields`,
    '',
    `_Report saved: ${filename}_`,
  ].join('\n');

  return { text };
}

// Post via Incoming Webhook (just needs a webhook URL, no bot token or scopes)
async function postViaWebhook(members, reportPath) {
  const { text } = buildSummaryBlocks(members, reportPath);
  await axios.post(process.env.SLACK_WEBHOOK_URL, { text });
  console.log('Slack message posted via webhook.');
}

// Post via bot token (needs chat:write + files:write scopes)
async function postViaToken(members, reportPath) {
  const client = new WebClient(process.env.SLACK_TOKEN);
  const channelId = process.env.SLACK_CHANNEL_ID;
  const { text } = buildSummaryBlocks(members, reportPath);

  await client.chat.postMessage({ channel: channelId, text, mrkdwn: true });

  const filename = path.basename(reportPath);
  await client.files.uploadV2({
    channel_id: channelId,
    file: fs.createReadStream(reportPath),
    filename,
    title: filename,
  });

  console.log('Slack message and file posted via bot token.');
}

async function postReport(members, reportPath) {
  if (process.env.SLACK_WEBHOOK_URL) {
    return postViaWebhook(members, reportPath);
  }
  if (process.env.SLACK_TOKEN) {
    return postViaToken(members, reportPath);
  }
  console.log('No Slack credentials configured — skipping Slack post.');
}

module.exports = { postReport };
