-- Phase 3: persistent, shared usage / cost controls.
--
-- Counters live in Postgres so limits hold across Edge Function isolates
-- (an in-memory Map alone cannot protect against concurrent callers).
-- Enforcement happens inside `consume_usage`, a SECURITY DEFINER function
-- that only ever *increments* a windowed counter atomically:
--   * the table itself is deny-by-default: RLS is enabled with no policies
--     and all grants are revoked from client roles, so no client can rewrite
--     or reset its own counters;
--   * callers with a user JWT may only consume their own budget (the
--     function rejects any other p_user_id), so a direct call can burn a
--     user's own budget faster but can never raise a limit;
--   * all parameters are clamped, so the function cannot be weaponised;
--   * the conditional `on conflict ... where count + amount <= limit`
--     increment is atomic per row: N concurrent callers can never collectively
--     exceed the limit.
--
-- The Edge Functions call this RPC with the *user's* JWT (no service-role
-- secret required). Idempotent: safe to re-run.

create table if not exists public.usage_counters (
  user_id uuid not null,
  scope text not null,
  bucket text not null,
  count bigint not null default 0,
  tokens bigint not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, bucket),
  check (count >= 0),
  check (tokens >= 0)
);

comment on table public.usage_counters is
  'Windowed usage budgets (requests / tokens) per user and scope. Server-enforced only; no client access.';

alter table public.usage_counters enable row level security;

-- Deny-by-default: drop any (accidental) client policies and all grants.
drop policy if exists "own usage rows" on public.usage_counters;
revoke all on public.usage_counters from anon, authenticated;

create index if not exists usage_counters_expires_at_idx
  on public.usage_counters (expires_at);

create or replace function public.consume_usage(
  p_user_id uuid,
  p_scope text,
  p_limit bigint,
  p_window_seconds integer,
  p_amount bigint default 1,
  p_tokens bigint default 0
)
returns table (used_count bigint, allowed boolean, used_tokens bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bucket text;
  v_count bigint;
  v_tokens bigint;
begin
  if p_user_id is null or p_scope is null then
    raise exception 'usage: user and scope are required' using errcode = '22023';
  end if;

  -- Authorization: a JWT caller may only consume its own budget; only the
  -- service role (Edge Functions) may act on behalf of a user id.
  if v_uid is null then
    if current_user not in ('service_role', 'postgres') then
      raise exception 'usage: access denied' using errcode = '42501';
    end if;
  elsif p_user_id is distinct from v_uid then
    raise exception 'usage: access denied' using errcode = '42501';
  end if;

  -- Clamp every input so a direct call cannot be weaponised.
  p_limit := least(greatest(coalesce(p_limit, 1), 1), 1000000000);
  p_window_seconds := least(greatest(coalesce(p_window_seconds, 60), 10), 172800);
  p_amount := least(greatest(coalesce(p_amount, 1), 0), 100000000);
  p_tokens := least(greatest(coalesce(p_tokens, 0), 0), 1000000000000);

  v_bucket := (floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)::bigint::text;

  -- Opportunistic pruning keeps the table small without a cron dependency.
  delete from public.usage_counters where expires_at < now();

  -- Pure check (p_amount = 0): allowed while any budget remains. Never writes.
  if p_amount = 0 then
    select coalesce(c.count, 0), coalesce(c.tokens, 0)
      into v_count, v_tokens
      from public.usage_counters c
     where c.user_id = p_user_id and c.scope = p_scope and c.bucket = v_bucket;
    return query select coalesce(v_count, 0), coalesce(v_count, 0) < p_limit, coalesce(v_tokens, 0);
    return;
  end if;

  -- An amount larger than the whole limit can never be allowed.
  if p_amount > p_limit then
    select coalesce(c.count, 0), coalesce(c.tokens, 0)
      into v_count, v_tokens
      from public.usage_counters c
     where c.user_id = p_user_id and c.scope = p_scope and c.bucket = v_bucket;
    return query select coalesce(v_count, 0), false, coalesce(v_tokens, 0);
    return;
  end if;

  insert into public.usage_counters (user_id, scope, bucket, count, tokens, expires_at)
  values (p_user_id, p_scope, v_bucket, p_amount, p_tokens,
          now() + make_interval(secs => (p_window_seconds * 2)::double precision))
  on conflict (user_id, scope, bucket) do update
     set count = usage_counters.count + excluded.count,
         tokens = usage_counters.tokens + excluded.tokens,
         expires_at = greatest(usage_counters.expires_at, excluded.expires_at),
         updated_at = now()
   where usage_counters.count + excluded.count <= p_limit
  returning count, tokens into v_count, v_tokens;

  if v_count is null then
    -- The conditional update did not apply: the limit is already reached.
    select coalesce(c.count, 0), coalesce(c.tokens, 0)
      into v_count, v_tokens
      from public.usage_counters c
     where c.user_id = p_user_id and c.scope = p_scope and c.bucket = v_bucket;
    return query select coalesce(v_count, 0), false, coalesce(v_tokens, 0);
    return;
  end if;

  return query select v_count, true, v_tokens;
end;
$$;

revoke all on function public.consume_usage(uuid, text, bigint, integer, bigint, bigint) from public, anon;
grant execute on function public.consume_usage(uuid, text, bigint, integer, bigint, bigint) to authenticated, service_role;
