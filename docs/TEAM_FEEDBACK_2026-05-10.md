# Sky Light team feedback — 2026-05-10

Source: WhatsApp group "Sky Light AI System", messages 3:08 PM → 4:23 PM (and the 4:41 PM Thursday note about per-task design counters).

Triage rule: **bugs first → schema/log gaps → UI parity → new features**.

## Bugs (block correct usage)

1. **Show project name next to task name** instead of project ID. *(UI label)*
2. **Project page shows all system tasks**, not just the project's tasks. *(scoping bug — high priority)*
3. **Project-create wizard skipped 3 steps** (same regression seen in the meeting).
4. **Hold state has no actor/timestamp** — can't see who put a project on hold or when.
5. **Notifications still render the ID** instead of the human-readable code/name (PRJ-007 etc.).
6. **Followers picker** doesn't open the dropdown to choose a follower.
7. **State changes missing from activity log** — no record of who changed the state and when.
8. **Reports section** — "Average stay per stage" and "Delay distribution" widgets render an empty black banner.
9. **AI assistant loses chat history** when opening a new chat or navigating away and back.
10. **"Create new task" action missing inside a Service**.
11. **Private-message icon was added but can't reach the historical chat** between the manager and the employee.

## Feature requests

12. **Multi-package selection** — allow choosing more than one package together.
13. **Surface employee position/role at each stage** by name (depends on org/department setup so each employee has an associated position auto-displayed).
14. **"All Documents" tab cleanup** in project info (team says it's a stray section that shouldn't be there yet — confirm scope).
15. **Add a Rwasem-style section** referenced by screenshot (4:08 PM — clarify exactly which section).
16. **Holiday / skip-date deadline shifting** — official Saudi holidays + ad-hoc skips should slide downstream deadlines. Needed at **project level AND across all projects globally**. *Foundation already exists (migration 0055 — `holidays`, `is_working_day`, `add_working_days`); this is wiring + UX.*
17. **Repurpose the Calendar** — current project-deadline calendar view isn't useful (start/end too unstable). Re-aim it at **personal schedules / reminders** an employee creates for themselves.
18. **Filters parity with Rwasem (Odoo)** — filter behaviour should match what they're used to in Odoo.
19. **Two columns inside the task** *(from Thursday 4:41 PM)*: count of **designs** and count of **edits/revisions**, with a **monthly-total filter** for closing.

## Implementation order (proposed)

| Step | Item | Why first |
|------|------|-----------|
| 1 | #1 project name next to task name | Tiny UI change, immediate visible win |
| 2 | #2 project→tasks scoping bug | Correctness — they can't trust the page until fixed |
| 3 | #7 state-change activity log | Audit gap, complements #4 |
| 4 | #4 hold actor/timestamp | Same audit family as #7 |
| 5 | #5 notification labels | Same family — get the readable codes everywhere |
| 6 | #6 followers picker | UI fix |
| 7 | #8 reports empty widgets | Likely a query/permission issue |
| 8 | #16 holiday-driven deadline shifts | Big value, foundation already laid |
| 9 | #19 designs vs. edits counters | Schema work — clear scope |
| 10 | #18 filter parity | Larger, do after the above bugs |
| 11+ | rest | Clarify remaining scope with owner before starting |

Items needing clarification before coding: **#3** (which 3 wizard steps), **#10** (which Service screen exactly), **#11** (private-DM data model), **#14** (which "All Documents"), **#15** (which Rwasem section, screenshot), **#13** (department/position seed data).
