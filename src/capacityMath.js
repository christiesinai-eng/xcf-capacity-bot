'use strict';
// Capacity arithmetic, shared by the build (Node) and the dashboard page (browser).
//
// Every date is a 'YYYY-MM-DD' string and is turned into a whole day number before any sums, so the
// answer is the same on a laptop in Auckland, London or New York. (The earlier version used local Date
// objects and toISOString(), which shifted dates back a day on a machine ahead of UTC and made the
// week and month totals depend on where the build ran.)
//
// Rules, agreed 29 Oct 2026:
//   Today  : hours falling on today.
//   Week   : the next 5 working days, starting today (or the next working day if today is a weekend).
//   Month  : from today up to the day before the same date next month; capacity is the number of
//            working days in that span (about 20 to 23, so it differs from month to month).
//   A working day is Monday to Friday. Public holidays are not taken off.
//   A task's estimate is spread evenly over the working days from its start to its due date; with no
//   start date, all of it falls on the due date.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapacityMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const MS_PER_DAY = 86400000;

  // 'YYYY-MM-DD' -> whole days since 1 Jan 1970 (UTC, so no time zone or daylight saving involved)
  function dayNumber(str) {
    const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
  }
  const dateString = (n) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

  // 1 Jan 1970 was a Thursday. 0 = Monday ... 6 = Sunday.
  const weekdayIndex = (n) => (((n % 7) + 10) % 7);
  const isWorkingDay = (n) => weekdayIndex(n) < 5;

  const addDays = (str, n) => dateString(dayNumber(str) + n);

  // Same date next month, kept inside the month (31 Jan + 1 month = 28 Feb).
  function addOneMonth(str) {
    const [y, m, d] = str.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }

  // Working days from start to end inclusive; never less than 1 (a task due before it starts counts as 1).
  function workingDaysBetween(startStr, endStr) {
    const a = dayNumber(startStr);
    const b = dayNumber(endStr);
    if (a > b) return 1;
    let count = 0;
    for (let n = a; n <= b; n++) if (isWorkingDay(n)) count++;
    return Math.max(count, 1);
  }

  // Hours a task contributes on one date.
  function hoursOnDate(estimatedHours, startDate, dueDate, targetStr) {
    if (!estimatedHours || !dueDate) return 0;
    const target = dayNumber(targetStr);
    const due = dayNumber(dueDate);
    if (target > due) return 0;
    if (!isWorkingDay(target)) return 0;
    if (!startDate) return due === target ? estimatedHours : 0;

    const start = dayNumber(startDate);
    // A task that starts on or after the next working day contributes nothing today.
    if (start > target) {
      let next = target + 1;
      while (!isWorkingDay(next)) next++;
      if (start >= next) return 0;
    }
    const effectiveStart = start > target ? target : start;
    return estimatedHours / workingDaysBetween(dateString(effectiveStart), dueDate);
  }

  // Total hours over fromStr..toStr inclusive.
  function sumHoursOverRange(estimatedHours, startDate, dueDate, fromStr, toStr) {
    let total = 0;
    for (let n = dayNumber(fromStr); n <= dayNumber(toStr); n++) {
      if (isWorkingDay(n)) total += hoursOnDate(estimatedHours, startDate, dueDate, dateString(n));
    }
    return total;
  }

  // The week and month windows for a given "today" ('YYYY-MM-DD', NZT).
  function windows(todayStr, weekDays) {
    const weekLength = weekDays || 5;
    let n = dayNumber(todayStr);
    while (!isWorkingDay(n)) n++;
    const weekFrom = dateString(n);
    let seen = 0;
    let weekEnd = n;
    for (let d = n; seen < weekLength; d++) if (isWorkingDay(d)) { seen++; weekEnd = d; }
    const monthEnd = addDays(addOneMonth(todayStr), -1);
    return {
      today: todayStr,
      weekFrom,
      weekTo: dateString(weekEnd),
      weekWorkdays: weekLength,
      monthFrom: todayStr,
      monthTo: monthEnd,
      monthWorkdays: workingDaysBetween(todayStr, monthEnd),
    };
  }

  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;

  return { dayNumber, dateString, weekdayIndex, isWorkingDay, addDays, addOneMonth, workingDaysBetween, hoursOnDate, sumHoursOverRange, windows, round1, round2 };
}));
