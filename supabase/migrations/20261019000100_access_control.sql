-- Approval-based access: new users can sign up, but may only use the AI
-- functions once the owner approves them. The owner's own account is
-- recognised by email in the Edge Functions (OWNER_EMAIL secret) and never
-- needs a row here.
--
-- Clients can read their OWN row and create their OWN *pending* row. They can
-- never update or delete it, so nobody can approve themselves. Approval is
-- written by the `access-approve` Edge Function (service role) after the owner
-- confirms a signed, expiring link. Idempotent: safe to re-run.

create table if not exists public.user_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.user_access enable row level security;

drop policy if exists "user_access: read own" on public.user_access;
create policy "user_access: read own"
  on public.user_access for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_access: request own" on public.user_access;
create policy "user_access: request own"
  on public.user_access for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending' and decided_at is null);

revoke all on public.user_access from anon, authenticated;
grant select, insert on public.user_access to authenticated;
