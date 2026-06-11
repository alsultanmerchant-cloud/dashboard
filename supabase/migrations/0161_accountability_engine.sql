-- 0161_accountability_engine.sql
-- Accountability Engine audit fixes (DB layer).
--
-- Finding: public.business_minutes_between (0025) counted every Sun–Thu
-- 09:00–17:00 Riyadh minute with NO holiday lookup, although 0055 added a
-- per-org `holidays` table (incl. recurring month/day holidays) and the
-- day-level calendar functions (is_working_day / working_days_between /
-- add_working_days) already honor it. Result: stage-dwell business minutes
-- (accountability scorecard, SLA breach math, reporting views, activity
-- audit) were inflated by 480 phantom minutes per weekday holiday — e.g.
-- Eid al-Adha 2026-05-27/28 (seeded, weekdays) added 960 min to any
-- interval spanning them.
--
-- Fix: holiday-aware day loop. Holidays are loaded ONCE per call into two
-- arrays (exact dates + recurring month*100+day keys) so per-day checks are
-- array lookups, not per-day subqueries. Single-tenant deployment (Sky Light
-- only — one organization row), so holidays are read without an org filter;
-- this avoids changing the (timestamptz, timestamptz) signature every
-- caller (0029 reporting views, 0147 activity audit, accountability loader)
-- depends on. The function stays STABLE; it now reads `holidays`, which is
-- fine for STABLE (it was never inlined — plpgsql).
--
-- NOTE on the rest of the audit: the accountability metric fixes (30-day
-- measurement window, open-already-breached SLA intervals, reviewer rigor
-- stage-history fallback, median review time, rework-after-pass, Tier-B
-- signal pool/linkage, confidence gating) live in the loader
-- src/lib/data/accountability.ts — there are no v_acc_* views or snapshot
-- tables to refresh; every page load computes live via agent_run_readonly_sql.

create or replace function public.business_minutes_between(p_start timestamptz, p_end timestamptz)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_start timestamptz := least(p_start, p_end);
  v_end   timestamptz := greatest(p_start, p_end);
  v_total integer := 0;
  v_day   date;
  v_last  date;
  v_dow   integer;
  v_open  timestamptz;
  v_close timestamptz;
  v_a     timestamptz;
  v_b     timestamptz;
  v_holiday_dates date[];
  v_recurring_md  integer[]; -- month*100 + day keys for recurring holidays
begin
  if v_start is null or v_end is null or v_start >= v_end then
    return 0;
  end if;

  -- iterate by Riyadh-local day so weekday + open/close map cleanly
  v_day  := (v_start at time zone 'Asia/Riyadh')::date;
  v_last := (v_end   at time zone 'Asia/Riyadh')::date;

  -- Load the holiday calendar once per call (single-tenant: no org filter,
  -- mirroring is_working_day's matching rules from 0055).
  select coalesce(array_agg(h.holiday_date) filter (where not h.recurring), '{}'),
         coalesce(array_agg(distinct (extract(month from h.holiday_date) * 100
                                    + extract(day   from h.holiday_date))::int)
                  filter (where h.recurring), '{}')
    into v_holiday_dates, v_recurring_md
    from public.holidays h;

  while v_day <= v_last loop
    -- Postgres EXTRACT(DOW): 0=Sun, 1=Mon, ..., 6=Sat. Work week: Sun..Thu.
    v_dow := extract(dow from v_day)::int;
    if v_dow between 0 and 4
       and not (v_day = any (v_holiday_dates))
       and not ((extract(month from v_day) * 100 + extract(day from v_day))::int
                = any (v_recurring_md)) then
      v_open  := (v_day::timestamp + time '09:00') at time zone 'Asia/Riyadh';
      v_close := (v_day::timestamp + time '17:00') at time zone 'Asia/Riyadh';
      v_a := greatest(v_start, v_open);
      v_b := least(v_end,   v_close);
      if v_b > v_a then
        v_total := v_total + floor(extract(epoch from (v_b - v_a)) / 60.0)::int;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return v_total;
end;
$$;

comment on function public.business_minutes_between is
  'Minutes inside Sun–Thu 09:00–17:00 Asia/Riyadh between two timestamps, excluding holidays (exact-date and recurring, per 0055). STABLE; reads public.holidays once per call. Single-tenant: holidays apply org-wide.';

-- ---------------------------------------------------------------------------
-- agent_run_readonly_sql (0126) hardening, found while re-verifying the
-- accountability loaders through the real RPC path: btrim(text) strips
-- SPACES only, so a statement that starts with a newline (every template
-- literal in src/lib/data/*.ts does) fails the `^(select|with)` check and
-- the whole query is rejected. Trim all ASCII whitespace instead. Body is
-- otherwise identical to 0126.
create or replace function public.agent_run_readonly_sql(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean  text;
  v_result jsonb;
begin
  v_clean := btrim(coalesce(p_sql, ''), E' \t\r\n');
  -- drop a single trailing semicolon if present
  v_clean := regexp_replace(v_clean, ';\s*$', '');

  if v_clean = '' then
    raise exception 'Empty query';
  end if;

  -- must be a single read statement
  if v_clean !~* '^(select|with)\s' then
    raise exception 'Only SELECT / WITH queries are allowed';
  end if;

  -- no remaining statement separators
  if position(';' in v_clean) > 0 then
    raise exception 'Multiple statements are not allowed';
  end if;

  -- reject write / DDL keywords anywhere (word-boundary matched)
  if v_clean ~* '\m(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|reindex|merge|call|do|set)\M' then
    raise exception 'Write / DDL keywords are not allowed in analytics queries';
  end if;

  -- bound runtime for this statement only
  perform set_config('statement_timeout', '12000', true);

  execute format(
    'select coalesce(jsonb_agg(row_to_json(sub)), ''[]''::jsonb) '
    || 'from (select * from (%s) q limit 2000) sub',
    v_clean
  )
  into v_result;

  return v_result;
end;
$$;
