'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/assetsMath');

const row = (o) => Object.assign({ gid: String(Math.random()), name: 'R', type: 'Micro (BAU)', completedAt: '2026-08-10T01:00:00.000Z', assets: 1, regMicro: [], regRoadmap: [] }, o);
const view = (rows, key) => A.summarise(rows).views[key || 'overall'];
const g = (v, name) => (v.groups.find((x) => x.group === name) || { assets: 0, requests: 0 });

test('only Micro (BAU), Roadmap and XCF initiative count; requests with no Project type are left out', () => {
  const v = view([row({ type: 'Micro (BAU)', assets: 2 }), row({ type: 'Roadmap', assets: 3 }), row({ type: 'XCF initiative', assets: 4 }),
    row({ type: '', assets: 100 }), row({ type: undefined, assets: 100 }), row({ type: 'Something else', assets: 100 })]);
  assert.equal(v.assets, 9);
  assert.equal(v.requests, 3);
  assert.deepEqual(v.types.map((t) => [t.type, t.assets]), [['Micro (BAU)', 2], ['Roadmap', 3], ['XCF initiative', 4]]);
});

test('the quarter is the Auckland day the request was completed; outside FY27 Q2 and Q3 is ignored', () => {
  const rows = [
    row({ completedAt: '2026-06-30T10:00:00Z', assets: 100 }),   // 30 Jun in Auckland: FY27 Q1, not shown
    row({ completedAt: '2026-06-30T12:00:00Z', assets: 1 }),     // 1 Jul 00:00 NZST: first moment of Q2
    row({ completedAt: '2026-09-30T10:59:59Z', assets: 2 }),     // 23:59:59 on 30 Sep NZDT: still Q2
    row({ completedAt: '2026-09-30T11:00:00Z', assets: 4 }),     // 00:00 on 1 Oct NZDT: Q3
    row({ completedAt: '2026-12-31T10:59:59Z', assets: 8 }),     // 23:59:59 on 31 Dec NZDT: last moment of Q3
    row({ completedAt: '2026-12-31T11:00:00Z', assets: 100 }),   // 1 Jan: FY27 Q4, not shown
    row({ completedAt: '', assets: 100 }), row({ completedAt: 'not a date', assets: 100 }),
  ];
  const s = A.summarise(rows);
  assert.deepEqual(s.order, ['overall', 'FY27 Q2', 'FY27 Q3']);
  assert.equal(s.views['FY27 Q2'].assets, 3);
  assert.equal(s.views['FY27 Q3'].assets, 12);
  assert.equal(s.views.overall.assets, 15, 'Overall is Q2 plus Q3');
});

test('assets are the Asset count; a delivered request with no count adds nothing but is reported', () => {
  const v = view([row({ assets: 5 }), row({ assets: null }), row({ assets: 0 }), row({ assets: undefined }), row({ assets: 'x' })]);
  assert.equal(v.assets, 5);
  assert.equal(v.requests, 5);
  assert.equal(v.withCount, 1);
  assert.equal(v.noCount, 4);
});

test('the region comes from Regions (XCF) for Micro, Applicable Regions for Roadmap, either for an XCF initiative', () => {
  const v = view([
    row({ type: 'Micro (BAU)', assets: 1, regMicro: ['US'], regRoadmap: ['UK'] }),           // Micro ignores Applicable Regions
    row({ type: 'Roadmap', assets: 10, regMicro: ['US'], regRoadmap: ['UK'] }),              // Roadmap ignores Regions (XCF)
    row({ type: 'XCF initiative', assets: 100, regMicro: ['AU'], regRoadmap: ['UK'] }),      // initiative: Regions (XCF) first
    row({ type: 'XCF initiative', assets: 1000, regMicro: [], regRoadmap: ['UK'] }),         // ... else Applicable Regions
  ]);
  assert.equal(g(v, 'US').assets, 1);
  assert.equal(g(v, 'UK').assets, 1010);
  assert.equal(g(v, 'ANZ').assets, 100);
});

test('regions are grouped US, UK, ANZ (AU and NZ), IM (every other named region), Global; none is its own group', () => {
  const G = (tag) => A.regionGroup(tag);
  assert.deepEqual(['US', 'UK', 'AU', 'NZ', 'CA', 'SG', 'ZA', 'UAE', 'IR', 'EMEA', 'RoAsia (ID, PH, HK)', 'IE', 'Other'].map(G),
    ['US', 'UK', 'ANZ', 'ANZ', 'IM', 'IM', 'IM', 'IM', 'IM', 'IM', 'IM', 'IM', 'IM']);
  assert.equal(G('Global'), 'Global');
  assert.equal(G('Global (All Markets) '), 'Global', 'Asana has a trailing space on this one');
  assert.equal(G(' '), null);
  const v = view([row({ assets: 7, regMicro: [] }), row({ assets: 3, regMicro: [' '] })]);
  assert.equal(g(v, 'No region').assets, 10);
});

test('a request tagged with several regions counts once in each group it touches; the total counts it once', () => {
  const v = view([
    row({ assets: 10, regMicro: ['AU', 'NZ'] }),               // one ANZ, not two
    row({ assets: 6, regMicro: ['US', 'UK', 'SG', 'ZA'] }),    // US, UK and IM (IM once)
  ]);
  assert.equal(v.assets, 16, 'the total counts each request once');
  assert.equal(g(v, 'ANZ').assets, 10);
  assert.equal(g(v, 'US').assets, 6);
  assert.equal(g(v, 'UK').assets, 6);
  assert.equal(g(v, 'IM').assets, 6);
  assert.equal(g(v, 'IM').requests, 1);
  const sum = v.groups.reduce((a, x) => a + x.assets, 0);
  assert.ok(sum > v.assets, 'the groups add up to more than the total, as the page says');
});

test('the real FY27 Q3 so far: a 120-asset UK request and a 2-asset AU one', () => {
  const v = view([
    row({ completedAt: '2026-10-28T03:00:00Z', assets: 120, regMicro: ['UK'] }),
    row({ completedAt: '2026-10-07T03:00:00Z', assets: 2, regMicro: ['AU'] }),
    row({ completedAt: '2026-10-08T03:00:00Z', assets: null, regMicro: ['Global'] }),
  ], 'FY27 Q3');
  assert.equal(v.assets, 122);
  assert.equal(v.requests, 3);
  assert.equal(v.noCount, 1);
  assert.deepEqual(v.top, { group: 'UK', label: 'UK', share: 98.4 });
  assert.equal(g(v, 'ANZ').share, 1.6);
  assert.equal(g(v, 'Global').requests, 1, 'a Global-tagged request with no count still shows as a request');
  assert.equal(g(v, 'Global').assets, 0);
});

test('groups come out in display order, only those with something in them; an empty view has no top', () => {
  const v = view([row({ assets: 1, regMicro: ['SG'] }), row({ assets: 2, regMicro: ['US'] })]);
  assert.deepEqual(v.groups.map((x) => x.group), ['US', 'IM']);
  const empty = view([]);
  assert.equal(empty.assets, 0);
  assert.equal(empty.requests, 0);
  assert.equal(empty.top, null);
  assert.deepEqual(empty.groups, []);
});

test('the same request twice is counted once', () => {
  const v = view([row({ gid: '1', assets: 5 }), row({ gid: '1', assets: 5 })]);
  assert.equal(v.assets, 5);
  assert.equal(v.requests, 1);
});

test('the biggest deliveries list the requests that make up the quarter, largest first', () => {
  const s = A.summarise([
    row({ gid: 'a', name: 'Small', assets: 2, regMicro: ['AU'], completedAt: '2026-10-07T03:00:00Z' }),
    row({ gid: 'b', name: 'Huge', assets: 120, regMicro: ['UK'], completedAt: '2026-10-28T03:00:00Z' }),
    row({ gid: 'c', name: 'No count', assets: null, completedAt: '2026-10-09T03:00:00Z' }),
    row({ gid: 'd', name: 'Q2 one', assets: 50, completedAt: '2026-08-09T03:00:00Z' }),
  ]);
  assert.deepEqual(A.biggest(s, 'FY27 Q3', 5).map((r) => [r.name, r.assets]), [['Huge', 120], ['Small', 2]]);
  assert.deepEqual(A.biggest(s, 'overall', 2).map((r) => r.name), ['Huge', 'Q2 one']);
  assert.deepEqual(A.biggest(s, 'nope'), []);
});

test('the build keeps a request completed on a UTC day just outside a quarter, and the page decides by the Auckland day', () => {
  const { rowFromTask } = require('../src/assetsRequests');
  const task = (completedAt) => ({ gid: '1', name: '[Converted to project] XCF-1 | Thing', completed_at: completedAt, custom_fields: [
    { gid: '1211986892220398', enum_value: { name: 'Complete' } }, { gid: '1217575429570978', enum_value: { name: 'Micro (BAU)' } },
    { gid: '1212213385632145', number_value: 4 }, { gid: '1213486033990545', multi_enum_values: [{ name: 'UK' }] }] });
  const r = rowFromTask(task('2026-06-30T12:30:00.000Z'));          // 1 Jul 00:30 in Auckland: a Q2 delivery
  assert.equal(r.name, 'XCF-1 | Thing');
  assert.deepEqual([r.type, r.assets, r.regMicro, r.regRoadmap], ['Micro (BAU)', 4, ['UK'], []]);
  assert.equal(A.summarise([r]).views['FY27 Q2'].assets, 4);
  assert.equal(rowFromTask(task('2026-06-29T23:59:00.000Z')), null, 'two days before is out');
  assert.equal(rowFromTask(task('2027-01-01T00:00:00.000Z')), null);
  const noType = task('2026-08-01T00:00:00.000Z'); noType.custom_fields = noType.custom_fields.filter((f) => f.gid !== '1217575429570978');
  assert.equal(rowFromTask(noType), null, 'no Project type: not counted');
  const open = task('2026-08-01T00:00:00.000Z'); open.custom_fields[0].enum_value.name = 'In Progress';
  assert.equal(rowFromTask(open), null, 'only Complete counts');
  const noCount = task('2026-08-01T00:00:00.000Z'); noCount.custom_fields = noCount.custom_fields.filter((f) => f.gid !== '1212213385632145');
  assert.equal(rowFromTask(noCount).assets, null, 'a missing count stays empty, never 0');
});

test('withoutCount lists the delivered requests that have no asset count, newest first, with their quarter', () => {
  const s = A.summarise([
    row({ gid: 'a', name: 'Counted', assets: 5, completedAt: '2026-10-07T03:00:00Z' }),
    row({ gid: 'b', name: 'No count Q3', assets: null, regMicro: ['US', 'SG'], completedAt: '2026-10-09T03:00:00Z' }),
    row({ gid: 'c', name: 'Zero is no count', assets: 0, completedAt: '2026-08-09T03:00:00Z' }),
    row({ gid: 'd', name: 'No count Q2', assets: undefined, completedAt: '2026-07-20T03:00:00Z' }),
    row({ gid: 'e', name: 'Untyped', type: '', assets: null, completedAt: '2026-10-09T03:00:00Z' }),
  ]);
  const all = A.withoutCount(s, 'overall');
  assert.deepEqual(all.map((r) => [r.name, r.quarter]), [['No count Q3', 'FY27 Q3'], ['Zero is no count', 'FY27 Q2'], ['No count Q2', 'FY27 Q2']]);
  assert.deepEqual(all[0].groups, ['US', 'IM']);
  assert.deepEqual(A.withoutCount(s, 'FY27 Q3').map((r) => r.name), ['No count Q3']);
  assert.equal(all.length, s.views.overall.noCount, 'the list is exactly the number the card reports');
  assert.deepEqual(A.withoutCount(s, 'nope'), []);
});
