'use strict';
// Formulas for the two extra Glean agents (request comments, PM updates), and the JS reference they must agree with.
//
//   node scripts/glean-extra-formulas.js            prints both formulas as JSON (to paste into the sheet)
//   node scripts/glean-extra-formulas.js --selftest runs the JS reference on a few awkward texts
//
// The agents only COPY raw values into a "_Raw" tab. These formulas do the rules an LLM gets wrong by eye: the
// password redaction, the 1,200 character cut, URL stripping, ISO timestamps, the week a message belongs to and the
// sort order. They are written to give exactly what src/requestTiming.js (fetchComments + report.js stripCommentUrls)
// and src/slackUpdates.js (stripUrls, getMondayOf, formatWeekLabel) produce.

const RAW_C = 'Glean_Request_Comments_Raw';
const RAW_P = 'Glean_PM_Updates_Raw';
const C_ROWS = 4000;
const P_ROWS = 500;

// ── Request_Comments ────────────────────────────────────────────────────────────────────────────────────────────
// build: redactSecrets(text).slice(0,1200), then stripCommentUrls (report.js) on the way into the sheet.
function redactSecrets(text) {
  return (text || '').replace(/((?:pass\s?word|passcode|pin|login|credential)s?\s*(?:is|are|:|=)?\s*)(\S{3,})/gi, '$1[redacted]');
}
function stripCommentUrls(text) {
  if (!text) return text;
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, '$2')
    .replace(/https?:\/\/app\.asana\.com\/\S*profile\/\d+/gi, '@mention')
    .replace(/<?https?:\/\/\S+>?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
const cleanComment = (raw) => stripCommentUrls(redactSecrets(raw).slice(0, 1200));

// Sheets: RE2 regexes, no backslash escaping inside a formula string. (?i) is the "i" flag. trim() also strips
// non-breaking spaces and the byte order mark, so the last step does too.
const RX_REDACT = '(?i)((?:pass\\s?word|passcode|pin|login|credential)s?\\s*(?:is|are|:|=)?\\s*)(\\S{3,})';
const RX_LABEL = '<(https?://[^|>]+)\\|([^>]*)>';
const RX_PROFILE = '(?i)https?://app\\.asana\\.com/\\S*profile/\\d+';
const RX_URL = '(?i)<?https?://\\S+>?';
const RX_SPACES = '[ \\t]{2,}';
// (\p{Zs} is not accepted by Sheets, so the Unicode spaces trim() removes are listed by code.)
const WS = '\\s\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}';
const RX_TRIM = `^[${WS}]+|[${WS}]+$`;

function commentsFormula() {
  const R = (c) => `${RAW_C}!${c}:${c}`; // whole columns: rows inserted by an append action cannot shift them
  return '=LET(' +
    `a,${R('A')},` +
    `e,${R('E')},` +
    `sa,ARRAYFORMULA(REGEXREPLACE(e,"${RX_REDACT}","$1[redacted]")),` +
    'sb,ARRAYFORMULA(LEFT(sa,1200)),' +
    `sc,ARRAYFORMULA(REGEXREPLACE(sb,"${RX_LABEL}","$2")),` +
    `sd,ARRAYFORMULA(REGEXREPLACE(sc,"${RX_PROFILE}","@mention")),` +
    `se,ARRAYFORMULA(REGEXREPLACE(sd,"${RX_URL}","")),` +
    `sf,ARRAYFORMULA(REGEXREPLACE(se,"${RX_SPACES}"," ")),` +
    `sg,ARRAYFORMULA(REGEXREPLACE(sf,"${RX_TRIM}","")),` +
    `IFERROR(SORT(FILTER(HSTACK(a,${R('B')},${R('C')},${R('D')},sg),(a<>"")*(ROW(a)>1)),1,TRUE,4,TRUE),""))`;
}

// ── PM_Updates ──────────────────────────────────────────────────────────────────────────────────────────────────
// build: weeks keyed by the Monday (UTC) of the message, labelled by that week's Friday ("6 Nov"); message time is
// new Date(parseFloat(ts)*1000).toISOString(); text = stripUrls(text). Weeks newest first, messages oldest first.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function stripUrls(text) {
  return (text || '')
    .replace(/<https?:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<https?:[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '');
}
function pmUpdateRow(ts, author, text) {
  const date = new Date(parseFloat(ts) * 1000);
  const monday = new Date(date); const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() + (day === 0 ? -6 : 1 - day)); monday.setUTCHours(0, 0, 0, 0);
  const friday = new Date(monday); friday.setUTCDate(friday.getUTCDate() + 4);
  return [monday.toISOString().slice(0, 10), `${friday.getUTCDate()} ${MONTHS[friday.getUTCMonth()]}`, author, date.toISOString(), stripUrls(text)];
}

function pmUpdatesFormula() {
  const R = (c) => `${RAW_P}!${c}:${c}`;
  return '=LET(' +
    `ts,${R('A')},au,${R('B')},tx,${R('C')},` +
    'ok,ARRAYFORMULA((ts<>"")*(ROW(ts)>1)*(IFERROR(VALUE(ts),0)>=(NOW()-DATE(1970,1,1))*86400-7257600)),' + // outside ARRAYFORMULA a range comparison inside LET is read for one cell only
    'ms,ARRAYFORMULA(IF(ok,INT(VALUE(ts)*1000),0)),' +
    'sec,ARRAYFORMULA(INT(ms/1000)),' +
    'days,ARRAYFORMULA(INT(sec/86400)),' +
    'mon,ARRAYFORMULA(days-MOD(days+3,7)),' +
    'ws,ARRAYFORMULA(TEXT(DATE(1970,1,1)+mon,"yyyy-mm-dd")),' +
    'wl,ARRAYFORMULA(TEXT(DATE(1970,1,1)+mon+4,"d mmm")),' +
    'sod,ARRAYFORMULA(MOD(sec,86400)),' +
    'pa,ARRAYFORMULA(TEXT(DATE(1970,1,1)+days,"yyyy-mm-dd")&"T"&TEXT(INT(sod/3600),"00")&":"&TEXT(INT(MOD(sod,3600)/60),"00")&":"&TEXT(MOD(sod,60),"00")&"."&TEXT(MOD(ms,1000),"000")&"Z"),' +
    'cl,ARRAYFORMULA(REGEXREPLACE(REGEXREPLACE(REGEXREPLACE(tx,"<https?:[^|>]+\\|([^>]+)>","$1"),"<https?:[^>]+>",""),"https?://\\S+","")),' +
    'IFERROR(SORT(FILTER(HSTACK(ws,wl,au,pa,cl),ok),1,FALSE,4,TRUE),""))';
}

module.exports = { cleanComment, redactSecrets, stripCommentUrls, stripUrls, pmUpdateRow, commentsFormula, pmUpdatesFormula, RAW_C, RAW_P, C_ROWS, P_ROWS };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    console.log(JSON.stringify(cleanComment('  Hi <@U1> see <https://www.canva.com/x|the design>  and https://app.asana.com/0/profile/123 and https://f.io/abc   password: hunter2 ok  '), null, 1));
    console.log(JSON.stringify(pmUpdateRow('1793942236.584499', 'Deepak Aujla', ':clipboard: _WEEKLY_ <https://a.b/c|label> <https://x.y> https://z.w/q end')));
  } else {
    console.log(JSON.stringify({ comments: commentsFormula(), pmUpdates: pmUpdatesFormula() }, null, 1));
  }
}
