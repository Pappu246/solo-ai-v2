-- In-app feedback. Signed-in users can add their own feedback (insert-only);
-- nobody but the project owner (service role / SQL editor) can read it.
-- Idempotent.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  category text not null default 'idea' check (category in ('bug', 'idea', 'praise', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  page text check (page is null or char_length(page) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- No select/update/delete policy: users cannot read back or edit feedback.
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to authenticated;

create or replace function public.enforce_feedback_rate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.feedback
        where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'feedback limit reached for today' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_rate on public.feedback;
create trigger feedback_rate before insert on public.feedback
  for each row execute function public.enforce_feedback_rate();
