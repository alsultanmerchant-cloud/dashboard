-- 0126_agent_readonly_sql.sql
-- Read-only SQL analytics function for the in-app AI assistant.
--
-- The agent's queryDatabase tool can only fetch raw rows — it cannot count,
-- group, average, or trend. This made "deep analysis" impossible: the model
-- would pull 50 recent rows and eyeball them. This function gives the agent a
-- real analytical engine: it may run a SINGLE read-only SELECT / WITH query
-- and get aggregated results back as JSON.
--
-- Safety (owner-only tool, single-tenant deployment):
--   * statement must start with SELECT or WITH
--   * no statement separators (`;`) — blocks multi-statement injection
--   * write / DDL keywords rejected anywhere in the text (catches
--     `WITH x AS (DELETE ...)` style CTE writes)
--   * statement_timeout bounds runtime
--   * result capped at 2000 rows
--   * SECURITY DEFINER + fixed search_path

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
  v_clean := btrim(coalesce(p_sql, ''));
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

comment on function public.agent_run_readonly_sql(text) is
  'AI assistant analytics engine — runs a single read-only SELECT/WITH query, returns JSON rows (max 2000).';

revoke all on function public.agent_run_readonly_sql(text) from public;
grant execute on function public.agent_run_readonly_sql(text) to service_role;
