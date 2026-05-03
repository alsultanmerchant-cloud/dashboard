# Phase T3 — Open questions for the owner / orchestrator

## 1. Log Note attachments — no Storage bucket exists

The dispatch asked me to wire **Log Note attachments via Supabase Storage
(thumbnails for images)**. Inspection showed:

```sql
select name, public from storage.buckets;
-- → 0 rows
```

There is no bucket configured on the project. The dispatch said
"verify existing bucket; surface as a question if not configured" — so
I am NOT shipping the attachment upload UI in this phase. It is the
only row in `docs/SPEC_FROM_PDF.md §13` left at ⚠ pending.

**Owner please decide:**
1. Bucket name (suggested: `task-attachments`).
2. Public vs private (recommend **private** with signed URLs — task
   bodies frequently include client-confidential briefs).
3. Per-file size cap (suggest 25 MB, matching mail.message attachments
   size in Odoo).
4. Allowed MIME types (suggest images, PDFs, common Office formats).

Once the bucket + policy are in place I (or a follow-up phase) will:
- Add an `attachments` panel under the Log Note composer.
- Persist attachment metadata in a new `task_attachments` table linked
  to `task_comments.id` (already in T10's import scope).
- Render image thumbnails inline in the comments feed.

## 2. Per-task HOLD vs project HOLD

The PDF (§6, §7) only describes HOLD at the **project** level. Owner has
already approved per-project HOLD (shipped in migration 0019 + UI in
project detail). Migration 0023 also adds `tasks.hold_reason` +
`tasks.hold_since` for symmetry, and exposes `holdTaskAction` /
`resumeTaskAction` server actions, but no UI button yet — the per-task
HOLD button is parked until the owner confirms the use case.

If the owner does NOT want per-task HOLD, the columns + server actions
are harmless (no UI exposes them) and can be dropped in a later
migration without data loss.

## 3. `task.view_all` vs `task.manage_followers`

T2 bound `task.view_all` to owner / admin / manager / account_manager.
T3 introduces `task.manage_followers` and binds it to the same set.
Net effect: any role that can see all tasks can also curate follower
lists. The two permissions exist separately so a future role (e.g.
"Quality Control reviewer", later in T6) can be granted manage-only
without view-all. This is additive; no owner approval needed unless
the binding seems wrong.
