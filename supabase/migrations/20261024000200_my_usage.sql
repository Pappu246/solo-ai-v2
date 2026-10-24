-- Read-only view of the caller's own daily usage, for the Settings screen.
-- usage_counters stays deny-by-default for clients; this function can only
-- ever return the signed-in user's own current-day counters. Idempotent.
create or replace function public.my_usage()
returns table (scope text, used bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.scope, c.count as used
  from public.usage_counters c
  where c.user_id = auth.uid()
    and c.expires_at > now()
    and c.scope in ('chat_day', 'image_day');
$$;

revoke all on function public.my_usage() from public, anon;
grant execute on function public.my_usage() to authenticated;
