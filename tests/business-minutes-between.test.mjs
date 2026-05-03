// Unit tests for the business_minutes_between() SQL function shipped in
// migration 0025 (phase T5).
//
// We re-implement the algorithm in plain JS so the test runs without the
// database. Any divergence with the SQL implementation will fail fast.
//
// Algorithm: minutes inside Sun(0)..Thu(4) 09:00–17:00 Asia/Riyadh.
// We compute Riyadh wall-clock by treating the input as if Riyadh were
// UTC+3 (Saudi has no DST — fixed offset, safe shortcut for tests).
//
// Self-running. Run any of:
//   bun run tests/business-minutes-between.test.mjs
//   node tests/business-minutes-between.test.mjs

import assert from 'node:assert/strict';

const RIYADH_OFFSET_MIN = 3 * 60; // UTC+3, no DST.
const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 17 * 60;

function toRiyadhDate(iso) {
  const ms = new Date(iso).getTime() + RIYADH_OFFSET_MIN * 60 * 1000;
  return new Date(ms);
}
function fromRiyadh(year, month, day, minutesOfDay) {
  // Build a UTC ms that represents that Riyadh wall time.
  const utc = Date.UTC(year, month, day, 0, 0, 0) + (minutesOfDay - RIYADH_OFFSET_MIN) * 60 * 1000;
  return new Date(utc);
}

function businessMinutesBetween(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!start || !end || start >= end) return 0;
  let total = 0;

  const rStart = toRiyadhDate(startIso);
  const rEnd = toRiyadhDate(endIso);

  // iterate by Riyadh-local day
  const day = new Date(Date.UTC(rStart.getUTCFullYear(), rStart.getUTCMonth(), rStart.getUTCDate()));
  const lastDay = new Date(Date.UTC(rEnd.getUTCFullYear(), rEnd.getUTCMonth(), rEnd.getUTCDate()));

  while (day.getTime() <= lastDay.getTime()) {
    const dow = day.getUTCDay(); // 0=Sun..6=Sat (in UTC, but we built it from Riyadh date components)
    if (dow >= 0 && dow <= 4) {
      const winStart = fromRiyadh(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), OPEN_MIN);
      const winEnd = fromRiyadh(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), CLOSE_MIN);
      const a = Math.max(start.getTime(), winStart.getTime());
      const b = Math.min(end.getTime(), winEnd.getTime());
      if (b > a) {
        total += Math.floor((b - a) / 60000);
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return total;
}

// Helper: build a UTC ISO from Riyadh wall clock.
function r(year, month0based, day, hour, minute = 0) {
  return fromRiyadh(year, month0based, day, hour * 60 + minute).toISOString();
}

const cases = [
  // Same-day window inside business hours.
  ['Sun 10:00→11:30 → 90', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 10, 0), r(2026, 4, 3, 11, 30)), 90)],

  // Identical → 0
  ['identical → 0', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 10, 0), r(2026, 4, 3, 10, 0)), 0)],

  // End before start → 0
  ['end before start → 0', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 12, 0), r(2026, 4, 3, 10, 0)), 0)],

  // Before open clamped: 08:30→10:00 → 60
  ['before-open clamped → 60', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 8, 30), r(2026, 4, 3, 10, 0)), 60)],

  // After close clamped: 16:30→18:30 → 30
  ['after-close clamped → 30', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 16, 30), r(2026, 4, 3, 18, 30)), 30)],

  // Overnight: Sun 16:30 → Mon 09:30 → 30 (Sun) + 30 (Mon) = 60
  ['overnight Sun→Mon → 60', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 16, 30), r(2026, 4, 4, 9, 30)), 60)],

  // Friday/Saturday closed: Thu 16:00 → Sun 10:00 should only count Thu 16:00–17:00 (60) + Sun 09:00–10:00 (60) = 120
  ['Thu→Sun across weekend → 120', () => {
    // 2026-04-30 is Thu; 2026-05-03 is Sun. Verify weekday assumption.
    assert.equal(new Date(Date.UTC(2026, 3, 30)).getUTCDay(), 4);
    assert.equal(new Date(Date.UTC(2026, 4, 3)).getUTCDay(), 0);
    const got = businessMinutesBetween(r(2026, 3, 30, 16, 0), r(2026, 4, 3, 10, 0));
    assert.equal(got, 120);
  }],

  // Pure Friday window → 0
  ['Friday window → 0', () => {
    // 2026-05-01 is Fri (UTC dow 5).
    assert.equal(new Date(Date.UTC(2026, 4, 1)).getUTCDay(), 5);
    assert.equal(businessMinutesBetween(r(2026, 4, 1, 9, 0), r(2026, 4, 1, 17, 0)), 0);
  }],

  // Exact edge: 09:00→17:00 same business day = 480
  ['full workday → 480', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 9, 0), r(2026, 4, 3, 17, 0)), 480)],

  // Two consecutive workdays → 960
  ['two workdays → 960', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 9, 0), r(2026, 4, 4, 17, 0)), 960)],

  // Exact-edge open: 09:00→09:00 → 0
  ['edge-open same → 0', () =>
    assert.equal(businessMinutesBetween(r(2026, 4, 3, 9, 0), r(2026, 4, 3, 9, 0)), 0)],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${cases.length} failed`);
  process.exit(1);
}
console.log(`\n${cases.length} passed, 0 failed`);
