-- Phase 3 hardening: make usage limits tamper-proof while keeping the
-- existing `USAGE_*` env-override contract intact.
--
-- The original `consume_usage` clamped p_limit/p_window_seconds into a range
-- but let the caller *choose* both, and accepted any p_scope. Because the RPC
-- is granted to `authenticated` (Edge Functions call it with the user's JWT,
-- no service-role secret), any signed-in user could call it directly with an
-- arbitrary `p_scope` and an inflated `p_limit`, minting unbounded counter
-- rows and raising their own budget above the operator's configuration. This
-- migration closes that while preserving backwards compatibility:
--
--   * `p_scope` must be one of the known scopes (allow-list). Unknown scopes
--     raise 42501 instead of being written, so no unbounded counter creation.
--   * the effective limit is `least(p_limit, ceiling_for_scope)`. A client may
--     lower its own limit (the env-override feature) but can never raise it
--     above the hard ceiling configured here, so limits stay operator-bounded.
--   * `p_window_seconds` is ignored and forced to the canonical window for the
--     scope, so a client cannot shard a budget across finer buckets to gain
--     extra throughput.
--   * `p_amount` / `p_tokens` are validated (non-null, non-negative, bounded)
--     rather than silently inflated from garbage.
--   * the opportunistic prune is rate-limited by an advisory lock so a hot call
--     path cannot turn every request into a full-table DELETE.
--   * the atomic `on conflict ... where count + amount <= limit` increment and
--     the self-only JWT ownership check are unchanged, so atomic accounting,
--     legitimate user ownership and the public chat/image APIs keep working.
--
-- Ceilings are set at the operator ceiling for each scope; if an operator needs
-- a higher budget they raise it here (or via a future config table), not from
-- the client. Idempotent: safe to re-run.

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
  v_window integer;
  v_ceiling bigint;
  v_limit bigint;
  v_prune_key text;
begin
  if p_user_id is null or p_scope is null then
    raise exception 'usage: user and scope are required' using errcode = '22023';
  end if;

  -- Authorization: a JWT caller may only consume its own budget; only the
  -- service role (Edge Functions / migrations) may act on behalf of a user id.
  if v_uid is null then
    if current_user not in ('service_role', 'postgres') then
      raise exception 'usage: access denied' using errcode = '42501';
    end if;
  elsif p_user_id is distinct from v_uid then
    raise exception 'usage: access denied' using errcode = '42501';
  end if;

  -- Server-authoritative scope allow-list: canonical window and operator
  -- ceiling per scope. Unknown scopes are rejected outright.
  case p_scope
    when 'chat_minute'   then begin v_window := 60;      v_ceiling := 10000;      end;
    when 'chat_day'      then begin v_window := 86400;   v_ceiling := 1000000;    end;
    when 'chat_tokens'   then begin v_window := 86400;   v_ceiling := 1000000000; end;
    when 'image_minute'  then begin v_window := 60;      v_ceiling := 10000;      end;
    when 'image_day'     then begin v_window := 86400;   v_ceiling := 1000000;    end;
    else raise exception 'usage: scope not permitted' using errcode = '42501';
  end case;

  -- The effective limit is bounded by the operator ceiling. A caller may pass a
  -- lower limit (env-override / tightened policy) but can never exceed it, and
  -- nulls fall back to the ceiling. Window is forced, never caller-chosen.
  v_limit := least(coalesce(p_limit, v_ceiling), v_ceiling);
  if v_limit < 1 then
    raise exception 'usage: limit out of range' using errcode = '22023';
  end if;

  -- Validate the remaining inputs instead of silently inflating them. A single
  -- call cannot book an absurd amount or token count in one shot.
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception 'usage: amount out of range' using errcode = '22023';
  end if;
  if p_tokens is null or p_tokens < 0 or p_tokens > 1000000000000 then
    raise exception 'usage: tokens out of range' using errcode = '22023';
  end if;

  v_bucket := (floor(extract(epoch from now()) / v_window) * v_window)::bigint::text;

  -- Opportunistic pruning keeps the table small without a cron dependency,
  -- but only for this user's expired rows and at most once per transaction, so
  -- a hot call path cannot turn every request into a full-table DELETE.
  v_prune_key := 'usage_prune:' || p_user_id::text;
  if pg_try_advisory_xact_lock(hashtext(v_prune_key)) then
    delete from public.usage_counters
      where user_id = p_user_id and scope = p_scope and expires_at < now();
  end if;

  -- Pure check (p_amount = 0): allowed while any budget remains. Never writes.
  if p_amount = 0 then
    select coalesce(c.count, 0), coalesce(c.tokens, 0)
      into v_count, v_tokens
      from public.usage_counters c
     where c.user_id = p_user_id and c.scope = p_scope and c.bucket = v_bucket;
    return query select coalesce(v_count, 0), coalesce(v_count, 0) < v_limit, coalesce(v_tokens, 0);
    return;
  end if;

  -- An amount larger than the whole limit can never be allowed.
  if p_amount > v_limit then
    select coalesce(c.count, 0), coalesce(c.tokens, 0)
      into v_count, v_tokens
      from public.usage_counters c
     where c.user_id = p_user_id and c.scope = p_scope and c.bucket = v_bucket;
    return query select coalesce(v_count, 0), false, coalesce(v_tokens, 0);
    return;
  end if;

  insert into public.usage_counters (user_id, scope, bucket, count, tokens, expires_at)
  values (p_user_id, p_scope, v_bucket, p_amount, p_tokens,
          now() + make_interval(secs => (v_window * 2)::double precision))
  on conflict (user_id, scope, bucket) do update
     set count = usage_counters.count + excluded.count,
         tokens = usage_counters.tokens + excluded.tokens,
         expires_at = greatest(usage_counters.expires_at, excluded.expires_at),
         updated_at = now()
   where usage_counters.count + excluded.count <= v_limit
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
