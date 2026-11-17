/* ══════════════════════════════════════════════════════════════════════════════════════════════════════
   XCF Control Tower: the one-page overview ("workflow" look).
   Draws the summary cards and the "See more" windows of the mockup from the report's OWN data (MEMBERS, PM_DATA,
   OOO_DATA, REQUESTS_DATA ...), using the same rules the existing tabs use. It reads the data and never changes it.
   Two cards (Assets delivered, Briefs in review) are work in progress: the report holds no data for them, so they show
   the mockup's sample numbers, marked "Sample numbers" and "(WIP)".
   Each window ends with a link to the report's original detailed tab, which is kept whole.
   ══════════════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('Overview failed to draw', e); }

  function init() {
    var NS = 'http://www.w3.org/2000/svg';
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var plural = function (n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); };
    var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2H14v4.5M14 2 8.5 7.5M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function seeMore(key, preset, label) { return '<button class="seemore" type="button" data-more="' + key + '"' + (preset ? ' data-preset="' + preset + '"' : '') + '>' + (label || 'See more') + ' ' + ICON + '</button>'; }
    function put(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; return el; }
    function head(title, sub, right) { return '<div class="ch"><div><h3 class="t-card">' + title + '</h3>' + (sub ? '<p class="t-sub">' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>'; }
    function chip(t, c, st) { return '<span class="chip ' + c + '"' + (st ? ' style="' + st + '"' : '') + '>' + t + '</span>'; }
    var CHEV_L = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var CHEV_R = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    // Arrows for a card that shows only part of its data, so people can look through the rest without opening it.
    function pagerHTML(id) { return '<div class="pgr" id="' + id + '"><button type="button" data-d="-1" aria-label="Previous">' + CHEV_L + '</button><span class="pg-n" aria-live="polite"></span><button type="button" data-d="1" aria-label="Next">' + CHEV_R + '</button></div>'; }
    // A list shown a page at a time: perPage items, arrows move to the next or previous page. The arrows hide themselves when everything fits.
    function pager(id, perPage, getTotal, onChange, noun, fmt) {
      var el = document.getElementById(id), st = { start: 0 };
      if (!el) return { reset: function () {}, paint: function () {}, start: function () { return 0; } };
      var prev = el.querySelector('[data-d="-1"]'), next = el.querySelector('[data-d="1"]'), n = el.querySelector('.pg-n');
      function paint() {
        var total = getTotal(); if (st.start >= total) st.start = 0;
        el.hidden = total <= perPage;
        n.textContent = fmt ? fmt(st.start + 1, Math.min(st.start + perPage, total), total) : 'Showing ' + (st.start + 1) + '–' + Math.min(st.start + perPage, total) + ' of ' + total + (noun ? ' ' + noun : '');
        prev.disabled = st.start <= 0; next.disabled = st.start + perPage >= total;
      }
      [prev, next].forEach(function (b) { b.addEventListener('click', function () { st.start = Math.max(0, st.start + (+b.dataset.d) * perPage); onChange(st.start); paint(); }); });
      return { reset: function () { st.start = 0; paint(); }, paint: paint, start: function () { return st.start; } };
    }
    // Cards laid side by side: all of them are in a row that scrolls across; the arrows (and a swipe or trackpad) move along it.
    function carousel(trackId, pagerId, noun) {
      var tr = document.getElementById(trackId), el = document.getElementById(pagerId); if (!tr || !el) return;
      var prev = el.querySelector('[data-d="-1"]'), next = el.querySelector('[data-d="1"]'), n = el.querySelector('.pg-n');
      function geom() {
        var first = tr.firstElementChild; if (!first) return { step: 1, vis: 1, total: 0 };
        var gap = parseFloat(getComputedStyle(tr).columnGap) || 0, step = first.getBoundingClientRect().width + gap;
        return { step: step, vis: Math.max(1, Math.round((tr.clientWidth + gap) / step)), total: tr.children.length };
      }
      function paint() {
        var g = geom(), i = Math.round(tr.scrollLeft / g.step);
        el.hidden = g.total <= g.vis;
        n.textContent = 'Showing ' + (i + 1) + '–' + Math.min(i + g.vis, g.total) + ' of ' + g.total + ' ' + noun;
        prev.disabled = tr.scrollLeft <= 2; next.disabled = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 2;
      }
      [prev, next].forEach(function (b) { b.addEventListener('click', function () { var g = geom(); tr.scrollBy({ left: (+b.dataset.d) * g.step * g.vis, behavior: 'smooth' }); }); });
      tr.addEventListener('scroll', paint, { passive: true }); window.addEventListener('resize', paint); paint();
    }
    function initials(n) { return String(n).split(/\s+/).map(function (x) { return x[0]; }).join('').slice(0, 2).toUpperCase(); }
    function pretty(raw) {
      var parts = String(raw || '').replace(/^\[Converted to project\]\s*/, '').split(' | ').map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^XCFP?-\d+$/.test(x) && !/^XCFT-\d+$/.test(x) && !/^FY\d+\s*Q\d.*$/.test(x) && !/^20\d\d$/.test(x); });
      return parts[parts.length - 1] || String(raw || '');
    }

    /* ── rings (the mockup's own drawing code) ── */
    function mount(el, size, stroke, vals, colors, centerHTML, label) {
      var r = (size - stroke) / 2, circ = 2 * Math.PI * r;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size); svg.setAttribute('width', size); svg.setAttribute('height', size);
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label || '');
      var tr = document.createElementNS(NS, 'circle');
      tr.setAttribute('cx', size / 2); tr.setAttribute('cy', size / 2); tr.setAttribute('r', r); tr.setAttribute('fill', 'none'); tr.setAttribute('stroke-width', stroke);
      tr.style.stroke = 'var(--track)'; tr.style.transition = 'none'; svg.appendChild(tr);
      var cs = [];
      colors.forEach(function (c) {
        var k = document.createElementNS(NS, 'circle');
        k.setAttribute('cx', size / 2); k.setAttribute('cy', size / 2); k.setAttribute('r', r); k.setAttribute('fill', 'none'); k.setAttribute('stroke-width', stroke);
        k.style.stroke = c; k.setAttribute('stroke-dasharray', '0 ' + circ); k.setAttribute('stroke-dashoffset', '0'); svg.appendChild(k); cs.push(k);
      });
      el.innerHTML = ''; el.appendChild(svg);
      var c = document.createElement('div'); c.className = 'ringc'; c.innerHTML = centerHTML || ''; el.appendChild(c);
      var api = {
        set: function (v, total, gap) {
          var t = total || v.reduce(function (a, b) { return a + b; }, 0) || 1, acc = 0, gp = gap == null ? 4 : gap;
          v.forEach(function (x, i) {
            var len = Math.max(0, x / t * circ - (v.length > 1 ? gp : 0));
            cs[i].setAttribute('stroke-dasharray', len + ' ' + (circ - len)); cs[i].setAttribute('stroke-dashoffset', -acc);
            cs[i].setAttribute('stroke-linecap', v.length > 1 ? 'butt' : 'round'); acc += x / t * circ;
          });
        }
      };
      requestAnimationFrame(function () { requestAnimationFrame(function () { api.set(vals.v, vals.t, vals.g); }); });
      return api;
    }
    function gauge(pct, size, stroke, color, txt) {
      var d = document.createElement('div'); d.className = 'ringwrap';
      mount(d, size, stroke, { v: [Math.max(0, Math.min(pct, 100))], t: 100, g: 0 }, [color], txt, ''); return d;
    }

    /* ── the report's data and helpers ── */
    var MEM = MEMBERS, N = MEM.length;
    var capOf = function (m) { return memberCap(m.name); };
    function capCounts(key) {
      var o = 0, u = 0, a = 0, x = 0;
      MEM.forEach(function (m) {
        if (m.ooo) { x++; return; }
        var s = statusChip(m[key], key, capOf(m));
        if (s.cls === 'chip-over') o++; else if (s.cls === 'chip-under') u++; else a++;
      });
      return [o, u, a, x];
    }
    var podDot = function (pod) { return (BRAND[pod] || BRAND['Campaign']).dot; };
    var DAY = 86400000;
    var today0 = new Date(); today0.setHours(0, 0, 0, 0);
    var fmtDay = function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    var fmtDayY = function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }); };
    var fmtDate = function (s) { return s ? fmtDayY(new Date(s + 'T00:00:00')) : '–'; };
    function st(p) { return p > 100 ? ['coral', 'var(--coral)', 'Over capacity'] : p >= 85 ? ['mint', 'var(--mint)', 'On target'] : ['gold', 'var(--gold)', 'Room to spare']; }

    /* request numbers: the same rules as the Request Cycle Time tab */
    var RQ = REQUESTS_DATA;
    var measured = RQ.filter(function (r) { return r.durationHours !== null && r.durationHours !== undefined; });
    var bk = rqBuckets();
    var slow = measured.filter(function (r) { return r.durationHours >= 168; }).length;
    var pool = measured.length + bk.waiting.length + bk.missed.length;
    var accounted = pool ? Math.round((measured.length + bk.waiting.length) / pool * 100) : 0;

    /* platform numbers: the latest month, and the one before it */
    var PD = typeof PLATFORM_DATA !== 'undefined' ? PLATFORM_DATA : null;
    var months = (PD && PD.months) || [];
    var spendIdx = months.length - 1;
    // overall tool usage: the share of the platforms in the total that are used daily (usage level "High" in the sheet)
    function usageShare(M) {
      var hi = (M.byUsage.filter(function (u) { return u.level === 'High'; })[0] || { count: 0 }).count, tot = M.totals.toolCount;
      return { high: hi, total: tot, pct: tot ? Math.round(hi / tot * 100) : 0 };
    }
    var capKey = 'today', oooMode = 'weeks';

    /* forecaster numbers: the same rules as the Project Forecaster tab */
    var FC = (function () {
      var RT = typeof RT_RAW_TASKS !== 'undefined' ? RT_RAW_TASKS : (window.RT_RAW_TASKS || []);
      var pd = function (s) { return s ? new Date(s + 'T00:00:00') : null; };
      function clean(raw) {
        var s = raw.replace(/^\[Converted to project\]\s*/, '').trim();
        var parts = s.split(' | ').map(function (p) { return p.trim(); }).filter(function (p) { return p && !/^XCFP?-\d+$/.test(p) && !/^XCFT-\d+$/.test(p) && !/^\[no value\]$/.test(p) && !/^FY\d+\s*Q\d.*$/.test(p) && !/^20\d\d$/.test(p); });
        return parts[parts.length - 1] || s;
      }
      var P = RT.map(function (t) {
        var sub = t.subtasks || [];
        var f = function (fn) { return sub.find(function (s) { return fn(s.name.trim()) && s.due_on; }); };
        var prod = f(function (n) { return n === 'Production'; }), mkt = f(function (n) { return n === 'In Market'; }), brief = f(function (n) { return /project brief due/i.test(n); });
        var m = t.name.match(/XCFP?-\d+|XCFT-\d+/);
        return {
          name: t.pmName ? t.pmName.trim() : clean(t.name), code: m ? m[0] : '', completed: t.completed, dropped: t.dropped || false, regions: t.regions || [], projectStatus: t.projectStatus || null,
          production: prod ? { start: pd(prod.start_on) || pd(prod.due_on), end: pd(prod.due_on) } : null,
          inMarket: mkt ? { start: pd(mkt.start_on) || pd(mkt.due_on), end: pd(mkt.due_on) } : null,
          brief: brief ? pd(brief.due_on) : null
        };
      });
      function status(p) {
        if (p.completed) return 'completed';
        if (p.projectStatus === 'on_hold') return 'onhold';
        var inProd = p.production && p.production.start <= today0 && p.production.end >= today0;
        var inMkt = p.inMarket && p.inMarket.start <= today0 && p.inMarket.end >= today0;
        var upcoming = (p.production && p.production.start > today0) || (!p.production && p.inMarket && p.inMarket.start > today0);
        if (inProd) return 'active'; if (inMkt) return 'inmarket'; if (upcoming) return 'upcoming';
        if (!p.production && !p.inMarket) return 'upcoming'; return 'completed';
      }
      var EXCL = ['XCFP-105', 'XCFT-3189', 'XCFT-3192', 'XCFT-3190', 'XCFT-3194', 'XCFT-1329', 'XCFT-5451', 'XCFT-5454', 'XCFT-5684', 'XCFT-3191'];
      var cnt = { active: 0, upcoming: 0, inmarket: 0, onhold: 0 };
      P.forEach(function (p) { var s = status(p); if (cnt[s] !== undefined) cnt[s]++; });
      var start = function (p) { return p.production ? p.production.start : p.inMarket ? p.inMarket.start : 0; };
      var listed = P.filter(function (p) { return !p.dropped && EXCL.indexOf(p.code) < 0 && status(p) !== 'completed'; })
        .sort(function (a, b) { var o = { active: 0, upcoming: 1, inmarket: 2, onhold: 3 }; return (o[status(a)] - o[status(b)]) || (start(a) - start(b)); });
      var taskCount = {};
      MEM.forEach(function (m) { (m.tasks || []).forEach(function (t) { var c = t.proj && t.proj.match(/XCFP-\d+/); if (c) taskCount[c[0]] = (taskCount[c[0]] || 0) + 1; }); });
      return { P: P, status: status, cnt: cnt, listed: listed, taskCount: taskCount };
    })();

    /* ═════════════ Overview cards ═════════════ */
    function renderKpis() {
      var over = capCounts('today')[0];
      var cur = months[months.length - 1], prev = months.length > 1 ? months[months.length - 2] : null;
      var nm = MISSING_TASKS.length;
      // every top box has the same layout (label, big number, then the chart or chips), so the numbers line up across the row
      function k(id, label, num, sub, viz, more, go) {
        return '<div class="card kcard s3 clickable" id="' + id + '" data-go="' + go + '"><span class="lbl">' + label + '</span><div class="knum">' + num + (sub ? '<span class="t-small">' + sub + '</span>' : '') + '</div><div class="kviz">' + viz + '</div><div class="cardfoot">' + seeMore(more) + '</div></div>';
      }
      var use;
      if (cur) {
        var u = usageShare(cur), up = prev ? usageShare(prev) : null, chg = '';
        if (up) { var dp = u.pct - up.pct, pm = esc(prev.label.split(' ')[0]); chg = dp ? chip((dp > 0 ? '▲ Up' : '▼ Down') + ' from ' + up.pct + '% in ' + pm, dp > 0 ? 'mint' : 'gold') : chip('No change from ' + up.pct + '% in ' + pm, 'grey'); }
        use = k('k-use', 'Overall tool usage', '<span class="num" style="color:var(--mint-ink)">' + u.pct + '%</span>', u.high + ' of ' + u.total + ' tools used daily', '<div class="ringwrap" id="k5"></div>' + chg, 'usage', 'spend');
      } else {
        use = k('k-use', 'Overall tool usage', '<span class="num">–</span>', 'No platform data yet', '', 'usage', 'spend');
      }
      put('kpiGrid',
        k('k-cap', 'People over capacity', '<span class="num" style="color:var(--coral-ink)">' + over + '</span>', 'of ' + N + ' people', '<div class="ringwrap" id="k1"></div>', 'capacity', 'capacity') +
        k('k-briefs', 'Briefs in review (WIP)', '<span class="num" style="color:var(--blue-ink)">9</span>', '', chip('Waiting on review', 'blue') + '<span class="t-small">WIP coming soon</span>', 'briefs', 'forecaster') +
        k('k-miss', 'Tasks needing attention', '<span class="num" style="color:var(--gold-ink)">' + nm + '</span>', '', chip(nm ? 'Needs fixing' : 'All clear', nm ? 'gold' : 'mint') + '<span class="t-small">Left out of capacity until filled in</span>', 'missing', 'missing') +
        k('k-wait', 'Requests waiting over a week', '<span class="num" style="color:var(--coral-ink)">' + slow + '</span>', 'of ' + measured.length + ' tracked', '<div class="ringwrap" id="k3"></div>', 'cycle', 'cycle') +
        use +
        '<article class="card s12 acard" id="assets"></article>');
      mount($('#k1'), 84, 12, { v: [over], t: N, g: 0 }, ['var(--coral)'], '', over + ' of ' + N + ' people over capacity');
      mount($('#k3'), 84, 12, { v: [slow], t: Math.max(measured.length, 1), g: 0 }, ['var(--coral)'], '', slow + ' of ' + measured.length + ' tracked requests waited over a week');
      if (cur && $('#k5')) { var uu = usageShare(cur); mount($('#k5'), 84, 12, { v: [uu.high], t: Math.max(uu.total, 1), g: 0 }, ['var(--mint)'], '', uu.high + ' of ' + uu.total + ' tools used daily'); }
    }

    /* Assets delivered: copied from the mockup with its sample numbers (the report has no asset data yet) */
    var ASSETS = [['US', 96, 'var(--data1)'], ['UK', 64, 'var(--xero-blue)'], ['ANZ', 52, 'var(--mint)'], ['IM', 36, 'var(--purple)']];
    function renderAssets() {
      var tot = ASSETS.reduce(function (a, r) { return a + r[1]; }, 0);
      put('assets', head('Assets delivered this quarter (WIP)', '248 assets so far in FY27 Q3. The US delivers the most, at 38.7% of the total.', chip('WIP coming soon', 'grey')) +
        '<div class="assets"><div class="panel" style="align-items:center;justify-content:center"><h4>Global</h4><div class="ringwrap" id="assetRing"></div></div><div class="rtiles" id="assetTiles"></div></div><div class="cardfoot">' + seeMore('assets') + '</div>');
      mount($('#assetRing'), 150, 22, { v: ASSETS.map(function (r) { return r[1]; }), t: tot, g: 4 }, ASSETS.map(function (r) { return r[2]; }), '<span class="num" style="font-size:44px">' + tot + '</span><span class="t-small">assets</span>', 'Assets delivered by region');
      $('#assetTiles').innerHTML = ASSETS.map(function (r) {
        var p = (r[1] / tot * 100).toFixed(1);
        return '<div class="rtile"><h4><i class="dot" style="background:' + r[2] + '"></i>' + r[0] + '</h4><span class="num">' + r[1] + '</span><span class="t-small">' + p + '% of global</span><span class="bar"><i style="width:' + p + '%;background:' + r[2] + '"></i></span></div>';
      }).join('');
    }

    /* ═════════════ People and capacity ═════════════ */
    function renderCapacity() {
      put('capacity', head('Team capacity', '<span id="capSub"></span>',
        '<div class="seg" id="range" role="group" aria-label="Time range"><button type="button" aria-pressed="true" data-r="today">Today</button><button type="button" aria-pressed="false" data-r="week">Next 7 days</button><button type="button" aria-pressed="false" data-r="month">Next month</button></div>') +
        '<div class="capbody"><div class="ringwrap" id="capRing"></div><ul class="legend" id="capLegend"></ul></div><p class="t-small cf" id="rangeNote"></p><div class="cardfoot">' + seeMore('capacity') + '</div>');
      var counts = { today: capCounts('today'), week: capCounts('week'), month: capCounts('month') };
      var SUB = {
        today: ['At or above the daily cap', 'Between 1h booked and the cap', 'Under 1h booked', 'Away'],
        week: ['At or above the weekly cap', 'Between half and full', 'Under half booked', 'Away'],
        month: ['At or above the monthly cap', 'Between half and full', 'Under half booked', 'Away']
      };
      var meta = [['Over capacity', 'var(--coral)'], ['Under capacity', 'var(--gold)'], ['Available', 'var(--mint)'], ['Out of office', 'var(--purple)']];
      var api = mount($('#capRing'), 240, 32, { v: counts.today, t: N, g: 5 }, meta.map(function (m) { return m[1]; }),
        '<span class="num" style="font-size:72px">' + N + '</span><span class="t-small">people</span>', 'Team capacity split');
      function paint(k) {
        capKey = k;
        $('#capLegend').innerHTML = meta.map(function (m, i) {
          return '<li><i class="dot" style="background:' + m[1] + '"></i><span class="lt"><b>' + m[0] + '</b><span class="t-small">' + SUB[k][i] + '</span></span><span class="num">' + counts[k][i] + '</span></li>';
        }).join('');
        var dl = window._dlabels || {};
        $('#rangeNote').textContent = (dl[k] || k) + '. Counts incomplete tasks only, so it shows work still to do.';
        $('#capSub').textContent = counts[k][0] + ' of ' + N + ' people are booked at or past their ' + (k === 'today' ? 'daily' : k === 'week' ? 'weekly' : 'monthly') + ' limit.';
      }
      paint('today');
      $$('#range button').forEach(function (b) {
        b.addEventListener('click', function () {
          $$('#range button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          paint(b.dataset.r); api.set(counts[b.dataset.r], N, 5);
        });
      });
    }

    function renderOver() {
      var all = MEM.filter(function (m) { return !m.ooo; }).map(function (m) { return { m: m, f: m.today / capOf(m) }; })
        .sort(function (a, b) { return b.f - a.f; }), PER = 5;
      var overN = capCounts('today')[0];
      put('over', head('Most over capacity', 'Hours booked today against each person’s daily cap') + '<ul class="ppl" id="overList"></ul>' +
        '<div class="cardfoot">' + pagerHTML('overPg') + '<button class="link" type="button" data-more="capacity" data-preset="over">See all ' + overN + ' ' + (overN === 1 ? 'person' : 'people') + '</button>' + seeMore('capacity', 'over') + '</div>');
      function draw(start) {
        var ul = $('#overList'); ul.innerHTML = '';
        all.slice(start, start + PER).forEach(function (r) {
          var pct = Math.round(r.f * 100), col = pct >= 100 ? 'var(--coral)' : pct >= 50 ? 'var(--gold)' : 'var(--mint)';
          var li = document.createElement('li');
          li.appendChild(gauge(pct, 56, 7, col, '<b style="font-size:13px">' + pct + '%</b>'));
          var w = document.createElement('div'); w.className = 'who'; w.innerHTML = '<b>' + esc(r.m.name) + '</b><span class="t-small">' + esc(r.m.pod) + '</span>'; li.appendChild(w);
          var h = document.createElement('div'); h.className = 'hrs'; h.innerHTML = r.m.today.toFixed(1) + 'h<span>' + plural(r.m.tasks.length, 'task') + '</span>'; li.appendChild(h);
          ul.appendChild(li);
        });
      }
      var pg = pager('overPg', PER, function () { return all.length; }, draw, 'people');
      draw(0); pg.paint();
    }

    var SHOW_PODS = 4;
    function podInfo() {
      var info = [];
      PODS.forEach(function (pod) {
        var ms = MEM.filter(function (m) { return m.pod === pod; }); if (!ms.length) return;
        var h = ms.reduce(function (s, m) { return s + m.today; }, 0);
        var cap = ms.filter(function (m) { return !m.ooo; }).reduce(function (s, m) { return s + capOf(m); }, 0);
        info.push({ pod: pod, ms: ms, h: h, cap: cap, pct: cap ? Math.round(h / cap * 100) : 0 });
      });
      return info;
    }
    function renderPods() {
      var info = podInfo();
      var by = { over: [], near: [], room: [] };
      info.forEach(function (p) { (p.pct > 100 ? by.over : p.pct >= 85 ? by.near : by.room).push(p.pod); });
      var parts = [];
      if (by.over.length) parts.push(by.over.join(', ') + (by.over.length > 1 ? ' are' : ' is') + ' over capacity');
      if (by.near.length) parts.push(by.near.join(', ') + (by.near.length > 1 ? ' are' : ' is') + ' nearly full');
      if (by.room.length) parts.push(by.room.join(', ') + (by.room.length > 1 ? ' have' : ' has') + ' room');
      put('pods', head('Pod summary', esc(parts.join('; ')) + '.',
        '<div class="pills">' + chip('Over 100%', 'coral') + chip('85% or more', 'mint') + chip('Under 85%', 'gold') + '</div>') +
        '<div class="pods car" id="podGrid"></div><div class="cardfoot">' + pagerHTML('podPg') + '<span class="t-small">Pod capacity is each person’s daily cap, for people who are working today.</span>' + seeMore('pods') + '</div>');
      info.forEach(function (p) {
        var s = st(p.pct), d = document.createElement('div'); d.className = 'pod';
        d.innerHTML = '<div class="ph"><i class="dot" style="background:' + podDot(p.pod) + '"></i><h4>' + esc(p.pod) + '</h4><span class="t-small">' + plural(p.ms.length, 'member') + '</span></div>';
        var pr = document.createElement('div'); pr.className = 'pr';
        pr.appendChild(gauge(p.pct, 104, 13, s[1], '<span class="num" style="font-size:30px">' + p.pct + '%</span>'));
        var inf = document.createElement('div');
        inf.innerHTML = '<div class="num">' + p.h.toFixed(1) + 'h</div><div class="t-small">of ' + (Math.round(p.cap * 10) / 10) + 'h available</div>' + chip(s[2], s[0], 'margin-top:8px'); pr.appendChild(inf); d.appendChild(pr);
        var gaps = p.ms.filter(function (m) { return CAPACITY_GAP_MEMBERS.has(m.name); }).length;
        if (gaps) d.appendChild(Object.assign(document.createElement('span'), { className: 'chip mint', style: 'align-self:flex-start', textContent: plural(gaps, 'person', 'people') + ' free for incoming micros' }));
        var ul = document.createElement('ul'); ul.className = 'mem';
        var sorted = p.ms.slice().sort(function (a, b) { return b.today - a.today; });
        sorted.slice(0, 3).forEach(function (m) {
          var li = document.createElement('li');
          if (m.ooo) { li.className = 'ooo'; li.innerHTML = '<span class="n">' + esc(m.name) + '</span><span></span><span class="chip grey" style="justify-self:end;font-size:13px;padding:1px 8px">Away</span>'; }
          else { var pc = Math.round(m.today / capOf(m) * 100); li.innerHTML = '<span class="n">' + esc(m.name) + '</span><span class="bar"><i style="width:' + Math.min(pc, 100) + '%;background:' + st(pc)[1] + '"></i></span><span class="h">' + m.today.toFixed(1) + 'h</span>'; }
          ul.appendChild(li);
        });
        if (sorted.length > 3) { var li = document.createElement('li'); li.style.gridTemplateColumns = '1fr'; li.innerHTML = '<button class="link" type="button" data-more="pods">+' + (sorted.length - 3) + ' more</button>'; ul.appendChild(li); }
        d.appendChild(ul); $('#podGrid').appendChild(d);
      });
      carousel('podGrid', 'podPg', 'pods');
    }

    var SHOW_PMS = 2;
    function pmFacts(pm) {
      var active = pm.projects.filter(function (p) { return p.pct === null || p.pct < 100; });
      return {
        active: active,
        roadmap: active.filter(function (p) { return p.projectType === 'Roadmap'; }),
        micro: active.filter(function (p) { return p.projectType === 'Micro (BAU)' || !p.projectType; }),
        init: active.filter(function (p) { return p.projectType === 'XCF initiative'; })
      };
    }
    function renderPM() {
      put('pmteam', head('PM team', 'Capacity booked today and what each PM is carrying') + '<div class="two car" id="pmGrid"></div><div class="cardfoot">' + pagerHTML('pmPg') + seeMore('pmteam') + '</div>');
      var mixC = ['var(--data1)', 'var(--mint)', 'var(--gold)'], mixN = ['roadmap', 'micro/BAU', 'initiative'];
      PM_DATA.forEach(function (pm) {
        var f = pmFacts(pm), mix = [f.roadmap.length, f.micro.length, f.init.length];
        var top = f.active.filter(function (p) { return p.pct !== null; }).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 2);
        var pct = Math.round(pm.today / 6 * 100);
        var d = document.createElement('div'); d.className = 'pod';
        d.innerHTML = '<div class="ph"><span class="av">' + esc(initials(pm.name)) + '</span><h4>' + esc(pm.name) + '</h4></div>';
        var pr = document.createElement('div'); pr.className = 'pr';
        pr.appendChild(gauge(pct, 88, 11, pct > 100 ? 'var(--coral)' : pct >= 85 ? 'var(--mint)' : 'var(--xero-blue)', '<span class="num" style="font-size:26px">' + pct + '%</span>'));
        var i = document.createElement('div');
        i.innerHTML = '<div class="t-small">Booked today</div><div class="num" style="font-size:36px">' + pm.today + 'h</div><div class="t-small">7 days ' + pm.week + 'h · month ' + pm.month + 'h</div>'; pr.appendChild(i); d.appendChild(pr);
        var s = document.createElement('div');
        s.innerHTML = '<div class="stack">' + mix.map(function (v, k) { return v ? '<i style="flex:' + v + ';background:' + mixC[k] + '"></i>' : ''; }).join('') + '</div><div class="t-small" style="margin-top:8px">' + mix.map(function (v, k) { return v + ' ' + mixN[k]; }).join(' · ') + '</div>'; d.appendChild(s);
        if (top.length) {
          var ul = document.createElement('ul'); ul.className = 'mem';
          var hd = document.createElement('li'); hd.style.gridTemplateColumns = '1fr'; hd.innerHTML = '<b style="font-size:15px">Closest to done</b>'; ul.appendChild(hd);
          top.forEach(function (t) { var li = document.createElement('li'); li.style.gridTemplateColumns = 'minmax(0,1fr) 52px 44px'; li.innerHTML = '<span class="n" title="' + esc(t.name) + '">' + esc(pretty(t.name)) + '</span><span class="bar"><i style="width:' + t.pct + '%;background:var(--mint)"></i></span><span class="h">' + t.pct + '%</span>'; ul.appendChild(li); });
          d.appendChild(ul);
        }
        $('#pmGrid').appendChild(d);
      });
      carousel('pmGrid', 'pmPg', 'PMs');
    }

    var SHOW_OOO = 4;
    function oooWindow() {
      var entries = (OOO_DATA || []).filter(function (e) { return !e.stub && e.start && e.end; });
      var podOf = {}; MEM.forEach(function (m) { podOf[m.name] = m.pod; });
      var start, D, labels;
      if (oooMode === 'weeks') { start = new Date(today0.getTime() - 28 * DAY); D = 91; labels = [0, 28, 56, 84].map(function (d) { return [d, fmtDay(new Date(start.getTime() + d * DAY))]; }); }
      else { start = new Date(today0.getFullYear(), today0.getMonth() - 1, 1); var end = new Date(start.getFullYear(), start.getMonth() + 12, 1); D = Math.round((end - start) / DAY); labels = [0, 3, 6, 9].map(function (m) { var dt = new Date(start.getFullYear(), start.getMonth() + m, 1); return [Math.round((dt - start) / DAY), dt.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })]; }); }
      var startT = start.getTime(), endT = startT + D * DAY, byName = {};
      entries.forEach(function (e) {
        var s = new Date(e.start + 'T00:00:00').getTime(), f = new Date(e.end + 'T00:00:00').getTime() + DAY;
        if (f < startT || s > endT) return;
        (byName[e.name] = byName[e.name] || { name: e.name, pod: podOf[e.name] || e.pod, first: s, bars: [] });
        byName[e.name].first = Math.min(byName[e.name].first, s); byName[e.name].bars.push([s, f, e]);
      });
      var rows = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (a, b) { return a.first - b.first; });
      return { entries: entries, podOf: podOf, startT: startT, endT: endT, D: D, labels: labels, rows: rows };
    }
    function oooBars(r, W, col) {
      return r.bars.map(function (b) {
        var l = Math.max(0, (b[0] - W.startT) / DAY) / W.D * 100, w = (Math.min(W.endT, b[1]) - Math.max(W.startT, b[0])) / DAY / W.D * 100;
        return '<div class="bw" style="left:' + l + '%;width:' + w + '%;background:' + col + '" title="' + esc(fmtDayY(new Date(b[0])) + ' – ' + fmtDayY(new Date(b[1] - DAY))) + '"></div>';
      }).join('');
    }
    function renderOOO() {
      var pg;
      function paint() {
        var W = oooWindow(), start = pg ? pg.start() : 0, shown = W.rows.slice(start, start + SHOW_OOO);
        var ax = '<div></div><div class="ax">' + W.labels.map(function (l) { return '<span style="left:' + (l[0] / W.D * 100) + '%">' + esc(l[1]) + '</span>'; }).join('') + '</div>';
        var np = (today0.getTime() - W.startT) / DAY / W.D * 100;
        var body = shown.map(function (r) { var col = podDot(r.pod); return '<div class="lab"><i class="dot" style="background:' + col + '"></i>' + esc(r.name) + '</div><div class="trk"><div class="today" style="left:' + np + '%"></div>' + oooBars(r, W, col) + '</div>'; }).join('');
        var pods = {}; shown.forEach(function (r) { pods[r.pod] = 1; });
        $('#oooTl').innerHTML = W.rows.length ? ax + body : '<div style="grid-column:1/-1" class="t-sub">Nobody has time off booked in this window.</div>';
        $('#oooKey').innerHTML = Object.keys(pods).map(function (p) { return '<span class="chip grey"><i class="dot" style="background:' + podDot(p) + ';width:10px;height:10px"></i>' + esc(p) + '</span>'; }).join('') + '<span class="t-small">Dark line is today</span>';
        if (pg) pg.paint();
      }
      put('ooo', head('Out of office', 'Leave by person, from Asana',
        '<div class="seg" role="group" aria-label="Scale"><button type="button" aria-pressed="true" data-s="weeks">Weeks</button><button type="button" aria-pressed="false" data-s="months">Months</button></div>') +
        '<div class="tl" id="oooTl"></div><div class="pills cf" id="oooKey"></div><div class="cardfoot">' + pagerHTML('oooPg') + seeMore('ooo') + '</div>');
      pg = pager('oooPg', SHOW_OOO, function () { return oooWindow().rows.length; }, function () { paint(); }, 'people');
      paint();
      $$('#ooo .seg button').forEach(function (b) { b.addEventListener('click', function () { $$('#ooo .seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); oooMode = b.dataset.s; pg.reset(); paint(); }); });
    }

    /* ═════════════ Work in flight ═════════════ */
    var FC_LAB = { active: ['In production', 'purple'], upcoming: ['Upcoming', 'gold'], inmarket: ['In market', 'mint'], onhold: ['On hold', 'grey'] };
    var FC_PS = { on_track: ['On track', 'mint'], at_risk: ['At risk', 'gold'], off_track: ['Off track', 'coral'], on_hold: ['On hold', 'grey'] };
    function renderForecaster() {
      var cnt = FC.cnt, listed = FC.listed, status = FC.status, SHOW = 6, filter = 'all';
      var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var w0 = new Date(today0.getFullYear(), today0.getMonth() - 5, 1), w1 = new Date(w0.getFullYear(), w0.getMonth() + 11, 1), WT = w1 - w0;
      var pos = function (d) { return Math.max(0, Math.min(100, (d - w0) / WT * 100)); };
      var pe = function (d) { return pos(new Date(d.getTime() + DAY)); };
      put('forecaster', head('Project forecaster', '<span id="fcSub"></span>',
        '<div class="seg" id="fcSeg" role="group" aria-label="Show"><button type="button" aria-pressed="true" data-f="all">All</button><button type="button" aria-pressed="false" data-f="active">In production</button><button type="button" aria-pressed="false" data-f="upcoming">Upcoming</button><button type="button" aria-pressed="false" data-f="inmarket">In market</button></div>') +
        '<div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div class="kpi"><span class="num" style="color:var(--purple-ink)">' + cnt.active + '</span><span class="lbl">In production</span></div><div class="kpi"><span class="num" style="color:var(--gold-ink)">' + cnt.upcoming + '</span><span class="lbl">Upcoming</span></div><div class="kpi"><span class="num" style="color:var(--mint-ink)">' + cnt.inmarket + '</span><span class="lbl">In market</span></div><div class="kpi"><span class="num" style="color:var(--muted)">' + cnt.onhold + '</span><span class="lbl">On hold</span></div></div>' +
        '<div class="gscroll"><div id="gantt"></div></div>' +
        '<div class="pills">' + chip('Production', 'purple') + chip('In market', 'mint') + chip('◆ Project brief due', 'gold') + '<span class="t-small" id="fcNote"></span></div><div class="cardfoot">' + pagerHTML('fcPg') + seeMore('forecaster') + '</div>');
      $('#fcSub').textContent = plural(cnt.active, 'project is', 'projects are') + ' in production. ' + (cnt.inmarket === 1 ? 'Only 1 is' : cnt.inmarket + ' are') + ' in market so far.';
      function paint() {
        var rows = listed.filter(function (p) { return filter === 'all' || status(p) === filter; });
        var gh = '<div class="gt"><div></div><div class="months">' + Array.apply(null, Array(11)).map(function (_, i) { var d = new Date(w0.getFullYear(), w0.getMonth() + i, 1); var now = d.getFullYear() === today0.getFullYear() && d.getMonth() === today0.getMonth(); return '<span class="' + (now ? 'now' : '') + '">' + MN[d.getMonth()] + (i === 0 || d.getMonth() === 0 ? ' ’' + String(d.getFullYear()).slice(2) : '') + '</span>'; }).join('') + '</div>';
        var np = pos(today0);
        rows.slice(pg.start(), pg.start() + SHOW).forEach(function (p) {
          var s = status(p), l = FC_LAB[s] || ['', 'grey'], ps = FC_PS[p.projectStatus];
          var reg = p.regions.length ? chip(esc(p.regions[0]) + (p.regions.length > 1 ? ' +' + (p.regions.length - 1) : ''), 'grey') : '';
          gh += '<div class="gl"><b>' + esc(p.code && p.name.indexOf(p.code) < 0 ? p.code + ': ' + p.name : p.name) + '</b><div class="tags">' + chip(l[0], l[1]) + (ps ? chip(ps[0], ps[1]) : '') + reg + '</div></div><div class="gr"><div class="today" style="left:' + np + '%;top:0;bottom:0"></div>';
          if (p.production && p.production.end >= w0 && p.production.start < w1) gh += '<div class="gb prod" style="left:' + pos(p.production.start) + '%;width:' + Math.max(0.6, pe(p.production.end) - pos(p.production.start)) + '%;top:14px">Production</div>';
          if (p.inMarket && p.inMarket.end >= w0 && p.inMarket.start < w1) gh += '<div class="gb mkt" style="left:' + pos(p.inMarket.start) + '%;width:' + Math.max(0.6, pe(p.inMarket.end) - pos(p.inMarket.start)) + '%;top:50px">' + esc(fmtDay(p.inMarket.start) + ' – ' + fmtDay(p.inMarket.end)) + '</div>';
          if (p.brief && p.brief >= w0 && p.brief < w1) gh += '<span style="position:absolute;left:' + pos(p.brief) + '%;top:16px;width:16px;height:16px;background:var(--gold);transform:rotate(45deg);border-radius:3px" title="Project brief due ' + esc(fmtDayY(p.brief)) + '"></span>';
          gh += '</div>';
        });
        $('#gantt').innerHTML = rows.length ? gh + '</div>' : '<p class="t-sub">No projects match this filter.</p>';
        $('#fcNote').textContent = 'Dark line is today'; pg.paint();
      }
      var pg = pager('fcPg', SHOW, function () { return listed.filter(function (p) { return filter === 'all' || status(p) === filter; }).length; }, function () { paint(); }, 'projects');
      paint();
      $$('#fcSeg button').forEach(function (b) { b.addEventListener('click', function () { $$('#fcSeg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); filter = b.dataset.f; pg.reset(); paint(); }); });
    }

    function missingGroups() {
      var by = {}, order = [];
      MISSING_TASKS.forEach(function (t) { var k = t.missing || 'Other'; if (!by[k]) { by[k] = 0; order.push(k); } by[k]++; });
      order.sort(function (a, b) { return by[b] - by[a]; });
      return { by: by, order: order };
    }
    function renderMissing() {
      var G = missingGroups(), by = G.by, order = G.order, total = MISSING_TASKS.length;
      var cols = ['var(--data1)', 'var(--gold)', 'var(--purple)', 'var(--coral)', 'var(--mint)'];
      put('missing', head('Tasks needing attention', 'What is blocking planning', chip('By what is missing', 'grey')) +
        '<div class="miss"><div class="ringwrap" id="missRing"></div><ul id="missList"></ul></div><div class="cardfoot"><button class="link" type="button" data-more="missing">See the ' + plural(total, 'task') + '</button>' + seeMore('missing') + '</div>');
      if (!total) { $('#missRing').outerHTML = ''; $('#missList').innerHTML = '<li>' + chip('All clear', 'mint') + '</li>'; return; }
      mount($('#missRing'), 150, 20, { v: order.map(function (k) { return by[k]; }), t: total, g: 4 }, order.map(function (k, i) { return cols[i % cols.length]; }),
        '<span class="num" style="font-size:48px">' + total + '</span><span class="t-small">tasks</span>', 'Tasks needing attention by what is missing');
      $('#missList').innerHTML = order.map(function (k, i) { return '<li><i class="dot" style="background:' + cols[i % cols.length] + '"></i>' + esc(k) + '<b>' + by[k] + '</b></li>'; }).join('');
    }

    function scopeSets() {
      var D = SCOPE_CREEP_DATA || [];
      var by = function (s) { return D.filter(function (t) { return t.status === s; }); };
      return { all: D, sc: by('Scope Creep'), scDone: by('Completed Scope Creep'), faa: by('FAA'), faaDone: by('Completed FAA') };
    }
    var hrsOf = function (a) { return Math.round(a.reduce(function (s, t) { return s + (t.estHours || 0); }, 0) * 10) / 10; };
    function renderScope() {
      var S = scopeSets(), sc = S.sc, faa = S.faa, open = sc.concat(faa), PER = 3;
      put('scope', head('Scope creep and FAA', 'Changes after approval') +
        '<div class="kv"><div class="stat"><span class="num" style="color:' + (sc.length ? 'var(--coral-ink)' : 'var(--mint-ink)') + '">' + sc.length + '</span><span class="lbl">Scope creep</span>' + chip(sc.length ? hrsOf(sc) + 'h estimated' : 'All clear', sc.length ? 'coral' : 'mint', 'margin-top:8px') + '</div>' +
        '<div class="stat"><span class="num" style="color:' + (faa.length ? 'var(--gold-ink)' : 'var(--mint-ink)') + '">' + faa.length + '</span><span class="lbl">Feedback after approval</span>' + chip(faa.length ? hrsOf(faa) + 'h estimated' : 'All clear', faa.length ? 'gold' : 'mint', 'margin-top:8px') + '</div></div>' +
        '<div id="scList" style="display:flex;flex-direction:column;gap:12px"></div><div class="cardfoot">' + pagerHTML('scPg') + seeMore('scope') + '</div>');
      function draw(start) {
        $('#scList').innerHTML = open.slice(start, start + PER).map(function (t) {
          return '<div class="task">' + chip(t.status === 'FAA' ? 'FAA' : 'Scope creep', t.status === 'FAA' ? 'gold' : 'coral') + '<div class="tt"><b>' + (t.url ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener" style="text-decoration:none">' + esc(t.name) + '</a>' : esc(t.name)) + '</b><span class="t-small">' + esc([t.parent, t.assignee].filter(Boolean).join(' · ')) + '</span></div><b>' + (t.estHours ? Math.round(t.estHours * 10) / 10 + 'h' : '') + '</b></div>';
        }).join('');
      }
      var pg = pager('scPg', PER, function () { return open.length; }, draw, 'tasks');
      draw(0); pg.paint();
    }

    function cleanUpdate(text) {
      var t = String(text || '').replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<https?:[^>]+>/g, '').replace(/<@[^>]+>/g, '@someone').replace(/<![^>]+>/g, '').replace(/:[a-z0-9_+-]+:/g, '').replace(/[*_~`]/g, '').replace(/[━─]+/g, '');
      return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    function updState(text) { var t = String(text || ''); if (/large_green_circle|On Track/i.test(t)) return ['On track', 'mint']; if (/large_yellow_circle|At Risk/i.test(t)) return ['At risk', 'gold']; if (/red_circle|Off Track/i.test(t)) return ['Off track', 'coral']; return null; }
    function updWhen(m) { return new Date(m.timestamp).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' }); }
    function updPod(m) { var x = (String(m.text).match(/WEEKLY UPDATE\s*[—-]\s*([^_\n]+)/i) || [])[1]; return x ? x.trim() : ''; }
    function renderUpdates() {
      var U = PM_UPDATES_DATA || [], weeks = U.slice(0, 3), sel = 0, PER = 1, pg;
      function excerpt(text) {
        var t = cleanUpdate(text), i = t.search(/Update:/i), body = i >= 0 ? t.slice(i + 7) : t.split('\n').slice(1).join(' ');
        body = body.replace(/\s+/g, ' ').replace(/•/g, '').trim();
        return body.length > 420 ? body.slice(0, 417).replace(/\s+\S*$/, '') + '…' : body;
      }
      function weekMsgs() { return ((weeks[sel] || {}).messages || []).slice().sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); }); }
      put('updates', head('PM updates', 'Weekly notes from the PM team') + '<div class="seg" id="updSeg" style="align-self:flex-start"></div>' + pagerHTML('updPg') + '<ul class="upd" id="updList"></ul><div class="cardfoot">' + seeMore('updates') + '</div>');
      function paint() {
        $('#updSeg').innerHTML = weeks.map(function (w, i) { return '<button type="button" aria-pressed="' + (i === sel) + '" data-w="' + i + '">' + esc(w.weekLabel) + '</button>'; }).join('');
        $$('#updSeg button').forEach(function (b) { b.addEventListener('click', function () { sel = +b.dataset.w; pg.reset(); paint(); }); });
        var msgs = weekMsgs().slice(pg.start(), pg.start() + PER);
        $('#updList').innerHTML = msgs.length ? msgs.map(function (m) {
          var s = updState(m.text), pod = updPod(m);
          return '<li><div class="uh"><span class="av">' + esc(initials(m.name)) + '</span><div><b>' + esc(m.name) + '</b><span class="t-small">' + esc((pod ? pod + ' · ' : '') + updWhen(m)) + '</span></div>' + (s ? chip(s[0], s[1], 'margin-left:auto') : '') + '</div><p>' + esc(excerpt(m.text)) + '</p></li>';
        }).join('') : '<li><p class="t-sub">No updates yet.</p></li>';
        pg.paint();
      }
      pg = pager('updPg', PER, function () { return weekMsgs().length; }, function () { paint(); }, 'updates', function (a, b, t) { return 'PM update ' + a + ' of ' + t; });
      if (!weeks.length) { $('#updSeg').remove(); }
      paint();
    }

    /* ═════════════ Speed and spend ═════════════ */
    var median = function (a) { return rqMedian(a); };
    function cycleFacts() {
      var byCause = {};
      RQ.filter(function (r) { return r.durationHours !== null && r.cause; }).forEach(function (r) { (byCause[r.cause] = byCause[r.cause] || []).push(r.durationHours); });
      var causes = Object.keys(byCause).map(function (k) { return [k, median(byCause[k]) / 24, byCause[k].length]; }).sort(function (a, b) { return b[1] - a[1]; });
      function group(keyFn, order) {
        var g = {}; measured.forEach(function (r) { var k = keyFn(r) || 'Unset'; (g[k] = g[k] || []).push(r.durationHours); });
        var keys = Object.keys(g); keys.sort(function (a, b) { var ia = order ? order.indexOf(a) : -1, ib = order ? order.indexOf(b) : -1; return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
        return keys.map(function (k) { return [k, median(g[k]) / 24, g[k].length]; });
      }
      var byQ = group(function (r) { return r.quarter; });
      var byT = group(function (r) { return r.projectType; }, ['Roadmap', 'Micro (BAU)', 'XCF initiative', 'Unset']);
      var longest = measured.slice().sort(function (a, b) { return b.durationHours - a.durationHours; });
      return { causes: causes, byQ: byQ, byT: byT, longest: longest };
    }
    function renderCycle() {
      var F = cycleFacts(), causes = F.causes, byQ = F.byQ;
      var spread = [['Same day', 0, 24, 'var(--xero-blue)', 1], ['1–3 days', 24, 72, 'var(--mint)', 1], ['3–7 days', 72, 168, 'var(--gold)', 1], ['1–2 weeks', 168, 336, 'var(--coral)', .55], ['2–4 weeks', 336, 672, 'var(--coral)', .8], ['Over a month', 672, Infinity, 'var(--coral)', 1]]
        .map(function (b) { return { l: b[0], n: measured.filter(function (r) { return r.durationHours >= b[1] && r.durationHours < b[2]; }).length, c: b[3], o: b[4] }; });
      var mx = Math.max.apply(null, spread.map(function (b) { return b.n; }).concat(1));
      var cmax = Math.max.apply(null, causes.map(function (c) { return c[1]; }).concat(1));
      var lastQ = byQ.length ? byQ[byQ.length - 1] : null, prevQ = byQ.length > 1 ? byQ[byQ.length - 2] : null, longest = F.longest[0];
      var cl = [['Measured', measured.length, 'var(--xero-blue)'], ['Awaiting', bk.waiting.length, 'var(--gold)'], ['Missed', bk.missed.length, 'var(--muted)'], ['Cancelled', bk.cancelled.length, 'var(--track)']];
      put('cycle', head('Request cycle time', esc(slow + ' of ' + measured.length + ' tracked requests waited over a week.'), chip('Since 1 Jul 2026 (FY27 Q2)', 'grey')) +
        '<div class="cyc"><div class="panel"><h4>Requests accounted for</h4><div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"><div class="ringwrap" id="cycRing"></div><ul class="lg" style="flex:1;min-width:150px" id="cycLegend"></ul></div></div>' +
        '<div class="panel"><h4>How long requests waited</h4><div class="hist" id="hist"></div><div class="brk"><span>' + slow + ' waited over a week</span></div></div>' +
        '<div class="panel"><h4>Where the wait comes from</h4><ul class="cause" id="cause"></ul><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="t-small">Mid-point wait in days</span>' + pagerHTML('causePg') + '</div></div></div>' +
        '<div class="two"><div class="panel" style="flex-direction:row;align-items:center;gap:20px"><span class="num" style="font-size:56px;color:var(--mint-ink)">' + (lastQ ? lastQ[1].toFixed(1) + 'd' : '–') + '</span><div><b style="font-size:17px">Mid-point wait, ' + esc(lastQ ? lastQ[0] : '') + '</b><div class="t-small">' + (prevQ ? (lastQ[1] < prevQ[1] ? 'Down' : lastQ[1] > prevQ[1] ? 'Up' : 'Level') + ' from ' + prevQ[1].toFixed(1) + ' days in ' + esc(prevQ[0]) : '') + '</div></div></div>' +
        '<div class="panel" style="flex-direction:row;align-items:center;gap:20px"><span class="num" style="font-size:56px;color:var(--coral-ink)">' + (longest ? (longest.durationHours / 24).toFixed(1) + 'd' : '–') + '</span><div><b style="font-size:17px">Longest measured wait</b><div class="t-small">' + (longest ? esc(longest.name) : '') + '</div></div></div></div>' +
        '<div class="cardfoot"><button class="link" type="button" data-more="cycle">See the longest waits</button>' + seeMore('cycle') + '</div>');
      mount($('#cycRing'), 160, 22, { v: [measured.length, bk.waiting.length, bk.missed.length], t: Math.max(pool, 1), g: 4 }, ['var(--xero-blue)', 'var(--gold)', 'var(--muted)'],
        '<span class="num" style="font-size:52px;color:var(--blue-ink)">' + accounted + '%</span>', 'Share of requests accounted for');
      $('#cycLegend').innerHTML = cl.map(function (c) { return '<li><i class="dot" style="background:' + c[2] + '"></i><span>' + c[0] + '</span><b>' + c[1] + '</b></li>'; }).join('');
      $('#hist').innerHTML = spread.map(function (h) { return '<div><b>' + h.n + '</b><i style="height:' + Math.max(3, h.n / mx * 110) + 'px;background:' + h.c + ';opacity:' + h.o + '"></i>' + h.l + '</div>'; }).join('');
      function drawCauses(start) {
        $('#cause').innerHTML = causes.length ? causes.slice(start, start + 6).map(function (c) { var col = c[1] >= 20 ? 'var(--coral)' : 'var(--gold)'; return '<li><span>' + esc(c[0]) + '</span><span class="bar"><i style="width:' + (c[1] / cmax * 100) + '%;background:' + col + '"></i></span><b>' + c[1].toFixed(1) + 'd</b></li>'; }).join('') : '<li class="t-sub">No causes tagged yet.</li>';
      }
      var cpg = pager('causePg', 6, function () { return causes.length; }, drawCauses, 'causes');
      drawCauses(0); cpg.paint();
    }

    function renderSpend() {
      if (!months.length) { put('spend', head('Platform spend and usage', 'No platform data yet.') + '<div class="cardfoot">' + seeMore('spend') + '</div>'); return; }
      var COLS = ['var(--data1)', 'var(--xero-blue)', 'var(--mint)', 'var(--gold)', 'var(--coral)', 'var(--purple)'];
      var UCOL = { High: 'var(--data1)', Medium: 'var(--xero-blue)', Low: 'var(--gold)', 'New tool': 'var(--purple)' };
      function paint() {
        var M = months[spendIdx], T = M.totals, prev = spendIdx > 0 ? months[spendIdx - 1] : null;
        var d = prev ? T.total - prev.totals.total : 0, p = prev && prev.totals.total ? Math.abs(d / prev.totals.total * 100) : 0;
        var chg = prev && Math.round(d * 100) !== 0 ? chip((d > 0 ? '▲ ' : '▼ ') + pltMoney(Math.abs(d)) + ' vs ' + esc(prev.label.split(' ')[0]), d > 0 ? 'gold' : 'mint', 'align-self:flex-start') : '';
        var sub = 'Annual cost in NZD.' + (prev && Math.round(d * 100) !== 0 ? ' Spend is ' + (d > 0 ? 'up ' : 'down ') + p.toFixed(1) + '% since ' + prev.label.split(' ')[0] + '.' : '');
        var rows = M.rows.filter(function (r) { return r.inTotal; }).slice().sort(function (a, b) { return b.annual - a.annual; });
        var top = rows.slice(0, 6), rest = rows.slice(6), restSum = rest.reduce(function (s, r) { return s + r.annual; }, 0);
        var plat = top.map(function (r, i) { return [r.tool, r.annual, COLS[i % COLS.length]]; });
        if (rest.length) plat.push(['Other ' + rest.length, restSum, 'var(--track)']);
        var maxT = Math.max.apply(null, months.map(function (m) { return m.totals.total; }).concat(1));
        var low = (M.byUsage.filter(function (u) { return u.level === 'Low'; })[0]) || { total: 0, tools: [] };
        var useRows = M.byUsage.filter(function (u) { return u.total > 0; });
        var meaning = {}; ((PD && PD.usageKey) || []).forEach(function (k) { meaning[k.level] = k.meaning; });
        put('spend', head('Platform spend and usage', esc(sub), '<div class="seg" id="spSeg" role="group" aria-label="Month">' + months.slice().reverse().map(function (m) { var i = months.indexOf(m); return '<button type="button" aria-pressed="' + (i === spendIdx) + '" data-i="' + i + '">' + esc(m.label) + '</button>'; }).join('') + '</div>') +
          '<div class="kpis"><div class="kpi"><span class="lbl">Total yearly cost · ' + esc(M.label) + '</span><span class="num">' + pltMoney(T.total) + '</span>' + chg + '</div>' +
          '<div class="kpi"><span class="lbl">Shared and XCF-only</span><div class="stack" style="height:18px;margin:10px 0 4px"><i style="width:' + (T.total ? T.shared / T.total * 100 : 0) + '%;background:var(--data1)"></i><i style="width:' + (T.total ? T.xcf / T.total * 100 : 0) + '%;background:var(--purple)"></i></div><ul class="lg"><li><i class="dot" style="background:var(--data1)"></i>Shared<b>' + pltCompact(T.shared) + '</b></li><li><i class="dot" style="background:var(--purple)"></i>XCF only<b>' + pltCompact(T.xcf) + '</b></li></ul></div>' +
          '<div class="kpi"><span class="lbl">Low-usage spend</span><span class="num" style="color:var(--purple-ink)">' + pltCompact(low.total) + '</span><span class="t-small">' + (low.tools.length ? esc(low.tools.join(', ')) + ' · used quarterly or less' : 'No low-usage platforms this month') + '</span></div></div>' +
          '<div class="spend"><div class="panel"><h4>Where the money goes</h4><div class="dl"><div class="ringwrap" id="platRing"></div><ul id="platList"></ul></div></div>' +
          '<div class="panel"><h4>Cost by month</h4><div class="cols" id="cols"></div><div class="pills">' + chip('Shared', 'blue') + chip('XCF only', 'purple') + '<span class="t-small">Click a month to switch</span></div></div>' +
          '<div class="panel"><h4>Cost by how much it’s used</h4><div class="stack" style="height:18px">' + useRows.map(function (u) { return '<i style="width:' + (u.total / (T.total || 1) * 100) + '%;background:' + (UCOL[u.level] || 'var(--track)') + '"></i>'; }).join('') + '</div><ul class="use">' +
          useRows.map(function (u) { var shown = u.tools.slice(0, 4).join(', ') + (u.tools.length > 4 ? ' +' + (u.tools.length - 4) + ' more' : ''); return '<li><i class="dot" style="background:' + (UCOL[u.level] || 'var(--track)') + '"></i><span><b>' + esc(u.level) + (meaning[u.level] ? ' · used ' + esc(meaning[u.level]) : '') + '</b><span class="t-small">' + esc(shown) + '</span></span><span class="v">' + pltMoney(u.total) + '</span></li>'; }).join('') + '</ul></div></div>' +
          '<div class="cardfoot"><span class="t-small">' + (PD && PD.syncedAt ? 'Copied from the Google Sheet on ' + esc(new Date(PD.syncedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })) : '') + '</span>' + seeMore('spend') + '</div>');
        mount($('#platRing'), 180, 26, { v: plat.map(function (x) { return x[1]; }), t: T.total || 1, g: 3 }, plat.map(function (x) { return x[2]; }),
          '<span class="num" style="font-size:38px">' + pltCompact(T.total) + '</span><span class="t-small">per year</span>', 'Spend by platform');
        $('#platList').innerHTML = plat.map(function (x) { return '<li><i class="dot" style="background:' + x[2] + '"></i>' + esc(x[0]) + '<b>' + pltMoney(x[1]) + '</b></li>'; }).join('');
        $('#cols').innerHTML = months.map(function (m, i) {
          var h = m.totals.total / maxT * 130;
          return '<div class="col' + (i === spendIdx ? ' sel' : '') + '" data-i="' + i + '" style="cursor:pointer"><b>' + pltCompact(m.totals.total) + '</b><div class="st" style="height:' + Math.max(4, h) + 'px"><i style="flex:' + m.totals.xcf + ';background:var(--purple)"></i><i style="flex:' + m.totals.shared + ';background:var(--data1)"></i></div>' + esc(m.label) + '</div>';
        }).join('');
        $$('#spSeg button, #cols .col').forEach(function (b) { b.addEventListener('click', function () { spendIdx = +b.dataset.i; paint(); }); });
      }
      paint();
    }

    /* ═════════════ "See more" windows, in the mockup's format ═════════════ */
    function table(headCells, rows) { return '<div class="tscroll"><table class="dt"><thead><tr>' + headCells.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'; }
    function row(cells, attr) { return '<tr' + (attr || '') + '>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }
    function segc(name, items) { return '<div class="seg" role="group" aria-label="Filter" data-seg="' + name + '" style="align-self:flex-start">' + items.map(function (it, i) { return '<button type="button" aria-pressed="' + (i === 0) + '" data-v="' + it[0] + '">' + it[1] + '</button>'; }).join('') + '</div>'; }
    function stats(a) { return '<div class="kv">' + a.map(function (s) { return '<div class="stat"><span class="num" style="color:' + s[2] + '">' + s[0] + '</span><span class="lbl">' + s[1] + '</span></div>'; }).join('') + '</div>'; }
    function sec(title, html, sub) { return '<section class="dsec"><h3 class="t-card">' + title + '</h3>' + (sub ? '<p class="t-sub">' + sub + '</p>' : '') + html + '</section>'; }
    function hbars(items, max, color) { return '<ul class="hb">' + items.map(function (i) { var c = typeof color === 'function' ? color(i) : color; return '<li><span>' + esc(i[0]) + (i[3] ? '<br><span class="t-small">' + esc(i[3]) + '</span>' : '') + '</span><span class="bar"><i style="width:' + Math.max(1, i[1] / (max || 1) * 100) + '%;background:' + c + '"></i></span><b>' + i[2] + '</b></li>'; }).join('') + '</ul>'; }
    function pbar(p, c, w) { return '<div style="display:flex;align-items:center;gap:10px"><span class="bar" style="width:' + (w || 110) + 'px;flex:none"><i style="width:' + Math.min(p, 100) + '%;background:' + c + '"></i></span><b>' + p + '%</b></div>'; }
    function orig(key) { return '<p class="note2">The report’s original detailed view, with every column and filter, is still available: <button class="link" type="button" data-orig="' + key + '">open the original view</button>.</p>'; }

    var SMAP = { over: ['coral', 'Over capacity', 'var(--coral)'], under: ['gold', 'Under capacity', 'var(--gold)'], avail: ['mint', 'Available', 'var(--mint)'], ooo: ['purple', 'Out of office', 'var(--purple)'] };
    var DET = {};
    var JUMP = { capacity: '#capacity', pods: '#pods', pmteam: '#pmteam', ooo: '#ooo', forecaster: '#forecaster', missing: '#missing', scope: '#scope', updates: '#updates', cycle: '#cycle', spend: '#spend', assets: '#assets', briefs: '#overview', usage: '#spend' };
    var ORIG = { capacity: 'capacity', pods: 'podsummary', pmteam: 'pmteam', ooo: 'ooo', forecaster: 'forecaster', missing: 'missing', scope: 'scopecreep', updates: 'pmupdates', cycle: 'requests', spend: 'platform', regional: 'regional' };
    var ORIG_TITLE = { capacity: 'Team capacity', pods: 'Pod summary', pmteam: 'PM team', ooo: 'Out of office', forecaster: 'Project forecaster', missing: 'Tasks needing attention', scope: 'Scope creep and FAA', updates: 'PM updates', cycle: 'Request cycle time', spend: 'Platform spend and usage', regional: 'Regional Requests - WIP' };

    DET.capacity = function () {
      var key = capKey, dl = window._dlabels || {}, cs = capCounts(key);
      var people = MEM.map(function (m) {
        var cap = capOf(m), max = key === 'today' ? cap : key === 'week' ? cap * 5 : cap * 21, h = m[key];
        var sc = m.ooo ? 'ooo' : ({ 'chip-over': 'over', 'chip-under': 'under', 'chip-avail': 'avail' })[statusChip(h, key, cap).cls];
        return { m: m, h: h, pct: Math.round(h / max * 100), sc: sc };
      }).sort(function (a, b) { return (a.sc === 'ooo') - (b.sc === 'ooo') || b.pct - a.pct; });
      var rows = people.map(function (p) {
        var s = SMAP[p.sc], gap = CAPACITY_GAP_MEMBERS.has(p.m.name);
        return row(['<b>' + esc(p.m.name) + '</b>' + (gap ? '<br><span class="t-small">Free for incoming micros</span>' : ''), esc(p.m.pod), p.sc === 'ooo' ? '–' : p.h.toFixed(1) + 'h', p.sc === 'ooo' ? '–' : pbar(p.pct, s[2]), chip(s[1], s[0])], ' data-group="people" data-pane="' + p.sc + '"');
      });
      var special = Object.keys(typeof MEMBER_CAPACITY !== 'undefined' ? MEMBER_CAPACITY : {}).map(function (n) { return n + ' (' + MEMBER_CAPACITY[n] + ' hours)'; });
      return { t: 'Team capacity', s: 'Everyone, grouped by how full their time is. ' + (dl[key] || key) + '.', h:
        stats([[cs[0], 'Over capacity', 'var(--coral-ink)'], [cs[1], 'Under capacity', 'var(--gold-ink)'], [cs[2], 'Available', 'var(--mint-ink)'], [cs[3], 'Out of office', 'var(--purple-ink)']]) +
        sec('Everyone', segc('people', [['all', 'All'], ['over', 'Over capacity'], ['under', 'Under capacity'], ['avail', 'Available'], ['ooo', 'Out of office']]) + table(['Person', 'Pod', 'Booked', 'Utilisation', 'Status'], rows) + '<p class="note2">Showing all ' + N + ' people.</p>') +
        sec('How this is worked out', '<p>Utilisation is hours booked divided by the person’s capacity: ' + (key === 'today' ? '6 hours for most people' : key === 'week' ? '6 hours a day over the next 5 working days' : '6 hours a day over the next 21 working days') + (special.length ? ', except ' + esc(special.join(' and ')) : '') + '. It counts incomplete tasks only, so it shows work still to do. Asana Workload also counts completed tasks until their due date, so it can read higher for people who finished work early.</p>') + orig('capacity') };
    };

    DET.pods = function () {
      var h = '<div class="dgrid">' + podInfo().map(function (p) {
        var rows = p.ms.slice().sort(function (a, b) { return b.today - a.today; }).map(function (m) {
          var gap = CAPACITY_GAP_MEMBERS.has(m.name);
          if (m.ooo) return row(['<b>' + esc(m.name) + '</b>', '–', chip('Away', 'grey')]);
          var pc = Math.round(m.today / capOf(m) * 100);
          return row(['<b>' + esc(m.name) + '</b>' + (gap ? '<br><span class="t-small">Free for incoming micros</span>' : ''), m.today.toFixed(1) + 'h', pbar(pc, st(pc)[1], 90)]);
        });
        return '<section class="dsec"><h3 class="t-card" style="display:flex;align-items:center;gap:10px"><i class="dot" style="background:' + podDot(p.pod) + '"></i>' + esc(p.pod) + '</h3><p class="t-sub">' + p.h.toFixed(1) + 'h of ' + (Math.round(p.cap * 10) / 10) + 'h available · ' + plural(p.ms.length, 'member') + '</p>' + table(['Person', 'Booked', 'Utilisation'], rows) + '</section>';
      }).join('') + '</div>';
      return { t: 'Pod summary', s: 'Every member of every pod, with hours booked today.', h: h + '<p class="note2">Pod capacity is each person’s daily cap, for the people who are working today. People who are away are left out.</p>' + orig('pods') };
    };

    DET.pmteam = function () {
      var h = segc('pm', PM_DATA.map(function (p, i) { return [String(i), esc(p.name)]; }));
      PM_DATA.forEach(function (pm, i) {
        var f = pmFacts(pm);
        function grp(title, list) {
          if (!list.length) return '';
          return sec(title + ' (' + list.length + ')', table(['Project', 'Progress', 'Start', 'Due'], list.map(function (p) {
            var past = p.due && new Date(p.due + 'T00:00:00') < today0;
            return row(['<b>' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' : esc(p.name)) + '</b>', p.pct === null ? '–' : pbar(p.pct, 'var(--mint)', 100), fmtDate(p.start), '<span class="' + (past ? 'past' : '') + '">' + fmtDate(p.due) + '</span>']);
          })));
        }
        h += '<div data-group="pm" data-pane="' + i + '"' + (i ? ' hidden' : '') + ' style="display:flex;flex-direction:column;gap:28px">' +
          stats([[pm.today + 'h', 'Booked today', 'var(--blue-ink)'], [pm.week + 'h', 'Next 7 days', 'var(--blue-ink)'], [pm.month + 'h', 'This month', 'var(--blue-ink)']]) +
          grp('Roadmap projects', f.roadmap) + grp('Micros and BAU', f.micro) + grp('XCF initiatives', f.init) +
          (f.active.length ? '' : '<p class="t-sub">No active projects.</p>') + '</div>';
      });
      return { t: 'PM team', s: 'Capacity booked and the projects each PM is carrying.', h: h + '<p class="note2">Dates in coral are earlier than today. Projects at 100% are not listed.</p>' + orig('pmteam') };
    };

    DET.ooo = function () {
      var W = oooWindow(), np = (today0.getTime() - W.startT) / DAY / W.D * 100;
      var byName = {}; W.rows.forEach(function (r) { byName[r.name] = r; });
      var groups = {}; MEM.forEach(function (m) { (groups[m.pod] = groups[m.pod] || []).push(m.name); });
      var tl = '<div class="tl" style="grid-template-columns:170px minmax(0,1fr)"><div></div><div class="ax">' + W.labels.map(function (l) { return '<span style="left:' + (l[0] / W.D * 100) + '%">' + esc(l[1]) + '</span>'; }).join('') + '</div>';
      PODS.filter(function (p) { return groups[p]; }).forEach(function (pod) {
        var col = podDot(pod);
        tl += '<div style="grid-column:1/-1;font-weight:600;display:flex;align-items:center;gap:8px;margin-top:8px"><i class="dot" style="background:' + col + '"></i>' + esc(pod) + '</div>';
        groups[pod].slice().sort().forEach(function (n) { var r = byName[n]; tl += '<div class="lab">' + esc(n) + '</div><div class="trk"><div class="today" style="left:' + np + '%"></div>' + (r ? oooBars(r, W, col) : '') + '</div>'; });
      });
      tl += '</div>';
      var list = W.entries.filter(function (e) { return new Date(e.end + 'T00:00:00').getTime() >= today0.getTime() - 28 * DAY; }).sort(function (a, b) { return a.start.localeCompare(b.start); });
      var rows = list.map(function (e) {
        var s = new Date(e.start + 'T00:00:00'), f = new Date(e.end + 'T00:00:00'), note;
        if (s <= today0 && f >= today0) note = 'Away now, back ' + fmtDay(new Date(f.getTime() + DAY));
        else if (s > today0) note = 'Starts in ' + plural(Math.round((s - today0) / DAY), 'day');
        else note = 'Ended ' + plural(Math.round((today0 - f) / DAY), 'day') + ' ago';
        return row(['<b>' + esc(e.name) + '</b>', esc(W.podOf[e.name] || e.pod || ''), esc(fmtDayY(s) + ' – ' + fmtDayY(f)), note]);
      });
      return { t: 'Out of office', s: 'Leave by person for the next 13 weeks, from Asana vacation dates and the leave tracker.', h:
        sec('Timeline', tl, 'The dark line is today.') + sec('Leave periods', rows.length ? table(['Person', 'Pod', 'Dates', 'Note'], rows) : '<p class="t-sub">Nobody has time off booked.</p>') + orig('ooo') };
    };

    DET.forecaster = function () {
      var cnt = FC.cnt, status = FC.status;
      var rows = FC.listed.map(function (p) {
        var s = status(p), l = FC_LAB[s] || ['', 'grey'], ps = FC_PS[p.projectStatus], tasks = FC.taskCount[p.code] || 0;
        return row(['<b>' + esc(p.code || '–') + '</b><br>' + esc(pretty(p.name)), esc(p.regions.join(', ') || '–'), chip(l[0], l[1]), ps ? chip(ps[0], ps[1]) : '–', String(tasks),
          p.production ? esc(fmtDay(p.production.start) + ' – ' + fmtDayY(p.production.end)) : '–', p.inMarket ? esc(fmtDay(p.inMarket.start) + ' – ' + fmtDayY(p.inMarket.end)) : '–'], ' data-group="fc" data-pane="' + s + '"');
      });
      return { t: 'Project forecaster', s: 'Production and in-market windows for XCF roadmap requests.', h:
        stats([[cnt.active, 'In production', 'var(--purple-ink)'], [cnt.upcoming, 'Upcoming', 'var(--gold-ink)'], [cnt.inmarket, 'In market', 'var(--mint-ink)'], [cnt.onhold, 'On hold', 'var(--muted)']]) +
        sec('Projects', segc('fc', [['all', 'All'], ['active', 'In production'], ['upcoming', 'Upcoming'], ['inmarket', 'In market'], ['onhold', 'On hold']]) + table(['Project', 'Region', 'Stage', 'Status', 'Tasks', 'Production', 'In market'], rows) + '<p class="note2">Tasks are the incomplete tasks assigned to the team on that project.</p>') + orig('forecaster') };
    };

    DET.missing = function () {
      var G = missingGroups(), why = { 'No estimate': 'Hours can’t be planned against anyone’s capacity.', 'No due date': 'The task can’t be placed on the capacity view.' };
      var rows = G.order.map(function (k) { return row(['<b>' + esc(k) + '</b>', String(G.by[k]), why[k] || 'The task is left out of the capacity numbers.']); });
      var tasks = MISSING_TASKS.map(function (t) {
        return row(['<b><a href="https://app.asana.com/0/0/' + esc(t.gid) + '/f" target="_blank" rel="noopener">' + esc(t.name) + ' ↗</a></b><br><span class="t-small">' + esc(t.proj) + '</span>', esc(t.assignee), esc(t.pod), esc(t.createdBy || '–'), chip(esc(t.missing), 'gold')]);
      });
      return { t: 'Tasks needing attention', s: plural(MISSING_TASKS.length, 'task') + ' can’t be fully planned until someone fills in the gaps.', h:
        sec('What is missing', table(['Field', 'Tasks', 'Why it matters'], rows)) + sec('Tasks to fix', table(['Task', 'Assignee', 'Pod', 'Created by', 'Missing'], tasks), 'Each task links to Asana.') + orig('missing') };
    };

    DET.scope = function () {
      var S = scopeSets(), allSc = S.sc.concat(S.scDone), allFaa = S.faa.concat(S.faaDone);
      var flagged = S.all.map(function (t) {
        var done = /^Completed/.test(t.status), faa = /FAA/.test(t.status);
        return row([chip(esc(t.status), done ? 'mint' : faa ? 'gold' : 'coral'), '<b>' + (t.url ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.name) + ' ↗</a>' : esc(t.name)) + '</b>', esc([t.parent, t.project].filter(Boolean).join(' · ')), esc(t.assignee || '–'), t.estHours ? Math.round(t.estHours * 10) / 10 + 'h' : '–']);
      });
      var cnt = function (a) { return String(a.length); };
      return { t: 'Scope creep and FAA', s: 'Work that changed after approval.', h:
        stats([[S.sc.length, 'Scope creep tasks', S.sc.length ? 'var(--coral-ink)' : 'var(--mint-ink)'], [S.faa.length, 'Feedback after approval', 'var(--gold-ink)'], [hrsOf(S.faa) + 'h', 'Estimated for FAA', 'var(--gold-ink)']]) +
        sec('Counts', table(['Type', 'Tasks', 'Estimated', 'Active', 'Completed'], [row(['<b>Scope creep</b>', cnt(allSc), allSc.length ? hrsOf(allSc) + 'h' : '–', cnt(S.sc), cnt(S.scDone)]), row(['<b>Feedback after approval</b>', cnt(allFaa), allFaa.length ? hrsOf(allFaa) + 'h' : '–', cnt(S.faa), cnt(S.faaDone)])])) +
        sec('Flagged tasks', flagged.length ? table(['Status', 'Task', 'Project', 'Assignee', 'Estimate'], flagged) : '<p class="t-sub">No scope creep or FAA tasks found.</p>') + orig('scope') };
    };

    DET.updates = function () {
      var U = (PM_UPDATES_DATA || []).slice(0, 6);
      if (!U.length) return { t: 'PM updates', s: 'No updates yet.', h: orig('updates') };
      function sections(text) {
        var blocks = String(text || '').split(/\n\s*\n/), out = [], last = null;
        blocks.forEach(function (b) {
          var plain = cleanUpdate(b).trim(); if (!plain || /WEEKLY UPDATE/i.test(b)) return;
          var lines = plain.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
          var si = lines.findIndex(function (l) { return /^Status:/i.test(l); });
          if (si >= 0) {
            var ui = lines.findIndex(function (l) { return /^Update:/i.test(l); });
            last = { title: lines.slice(0, si).join(' ') || 'Update', state: updState(b), body: (ui >= 0 ? lines.slice(ui) : lines.slice(si + 1)).join(' ').replace(/^Update:\s*/i, '') };
            out.push(last);
          } else if (last) last.body += ' ' + lines.join(' ');
          else out.push((last = { title: 'Update', state: updState(b), body: lines.join(' ') }));
        });
        return out;
      }
      var h = segc('updwk', U.map(function (w, i) { return [String(i), esc(w.weekLabel)]; }));
      U.forEach(function (w, i) {
        h += '<div data-group="updwk" data-pane="' + i + '"' + (i ? ' hidden' : '') + ' style="display:flex;flex-direction:column;gap:22px">' +
          ((w.messages || []).length ? w.messages.slice().sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); }).map(function (m) {
            var secs = sections(m.text), pod = updPod(m);
            return '<div style="display:flex;flex-direction:column;gap:14px"><p class="t-sub"><b style="color:var(--ink)">' + esc(m.name) + '</b> · ' + esc((pod ? pod + ' · ' : '') + updWhen(m)) + '</p>' +
              secs.map(function (p) { return '<div class="stat" style="flex:none"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><b style="font-size:17px">' + esc(p.title) + '</b>' + (p.state ? chip(p.state[0], p.state[1]) : '') + '</div><p style="margin-top:8px">' + esc(p.body) + '</p></div>'; }).join('') + '</div>';
          }).join('') : '<p class="t-sub">No updates this week.</p>') + '</div>';
      });
      return { t: 'PM updates', s: 'Weekly notes from the PM team, from #xcf-pm-weekly-updates. Showing the latest ' + U.length + ' weeks.', h: h + orig('updates') };
    };

    DET.cycle = function () {
      var F = cycleFacts(), cc = { 'Brief & scoping': 'gold', 'Requester-side': 'purple', 'Access & permissions': 'blue', 'Dropped': 'coral', 'Creative iteration': 'mint' };
      var cmax = Math.max.apply(null, F.causes.map(function (c) { return c[1]; }).concat(1));
      var lw = F.longest.slice(0, 9).map(function (r) {
        return row(['<b>' + esc(r.code) + '</b><br>' + esc(pretty(r.name)), esc(r.pod || '–'), esc(r.assignee || '–'), '<b style="color:var(--coral-ink)">' + (r.durationHours / 24).toFixed(1) + 'd</b>', r.cause ? chip(esc(r.cause), cc[r.cause] || 'grey') : chip('None recorded', 'grey')]);
      });
      var qmax = Math.max.apply(null, F.byQ.map(function (x) { return x[1]; }).concat(1)), tmax = Math.max.apply(null, F.byT.map(function (x) { return x[1]; }).concat(1));
      return { t: 'Request cycle time', s: 'From request submitted to work started, since 1 Jul 2026 (FY27 Q2). Sprint containers are excluded.', h:
        stats([[measured.length, 'Tracked', 'var(--blue-ink)'], [bk.waiting.length, 'Awaiting in progress', 'var(--gold-ink)'], [slow, 'Waited over a week', 'var(--coral-ink)'], [accounted + '%', 'Accounted for', 'var(--blue-ink)']]) +
        sec('Where the wait comes from', F.causes.length ? hbars(F.causes.map(function (c) { return [c[0], c[1], c[1].toFixed(1) + 'd', plural(c[2], 'request')]; }), cmax, function (i) { return i[1] >= 20 ? 'var(--coral)' : i[1] >= 10 ? 'var(--gold)' : 'var(--mint)'; }) : '<p class="t-sub">No causes tagged yet.</p>', 'Mid-point wait in days, ' + F.causes.reduce(function (s, c) { return s + c[2]; }, 0) + ' requests classified.') +
        '<div class="dgrid">' + sec('By quarter', hbars(F.byQ.map(function (x) { return [x[0], x[1], x[1].toFixed(1) + 'd', x[2] + ' measured']; }), qmax, 'var(--data1)')) + sec('By project type', hbars(F.byT.map(function (x) { return [x[0], x[1], x[1].toFixed(1) + 'd', x[2] + ' measured']; }), tmax, 'var(--data1)')) + '</div>' +
        sec('Longest waits', table(['Request', 'Pod', 'Assignee', 'Wait', 'Cause'], lw), 'The nine longest measured waits.') +
        '<p class="note2">The original view lists every request that took over 24 hours, with filters and the reasons for each wait: <button class="link" type="button" data-orig="cycle">open the original view</button>.</p>' };
    };

    DET.spend = function () {
      var M = months[spendIdx]; if (!M) return { t: 'Platform spend and usage', s: 'No platform data yet.', h: orig('spend') };
      var T = M.totals, prev = spendIdx > 0 ? months[spendIdx - 1] : null, vs = prev ? prev.label.split(' ')[0] : null;
      var uc = { High: 'blue', Medium: 'gold', Low: 'purple', 'New tool': 'mint' };
      var rows = M.rows.filter(function (r) { return r.inTotal; }).slice().sort(function (a, b) { return b.annual - a.annual; }).map(function (r) {
        var c = r.change || {}, txt = 'No change', col = 'var(--muted)';
        if (!prev) { txt = '–'; }
        else if (c.kind === 'new') { txt = 'New · +' + pltMoney(c.delta); col = 'var(--gold-ink)'; }
        else if (c.kind === 'up') { txt = '▲ ' + pltMoney(c.delta); col = 'var(--gold-ink)'; }
        else if (c.kind === 'down') { txt = '▼ ' + pltMoney(Math.abs(c.delta)); col = 'var(--mint-ink)'; }
        else if (c.kind && c.kind !== 'same') { txt = esc(c.kind); }
        return row(['<b>' + esc(r.tool) + '</b><br><span class="t-small">' + esc(r.category || '') + '</span>', chip(r.scope === 'Shared' ? 'Shared' : 'XCF only', r.scope === 'Shared' ? 'blue' : 'purple'), esc(r.seats || '–'), '<b>' + pltMoney(r.annual) + '</b>', pltShare(r.annual, T.total),
          '<span style="font-weight:600;color:' + col + '">' + txt + '</span>', chip(esc(r.usage || '–'), uc[r.usage] || 'grey') + (r.notes ? '<br><span class="t-small">' + esc(r.notes) + '</span>' : '')], ' data-group="plat" data-pane="' + (r.scope === 'Shared' ? 'shared' : 'xcf') + '"');
      });
      var d = prev ? T.total - prev.totals.total : 0;
      rows.push(row(['<b>Total, ' + plural(T.toolCount, 'platform') + '</b>', '', '', '<b>' + pltMoney(T.total) + '</b>', '100%', prev ? '<b style="color:' + (d > 0 ? 'var(--gold-ink)' : 'var(--mint-ink)') + '">' + (d > 0 ? '▲ ' : '▼ ') + pltMoney(Math.abs(d)) + (prev.totals.total ? ' · ' + Math.abs(d / prev.totals.total * 100).toFixed(1) + '%' : '') + '</b>' : '', '']));
      var low = (M.byUsage.filter(function (u) { return u.level === 'Low'; })[0]) || { total: 0 };
      return { t: 'Platform spend and usage', s: 'Annual cost in NZD for ' + M.label + (prev ? ', compared with ' + prev.label : '') + '.', h:
        stats([[pltCompact(T.total), 'Total per year', 'var(--ink)'], [pltCompact(T.shared), 'Shared (' + pltShare(T.shared, T.total) + ')', 'var(--blue-ink)'], [pltCompact(T.xcf), 'XCF only (' + pltShare(T.xcf, T.total) + ')', 'var(--purple-ink)'], [pltCompact(low.total), 'Low-usage spend', 'var(--gold-ink)']]) +
        sec('All platforms', segc('plat', [['all', 'All platforms'], ['shared', 'Shared'], ['xcf', 'XCF only']]) + table(['Platform', 'Scope', 'Seats', 'Annual cost', 'Share', 'Change' + (vs ? ' vs ' + esc(vs) : ''), 'Usage'], rows) + (T.notInTotalCount ? '<p class="note2">' + plural(T.notInTotalCount, 'more platform is', 'more platforms are') + ' listed in the sheet but left out of the total (' + pltMoney(T.notInTotal) + ').</p>' : '')) + orig('spend') };
    };

    DET.usage = function () {
      var M = months[months.length - 1]; if (!M) return { t: 'Overall tool usage', s: 'No platform data yet.', h: orig('spend') };
      var prev = months.length > 1 ? months[months.length - 2] : null, u = usageShare(M), up = prev ? usageShare(prev) : null;
      var meaning = { High: 'Used daily', Medium: 'Used regularly', Low: 'Used quarterly or less', 'New tool': 'New this month' };
      ((PD && PD.usageKey) || []).forEach(function (k) { meaning[k.level] = 'Used ' + ({ regular: 'regularly' }[k.meaning] || k.meaning); });
      var rank = { High: 3, Medium: 2, Low: 1, 'New tool': 0 }, lc = { High: 'blue', Medium: 'gold', Low: 'purple', 'New tool': 'mint' };
      var count = function (X, lv) { var r = X.byUsage.filter(function (x) { return x.level === lv; })[0]; return r ? r.count : 0; };
      var pn = prev ? prev.label.split(' ')[0] : null;
      var levels = ['High', 'Medium', 'Low', 'New tool'].filter(function (lv) { return count(M, lv) || (prev && count(prev, lv)); }).map(function (lv) {
        var row0 = M.byUsage.filter(function (x) { return x.level === lv; })[0] || { count: 0, tools: [], total: 0 };
        var d = prev ? count(M, lv) - count(prev, lv) : 0;
        return row([chip(esc(lv), lc[lv]), esc(meaning[lv] || ''), '<b>' + row0.count + '</b>' + (prev ? '<br><span class="t-small">' + (d ? (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' vs ' + esc(pn) : 'No change vs ' + esc(pn)) + '</span>' : ''), esc(row0.tools.join(', ') || '–'), pltMoney(row0.total)]);
      });
      var rows = M.rows.filter(function (r) { return r.inTotal; }).slice().sort(function (a, b) { return (rank[b.usage] || 0) - (rank[a.usage] || 0) || b.annual - a.annual; }).map(function (r) {
        var pr = prev ? prev.rows.filter(function (x) { return x.toolKey === r.toolKey; })[0] : null, txt = '–', col = 'var(--muted)';
        if (prev) {
          if (!pr) { txt = 'New this month'; col = 'var(--mint-ink)'; }
          else if (pr.usage === r.usage) txt = 'No change';
          else { var upr = (rank[r.usage] || 0) > (rank[pr.usage] || 0); txt = (upr ? '▲ Up from ' : '▼ Down from ') + esc(pr.usage); col = upr ? 'var(--mint-ink)' : 'var(--gold-ink)'; }
        }
        return row(['<b>' + esc(r.tool) + '</b><br><span class="t-small">' + esc(r.category || '') + '</span>', chip(esc(r.usage || '–'), lc[r.usage] || 'grey'), '<span style="font-weight:600;color:' + col + '">' + txt + '</span>', '<b>' + pltMoney(r.annual) + '</b>', '<span class="t-small">' + esc(r.howToCheck || '–') + '</span>']);
      });
      return { t: 'Overall tool usage', s: 'How much each platform is used in ' + M.label + (prev ? ', compared with ' + prev.label : '') + '. The headline is the share of platforms used daily.', h:
        stats([[u.pct + '%', 'Tools used daily', 'var(--mint-ink)'], [u.high + ' of ' + u.total, 'Used daily', 'var(--blue-ink)'], [up ? up.pct + '%' : '–', 'Used daily' + (pn ? ' in ' + esc(pn) : ''), 'var(--muted)'], [up ? (u.pct - up.pct >= 0 ? '+' : '') + (u.pct - up.pct) + ' pts' : '–', 'Change', u.pct >= (up ? up.pct : 0) ? 'var(--mint-ink)' : 'var(--gold-ink)']]) +
        sec('By how much they are used', table(['Level', 'Meaning', 'Tools', 'Which tools', 'Annual cost'], levels)) +
        sec('Tool by tool', table(['Platform', 'Usage', 'Change' + (pn ? ' vs ' + esc(pn) : ''), 'Annual cost', 'How usage is checked'], rows), 'Only platforms counted in the total are included.') + orig('spend') };
    };

    /* the two work-in-progress cards: the mockup's own sample numbers, shown as sample */
    DET.assets = function () {
      var R = [['US', 61, 35, 'var(--data1)'], ['UK', 40, 24, 'var(--xero-blue)'], ['ANZ', 33, 19, 'var(--mint)'], ['IM', 22, 14, 'var(--purple)']];
      var rows = R.map(function (r) { var t = r[1] + r[2]; return row(['<b>' + r[0] + '</b>', r[1], r[2], '<b>' + t + '</b>', (t / 248 * 100).toFixed(1) + '%']); });
      rows.push(row(['<b>Global</b>', '156', '92', '<b>248</b>', '100%']));
      var bars = R.map(function (r) { var t = r[1] + r[2]; return '<li><span><b>' + r[0] + '</b></span><span class="stack" style="height:14px"><i style="flex:' + r[1] + ';background:' + r[3] + '"></i><i style="flex:' + r[2] + ';background:' + r[3] + ';opacity:.5"></i></span><b>' + t + '</b></li>'; }).join('');
      return { t: 'Assets delivered this quarter (WIP)', s: 'FY27 Q3 so far, globally and by region. These are sample numbers.', h:
        stats([['248', 'Global', 'var(--ink)'], ['96', 'US', 'var(--blue-ink)'], ['64', 'UK', 'var(--blue-ink)'], ['52', 'ANZ', 'var(--mint-ink)'], ['36', 'IM', 'var(--purple-ink)']]) +
        sec('By region and month', table(['Region', 'Oct', 'Nov so far', 'Total', 'Share of global'], rows)) +
        sec('Mix by month', '<ul class="hb">' + bars + '</ul><p class="note2">Solid is October, lighter is November so far.</p>') };
    };
    DET.briefs = function () {
      var rows = [['US', '4 days'], ['UK', '3 days'], ['ANZ', '3 days'], ['US', '2 days'], ['IM', '2 days'], ['UK', '1 day'], ['ANZ', '1 day'], ['US', '1 day'], ['IM', 'Today']].map(function (r, i) { return row(['<b>XCF-0000</b> Sample brief ' + (i + 1), r[0], r[1], chip('Waiting on review', 'blue')]); });
      return { t: 'Briefs in review (WIP)', s: 'Briefs that have been submitted and are waiting on a review. These are sample numbers.', h:
        stats([['9', 'In review', 'var(--blue-ink)'], ['3', 'Waiting 3 days or more', 'var(--gold-ink)']]) + sec('Briefs', table(['Brief', 'Region', 'Time in review', 'Status'], rows), 'In the live version each row links to the brief.') };
    };

    var dlg = $('#ct-detail'), body = $('#dBody'), olg = $('#ct-orig'), obody = $('#oBody'), store = $('#ct-store'), openView = null;
    function openDetail(key, preset) {
      var f = DET[key]; if (!f) { openOriginal(key); return; }
      var o = f(); $('#dTitle').textContent = o.t; $('#dSub').textContent = o.s; body.innerHTML = o.h; body.scrollTop = 0;
      var jump = $('#dJump'); if (JUMP[key]) { jump.hidden = false; jump.setAttribute('href', JUMP[key]); } else jump.hidden = true;
      if (olg.open) olg.close();
      if (!dlg.open) dlg.showModal();
      $('#dClose').focus();
      if (preset) { var pb = body.querySelector('[data-seg] button[data-v="' + preset + '"]'); if (pb) pb.click(); }
    }
    function restore() { if (openView) { openView.classList.remove('active'); store.appendChild(openView); openView = null; } }
    function openOriginal(key) {
      var vn = ORIG[key]; if (!vn) return;
      restore(); var view = document.getElementById('view-' + vn); if (!view) return;
      $('#oTitle').textContent = ORIG_TITLE[key] || key;
      $('#oSub').textContent = key === 'regional' ? 'Work in progress: requests by region, business group and cost centre.' : 'The report’s original detailed view.';
      openView = view; obody.appendChild(view);
      if (dlg.open) dlg.close();
      if (!olg.open) olg.showModal();
      obody.scrollTop = 0; $('#oClose').focus();
      try { showView(vn, document.createElement('button')); } catch (e) { if (window.console) console.error(e); }
      view.classList.add('active');
    }
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    olg.addEventListener('click', function (e) { if (e.target === olg) olg.close(); });
    olg.addEventListener('close', restore);
    $('#dClose').addEventListener('click', function () { dlg.close(); });
    $('#oClose').addEventListener('click', function () { olg.close(); });
    $('#dJump').addEventListener('click', function (e) { var t = document.getElementById(this.getAttribute('href').slice(1)); dlg.close(); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    // the segmented filters inside the window (the mockup's own behaviour)
    body.addEventListener('click', function (e) {
      var o = e.target.closest('[data-orig]'); if (o) { openOriginal(o.getAttribute('data-orig')); return; }
      var b = e.target.closest('[data-seg] button'); if (!b) return;
      var sg = b.closest('[data-seg]'), n = sg.dataset.seg, v = b.dataset.v;
      $$('button', sg).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      $$('[data-group="' + n + '"]', body).forEach(function (el) { el.hidden = !(v === 'all' || el.dataset.pane === v); });
    });
    document.addEventListener('click', function (e) {
      var m = e.target.closest && e.target.closest('[data-more]');
      if (m) { e.preventDefault(); openDetail(m.getAttribute('data-more'), m.getAttribute('data-preset')); return; }
      var k = e.target.closest && e.target.closest('.kcard[data-go]');
      if (k && !e.target.closest('a,button')) { var mm = k.querySelector('[data-more]'); if (mm) openDetail(mm.getAttribute('data-more')); }
    });

    /* ═════════════ Build the page, then highlight the section being read ═════════════ */
    [renderKpis, renderAssets, renderCapacity, renderOver, renderPods, renderPM, renderOOO, renderForecaster, renderMissing, renderScope, renderUpdates, renderCycle, renderSpend].forEach(function (fn) {
      try { fn(); } catch (e) { if (window.console) console.error('Could not draw ' + fn.name, e); }
    });
    var links = $$('.nav-bar a[href^="#"]');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id); }); });
      }, { rootMargin: '-30% 0px -60% 0px' });
      links.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (t) io.observe(t); });
    }
  }
})();
