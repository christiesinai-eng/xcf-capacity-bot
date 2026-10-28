'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const cm = require('../src/capacityMath');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} vs ${b}`);

test('weekdays: 29 Oct 2026 is a Thursday, the next Monday is 2 Nov', () => {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  assert.equal(names[cm.weekdayIndex(cm.dayNumber('2026-10-29'))], 'Thu');
  assert.equal(names[cm.weekdayIndex(cm.dayNumber('2026-10-31'))], 'Sat');
  assert.equal(names[cm.weekdayIndex(cm.dayNumber('2026-11-02'))], 'Mon');
  assert.equal(names[cm.weekdayIndex(cm.dayNumber('1970-01-01'))], 'Thu');
  assert.equal(names[cm.weekdayIndex(cm.dayNumber('1969-12-28'))], 'Sun');
});

test('date strings round trip and add days across month, year and leap day', () => {
  assert.equal(cm.addDays('2026-10-29', 7), '2026-11-05');
  assert.equal(cm.addDays('2026-12-30', 5), '2027-01-04');
  assert.equal(cm.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(cm.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(cm.addDays('2026-10-29', -60), '2026-08-30');
});

test('same date next month stays inside the month', () => {
  assert.equal(cm.addOneMonth('2026-10-29'), '2026-11-29');
  assert.equal(cm.addOneMonth('2026-01-31'), '2026-02-28');
  assert.equal(cm.addOneMonth('2028-01-31'), '2028-02-29');
  assert.equal(cm.addOneMonth('2026-12-15'), '2027-01-15');
});

test('working days between dates, inclusive, never below 1', () => {
  assert.equal(cm.workingDaysBetween('2026-10-26', '2026-10-30'), 5);
  assert.equal(cm.workingDaysBetween('2026-10-30', '2026-11-02'), 2);
  assert.equal(cm.workingDaysBetween('2026-10-31', '2026-11-01'), 1, 'a weekend counts as 1');
  assert.equal(cm.workingDaysBetween('2026-11-05', '2026-11-01'), 1, 'due before start counts as 1');
});

test('windows: week is 5 working days from today, month is one calendar month', () => {
  const w = cm.windows('2026-10-29'); // Thursday
  assert.equal(w.weekFrom, '2026-10-29');
  assert.equal(w.weekTo, '2026-11-04'); // Thu, Fri, Mon, Tue, Wed
  assert.equal(w.monthTo, '2026-11-28');
  assert.equal(w.monthWorkdays, 22); // Thu 29, Fri 30, then four full weeks to Fri 27 Nov
  assert.equal(w.weekWorkdays, 5);
});

test('windows: a weekend today starts the week on Monday', () => {
  const w = cm.windows('2026-10-31'); // Saturday
  assert.equal(w.weekFrom, '2026-11-02');
  assert.equal(w.weekTo, '2026-11-06');
  const monday = cm.windows('2026-11-02');
  assert.equal(monday.weekTo, '2026-11-06');
});

test('the month length varies with the calendar', () => {
  assert.equal(cm.windows('2026-02-02').monthWorkdays, 20); // 2 Feb to 1 Mar
  assert.equal(cm.windows('2026-03-02').monthWorkdays, 23); // 2 Mar to 1 Apr: four full weeks plus Mon-Wed
  assert.equal(cm.windows('2026-01-31').monthTo, '2026-02-27');
});

test('hours on a date: spread evenly over working days, none on weekends or after the due date', () => {
  // 10h from Mon 26 Oct to Fri 30 Oct = 2h a day
  near(cm.hoursOnDate(10, '2026-10-26', '2026-10-30', '2026-10-28'), 2);
  near(cm.hoursOnDate(10, '2026-10-26', '2026-10-30', '2026-10-31'), 0, 'Saturday');
  near(cm.hoursOnDate(10, '2026-10-26', '2026-10-30', '2026-11-02'), 0, 'after due');
  // spread across a weekend: Fri 30 Oct to Mon 2 Nov is 2 working days
  near(cm.hoursOnDate(10, '2026-10-30', '2026-11-02', '2026-10-30'), 5);
  // no start date: everything on the due date
  near(cm.hoursOnDate(6, null, '2026-10-30', '2026-10-30'), 6);
  near(cm.hoursOnDate(6, null, '2026-10-30', '2026-10-29'), 0);
  // not started yet: nothing today
  near(cm.hoursOnDate(10, '2026-11-02', '2026-11-06', '2026-10-29'), 0);
  // starts on the weekend after a Friday: counts from the Friday
  near(cm.hoursOnDate(9, '2026-10-31', '2026-11-04', '2026-10-30'), 9 / cm.workingDaysBetween('2026-10-30', '2026-11-04'));
  // no estimate or no due date
  assert.equal(cm.hoursOnDate(0, '2026-10-26', '2026-10-30', '2026-10-28'), 0);
  assert.equal(cm.hoursOnDate(5, '2026-10-26', null, '2026-10-28'), 0);
});

test('the week sum is the sum of its five working days', () => {
  const w = cm.windows('2026-10-29');
  // 100h from 14 Sep to 4 Dec = 60 working days
  const perDay = 100 / 60;
  near(cm.sumHoursOverRange(100, '2026-09-14', '2026-12-04', w.weekFrom, w.weekTo), perDay * 5, 'five working days');
  // a task that ends mid-window only counts up to its due date
  near(cm.sumHoursOverRange(60, '2026-06-15', '2026-10-30', w.weekFrom, w.weekTo), (60 / cm.workingDaysBetween('2026-06-15', '2026-10-30')) * 2);
});

test('the answer does not depend on the machine time zone', () => {
  const script = `
    const cm = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'capacityMath.js'))});
    const w = cm.windows('2026-10-29');
    const out = [w.weekTo, w.monthTo, w.monthWorkdays,
      cm.sumHoursOverRange(100, '2026-09-14', '2026-12-04', w.weekFrom, w.weekTo).toFixed(6),
      cm.sumHoursOverRange(100, '2026-09-14', '2026-12-04', w.monthFrom, w.monthTo).toFixed(6),
      cm.hoursOnDate(10, '2026-10-26', '2026-10-30', '2026-10-28').toFixed(6)];
    console.log(JSON.stringify(out));`;
  const results = ['Pacific/Auckland', 'UTC', 'America/New_York', 'Europe/London', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']
    .map((tz) => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString().trim());
  for (const r of results) assert.equal(r, results[0]);
});
