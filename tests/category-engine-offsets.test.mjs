// Unit tests for the offset computation introduced in phase T4.
//
// We re-implement the contract in pure JS (mirroring src/lib/projects/offsets.ts)
// and assert the rules against the PDF §11 upload-deadline table plus the
// week-split semantics owners require for Social Media (Weeks 1/2/3).
//
// Self-running. Run any of:
//   bun run tests/category-engine-offsets.test.mjs
//   node tests/category-engine-offsets.test.mjs

import assert from 'node:assert/strict';

const ONE_DAY = 86400000;

function toDate(iso) {
  return new Date(iso.length === 10 ? iso + 'T00:00:00.000Z' : iso);
}
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * ONE_DAY); }

function computeItem({
  start, item, templateDeadlineOffsetDays, templateUploadOffsetDays, weekIndex,
}) {
  const offset = item.offset_days_from_project_start ?? 0;
  const duration = item.duration_days ?? 0;
  const baseDays = typeof templateDeadlineOffsetDays === 'number'
    ? templateDeadlineOffsetDays
    : offset + duration;
  const weekShift = weekIndex > 0 ? (weekIndex - 1) * 7 : 0;
  const deadline = addDays(toDate(start), baseDays + weekShift);
  const uploadOffset = typeof templateUploadOffsetDays === 'number'
    ? templateUploadOffsetDays
    : item.upload_offset_days_before_deadline;
  const uploadDue = typeof uploadOffset === 'number'
    ? toISO(addDays(deadline, -uploadOffset))
    : null;
  return { deadline: toISO(deadline), uploadDue };
}

const cases = [];

// 1. Sanity — start + offset + duration → deadline.
cases.push(['start + offset(0) + duration(2) = +2 days', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: null, week_index: null },
    weekIndex: 0,
  });
  assert.equal(r.deadline, '2026-05-03');
  assert.equal(r.uploadDue, null);
}]);

// 2. Upload offset clamps before deadline.
cases.push(['upload_offset 2 → deadline − 2 days', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 5, upload_offset_days_before_deadline: 2, week_index: null },
    weekIndex: 0,
  });
  assert.equal(r.deadline, '2026-05-06');
  assert.equal(r.uploadDue, '2026-05-04');
}]);

// 3. PDF §11.1 — Social Media writing weeks: −2, −3, −4.
cases.push(['SM Week 1 writing: deadline−2', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 2, week_index: 1 },
    weekIndex: 1,
  });
  // base = offset+duration = 0+2 = 2 → deadline 2026-05-03; upload = −2 = 2026-05-01.
  assert.equal(r.deadline, '2026-05-03');
  assert.equal(r.uploadDue, '2026-05-01');
}]);
cases.push(['SM Week 2 writing: shifted +7 days, upload offset 3', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 3, week_index: 2 },
    weekIndex: 2,
  });
  // base 2 + 7 = 9 → deadline 2026-05-10; upload = −3 = 2026-05-07.
  assert.equal(r.deadline, '2026-05-10');
  assert.equal(r.uploadDue, '2026-05-07');
}]);
cases.push(['SM Week 3 writing: shifted +14 days, upload offset 4', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 4, week_index: 3 },
    weekIndex: 3,
  });
  // base 2 + 14 = 16 → deadline 2026-05-17; upload = −4 = 2026-05-13.
  assert.equal(r.deadline, '2026-05-17');
  assert.equal(r.uploadDue, '2026-05-13');
}]);

// 4. PDF §11.2 — SM design weeks: deadline − 3, − 4, − 5.
cases.push(['SM Week 1 design: upload offset 3', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 3, week_index: 1 },
    weekIndex: 1,
  });
  assert.equal(r.uploadDue, '2026-04-30');
}]);
cases.push(['SM Week 2 design: upload offset 4', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 4, week_index: 2 },
    weekIndex: 2,
  });
  // base 2 + 7 = 9 → deadline 2026-05-10; upload − 4 = 2026-05-06.
  assert.equal(r.uploadDue, '2026-05-06');
}]);
cases.push(['SM Week 3 design: upload offset 5', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 5, week_index: 3 },
    weekIndex: 3,
  });
  // base 2 + 14 = 16 → deadline 2026-05-17; upload − 5 = 2026-05-12.
  assert.equal(r.uploadDue, '2026-05-12');
}]);

// 5. PDF §11 — SM stories/videos: upload Deadline − 4 (no week_index).
cases.push(['SM stories/videos: deadline − 4', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 3, upload_offset_days_before_deadline: 4, week_index: null },
    weekIndex: 0,
  });
  // base 0 + 3 = 3 → deadline 2026-05-04; upload − 4 = 2026-04-30.
  assert.equal(r.uploadDue, '2026-04-30');
}]);

// 6. PDF §11.1 — Media Buying writing: deadline − 2.
cases.push(['Media Buying writing: deadline − 2', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 2, upload_offset_days_before_deadline: 2, week_index: null },
    weekIndex: 0,
  });
  assert.equal(r.uploadDue, '2026-05-01');
}]);

// 7. PDF §11.2 — Media Buying design: deadline − 3.
cases.push(['Media Buying design: deadline − 3', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 3, upload_offset_days_before_deadline: 3, week_index: null },
    weekIndex: 0,
  });
  // deadline 2026-05-04; upload 2026-05-01.
  assert.equal(r.uploadDue, '2026-05-01');
}]);

// 8. PDF §11.2 — SEO landing page banners: deadline − 4.
cases.push(['SEO landing banners: deadline − 4', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 3, upload_offset_days_before_deadline: 4, week_index: null },
    weekIndex: 0,
  });
  assert.equal(r.uploadDue, '2026-04-30');
}]);

// 9. PDF §11.2 — SEO article banners: deadline − 5.
cases.push(['SEO article banners: deadline − 5', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 4, upload_offset_days_before_deadline: 5, week_index: null },
    weekIndex: 0,
  });
  // deadline 2026-05-05; upload 2026-04-30.
  assert.equal(r.uploadDue, '2026-04-30');
}]);

// 10. Template-level deadline_offset_days OVERRIDES per-item math.
cases.push(['template deadline_offset_days override', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 99, upload_offset_days_before_deadline: 2, week_index: null },
    templateDeadlineOffsetDays: 10,
    weekIndex: 0,
  });
  assert.equal(r.deadline, '2026-05-11');
  assert.equal(r.uploadDue, '2026-05-09');
}]);

// 11. Template-level upload_offset_days OVERRIDES per-item.
cases.push(['template upload_offset_days override', () => {
  const r = computeItem({
    start: '2026-05-01',
    item: { offset_days_from_project_start: 0, duration_days: 5, upload_offset_days_before_deadline: 2, week_index: null },
    templateUploadOffsetDays: 4,
    weekIndex: 0,
  });
  assert.equal(r.deadline, '2026-05-06');
  assert.equal(r.uploadDue, '2026-05-02');
}]);

// 12. Cross-month boundary safety.
cases.push(['cross-month: 2026-04-29 + 5 = 2026-05-04', () => {
  const r = computeItem({
    start: '2026-04-29',
    item: { offset_days_from_project_start: 0, duration_days: 5, upload_offset_days_before_deadline: null, week_index: null },
    weekIndex: 0,
  });
  assert.equal(r.deadline, '2026-05-04');
}]);

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

if (failed > 0) {
  console.error(`\n${failed} failed / ${cases.length}`);
  process.exit(1);
} else {
  console.log(`\n${cases.length} passed`);
}
