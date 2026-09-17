/* schedule.js — Worker B (templates + admin)
   Thin helpers on top of core Sched + Data for "is this due / locked / done"
   questions used by Home, Checklists, and Reports. Exported as global `Schedule`.
   Never touches localStorage directly — reads only via Data.*. */

'use strict';

const Schedule = (() => {

  function parseDayKey(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0); // noon avoids DST edge cases
    return dt;
  }

  function submissionMatches(sub, tpl, storeId, periodKey) {
    if (sub.templateId !== tpl.id || sub.storeId !== storeId) return false;
    if (sub.status !== 'submitted') return false;
    if (periodKey === null) return true; // adhoc: any submission counts as "done" for that check
    return sub.periodKey === periodKey;
  }

  /* dueToday(tpl, store, now) -> {due, done, locked, opensAt}
     due: this cadence expects one completion for "now"'s period (false for adhoc).
     done: a submitted submission already exists for that period at this store.
     locked/opensAt: from core Sched.isOpen (time-lock window). */
  function dueToday(tpl, store, now = new Date()) {
    const periodKey = Sched.periodKey(tpl.cadence, now, tpl);
    const due = periodKey !== null; // adhoc templates have no daily due-ness
    let done = false;
    if (due) {
      const subs = Data.list('submissions');
      done = subs.some(s => submissionMatches(s, tpl, store.id, periodKey));
    }
    const openState = Sched.isOpen(tpl, now);
    return { due, done, locked: !openState.open, opensAt: openState.opensAt || null };
  }

  /* expectedCount(tpl, dateRange) -> how many completions are expected at ONE store
     between dateRange.start and dateRange.end (inclusive), for Reports' completion
     matrix / expected-vs-actual math. dateRange values may be Date or ISO string.
     Adhoc templates have no fixed cadence -> 0 expected. */
  function expectedCount(tpl, dateRange) {
    if (!tpl.window && tpl.cadence === 'adhoc') return 0;
    if (tpl.cadence === 'adhoc') return 0;
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    if (isNaN(start) || isNaN(end) || start > end) return 0;
    const seen = new Set();
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
    while (cur <= last) {
      const pk = Sched.periodKey(tpl.cadence, cur);
      if (pk !== null) seen.add(pk);
      cur.setDate(cur.getDate() + 1);
    }
    return seen.size;
  }

  /* statusFor(tpl, storeId, dayKey) -> 'done'|'missed'|'locked'|'upcoming'|'na'
     Reads Data.list('submissions'). dayKey is a UI.dayKey()-format string
     ('YYYY-MM-DD') representing the calendar day being evaluated (e.g. one cell
     in the Reports completion matrix). */
  function statusFor(tpl, storeId, dayKey) {
    if (tpl.cadence === 'adhoc') return 'na';

    const dayDate = parseDayKey(dayKey);
    const periodKey = Sched.periodKey(tpl.cadence, dayDate, tpl);
    const subs = Data.list('submissions');
    const done = subs.some(s => submissionMatches(s, tpl, storeId, periodKey));
    if (done) return 'done';

    const today = new Date();
    const todayKey = UI.dayKey(today);

    if (dayKey > todayKey) return 'upcoming';

    if (dayKey === todayKey) {
      const openState = Sched.isOpen(tpl, today);
      if (openState.open) return 'upcoming'; // due today, window open, not yet done
      // window closed: either not-yet-open (locked) or already passed (missed)
      if (tpl.window) {
        const h = today.getHours() + today.getMinutes() / 60;
        const { startHH, endHH } = tpl.window;
        const beforeOpen = startHH <= endHH ? (h < startHH) : (h < startHH && h >= endHH);
        return beforeOpen ? 'locked' : 'missed';
      }
      return 'locked';
    }

    return 'missed'; // dayKey < todayKey, not done
  }

  return { dueToday, expectedCount, statusFor };
})();
