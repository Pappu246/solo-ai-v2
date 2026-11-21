-- Isolation hardening: a row may only point at parents owned by the same user.
-- RLS already stops anyone reading other people's rows; this also stops a user
-- from *attaching* their rows to someone else's conversation / project / file.
-- Applies to new and updated rows only. Idempotent.

create or replace function public.enforce_parent_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent uuid;
begin
  if tg_table_name = 'messages' then
    select user_id into parent from public.conversations where id = new.conversation_id;
    if parent is null or parent <> new.user_id then
      raise exception 'conversation not found' using errcode = 'foreign_key_violation';
    end if;
  elsif tg_table_name = 'conversations' then
    if new.project_id is not null then
      select user_id into parent from public.projects where id = new.project_id;
      if parent is null or parent <> new.user_id then
        raise exception 'project not found' using errcode = 'foreign_key_violation';
      end if;
    end if;
  elsif tg_table_name = 'files' then
    if new.project_id is not null then
      select user_id into parent from public.projects where id = new.project_id;
      if parent is null or parent <> new.user_id then
        raise exception 'project not found' using errcode = 'foreign_key_violation';
      end if;
    end if;
    if new.conversation_id is not null then
      select user_id into parent from public.conversations where id = new.conversation_id;
      if parent is null or parent <> new.user_id then
        raise exception 'conversation not found' using errcode = 'foreign_key_violation';
      end if;
    end if;
  elsif tg_table_name = 'memories' then
    if new.project_id is not null then
      select user_id into parent from public.projects where id = new.project_id;
      if parent is null or parent <> new.user_id then
        raise exception 'project not found' using errcode = 'foreign_key_violation';
      end if;
    end if;
    if new.source_conversation_id is not null then
      select user_id into parent from public.conversations where id = new.source_conversation_id;
      if parent is null or parent <> new.user_id then
        raise exception 'conversation not found' using errcode = 'foreign_key_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_parent_ownership() from public, anon, authenticated;

drop trigger if exists trg_parent_ownership on public.messages;
create trigger trg_parent_ownership before insert or update of conversation_id, user_id on public.messages
  for each row execute function public.enforce_parent_ownership();
drop trigger if exists trg_parent_ownership on public.conversations;
create trigger trg_parent_ownership before insert or update of project_id, user_id on public.conversations
  for each row execute function public.enforce_parent_ownership();
drop trigger if exists trg_parent_ownership on public.files;
create trigger trg_parent_ownership before insert or update of project_id, conversation_id, user_id on public.files
  for each row execute function public.enforce_parent_ownership();
drop trigger if exists trg_parent_ownership on public.memories;
create trigger trg_parent_ownership before insert or update of project_id, source_conversation_id, user_id on public.memories
  for each row execute function public.enforce_parent_ownership();
