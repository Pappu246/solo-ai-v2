-- Storage abuse limits. Any signed-up user can write their own rows, so cap what
-- one account can store. Limits are far above normal use (largest real data today:
-- 47 chats per user, 39 messages per chat, 15k characters per message).
-- NOT VALID: applies to new and updated rows only, so existing data is never rejected.
-- Idempotent.

do $limits$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_content_max_length' and conrelid = 'public.messages'::regclass) then
    alter table public.messages
      add constraint messages_content_max_length check (char_length(content) <= 200000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_title_max_length' and conrelid = 'public.conversations'::regclass) then
    alter table public.conversations
      add constraint conversations_title_max_length check (char_length(title) <= 300) not valid;
  end if;
end
$limits$;

create or replace function public.enforce_conversation_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from (select 1 from public.conversations where user_id = new.user_id limit 5000) s) >= 5000 then
    raise exception 'conversation limit reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_message_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from (select 1 from public.messages where conversation_id = new.conversation_id limit 5000) s) >= 5000 then
    raise exception 'message limit reached for this chat' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_cap on public.conversations;
create trigger conversations_cap before insert on public.conversations
  for each row execute function public.enforce_conversation_cap();

drop trigger if exists messages_cap on public.messages;
create trigger messages_cap before insert on public.messages
  for each row execute function public.enforce_message_cap();
