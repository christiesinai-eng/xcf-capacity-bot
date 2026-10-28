'use strict';
// Lightweight markdown -> HTML for executive summaries and request summaries.
// Shared by the build (Node) and the dashboard page (browser), so a summary typed into the Google Sheet
// renders exactly as it did when the build did the conversion.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkdownLite = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function mdToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inUl = false, inTable = false, tableHasHead = false;

  function flushUl() { if (inUl) { out.push('</ul>'); inUl = false; } }
  function flushTable() { if (inTable) { out.push('</tbody></table>'); inTable = false; tableHasHead = false; } }
  function flushAll() { flushUl(); flushTable(); }

  function inline(t) {
    return t
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (/^\s*$/.test(line)) { flushAll(); out.push('<div style="margin:.4em 0"></div>'); continue; }
    if (/^---+$/.test(line)) { flushAll(); out.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,.1);margin:.8em 0">'); continue; }
    if (/^## /.test(line)) { flushAll(); out.push(`<h2 class="exec-h2">${inline(line.slice(3))}</h2>`); continue; }
    if (/^### /.test(line)) { flushAll(); out.push(`<h3 class="exec-h3">${inline(line.slice(4))}</h3>`); continue; }
    if (/^> /.test(line)) { flushAll(); out.push(`<blockquote class="exec-bq">${inline(line.slice(2))}</blockquote>`); continue; }
    if (/^\* /.test(line) || /^- /.test(line)) {
      flushTable();
      if (!inUl) { out.push('<ul class="exec-ul">'); inUl = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flushUl();
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (/^[\s|:-]+$/.test(line)) { tableHasHead = true; continue; }
      if (!inTable) { out.push('<table class="exec-tbl"><tbody>'); inTable = true; }
      const tag = (!tableHasHead) ? 'th' : 'td';
      out.push(`<tr>${cells.map(c=>`<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      if (tag === 'th') tableHasHead = true;
      continue;
    }
    flushAll();
    out.push(`<p class="exec-p">${inline(line)}</p>`);
  }
  flushAll();
  return out.join('\n');
}

  return { mdToHtml };
}));
